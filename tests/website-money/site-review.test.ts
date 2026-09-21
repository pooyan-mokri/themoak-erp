import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { prisma, resetDatabase } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { POST } from '@/app/api/erp/route';
import {
  getSitePaymentsToReview,
  markSiteOrderKept,
  recordSiteOrderReceipt,
  recordSiteOrderRefund,
} from '@/actions/site-review';
import { AccessDenied } from '@/lib/access';
import { DUPLICATE_REQUEST_MESSAGE } from '@/lib/request-id';
import { SITE_DECISION_KEPT, SITE_DECISION_REFUNDED, readSiteOrderData } from '@/lib/site-sale-data';
import { balanceEffect } from '@/lib/balance-reconciliation';

// Website money must not be forgotten (report fix #3): cancelled orders whose
// money was never refunded, and test or untraced payments, wait on
// /dashboard/sales/site-review until an admin decides.

console.error = () => {};

const TOKEN = 'website-review-test-token';
const TOTAL = 5_200_000;
const ADMIN_ONLY = 'دسترسی غیرمجاز — فقط مدیر سیستم می‌تواند این عملیات را انجام دهد.';
const USD_RATE = 100_000;

let world: {
  saman: { id: string };
  cash: { id: string };
  usd: { id: string };
  expense: { id: string };
  warehouse: { id: string };
};

beforeEach(async () => {
  process.env.ERP_API_SECRET = TOKEN;
  setTestRole('ADMIN');
  await resetDatabase();
  const saman = await prisma.account.create({ data: { name: 'بانک سامان', type: 'BANK', currency: 'TOMAN', balance: 0 } });
  const cash = await prisma.account.create({ data: { name: 'صندوق', type: 'CASH', currency: 'TOMAN', balance: 20_000_000 } });
  const usd = await prisma.account.create({ data: { name: 'حساب ذخیره دلاری', type: 'BANK', currency: 'USD', balance: 1_000 } });
  const expense = await prisma.account.create({ data: { name: 'هزینه‌ها', type: 'EXPENSE', currency: 'TOMAN', balance: 0 } });
  await prisma.exchangeRate.create({ data: { currency: 'USD', rateToToman: USD_RATE, date: new Date('2026-09-01') } });
  const warehouse = await prisma.warehouse.create({ data: { name: 'مشاهیر' } });
  const product = await prisma.product.create({
    data: { name: 'YEK - Black', sku: 'YEK/BLACK', webId: 'MOAK-YEK-BLACK', costPrice: 1, sellPrice: TOTAL },
  });
  await prisma.inventory.create({ data: { productId: product.id, warehouseId: warehouse.id, quantity: 50 } });
  // The site's money lands in «بانک سامان», the default when nothing is saved.
  world = { saman, cash, usd, expense, warehouse };
});
after(() => prisma.$disconnect());

async function call(action: string, body: Record<string, unknown>) {
  const res = await POST(
    new NextRequest('http://localhost/api/erp', {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action, ...body }),
    }),
  );
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
}

const REAL = { gateway: 'zibal', trackId: '3312001', refNumber: '98001', paidAt: '2026-09-14T08:59:40.000Z', amount: TOTAL };

let counter = 0;
async function sell(payment: Record<string, unknown>) {
  counter += 1;
  const reference = `M-REVIEW${counter}`;
  await call('createSale', {
    reference,
    issuedAt: '2026-09-14T09:00:00.000Z',
    warehouseId: world.warehouse.id,
    customer: { name: `مشتری ${counter}`, mobile: `0935000000${counter}` },
    items: [{ webId: 'MOAK-YEK-BLACK', quantity: 1, unitPrice: TOTAL }],
    subtotal: TOTAL,
    discount: 0,
    total: TOTAL,
    payment,
  });
  return prisma.order.findUniqueOrThrow({ where: { siteReference: reference } });
}

/**
 * An order booked before this fix: a sandbox payment the ERP took as income
 * (M-TLD3KJ), written the way the old createSale wrote it.
 */
