// Paying purchase orders in the currency actually paid (src/lib/erp-api-po-payments.ts). Pooyan, 2026-11-15: the
// suppliers in China are paid in yuan through WeChat or Alipay, funded from «حساب ذخیره دلاری» (a dollar account).
// The bank gives 6.6703 yuan per dollar and a dollar is 271,000 Toman, so ¥2,000 on an order takes
// 2000 / 6.6703 = $299.84 from the account and is worth 299.84 × 271,000 = 81,256,640 Toman. The order's balance is
// kept in yuan, and once it is paid its Toman figures are the ones actually paid.
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { prisma, resetDatabase } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { GET, POST } from '@/app/api/erp/route';
import { createApiKey } from '@/actions/api-keys';
import { receivePurchaseOrderItems } from '@/actions/supplier';
import { recordPurchasePartialPayment } from '@/actions/supplier-workflow';
import { landedCostPerUnit } from '@/lib/landed-cost';
import { unpaidOnPurchaseOrder, latestRates, PURCHASE_ORDER_DEBT_FIELDS } from '@/lib/money-totals';
import { orderBalance, owedInTomanAfterCurrencyPayments } from '@/lib/purchase-order-balance';
import { balanceOf, driftOf, openAccount } from '../accounting/ledger';
import { purchasingWorld, type World } from './world';

console.error = () => {};

const FULL = 'owner-full-key-for-po-payment-tests';
const SITE = 'site-key-for-po-payment-tests';
const USD = 271_000; // Toman per dollar
const CNY = 40_600; // Toman per yuan
const BANK = 6.6703; // yuan per dollar, the bank's rate
const RESERVE = 'reserve'; // «حساب ذخیره دلاری», opened with $1,000

let w: World;

beforeEach(async () => {
  process.env.ERP_API_SECRET = FULL;
  process.env.ERP_SITE_API_SECRET = SITE;
  setTestRole('ADMIN');
  await resetDatabase();
  await prisma.user.create({ data: { id: 'test-user', name: 'مدیر', email: 'owner@x.test', password: 'x', role: 'ADMIN' } });
  w = await purchasingWorld();
  await openAccount(RESERVE, 1_000, 'USD', { name: 'حساب ذخیره دلاری' });
  // Newer than the world's own rates.
  await prisma.exchangeRate.create({ data: { currency: 'USD', rateToToman: USD, date: new Date('2026-11-01') } });
  await prisma.exchangeRate.create({ data: { currency: 'CNY', rateToToman: CNY, date: new Date('2026-11-01') } });
});
after(() => prisma.$disconnect());

