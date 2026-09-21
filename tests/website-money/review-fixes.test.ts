import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { prisma, resetDatabase, form } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { POST } from '@/app/api/erp/route';
import { recordArrival, recordPurchasePartialPayment, recordPurchasePayment } from '@/actions/supplier-workflow';
import { createMarketingGift } from '@/actions/marketing';
import { balanceEffect } from '@/lib/balance-reconciliation';

// Defects found reviewing the website-money area: a requestId the API cannot
// use must not be dropped silently; two different submissions paying one
// purchase order at once must not both book; a gift on a dollar expense
// account moves dollars.

console.error = () => {};

const TOKEN = 'review-fixes-token';
const USD_RATE = 100_000;
const OPENING = { toman: 50_000_000, usd: 1_000, gifts: 0 };

let world: { supplier: { id: string }; product: { id: string }; warehouse: { id: string } };

beforeEach(async () => {
  process.env.ERP_API_SECRET = TOKEN;
  setTestRole('ADMIN');
  await resetDatabase();
  await prisma.account.createMany({
    data: [
      { id: 'toman', name: 'بانک', type: 'BANK', currency: 'TOMAN', balance: OPENING.toman },
      { id: 'usd', name: 'حساب ذخیره دلاری', type: 'BANK', currency: 'USD', balance: OPENING.usd },
      { id: 'gifts', name: 'هدایای دلاری', type: 'EXPENSE', currency: 'USD', balance: OPENING.gifts },
    ],
  });
  await prisma.exchangeRate.create({ data: { currency: 'USD', rateToToman: USD_RATE, date: new Date('2026-09-01') } });
  const supplier = await prisma.supplier.create({ data: { name: 'Mazzucchelli' } });
  const product = await prisma.product.create({ data: { name: 'PANJ', sku: 'PANJ/BLUE', costPrice: 300_000, sellPrice: 2_000_000 } });
  const warehouse = await prisma.warehouse.create({ data: { name: 'مرکزی' } });
  await prisma.inventory.create({ data: { productId: product.id, warehouseId: warehouse.id, quantity: 5 } });
  world = { supplier, product, warehouse };
});
after(() => prisma.$disconnect());

const balanceOf = async (id: string) => Number((await prisma.account.findUniqueOrThrow({ where: { id } })).balance);

async function assertLedgers() {
  for (const [id, opening] of Object.entries(OPENING)) {
    const account = await prisma.account.findUniqueOrThrow({ where: { id }, include: { transactions: true } });
    const derived = opening + account.transactions.reduce((sum: number, t: any) => sum + balanceEffect(t), 0);
    assert.ok(Math.abs(Number(account.balance) - derived) < 1e-9, `${id}: ${Number(account.balance)} vs ${derived}`);
  }
}