async function legacySandboxSale() {
  const order = await sell(REAL);
  const data = readSiteOrderData(order.siteData)!;
  await prisma.order.update({
    where: { id: order.id },
    data: { siteData: { ...data, payment: { ...data.payment, trackId: null, paidAt: null } } },
  });
  return order;
}

const balanceOf = async (id: string) => Number((await prisma.account.findUniqueOrThrow({ where: { id } })).balance);

async function assertLedger(id: string, opening: number) {
  const account = await prisma.account.findUniqueOrThrow({ where: { id }, include: { transactions: true } });
  const derived = opening + account.transactions.reduce((sum: number, t: any) => sum + balanceEffect(t), 0);
  assert.ok(Math.abs(Number(account.balance) - derived) < 1e-9, `${Number(account.balance)} vs ${derived}`);
}

test('lists a website order cancelled without a refund and a legacy sandbox income; not a normal sale', async () => {
  const normal = await sell(REAL);
  const cancelled = await sell(REAL);
  await call('setSaleStatus', { status: 'cancelled', reference: cancelled.siteReference });
  const refundedOnSite = await sell(REAL);
  await call('setSaleStatus', { status: 'cancelled', reference: refundedOnSite.siteReference, amount: TOTAL });
  const legacy = await legacySandboxSale();
  const unpaid = await sell({ ...REAL, sandbox: true });

  const rows = await getSitePaymentsToReview();
  const byId = new Map(rows.map((row) => [row.id, row]));
  assert.ok(!byId.has(normal.id));
  assert.ok(!byId.has(refundedOnSite.id), 'refunded in full on the site: nothing left to decide');

  const c = byId.get(cancelled.id)!;
  assert.equal(c.cancelled, true);
  assert.deepEqual(c.actions.sort(), ['kept', 'refund']);
  assert.deepEqual(c.amounts, { sitePaid: TOTAL, siteRefunded: 0, held: TOTAL, owed: 0 });
  assert.equal(c.saleAccountId, world.saman.id);

  const l = byId.get(legacy.id)!;
  assert.deepEqual(l.actions.sort(), ['kept', 'refund']);
  assert.ok(l.reasons.some((reason) => reason.includes('trackId')), JSON.stringify(l.reasons));

  // Recorded unpaid by the new createSale: the question is whether money arrived.
  const u = byId.get(unpaid.id)!;
  assert.deepEqual(u.actions, ['receipt']);
  assert.deepEqual(u.amounts, { sitePaid: TOTAL, siteRefunded: 0, held: 0, owed: TOTAL });
  assert.equal(rows.length, 3);
});

test('reading takes sales.view; amounts only with finance.view', async () => {
  const cancelled = await sell(REAL);
  await call('setSaleStatus', { status: 'cancelled', reference: cancelled.siteReference });

  setTestRole('SALES');
  const [row] = await getSitePaymentsToReview();
  assert.equal(row.id, cancelled.id);
  assert.equal(row.amounts, null);
  assert.ok(row.decisions.every((d) => d.amount === null));

  setTestRole('AUDITOR');
  assert.equal((await getSitePaymentsToReview())[0].amounts?.held, TOTAL);

  for (const role of ['WAREHOUSE', null]) {
    setTestRole(role);
    await assert.rejects(getSitePaymentsToReview(), AccessDenied, String(role));
  }
});