const call = (method: 'GET' | 'POST', key: string, query: string, body?: unknown) => {
  const req = new NextRequest(`http://localhost/api/erp?${query}`, {
    method,
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  return method === 'GET' ? GET(req) : POST(req);
};
const post = async (body: Record<string, unknown>, key = FULL) => {
  const res = await call('POST', key, '', body);
  return { status: res.status, body: await res.json() };
};
const listed = async (number: number) => {
  const res = await call('GET', FULL, 'action=purchaseOrders');
  return (await res.json()).purchaseOrders.find((o: any) => o.number === number);
};

/** A yuan order as the PI states it: 100 frames at ¥50 and ¥1,000 freight, ¥6,000 in all, waiting for its payment. */
async function yuanOrder(fields: Record<string, unknown> = {}) {
  const { status, body } = await post({
    action: 'createPurchaseOrder',
    supplier: 'Mazzucchelli',
    currency: 'CNY',
    items: [{ sku: 'PANJ/BLUE', quantity: 100, unitCost: 50 }],
    additionalCosts: [{ title: 'حمل', amount: 1000 }],
    status: 'PENDING_PAYMENT',
    ...fields,
  });
  assert.equal(status, 200, JSON.stringify(body));
  return body.purchaseOrder as { id: string; number: number };
}
const pay = (po: { number: number }, fields: Record<string, unknown>, key = FULL) =>
  post({ action: 'payPurchaseOrder', order: po.number, account: 'حساب ذخیره دلاری', currency: 'CNY', accountRate: BANK, tomanRate: USD, ...fields }, key);
const addCost = (po: { number: number }, fields: Record<string, unknown>, key = FULL) => post({ action: 'addPurchaseOrderCost', order: po.number, ...fields }, key);
const row = (id: string) =>
  prisma.purchaseOrder.findUniqueOrThrow({
    where: { id },
    include: { items: { orderBy: { id: 'asc' } }, additionalCosts: { orderBy: { createdAt: 'asc' } }, payments: { orderBy: { createdAt: 'asc' }, include: { transaction: true } } },
  });
const near = (actual: unknown, expected: number, message?: string) =>
  assert.ok(Math.abs(Number(actual) - expected) < 0.01, `${message ?? ''} ${actual} vs ${expected}`);
/** Nothing was written for a refused payment. */
async function assertUntouched(po: { id: string }, balance = 1_000, payments = 0) {
  assert.equal(await prisma.purchaseOrderPayment.count({ where: { purchaseOrderId: po.id } }), payments);
  near(await balanceOf(RESERVE), balance);
  assert.equal(await driftOf(RESERVE), 0);
}

test('¥2,000 from the dollar account at 6.6703 and 271,000: $299.84 leaves the account, worth 81,256,640 Toman, and ¥4,000 remain', async () => {
  const po = await yuanOrder();
  const { status, body } = await pay(po, { amount: 2000, date: '2026-11-15', note: 'بیعانه' });
  assert.equal(status, 200, JSON.stringify(body));

  assert.deepEqual([body.order, body.status, body.currency, body.totalAmount], [po.number, 'PARTIALLY_PAID', 'CNY', 6000]);
  assert.deepEqual([body.paidInOrderCurrency, body.remainingInOrderCurrency, body.totalAmountInToman], [2000, 4000, null]);
  const { id: _id, date: _date, ...payment } = body.payment;
  assert.deepEqual(payment, {
    paidAmount: 2000,
    currency: 'CNY',
    accountAmount: 299.84,
    accountCurrency: 'USD',
    accountRate: BANK,
    tomanRate: USD,
    amountInToman: 81_256_640,
    inOrderCurrency: 2000,
    note: 'بیعانه',
  });
  assert.deepEqual([body.account.name, body.account.currency, body.account.balance], ['حساب ذخیره دلاری', 'USD', 700.16]);

  // The account and its expense row, in dollars.
  assert.equal(await balanceOf(RESERVE), 700.16);
  assert.equal(await driftOf(RESERVE), 0);
  const stored = await row(po.id);
  assert.equal(stored.status, 'PARTIALLY_PAID');
  const [p] = stored.payments;
  const t = p.transaction!;
  assert.deepEqual(
    [t.type, Number(t.amount), t.currency, Number(t.rateSnapshot), Number(t.amountInToman), t.category, t.accountId],
    ['EXPENSE', 299.84, 'USD', USD, 81_256_640, 'Purchase Payment', RESERVE],
  );
  assert.equal(t.description, `پرداخت سفارش خرید #${po.number} — ¥2,000 @ 6.6703 — بیعانه`);
  assert.equal(t.date.toISOString().slice(0, 10), '2026-11-15');
  // The payment: `amount` stays the Toman value, the new columns say what was really paid.
  assert.deepEqual(
    [Number(p.amount), Number(p.paidAmount), p.paidCurrency, Number(p.accountRate), Number(p.tomanRate), Number(p.accountAmount), Number(p.orderAmount), p.accountId, p.description],
    [81_256_640, 2000, 'CNY', BANK, USD, 299.84, 2000, RESERVE, 'بیعانه'],
  );
  assert.equal(stored.paymentTransactionId, t.id);
  // Not paid in full: the order still has no Toman figures.
  assert.equal(stored.totalAmountInToman, null);
  assert.deepEqual(stored.items.map((i: any) => [i.exchangeRateSnapshot, i.unitCostInToman]), [[null, null]]);

  const log = await prisma.activityLog.findFirstOrThrow({ where: { action: 'API_PAY_PURCHASE_ORDER' } });
  assert.match(log.details, new RegExp(`کلید کامل: پرداخت سفارش خرید PO-${po.number} .*¥2,000 @ 6\\.6703 از حساب «حساب ذخیره دلاری» \\(\\$299\\.84\\)، معادل 81,256,640 تومان`));

  // The list: the balance in yuan, the payment as it was paid, and what is left priced at today's yuan rate.
  const seen = await listed(po.number);
  assert.deepEqual([seen.paidInOrderCurrency, seen.remainingInOrderCurrency, seen.paidInToman, seen.unpaidInToman], [2000, 4000, 81_256_640, 4000 * CNY]);
  const { date: _d, ...shown } = seen.payments[0];
  assert.deepEqual(shown, {
    amountInToman: 81_256_640,
    description: 'بیعانه',
    paidAmount: 2000,
    paidCurrency: 'CNY',
    account: 'حساب ذخیره دلاری',
    accountCurrency: 'USD',
    accountAmount: 299.84,
    accountRate: BANK,
    tomanRate: USD,
    inOrderCurrency: 2000,
  });
  // The payables count it the same way.
  const debt = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id }, select: PURCHASE_ORDER_DEBT_FIELDS });
  assert.equal(unpaidOnPurchaseOrder(debt as any, await latestRates(prisma)), 4000 * CNY);
});

