import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { prisma, resetDatabase } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { POST } from '@/app/api/erp/route';
import { TAG_NEEDS_REVIEW, readSiteOrderData } from '@/lib/site-sale-data';
import { balanceEffect } from '@/lib/balance-reconciliation';

// Website money (report fix #3): a payment the gateway left no trace of, or a
// test payment, books no income; every website money row names its order.

const TOKEN = 'website-money-test-token';
const OPENING = 1_000_000;
const TOTAL = 5_200_000;

let world: { account: { id: string }; warehouse: { id: string } };

beforeEach(async () => {
  process.env.ERP_API_SECRET = TOKEN;
  setTestRole('ADMIN');
  await resetDatabase();
  const account = await prisma.account.create({
    data: { name: 'بانک سامان', type: 'BANK', currency: 'TOMAN', balance: OPENING },
  });
  const warehouse = await prisma.warehouse.create({ data: { name: 'مشاهیر' } });
  const product = await prisma.product.create({
    data: { name: 'YEK - Black', sku: 'YEK/BLACK', webId: 'MOAK-YEK-BLACK', costPrice: 1, sellPrice: TOTAL },
  });
  await prisma.inventory.create({ data: { productId: product.id, warehouseId: warehouse.id, quantity: 5 } });
  world = { account, warehouse };
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
  return { status: res.status, body: await res.json() };
}

let counter = 0;
/** What the website's pushOrder sends (themoak-api/src/erp.ts), with `payment` as given. */
function sale(payment: Record<string, unknown>) {
  counter += 1;
  return {
    reference: `M-MONEY${counter}`,
    issuedAt: '2026-09-14T09:00:00.000Z',
    tag: 'website',
    warehouseId: world.warehouse.id,
    customer: { name: 'آزمایش', mobile: `0912000000${counter}`, email: null, siteId: null, ordersBefore: 0 },
    shipTo: null,
    shipping: { zone: 'tehran', carrier: 'پیک', freight: 0, free: true, trackingCode: null },
    items: [{ webId: 'MOAK-YEK-BLACK', quantity: 1, unitPrice: TOTAL }],
    subtotal: TOTAL,
    discount: 0,
    coupon: null,
    total: TOTAL,
    currency: 'toman',
    payment,
  };
}

// A gateway payment: the site sends the settled attempt's trackId and settledAt.
const REAL = { gateway: 'zibal', trackId: '3312001', refNumber: '98001', paidAt: '2026-09-14T08:59:40.000Z', amount: TOTAL };
// What the site sends for an order marked paid by hand: no settled attempt, so no trackId or paidAt.
const BY_HAND = { gateway: 'zibal', trackId: null, refNumber: null, paidAt: null, amount: TOTAL };

const orderOf = (reference: string) =>
  prisma.order.findUniqueOrThrow({ where: { siteReference: reference }, include: { moneyRows: true } });

async function balance() {
  return Number((await prisma.account.findUniqueOrThrow({ where: { id: world.account.id } })).balance);
}

async function assertBooksBalance() {
  const account = await prisma.account.findUniqueOrThrow({ where: { id: world.account.id }, include: { transactions: true } });
  const derived = OPENING + account.transactions.reduce((sum: number, t: any) => sum + balanceEffect(t), 0);
  assert.equal(Number(account.balance), derived);
}

test('a real gateway payment books income, and the income row carries the order id', async () => {
  const body = sale(REAL);
  assert.equal((await call('createSale', body)).status, 200);
  const order = await orderOf(body.reference);
  assert.equal(order.paymentStatus, 'PAID');
  assert.equal(Number(order.paidAmount), TOTAL);
  assert.deepEqual(order.moneyRows.map((t: any) => [t.type, Number(t.amount), t.id]), [['INCOME', TOTAL, order.transactionId]]);
  assert.equal(await balance(), OPENING + TOTAL);
  assert.ok(!order.tags.includes(TAG_NEEDS_REVIEW));
});

test('a sandbox payment books no income: the sale is recorded unpaid, stock still taken, and flagged', async () => {
  for (const payment of [{ ...REAL, sandbox: true }, { ...REAL, test: true }, { ...REAL, gateway: 'zibal-sandbox' }]) {
    const body = sale(payment);
    const res = await call('createSale', body);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const order = await orderOf(body.reference);
    assert.equal(order.paymentStatus, 'UNPAID', JSON.stringify(payment));
    assert.equal(Number(order.paidAmount), 0);
    assert.equal(order.transactionId, null);
    assert.equal(order.moneyRows.length, 0);
    assert.ok(order.tags.includes(TAG_NEEDS_REVIEW));
    const data = readSiteOrderData(order.siteData);
    assert.ok(data?.review.some((reason) => reason.includes('آزمایشی')), JSON.stringify(data?.review));
    // What the site said is kept, for the review page.
    assert.equal(data?.payment.amount, TOTAL);
  }
  assert.equal(await prisma.transaction.count(), 0);
  assert.equal(await balance(), OPENING);
  const stock = await prisma.inventory.findFirstOrThrow();
  assert.equal(stock.quantity, 5 - 3);
});

test('a payment with no gateway trace (marked paid by hand on the site) books no income', async () => {
  const body = sale(BY_HAND);
  assert.equal((await call('createSale', body)).status, 200);
  const order = await orderOf(body.reference);
  assert.equal(order.paymentStatus, 'UNPAID');
  assert.equal(Number(order.paidAmount), 0);
  assert.equal(await prisma.transaction.count(), 0);
  assert.equal(await balance(), OPENING);
  const review = readSiteOrderData(order.siteData)?.review ?? [];
  assert.ok(review.some((reason) => reason.includes('trackId')), JSON.stringify(review));
  // The customer owes the sale until someone decides.
  assert.equal(Number(order.totalAmount) - Number(order.discount) - Number(order.paidAmount), TOTAL);
});

test('a website refund books its EXPENSE with the order id, out of what the ERP holds', async () => {
  const body = sale(REAL);
  await call('createSale', body);
  const res = await call('setSaleStatus', { status: 'cancelled', reference: body.reference, amount: TOTAL, at: '2026-09-15T10:00:00.000Z' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const order = await orderOf(body.reference);
  assert.deepEqual(
    order.moneyRows.map((t: any) => [t.type, Number(t.amount)]).sort(),
    [['EXPENSE', TOTAL], ['INCOME', TOTAL]],
  );
  assert.equal(await balance(), OPENING);
  await assertBooksBalance();
});

test('refunding a sale that was recorded unpaid moves no money, and says so', async () => {
  const body = sale({ ...REAL, sandbox: true });
  await call('createSale', body);
  const res = await call('setSaleStatus', {
    status: 'refunded',
    reference: body.reference,
    amount: TOTAL,
    refundId: 'r-1',
    at: '2026-09-15T10:00:00.000Z',
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const order = await prisma.order.findUniqueOrThrow({ where: { siteReference: body.reference }, include: { siteRefunds: true } });
  assert.equal(await prisma.transaction.count(), 0, 'no refund leaves an account that never received the money');
  assert.equal(await balance(), OPENING);
  assert.equal(order.status, 'CANCELLED');
  assert.equal(Number(order.totalAmount) - Number(order.discount) - Number(order.paidAmount), 0);
  // The site's refund is still on record, with no money row.
  assert.deepEqual(order.siteRefunds.map((r: any) => [r.refundId, Number(r.amount), r.transactionId]), [['r-1', TOTAL, null]]);
  const review = readSiteOrderData(order.siteData)?.review ?? [];
  assert.ok(review.some((reason) => reason.includes('نگه نداشته')), JSON.stringify(review));
});

test('a cancel that carries no amount leaves the money booked and points at the review page', async () => {
  const body = sale(REAL);
  await call('createSale', body);
  await call('setSaleStatus', { status: 'cancelled', reference: body.reference, restock: true });
  const order = await orderOf(body.reference);
  assert.equal(order.status, 'CANCELLED');
  assert.equal(Number(order.paidAmount), TOTAL);
  const review = readSiteOrderData(order.siteData)?.review ?? [];
  assert.ok(review.some((reason) => reason.includes('بررسی پول سفارش‌های سایت')), JSON.stringify(review));
});