test('every decision is ADMIN-only and writes nothing otherwise', async () => {
  const cancelled = await sell(REAL);
  await call('setSaleStatus', { status: 'cancelled', reference: cancelled.siteReference });
  const unpaid = await sell({ ...REAL, trackId: null, paidAt: null });
  const before = await prisma.transaction.count();

  for (const role of ['ACCOUNTANT', 'SALES', 'AUDITOR', null]) {
    setTestRole(role);
    const refund = await recordSiteOrderRefund({ orderId: cancelled.id, accountId: world.cash.id, amount: TOTAL, note: 'x' });
    assert.equal(refund.message, ADMIN_ONLY, String(role));
    assert.equal((await markSiteOrderKept({ orderId: cancelled.id, note: 'x' })).message, ADMIN_ONLY, String(role));
    const receipt = await recordSiteOrderReceipt({ orderId: unpaid.id, accountId: world.cash.id, amount: TOTAL, note: 'x' });
    assert.equal(receipt.message, ADMIN_ONLY, String(role));
  }
  assert.equal(await prisma.transaction.count(), before);
  assert.equal(readSiteOrderData((await prisma.order.findUniqueOrThrow({ where: { id: cancelled.id } })).siteData)?.history.length, 1);
});

test('a refund is booked out of the account the admin picks, not the sale account, and clears the order', async () => {
  const order = await sell(REAL);
  await call('setSaleStatus', { status: 'cancelled', reference: order.siteReference });
  assert.equal(await balanceOf(world.saman.id), TOTAL);

  const result = await recordSiteOrderRefund({
    orderId: order.id,
    accountId: world.cash.id,
    amount: TOTAL,
    note: 'کارت‌به‌کارت از صندوق',
    requestId: 'refund-request-0001',
  });
  assert.equal(result.success, true, result.message);

  // The sale's account keeps its income; the money left the cash box it was paid from.
  assert.equal(await balanceOf(world.saman.id), TOTAL);
  assert.equal(await balanceOf(world.cash.id), 20_000_000 - TOTAL);
  const refund = await prisma.transaction.findFirstOrThrow({ where: { type: 'EXPENSE' } });
  assert.deepEqual(
    [refund.accountId, Number(refund.amount), refund.orderId, refund.category, refund.clientRequestId],
    [world.cash.id, TOTAL, order.id, 'Return', 'refund-request-0001'],
  );

  const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(Number(after.paidAmount), 0);
  assert.equal(Number(after.totalAmount) - Number(after.discount) - Number(after.paidAmount), 0);
  const history = readSiteOrderData(after.siteData)!.history;
  const last = history[history.length - 1];
  assert.deepEqual(
    [last.status, last.amount, last.note, last.accountId, last.transactionId, last.by],
    [SITE_DECISION_REFUNDED, TOTAL, 'کارت‌به‌کارت از صندوق', world.cash.id, refund.id, 'test-user'],
  );
  assert.deepEqual(await getSitePaymentsToReview(), []);

  // The same submission again books nothing.
  const again = await recordSiteOrderRefund({
    orderId: order.id,
    accountId: world.cash.id,
    amount: TOTAL,
    note: 'کارت‌به‌کارت از صندوق',
    requestId: 'refund-request-0001',
  });
  assert.equal(again.message, DUPLICATE_REQUEST_MESSAGE);
  assert.equal(await prisma.transaction.count({ where: { type: 'EXPENSE' } }), 1);
  await assertLedger(world.cash.id, 20_000_000);
  await assertLedger(world.saman.id, 0);
});

test('a refund from a dollar account moves the dollar equivalent; partial refunds keep the order listed', async () => {
  const order = await sell(REAL);
  await call('setSaleStatus', { status: 'cancelled', reference: order.siteReference });

  const result = await recordSiteOrderRefund({ orderId: order.id, accountId: world.usd.id, amount: 2_000_000, note: 'نیمی دلاری' });
  assert.equal(result.success, true, result.message);
  assert.equal(await balanceOf(world.usd.id), 1_000 - 20);
  const row = await prisma.transaction.findFirstOrThrow({ where: { type: 'EXPENSE' } });
  assert.deepEqual([Number(row.amount), row.currency, Number(row.amountInToman)], [20, 'USD', 2_000_000]);
  await assertLedger(world.usd.id, 1_000);

  const [listed] = await getSitePaymentsToReview();
  assert.equal(listed.amounts?.held, TOTAL - 2_000_000);
  assert.deepEqual(listed.decisions.map((d) => [d.status, d.amount]), [[SITE_DECISION_REFUNDED, 2_000_000]]);
});