async function post(body: Record<string, unknown>) {
  const res = await POST(
    new NextRequest('http://localhost/api/erp', {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: await res.json() };
}

test('an API requestId the ERP cannot store is 422, not silently dropped (a retry would book twice)', async () => {
  for (const requestId of ['lunch', 'has space here', 'x'.repeat(65), 12345678, 'ناهار-۱۴۰۵-۰۶-۱۱']) {
    for (const body of [
      { action: 'expense', accountId: 'toman', amount: 632_200, currency: 'TOMAN', description: 'Other - ناهار', requestId },
      { action: 'deposit', accountId: 'toman', amount: 632_200, currency: 'TOMAN', description: 'x', requestId },
      { action: 'transfer', fromAccountId: 'toman', toAccountId: 'usd', amount: 1, requestId },
    ]) {
      const res = await post(body);
      assert.equal(res.status, 422, `${body.action} ${String(requestId)}: ${JSON.stringify(res.body)}`);
      assert.match(res.body.error, /requestId/);
    }
  }
  assert.equal(await prisma.transaction.count(), 0);
  assert.equal(await balanceOf('toman'), OPENING.toman);
  // Leaving it out (or empty) is still allowed: no protection asked for.
  assert.equal((await post({ action: 'deposit', accountId: 'toman', amount: 1, description: 'x', requestId: '' })).status, 200);
});

function purchaseOrder(status: string, total = 20_000_000) {
  return prisma.purchaseOrder.create({
    data: {
      supplierId: world.supplier.id,
      status,
      totalAmount: total,
      totalAmountInToman: total,
      items: { create: [{ productId: world.product.id, quantity: 10, unitCost: total / 10, unitCostInToman: total / 10 }] },
    },
  });
}

test('two different submissions paying one purchase order in full at once: one pays, one is refused', async () => {
  const order = await purchaseOrder('PENDING_PAYMENT', 20_000_000);
  const results = await Promise.all([
    recordPurchasePayment(order.id, 'toman', 'supplier-tab-a-001'),
    recordPurchasePayment(order.id, 'toman', 'supplier-tab-b-001'),
  ]);
  assert.deepEqual(results.map((r) => r.success).sort(), [false, true], JSON.stringify(results));
  assert.equal(await prisma.transaction.count(), 1);
  assert.equal(await prisma.purchaseOrderPayment.count(), 1);
  assert.equal(await balanceOf('toman'), OPENING.toman - 20_000_000);
  await assertLedgers();
});

test('two partial payments at once never pay a purchase order beyond its total', async () => {
  const order = await purchaseOrder('PENDING_PAYMENT', 20_000_000);
  const pay = (requestId: string) =>
    recordPurchasePartialPayment({ orderId: order.id, accountId: 'toman', amount: 15_000_000, requestId });
  const results = await Promise.all([pay('partial-tab-a-001'), pay('partial-tab-b-001')]);
  assert.deepEqual(results.map((r) => r.success).sort(), [false, true], JSON.stringify(results));
  const paid = await prisma.purchaseOrderPayment.aggregate({ _sum: { amount: true } });
  assert.equal(Number(paid._sum.amount), 15_000_000);
  assert.equal(await balanceOf('toman'), OPENING.toman - 15_000_000);
  await assertLedgers();
});

test('two different arrival submissions at once book the arrival costs once', async () => {
  const order = await purchaseOrder('IN_PRODUCTION');
  const costs = [{ title: 'حمل', amount: 2_000_000, currency: 'TOMAN' as const }];
  const results = await Promise.all([
    recordArrival(order.id, costs, 'toman', 'arrival-tab-a-001'),
    recordArrival(order.id, costs, 'toman', 'arrival-tab-b-001'),
  ]);
  assert.deepEqual(results.map((r) => r.success).sort(), [false, true], JSON.stringify(results));
  assert.equal(await prisma.transaction.count(), 1);
  assert.equal(await prisma.purchaseOrderArrivalCost.count(), 1);
  assert.equal(await balanceOf('toman'), OPENING.toman - 2_000_000);
  await assertLedgers();
});

test('a gift on a dollar expense account moves the dollar equivalent of its cost', async () => {
  const result = await createMarketingGift(
    undefined,
    form({
      items: JSON.stringify([{ productId: world.product.id, quantity: 1, warehouseId: world.warehouse.id }]),
      recipientName: 'اینفلوئنسر',
      accountId: 'gifts',
      date: '2026-09-01',
    }),
  );
  assert.equal(result.success, true, result.message);
  const row = await prisma.transaction.findFirstOrThrow();
  assert.deepEqual(
    [Number(row.amount), row.currency, Number(row.rateSnapshot), Number(row.amountInToman)],
    [3, 'USD', USD_RATE, 300_000],
  );
  assert.equal(await balanceOf('gifts'), OPENING.gifts - 3);
  // The gift's own record stays in Toman.
  assert.equal(Number((await prisma.marketingGift.findFirstOrThrow()).totalCost), 300_000);
  await assertLedgers();
});