test('tomanRate defaults to the account currency\'s latest rate; the account is found by part of its name or its id', async () => {
  const po = await yuanOrder();
  const byName = await post({ action: 'payPurchaseOrder', order: `PO-${po.number}`, account: 'ذخیره', amount: 1000, currency: 'CNY', accountRate: BANK });
  assert.equal(byName.status, 200, JSON.stringify(byName.body));
  assert.deepEqual([byName.body.payment.tomanRate, byName.body.payment.accountAmount, byName.body.payment.amountInToman], [USD, 149.92, Math.round(149.92 * USD)]);
  const byId = await post({ action: 'payPurchaseOrder', order: po.number, accountId: RESERVE, amount: 1000, currency: 'CNY', accountRate: BANK });
  assert.equal(byId.status, 200, JSON.stringify(byId.body));
  assert.equal(byId.body.remainingInOrderCurrency, 4000);

  // «حساب» alone is every account.
  const vague = await post({ action: 'payPurchaseOrder', order: po.number, account: 'حساب', amount: 1, currency: 'CNY', accountRate: BANK });
  assert.equal(vague.status, 422);
  assert.ok(vague.body.options.length > 1);
});

test('two part payments settle the order: PAID, and its Toman figures are the ones actually paid', async () => {
  const po = await yuanOrder();
  const first = await pay(po, { amount: 2000 });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  // The rest, another day at other rates: 4000 / 6.5 = $615.38, × 280,000 = 172,306,400 Toman.
  const second = await pay(po, { amount: 4000, accountRate: 6.5, tomanRate: 280_000 });
  assert.equal(second.status, 200, JSON.stringify(second.body));
  assert.deepEqual([second.body.status, second.body.paidInOrderCurrency, second.body.remainingInOrderCurrency], ['PAID', 6000, 0]);
  assert.deepEqual([second.body.payment.accountAmount, second.body.payment.amountInToman], [615.38, 172_306_400]);
  near(await balanceOf(RESERVE), 1000 - 299.84 - 615.38);
  assert.equal(await driftOf(RESERVE), 0);

  const paidInToman = 81_256_640 + 172_306_400;
  const rate = paidInToman / 6000; // Toman per yuan, as really paid
  assert.equal(second.body.totalAmountInToman, paidInToman);
  const stored = await row(po.id);
  assert.equal(stored.status, 'PAID');
  assert.equal(Number(stored.totalAmountInToman), paidInToman);
  const [item] = stored.items;
  near(item.exchangeRateSnapshot, rate);
  near(item.unitCostInToman, 50 * rate);
  // Left for receiving, which adds each receipt's landed cost to it.
  assert.equal(item.totalCostInToman, null);
  const [freight] = stored.additionalCosts;
  near(freight.exchangeRateSnapshot, rate);
  near(freight.amountInToman, 1000 * rate);
  // Lines and costs add up to the total, and the payables owe nothing.
  near(100 * Number(item.unitCostInToman) + Number(freight.amountInToman), paidInToman);
  assert.equal((await listed(po.number)).unpaidInToman, 0);

  // Landed cost no longer asks for a rate: it is the paid one, whatever the yuan does afterwards.
  const noRate = () => {
    throw new Error('the live rate must not be read');
  };
  near(landedCostPerUnit(item as any, stored as any, noRate), paidInToman / 100);
  await prisma.exchangeRate.create({ data: { currency: 'CNY', rateToToman: 99_999, date: new Date('2026-12-01') } });
  await prisma.purchaseOrder.update({ where: { id: po.id }, data: { status: 'ARRIVED' } });
  const received = await receivePurchaseOrderItems(po.id, w.main.id, [{ itemId: item.id, receivedQuantity: 100 }]);
  assert.equal(received.success, true, received.error);
  near((await prisma.purchaseOrderItem.findUniqueOrThrow({ where: { id: item.id } })).totalCostInToman, paidInToman);
});