test('a refund is refused beyond what the ERP holds, from an expense account, or without a note', async () => {
  const order = await sell(REAL);
  await call('setSaleStatus', { status: 'cancelled', reference: order.siteReference });
  const cases: Array<[string, Parameters<typeof recordSiteOrderRefund>[0]]> = [
    ['too much', { orderId: order.id, accountId: world.cash.id, amount: TOTAL + 1, note: 'x' }],
    ['zero', { orderId: order.id, accountId: world.cash.id, amount: 0, note: 'x' }],
    ['expense account', { orderId: order.id, accountId: world.expense.id, amount: TOTAL, note: 'x' }],
    ['no note', { orderId: order.id, accountId: world.cash.id, amount: TOTAL, note: '  ' }],
  ];
  for (const [label, input] of cases) {
    assert.equal((await recordSiteOrderRefund(input)).success, false, label);
  }
  assert.equal(await prisma.transaction.count({ where: { type: 'EXPENSE' } }), 0);
});

test('kept: no money moves, the decision is recorded, and the order leaves the list until the site cancels it', async () => {
  const legacy = await legacySandboxSale();
  const result = await markSiteOrderKept({ orderId: legacy.id, note: 'پول در زیبال تسویه شد' });
  assert.equal(result.success, true, result.message);
  assert.equal(await balanceOf(world.saman.id), TOTAL);
  assert.deepEqual(await getSitePaymentsToReview(), []);
  const history = readSiteOrderData((await prisma.order.findUniqueOrThrow({ where: { id: legacy.id } })).siteData)!.history;
  assert.deepEqual([history[0].status, history[0].amount, history[0].note], [SITE_DECISION_KEPT, TOTAL, 'پول در زیبال تسویه شد']);

  // Cancelled afterwards without a refund: a new question.
  await call('setSaleStatus', { status: 'cancelled', reference: legacy.siteReference });
  const rows = await getSitePaymentsToReview();
  assert.deepEqual(rows.map((row) => row.id), [legacy.id]);
  assert.equal((await markSiteOrderKept({ orderId: legacy.id, note: 'باز هم نگه داشته شد' })).success, true);
  assert.deepEqual(await getSitePaymentsToReview(), []);
});

test('a sale recorded unpaid whose money did arrive: the receipt books income linked to the order', async () => {
  const order = await sell({ ...REAL, trackId: null, paidAt: null });
  const result = await recordSiteOrderReceipt({
    orderId: order.id,
    accountId: world.saman.id,
    amount: TOTAL,
    note: 'کارت‌به‌کارت مشتری',
    requestId: 'receipt-request-01',
  });
  assert.equal(result.success, true, result.message);
  const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(after.paymentStatus, 'PAID');
  assert.equal(Number(after.paidAmount), TOTAL);
  const income = await prisma.transaction.findFirstOrThrow({ where: { type: 'INCOME' } });
  assert.deepEqual([income.accountId, Number(income.amount), income.orderId, after.transactionId], [world.saman.id, TOTAL, order.id, income.id]);
  assert.equal(await balanceOf(world.saman.id), TOTAL);
  assert.deepEqual(await getSitePaymentsToReview(), [], 'money confirmed: nothing left to decide');

  // A later website refund comes out of the account the receipt went into.
  await call('setSaleStatus', { status: 'refunded', reference: order.siteReference, amount: TOTAL, refundId: 'r-9' });
  assert.equal(await balanceOf(world.saman.id), 0);
  await assertLedger(world.saman.id, 0);

  // More than the order owes is refused.
  const other = await sell({ ...REAL, trackId: null, paidAt: null });
  assert.equal((await recordSiteOrderReceipt({ orderId: other.id, accountId: world.saman.id, amount: TOTAL + 1, note: 'x' })).success, false);
});
