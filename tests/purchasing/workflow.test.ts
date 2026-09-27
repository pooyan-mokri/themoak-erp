import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { prisma, resetDatabase } from '../helpers/db';
import { beforeQuery } from '../helpers/hooks';
import { setTestRole } from '../stubs/auth';
import { recordArrival, recordPurchasePartialPayment, recordPurchasePayment, updatePurchaseOrderStatus } from '@/actions/supplier-workflow';
import { DUPLICATE_REQUEST_MESSAGE } from '@/lib/request-id';
import { balanceOf } from '../accounting/ledger';
import { EUR_RATE, OPENING, USD_RATE, assertPurchaseInvariants, order, purchasingWorld, type World } from './world';

// The purchase-order lifecycle: status moves, full and partial payments with their account transactions,
// and arrival costs in Toman and other currencies.

console.error = () => {};

const DENIED = 'شما به این بخش دسترسی ندارید.';
let w: World;

beforeEach(async () => {
  setTestRole('ADMIN');
  beforeQuery.fn = null;
  await resetDatabase();
  w = await purchasingWorld();
});
after(() => prisma.$disconnect());

const statusOf = async (id: string) => (await prisma.purchaseOrder.findUniqueOrThrow({ where: { id } })).status;
const tenFrames = (status = 'DRAFT') =>
  order(w, [{ productId: w.panj.id, quantity: 10, unitCost: 100_000 }], [{ title: 'حمل', amount: 200_000, currency: 'TOMAN' }], status);

// --- status ---

test('status: every allowed move goes through; every other one is refused in Persian and changes nothing', async () => {
  const allowed: Record<string, string[]> = {
    DRAFT: ['PENDING_PAYMENT', 'CANCELLED'],
    PENDING_PAYMENT: ['PARTIALLY_PAID', 'PAID', 'CANCELLED'],
    PARTIALLY_PAID: ['PAID', 'CANCELLED'],
    PAID: ['IN_PRODUCTION', 'CANCELLED'],
    IN_PRODUCTION: ['ARRIVED', 'CANCELLED'],
    ARRIVED: ['RECEIVED', 'CANCELLED'],
    PARTIALLY_RECEIVED: [],
    RECEIVED: [],
    CANCELLED: [],
  };
  const all = Object.keys(allowed);
  for (const from of all) {
    for (const to of all) {
      const po = await tenFrames(from);
      const result = await updatePurchaseOrderStatus(po.id, to);
      if (allowed[from].includes(to)) {
        assert.deepEqual(result, { success: true, message: 'وضعیت سفارش به‌روزرسانی شد' }, `${from} → ${to}`);
        assert.equal(await statusOf(po.id), to);
      } else {
        assert.equal(result.success, false, `${from} → ${to}`);
        assert.match(result.message!, /^تغییر وضعیت از «.+» به «.+» مجاز نیست$/, `${from} → ${to}`);
        assert.doesNotMatch(result.message!, /[A-Z_]{4,}/, 'no raw status code');
        assert.equal(await statusOf(po.id), from);
      }
    }
  }
  assert.deepEqual(await updatePurchaseOrderStatus('missing', 'CANCELLED'), { success: false, message: 'سفارش یافت نشد' });
});

test('status: procurement moves take stock.manage or finance.manage; paid moves take finance.manage', async () => {
  const draft = await tenFrames();
  const pending = await tenFrames('PENDING_PAYMENT');
  for (const role of ['AUDITOR', 'SALES', 'PROJECT_MANAGER', 'USER', null]) {
    setTestRole(role);
    assert.equal((await updatePurchaseOrderStatus(draft.id, 'PENDING_PAYMENT')).message, DENIED, String(role));
  }
  setTestRole('WAREHOUSE');
  assert.equal((await updatePurchaseOrderStatus(pending.id, 'PAID')).message, DENIED);
  assert.equal((await updatePurchaseOrderStatus(pending.id, 'PARTIALLY_PAID')).message, DENIED);
  assert.equal((await updatePurchaseOrderStatus(draft.id, 'PENDING_PAYMENT')).success, true);
  setTestRole('ACCOUNTANT');
  assert.equal((await updatePurchaseOrderStatus(draft.id, 'CANCELLED')).success, true);
  assert.deepEqual([await statusOf(draft.id), await statusOf(pending.id)], ['CANCELLED', 'PENDING_PAYMENT']);
});