test('a payment over what remains is refused, and nothing is written', async () => {
  const po = await yuanOrder();
  const over = await pay(po, { amount: 6000.02 });
  assert.equal(over.status, 422, JSON.stringify(over.body));
  assert.match(over.body.error, /بیشتر است/);
  assert.deepEqual([over.body.remainingInOrderCurrency, over.body.currency], [6000, 'CNY']);
  await assertUntouched(po);

  assert.equal((await pay(po, { amount: 2000 })).status, 200);
  const again = await pay(po, { amount: 4000.02 });
  assert.equal(again.status, 422);
  assert.equal(again.body.remainingInOrderCurrency, 4000);
  await assertUntouched(po, 700.16, 1);
  assert.equal((await row(po.id)).status, 'PARTIALLY_PAID');
});

test('the same requestId twice is one payment, one after the other or both at once', async () => {
  const po = await yuanOrder();
  const requestId = 'po-pay-0001';
  const first = await pay(po, { amount: 2000, requestId });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const second = await pay(po, { amount: 2000, requestId });
  assert.equal(second.status, 200, JSON.stringify(second.body));
  assert.equal(second.body.duplicate, true);
  assert.equal(second.body.payment.id, first.body.payment.id);
  assert.deepEqual([second.body.paidInOrderCurrency, second.body.remainingInOrderCurrency, second.body.account.balance], [2000, 4000, 700.16]);
  await assertUntouched(po, 700.16, 1);
  assert.equal(await prisma.activityLog.count({ where: { action: 'API_PAY_PURCHASE_ORDER' } }), 1);

  const both = await Promise.all([pay(po, { amount: 1000, requestId: 'po-pay-0002' }), pay(po, { amount: 1000, requestId: 'po-pay-0002' })]);
  assert.deepEqual(both.map((r) => r.status), [200, 200]);
  assert.equal(both.filter((r) => r.body.duplicate).length, 1);
  await assertUntouched(po, 700.16 - 149.92, 2);

  const bad = await pay(po, { amount: 1, requestId: 'short' });
  assert.equal(bad.status, 422);
  assert.match(bad.body.error, /requestId/);
});

test('paying in a currency that is not the account\'s needs the bank\'s rate', async () => {
  const po = await yuanOrder();
  const { status, body } = await post({ action: 'payPurchaseOrder', order: po.number, account: 'حساب ذخیره دلاری', amount: 2000, currency: 'CNY', tomanRate: USD });
  assert.equal(status, 422, JSON.stringify(body));
  assert.match(body.error, /accountRate/);
  assert.equal(body.accountCurrency, 'USD');
  await assertUntouched(po);

  // From a Toman account the rate is Toman per yuan, and the account pays amount × rate.
  const fromToman = await post({ action: 'payPurchaseOrder', order: po.number, account: 'toman', amount: 1000, currency: 'CNY', accountRate: 40_000 });
  assert.equal(fromToman.status, 200, JSON.stringify(fromToman.body));
  assert.deepEqual(
    [fromToman.body.payment.accountAmount, fromToman.body.payment.accountCurrency, fromToman.body.payment.tomanRate, fromToman.body.payment.amountInToman, fromToman.body.payment.inOrderCurrency],
    [40_000_000, 'TOMAN', 1, 40_000_000, 1000],
  );
  assert.equal(await driftOf('toman'), 0);

  // Paid in the account's own currency there is no rate between them. Dollars on a yuan order settle their
  // Toman value at the yuan's latest rate: $100 × 271,000 / 40,600 = ¥667.49.
  const inDollars = await post({ action: 'payPurchaseOrder', order: po.number, account: RESERVE, amount: 100, currency: 'USD' });
  assert.equal(inDollars.status, 200, JSON.stringify(inDollars.body));
  assert.deepEqual(
    [inDollars.body.payment.accountAmount, inDollars.body.payment.accountRate, inDollars.body.payment.amountInToman, inDollars.body.payment.inOrderCurrency],
    [100, null, 100 * USD, 667.49],
  );
  near(inDollars.body.remainingInOrderCurrency, 6000 - 1000 - 667.49);
});