test('status: a status move racing a payment does not overwrite the status the payment wrote', async () => {
  const po = await tenFrames('PENDING_PAYMENT');
  let started: Promise<any> | null = null;
  beforeQuery.fn = async (params) => {
    // Right before the status move writes, a payment settles the order.
    if (params.model !== 'PurchaseOrder' || !['update', 'updateMany'].includes(params.action)) return;
    beforeQuery.fn = null;
    started = recordPurchasePartialPayment({ orderId: po.id, accountId: 'toman', amount: 1_200_000 });
    await started;
  };
  const cancelled = await updatePurchaseOrderStatus(po.id, 'PARTIALLY_PAID');
  assert.equal((await started!).success, true);
  assert.deepEqual(cancelled, { success: false, message: 'وضعیت این سفارش هم‌زمان تغییر کرد؛ صفحه را تازه کنید.' });
  assert.equal(await statusOf(po.id), 'PAID');
  await assertPurchaseInvariants();
});

// --- full payment ---

test('full payment: the whole Toman total from a Toman account, one expense row, one payment row, PAID', async () => {
  const po = await tenFrames('PENDING_PAYMENT');
  const result = await recordPurchasePayment(po.id, 'toman');
  assert.deepEqual(result, { success: true, message: 'پرداخت با موفقیت ثبت شد' });
  assert.equal(await balanceOf('toman'), OPENING.toman - 1_200_000);
  const row = await prisma.transaction.findFirstOrThrow({ where: { category: 'Purchase Payment' } });
  assert.deepEqual(
    [row.type, Number(row.amount), row.currency, Number(row.rateSnapshot), Number(row.amountInToman), row.description],
    ['EXPENSE', 1_200_000, 'TOMAN', 1, 1_200_000, `پرداخت سفارش خرید #${po.number} به تامین‌کننده`],
  );
  const after = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id }, include: { payments: true } });
  assert.deepEqual([after.status, after.paymentAccountId, after.paymentTransactionId], ['PAID', 'toman', row.id]);
  assert.deepEqual(after.payments.map((p: any) => [Number(p.amount), p.transactionId, p.description]), [[1_200_000, row.id, 'پرداخت کامل']]);
  await assertPurchaseInvariants();
});

test('full payment from a euro account moves the euro equivalent at today\'s rate', async () => {
  const po = await order(w, [{ productId: w.panj.id, quantity: 11, unitCost: 100_000 }], [], 'PENDING_PAYMENT');
  assert.equal((await recordPurchasePayment(po.id, 'eur')).success, true);
  assert.equal(await balanceOf('eur'), OPENING.eur - 1_100_000 / EUR_RATE);
  const payment = await prisma.purchaseOrderPayment.findFirstOrThrow();
  assert.equal(Number(payment.amount), 1_100_000);
  await assertPurchaseInvariants();
});

test('full payment is refused outside PENDING_PAYMENT, for an unknown account, or short of money, and writes nothing', async () => {
  const draft = await tenFrames();
  const partial = await tenFrames('PENDING_PAYMENT');
  await recordPurchasePartialPayment({ orderId: partial.id, accountId: 'toman', amount: 100_000 });
  const before = await balanceOf('toman');
  assert.deepEqual(await recordPurchasePayment(draft.id, 'toman'), { success: false, message: 'این سفارش در وضعیت پرداخت نیست' });
  // Once partly paid, a full payment would pay the whole total again.
  assert.deepEqual(await recordPurchasePayment(partial.id, 'toman'), { success: false, message: 'این سفارش در وضعیت پرداخت نیست' });
  const huge = await order(w, [{ productId: w.panj.id, quantity: 1, unitCost: 600_000_000 }], [], 'PENDING_PAYMENT');
  const short = await recordPurchasePayment(huge.id, 'toman');
  assert.equal(short.success, false);
  assert.match(short.message!, /کافی نیست/);
  assert.equal((await recordPurchasePayment(huge.id, 'no-such-account')).success, false);
  assert.equal(await balanceOf('toman'), before);
  assert.equal(await prisma.purchaseOrderPayment.count(), 1);
  await assertPurchaseInvariants();
});

// --- partial payments ---

test('partial payments: each books its own rows on its own date and accounts; the last one makes the order PAID', async () => {
  const po = await tenFrames('PENDING_PAYMENT');
  const first = await recordPurchasePartialPayment({ orderId: po.id, accountId: 'toman', amount: 500_000, date: '2026-09-01T08:00:00.000Z', description: ' پیش‌پرداخت ' });
  assert.deepEqual(first, { success: true, message: 'پرداخت ثبت شد. باقیمانده: ۷۰۰٬۰۰۰ تومان' });
  assert.equal(await statusOf(po.id), 'PARTIALLY_PAID');
  const second = await recordPurchasePartialPayment({ orderId: po.id, accountId: 'usd', amount: 700_000 });
  assert.deepEqual(second, { success: true, message: 'پرداخت ثبت شد و سفارش به‌طور کامل تسویه شد.' });
  assert.equal(await statusOf(po.id), 'PAID');

  const payments = await prisma.purchaseOrderPayment.findMany({ include: { transaction: true }, orderBy: { amount: 'asc' } });
  assert.deepEqual(
    payments.map((p: any) => [Number(p.amount), p.accountId, p.description, p.transaction.currency, Number(p.transaction.amount)]),
    [[500_000, 'toman', 'پیش‌پرداخت', 'TOMAN', 500_000], [700_000, 'usd', null, 'USD', 7]],
  );
  assert.equal(payments[0].date.toISOString(), '2026-09-01T08:00:00.000Z');
  assert.equal(payments[0].transaction.description, `پرداخت سفارش خرید #${po.number} - پیش‌پرداخت`);
  assert.deepEqual([await balanceOf('toman'), await balanceOf('usd')], [OPENING.toman - 500_000, OPENING.usd - 7]);
  // Settled: nothing more can be paid.
  const more = await recordPurchasePartialPayment({ orderId: po.id, accountId: 'toman', amount: 1 });
  assert.deepEqual(more, { success: false, message: 'این سفارش در وضعیت قابل پرداخت نیست' });
  await assertPurchaseInvariants();
});

test('partial payments: more than what remains is refused; within 1 toman over it is capped at the remainder', async () => {
  const po = await tenFrames('PENDING_PAYMENT');
  const over = await recordPurchasePartialPayment({ orderId: po.id, accountId: 'toman', amount: 1_200_002 });
  assert.deepEqual(over, { success: false, message: 'مبلغ پرداخت از باقیمانده بیشتر است. باقیمانده: ۱٬۲۰۰٬۰۰۰ تومان' });
  const capped = await recordPurchasePartialPayment({ orderId: po.id, accountId: 'toman', amount: 1_200_000.8 });
  assert.equal(capped.success, true);
  assert.equal(Number((await prisma.purchaseOrderPayment.findFirstOrThrow()).amount), 1_200_000);
  assert.equal(await balanceOf('toman'), OPENING.toman - 1_200_000);
  await assertPurchaseInvariants();
});