test('an account that cannot cover the payment refuses it', async () => {
  const po = await yuanOrder();
  // ¥2,000 at 1.5 yuan a dollar would take $1,333.33 of the $1,000 there.
  const { status, body } = await pay(po, { amount: 2000, accountRate: 1.5 });
  assert.equal(status, 422, JSON.stringify(body));
  assert.match(body.error, /موجودی حساب «حساب ذخیره دلاری» کافی نیست/);
  assert.deepEqual([body.balance, body.needed, body.accountCurrency], [1000, 1333.33, 'USD']);
  await assertUntouched(po);
  assert.equal((await row(po.id)).status, 'PENDING_PAYMENT');
});

test('only the full key pays; a draft is placed by its payment; a paid, received or cancelled order takes none; bad input is refused', async () => {
  const po = await yuanOrder({ status: 'DRAFT' });
  assert.equal((await pay(po, { amount: 2000 }, SITE)).status, 403);
  const user = await prisma.user.create({ data: { name: 'مدیر دوم', email: 'admin2@x.test', password: 'x', role: 'ADMIN' } });
  const made: any = await createApiKey(user.id, 'Claude');
  assert.equal((await pay(po, { amount: 2000 }, made.key)).status, 403);
  assert.equal((await addCost(po, { title: 'لوگو', amount: 10 }, made.key)).status, 403);
  assert.equal((await addCost(po, { title: 'لوگو', amount: 10 }, SITE)).status, 403);
  await assertUntouched(po);

  for (const [fields, pattern] of [
    [{ amount: 0 }, /amount/],
    [{ amount: 100, currency: 'GBP' }, /currency/],
    [{ amount: 100, currency: undefined }, /currency/],
    [{ amount: 100, accountRate: -1 }, /accountRate/],
    [{ amount: 100, date: '1405-08-24' }, /شمسی/],
    [{ amount: 100, account: 'ناموجود' }, /پیدا نشد/],
    [{ amount: 100, order: 999_999 }, /پیدا نشد/],
  ] as Array<[Record<string, unknown>, RegExp]>) {
    const refused = await pay(po, fields);
    assert.equal(refused.status, 422, JSON.stringify(refused.body));
    assert.match(refused.body.error, pattern);
  }
  await assertUntouched(po);

  const placed = await pay(po, { amount: 2000 });
  assert.equal(placed.status, 200, JSON.stringify(placed.body));
  assert.equal(placed.body.status, 'PARTIALLY_PAID');
  assert.match(placed.body.note, /پیش‌نویس/);

  for (const status of ['PAID', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED']) {
    await prisma.purchaseOrder.update({ where: { id: po.id }, data: { status } });
    const refused = await pay(po, { amount: 100 });
    assert.equal(refused.status, 422, `${status}: ${JSON.stringify(refused.body)}`);
    assert.equal(refused.body.status, status);
  }
  await assertUntouched(po, 700.16, 1);
});

test('a cost is added in the order\'s currency: with no Toman figure on an open order, the same one never twice', async () => {
  const po = await yuanOrder();
  const { status, body } = await addCost(po, { title: 'Gold-filled laser logo', amount: 322 });
  assert.equal(status, 200, JSON.stringify(body));
  assert.deepEqual([body.status, body.currency, body.totalAmount, body.paidInOrderCurrency, body.remainingInOrderCurrency], ['PENDING_PAYMENT', 'CNY', 6322, 0, 6322]);
  assert.deepEqual(body.cost, { title: 'Gold-filled laser logo', amount: 322, currency: 'CNY', amountInToman: null });
  const stored = await row(po.id);
  assert.equal(Number(stored.totalAmount), 6322);
  assert.equal(stored.totalAmountInToman, null);
  const logo = stored.additionalCosts.find((c: any) => c.title === 'Gold-filled laser logo')!;
  assert.deepEqual([Number(logo.amount), logo.currency, logo.exchangeRateSnapshot, logo.amountInToman], [322, 'CNY', null, null]);
  const log = await prisma.activityLog.findFirstOrThrow({ where: { action: 'API_ADD_PURCHASE_ORDER_COST' } });
  assert.match(log.details, new RegExp(`«Gold-filled laser logo» ¥322 به سفارش خرید PO-${po.number}`));

  const twice = await addCost(po, { title: ' gold-filled LASER logo ', amount: 322 });
  assert.equal(twice.status, 422);
  assert.match(twice.body.error, /از قبل/);
  assert.equal((await row(po.id)).additionalCosts.length, 2);

  for (const [fields, pattern] of [
    [{ title: '', amount: 5 }, /title/],
    [{ title: 'x', amount: 0 }, /amount/],
    [{ title: 'x', amount: 5, order: 999_999 }, /پیدا نشد/],
  ] as Array<[Record<string, unknown>, RegExp]>) {
    const refused = await addCost(po, fields);
    assert.equal(refused.status, 422, JSON.stringify(refused.body));
    assert.match(refused.body.error, pattern);
  }

  // The order now owes ¥6,322: ¥6,000 leave ¥322.
  const paid = await pay(po, { amount: 6000, accountRate: 60 });
  assert.deepEqual([paid.body.status, paid.body.remainingInOrderCurrency], ['PARTIALLY_PAID', 322]);
});

test('a cost on a PAID order takes the rate that was paid, and the order owes again until it is paid too', async () => {
  const po = await yuanOrder();
  // ¥6,000 at 60 yuan a dollar: $100, 27,100,000 Toman, so 4,516.67 Toman a yuan.
  assert.equal((await pay(po, { amount: 6000, accountRate: 60 })).body.status, 'PAID');
  const rate = (100 * USD) / 6000;

  const { status, body } = await addCost(po, { title: 'Gold-filled laser logo', amount: 322 });
  assert.equal(status, 200, JSON.stringify(body));
  assert.deepEqual([body.status, body.totalAmount, body.paidInOrderCurrency, body.remainingInOrderCurrency], ['PARTIALLY_PAID', 6322, 6000, 322]);
  near(body.cost.amountInToman, 322 * rate);
  near(body.totalAmountInToman, 6322 * rate);
  let stored = await row(po.id);
  assert.equal(stored.status, 'PARTIALLY_PAID');
  near(stored.totalAmountInToman, 6322 * rate);
  const logo = stored.additionalCosts.find((c: any) => c.title === 'Gold-filled laser logo')!;
  near(logo.exchangeRateSnapshot, rate);
  near(logo.amountInToman, 322 * rate);
  // The order page's Toman figures agree: 322 yuan at the order's rate are owed.
  near((await listed(po.number)).unpaidInToman, 322 * rate);

  // Paid at another rate (322 / 7 = $46, × 271,000): PAID again, every figure at the new rate over all payments.
  const settled = await pay(po, { amount: 322, accountRate: 7 });
  assert.equal(settled.status, 200, JSON.stringify(settled.body));
  assert.deepEqual([settled.body.status, settled.body.remainingInOrderCurrency], ['PAID', 0]);
  const paidInToman = 100 * USD + 46 * USD;
  stored = await row(po.id);
  assert.equal(Number(stored.totalAmountInToman), paidInToman);
  near(stored.items[0].unitCostInToman, (50 * paidInToman) / 6322);
  near(stored.additionalCosts.reduce((s: number, c: any) => s + Number(c.amountInToman), 0), (1322 * paidInToman) / 6322);
});

test('no cost is added once goods came in or the order is cancelled; in production it is added and paid with the order where it is', async () => {
  const po = await yuanOrder();
  for (const status of ['RECEIVED', 'PARTIALLY_RECEIVED', 'CANCELLED']) {
    await prisma.purchaseOrder.update({ where: { id: po.id }, data: { status } });
    const refused = await addCost(po, { title: 'لوگو', amount: 322 });
    assert.equal(refused.status, 422, `${status}: ${JSON.stringify(refused.body)}`);
    assert.equal(refused.body.status, status);
  }
  const stored = await row(po.id);
  assert.deepEqual([Number(stored.totalAmount), stored.additionalCosts.length], [6000, 1]);

  await prisma.purchaseOrder.update({ where: { id: po.id }, data: { status: 'PENDING_PAYMENT' } });
  assert.equal((await pay(po, { amount: 6000, accountRate: 60 })).body.status, 'PAID');
  await prisma.purchaseOrder.update({ where: { id: po.id }, data: { status: 'IN_PRODUCTION' } });
  const added = await addCost(po, { title: 'لوگو', amount: 322 });
  assert.deepEqual([added.status, added.body.status, added.body.remainingInOrderCurrency], [200, 'IN_PRODUCTION', 322]);
  const paid = await pay(po, { amount: 322, accountRate: 7 });
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  assert.deepEqual([paid.body.status, paid.body.remainingInOrderCurrency], ['IN_PRODUCTION', 0]);
  assert.equal(Number((await row(po.id)).totalAmountInToman), 146 * USD);
  assert.equal(await driftOf(RESERVE), 0);
});

test('the order page\'s Toman payment after a yuan payment pays what remains of the yuan, at today\'s rate', async () => {
  const po = await yuanOrder();
  assert.equal((await pay(po, { amount: 2000 })).status, 200);
  // ¥4,000 remain: 162,400,000 Toman at 40,600. One Toman more is over.
  setTestRole('ADMIN');
  const over = await recordPurchasePartialPayment({ orderId: po.id, accountId: 'toman', amount: 4000 * CNY + 2 });
  assert.equal(over.success, false);
  const rest = await recordPurchasePartialPayment({ orderId: po.id, accountId: 'toman', amount: 4000 * CNY });
  assert.equal(rest.success, true, rest.message);
  const stored = await row(po.id);
  assert.equal(stored.status, 'PAID');
  const seen = await listed(po.number);
  assert.deepEqual([seen.paidInOrderCurrency, seen.remainingInOrderCurrency, seen.unpaidInToman], [6000, 0, 0]);
  // And the other way round: a Toman payment first counts at today's rate, then yuan pay the rest.
  const next = await yuanOrder();
  const first = await recordPurchasePartialPayment({ orderId: next.id, accountId: 'toman', amount: 1000 * CNY });
  assert.equal(first.success, true, first.message);
  const tooMuch = await pay(next, { amount: 5000.02, accountRate: 60 });
  assert.equal(tooMuch.status, 422);
  assert.equal(tooMuch.body.remainingInOrderCurrency, 5000);
  const settled = await pay(next, { amount: 5000, accountRate: 60 });
  assert.deepEqual([settled.status, settled.body.status], [200, 'PAID']);
  // 40,600,000 Toman on the page and $83.33 × 271,000 through the API.
  assert.equal(settled.body.totalAmountInToman, 1000 * CNY + Math.round(83.33 * USD));
});

test('the balance in the order\'s currency: what each kind of payment settles', () => {
  const lines = { items: [{ quantity: 100, unitCost: 50, currency: 'CNY' }], additionalCosts: [{ amount: 1000, currency: 'CNY' }] };
  const rateOf = (currency: string) => (currency === 'CNY' ? CNY : currency === 'USD' ? USD : 1);
  // A payment in the currency paid stores what it settled; a Toman payment counts at today's rate.
  assert.deepEqual(orderBalance({ ...lines, payments: [{ amount: 81_256_640, orderAmount: 2000 }, { amount: 1000 * CNY }] }, rateOf), {
    currency: 'CNY',
    total: 6000,
    paid: 3000,
    remaining: 3000,
  });
  // An order with a Toman total counts a Toman payment at its own rate, not today's.
  assert.equal(orderBalance({ ...lines, totalAmountInToman: 6000 * 45_000, payments: [{ amount: 3000 * 45_000 }] }, rateOf)!.remaining, 3000);
  // An order in Toman: its Toman payments, as they are.
  assert.deepEqual(orderBalance({ items: [{ quantity: 2, unitCost: 500_000, currency: 'TOMAN' }], payments: [{ amount: 400_000 }] }, rateOf), {
    currency: 'TOMAN',
    total: 1_000_000,
    paid: 400_000,
    remaining: 600_000,
  });
  // Within a hundredth nothing remains; mixed currencies have no balance in one.
  assert.equal(orderBalance({ ...lines, payments: [{ amount: 1, orderAmount: 5999.995 }] }, rateOf)!.remaining, 0);
  assert.equal(orderBalance({ items: [{ quantity: 1, unitCost: 5, currency: 'CNY' }], additionalCosts: [{ amount: 1, currency: 'USD' }] }, rateOf), null);

  // The Toman owed changes only once a payment in the currency paid is there, and only without a Toman total.
  assert.equal(owedInTomanAfterCurrencyPayments({ ...lines, payments: [{ amount: 1000 * CNY }] }, rateOf), null);
  assert.equal(owedInTomanAfterCurrencyPayments({ ...lines, payments: [{ amount: 81_256_640, orderAmount: 2000 }] }, rateOf), 81_256_640 + 4000 * CNY);
  assert.equal(owedInTomanAfterCurrencyPayments({ ...lines, totalAmountInToman: 1, payments: [{ amount: 81_256_640, orderAmount: 2000 }] }, rateOf), null);
});