test('partial payments: zero, negative, NaN, a missing account, a bad date and the wrong status are refused and write nothing', async () => {
  const po = await tenFrames('PENDING_PAYMENT');
  const draft = await tenFrames();
  const cases: Array<[any, string]> = [
    [{ orderId: po.id, accountId: 'toman', amount: 0 }, 'مبلغ پرداخت باید بیشتر از صفر باشد.'],
    [{ orderId: po.id, accountId: 'toman', amount: -5 }, 'مبلغ پرداخت باید بیشتر از صفر باشد.'],
    [{ orderId: po.id, accountId: 'toman', amount: Number.NaN }, 'مبلغ پرداخت باید بیشتر از صفر باشد.'],
    [{ orderId: po.id, accountId: '', amount: 5 }, 'لطفا حساب پرداخت را انتخاب کنید.'],
    [{ orderId: po.id, accountId: 'toman', amount: 5, date: 'دیروز' }, 'تاریخ پرداخت نامعتبر است.'],
    [{ orderId: draft.id, accountId: 'toman', amount: 5 }, 'این سفارش در وضعیت قابل پرداخت نیست'],
    [{ orderId: po.id, accountId: 'toman', amount: Number.POSITIVE_INFINITY }, 'مبلغ پرداخت از باقیمانده بیشتر است. باقیمانده: ۱٬۲۰۰٬۰۰۰ تومان'],
  ];
  for (const [input, message] of cases) {
    assert.deepEqual(await recordPurchasePartialPayment(input), { success: false, message }, JSON.stringify(input));
  }
  assert.equal(await prisma.purchaseOrderPayment.count(), 0);
  assert.equal(await prisma.transaction.count({ where: { category: 'Purchase Payment' } }), 0);
  assert.equal(await balanceOf('toman'), OPENING.toman);
});

test('partial payments: two different payments at once that together pass the total, the second is refused', async () => {
  const po = await tenFrames('PENDING_PAYMENT');
  let started: Promise<any> | null = null;
  beforeQuery.fn = async (params) => {
    if (params.model !== 'PurchaseOrderPayment' || params.action !== 'create') return;
    beforeQuery.fn = null;
    started = recordPurchasePartialPayment({ orderId: po.id, accountId: 'usd', amount: 800_000 });
    await Promise.race([started, sleep(500)]);
  };
  const first = await recordPurchasePartialPayment({ orderId: po.id, accountId: 'toman', amount: 800_000 });
  beforeQuery.fn = null;
  const second = await started!;
  assert.equal(first.success, true);
  assert.deepEqual(second, { success: false, message: 'مبلغ پرداخت از باقیمانده بیشتر است. باقیمانده: ۴۰۰٬۰۰۰ تومان' });
  assert.equal(await balanceOf('usd'), OPENING.usd);
  await assertPurchaseInvariants();
});

test('payments take finance.manage: every other role is refused and nothing moves', async () => {
  const po = await tenFrames('PENDING_PAYMENT');
  for (const role of ['AUDITOR', 'SALES', 'WAREHOUSE', 'PROJECT_MANAGER', 'USER', null]) {
    setTestRole(role);
    assert.equal((await recordPurchasePayment(po.id, 'toman')).message, DENIED, String(role));
    assert.equal((await recordPurchasePartialPayment({ orderId: po.id, accountId: 'toman', amount: 1 })).message, DENIED, String(role));
  }
  setTestRole('ACCOUNTANT');
  assert.equal((await recordPurchasePartialPayment({ orderId: po.id, accountId: 'toman', amount: 1 })).success, true);
  await assertPurchaseInvariants();
});

// --- arrival ---

test('arrival: costs in Toman, dollars and euros paid from one account, each with its row; the order ARRIVES', async () => {
  const po = await tenFrames('IN_PRODUCTION');
  const result = await recordArrival(po.id, [
    { title: 'حمل داخلی', amount: 300_000, currency: 'TOMAN' },
    { title: 'ترخیص', amount: 10, currency: 'USD' },
    { title: 'بیمه', amount: 2, currency: 'EUR' },
  ], 'toman', 'arrival-0001');
  assert.deepEqual(result, { success: true, message: 'رسیدن به مقصد و هزینه‌های اضافی ثبت شد' });
  assert.equal(await statusOf(po.id), 'ARRIVED');
  const costs = await prisma.purchaseOrderArrivalCost.findMany({ include: { transaction: true }, orderBy: { amountInToman: 'asc' } });
  assert.deepEqual(
    costs.map((c: any) => [c.title, Number(c.amount), c.currency, Number(c.exchangeRateSnapshot), Number(c.amountInToman), Number(c.transaction.amount)]),
    [
      ['بیمه', 2, 'EUR', EUR_RATE, 2 * EUR_RATE, 2 * EUR_RATE],
      ['حمل داخلی', 300_000, 'TOMAN', 1, 300_000, 300_000],
      ['ترخیص', 10, 'USD', USD_RATE, 10 * USD_RATE, 10 * USD_RATE],
    ],
  );
  assert.equal(await balanceOf('toman'), OPENING.toman - 300_000 - 10 * USD_RATE - 2 * EUR_RATE);
  const again = await recordArrival(po.id, [{ title: 'حمل داخلی', amount: 300_000, currency: 'TOMAN' }], 'toman', 'arrival-0001');
  assert.equal(again.message, DUPLICATE_REQUEST_MESSAGE);
  assert.equal(await prisma.purchaseOrderArrivalCost.count(), 3);
  await assertPurchaseInvariants();
});

test('arrival: with no costs the order still arrives and no money moves', async () => {
  const po = await tenFrames('IN_PRODUCTION');
  assert.equal((await recordArrival(po.id, [], 'toman')).success, true);
  assert.equal(await statusOf(po.id), 'ARRIVED');
  assert.equal(await balanceOf('toman'), OPENING.toman);
  await assertPurchaseInvariants();
});

test('arrival: refused before production, without a rate, short of money, or with a bad cost, and nothing is written', async () => {
  const paid = await tenFrames('PAID');
  const producing = await tenFrames('IN_PRODUCTION');
  const cost = [{ title: 'حمل', amount: 100, currency: 'TOMAN' as const }];
  const cases: Array<[() => Promise<any>, RegExp]> = [
    [() => recordArrival(paid.id, cost, 'toman'), /در حال تولید نیست/],
    [() => recordArrival(producing.id, [{ title: 'حمل', amount: 5, currency: 'CNY' }], 'toman'), /نرخ ارز برای CNY یافت نشد/],
    [() => recordArrival(producing.id, [{ title: 'حمل', amount: 20_000, currency: 'USD' }], 'usd'), /کافی نیست/],
    [() => recordArrival(producing.id, [{ title: '', amount: 1, currency: 'TOMAN' }], 'toman'), /عنوان الزامی است/],
    [() => recordArrival(producing.id, [{ title: 'حمل', amount: -1, currency: 'TOMAN' }], 'toman'), /مبلغ/],
    [() => recordArrival(producing.id, cost, 'no-such-account'), /./],
    [() => recordArrival('missing', cost, 'toman'), /./],
  ];
  for (const [call, message] of cases) {
    const result = await call();
    assert.equal(result.success, false);
    assert.match(result.message, message);
  }
  assert.equal(await prisma.purchaseOrderArrivalCost.count(), 0);
  assert.deepEqual([await statusOf(paid.id), await statusOf(producing.id)], ['PAID', 'IN_PRODUCTION']);
  assert.deepEqual([await balanceOf('toman'), await balanceOf('usd')], [OPENING.toman, OPENING.usd]);
  await assertPurchaseInvariants();
});

test('arrival takes cost.edit and finance.manage together: only ADMIN', async () => {
  const po = await tenFrames('IN_PRODUCTION');
  for (const role of ['AUDITOR', 'ACCOUNTANT', 'SALES', 'WAREHOUSE', 'PROJECT_MANAGER', 'USER', null]) {
    setTestRole(role);
    assert.equal((await recordArrival(po.id, [], 'toman')).message, DENIED, String(role));
  }
  assert.equal(await statusOf(po.id), 'IN_PRODUCTION');
});
