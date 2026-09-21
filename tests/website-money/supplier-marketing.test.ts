import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase, form } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { recordArrival, recordPurchasePartialPayment, recordPurchasePayment } from '@/actions/supplier-workflow';
import { createMarketingGift } from '@/actions/marketing';
import { DUPLICATE_REQUEST_MESSAGE } from '@/lib/request-id';
import { balanceEffect } from '@/lib/balance-reconciliation';

// Supplier payments and arrival costs move the paying account in its own
// currency, once per submission; marketing gifts go on EXPENSE accounts only
// (report fix #9, the supplier and marketing parts).

console.error = () => {};

const USD_RATE = 100_000;
const OPENING = { toman: 50_000_000, usd: 1_000 };

let world: { supplier: { id: string }; product: { id: string }; warehouse: { id: string } };

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
  await prisma.account.createMany({
    data: [
      { id: 'toman', name: 'بانک', type: 'BANK', currency: 'TOMAN', balance: OPENING.toman },
      { id: 'usd', name: 'حساب ذخیره دلاری', type: 'BANK', currency: 'USD', balance: OPENING.usd },
      { id: 'marketing', name: 'Marketing Expenses', type: 'EXPENSE', currency: 'TOMAN', balance: 0 },
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

const balanceOf = async (id: string) => Number((await prisma.account.findUniqueOrThrow({ where: { id } })).balance);

async function assertLedger(id: 'toman' | 'usd') {
  const account = await prisma.account.findUniqueOrThrow({ where: { id }, include: { transactions: true } });
  const derived = OPENING[id] + account.transactions.reduce((sum: number, t: any) => sum + balanceEffect(t), 0);
  assert.ok(Math.abs(Number(account.balance) - derived) < 1e-9, `${id}: ${Number(account.balance)} vs ${derived}`);
}

test('a supplier payment from a dollar account moves the dollar equivalent, not the Toman figure', async () => {
  const order = await purchaseOrder('PENDING_PAYMENT', 200_000_000);
  const result = await recordPurchasePartialPayment({ orderId: order.id, accountId: 'usd', amount: 5_000_000 });
  assert.equal(result.success, true, result.message);
  assert.equal(await balanceOf('usd'), OPENING.usd - 50);
  const row = await prisma.transaction.findFirstOrThrow();
  assert.deepEqual([Number(row.amount), row.currency, Number(row.rateSnapshot), Number(row.amountInToman)], [50, 'USD', USD_RATE, 5_000_000]);
  // The order's own bookkeeping stays in Toman.
  const payment = await prisma.purchaseOrderPayment.findFirstOrThrow();
  assert.equal(Number(payment.amount), 5_000_000);
  assert.equal((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: order.id } })).status, 'PARTIALLY_PAID');
  await assertLedger('usd');

  // More than the account holds, in its own currency, is refused.
  const short = await recordPurchasePartialPayment({ orderId: order.id, accountId: 'usd', amount: 100_000_000 });
  assert.equal(short.success, false);
  assert.match(short.message ?? '', /USD/);
});

test('a full supplier payment from a dollar account converts too', async () => {
  const order = await purchaseOrder('PENDING_PAYMENT', 30_000_000);
  const result = await recordPurchasePayment(order.id, 'usd');
  assert.equal(result.success, true, result.message);
  assert.equal(await balanceOf('usd'), OPENING.usd - 300);
  await assertLedger('usd');
});

test('the same payment submission books once', async () => {
  const order = await purchaseOrder('PENDING_PAYMENT');
  const pay = () => recordPurchasePartialPayment({ orderId: order.id, accountId: 'toman', amount: 1_000_000, requestId: 'supplier-pay-0001' });
  const results = await Promise.all([pay(), pay()]);
  assert.ok(results.every((r) => r.success), JSON.stringify(results));
  assert.equal((await pay()).message, DUPLICATE_REQUEST_MESSAGE);
  assert.equal(await prisma.transaction.count(), 1);
  assert.equal(await prisma.purchaseOrderPayment.count(), 1);
  assert.equal(await balanceOf('toman'), OPENING.toman - 1_000_000);

  const full = await purchaseOrder('PENDING_PAYMENT', 2_000_000);
  assert.equal((await recordPurchasePayment(full.id, 'toman', 'supplier-full-0001')).success, true);
  assert.equal((await recordPurchasePayment(full.id, 'toman', 'supplier-full-0001')).message, DUPLICATE_REQUEST_MESSAGE);
  assert.equal(await balanceOf('toman'), OPENING.toman - 3_000_000);
  await assertLedger('toman');
});

test('arrival costs paid from a dollar account move dollars; one submission books once', async () => {
  const order = await purchaseOrder('IN_PRODUCTION');
  const costs = [
    { title: 'حمل', amount: 2_000_000, currency: 'TOMAN' as const },
    { title: 'ترخیص', amount: 30, currency: 'USD' as const },
  ];
  const result = await recordArrival(order.id, costs, 'usd', 'arrival-request-01');
  assert.equal(result.success, true, result.message);
  assert.equal(await balanceOf('usd'), OPENING.usd - 20 - 30);
  const rows = await prisma.transaction.findMany({ orderBy: { amountInToman: 'desc' } });
  assert.deepEqual(
    rows.map((t: any) => [Number(t.amount), t.currency, Number(t.amountInToman)]),
    [[30, 'USD', 3_000_000], [20, 'USD', 2_000_000]],
  );
  // The landed-cost rows keep each cost in its own currency and in Toman.
  const arrival = await prisma.purchaseOrderArrivalCost.findMany({ orderBy: { amountInToman: 'asc' } });
  assert.deepEqual(arrival.map((c: any) => [Number(c.amount), c.currency, Number(c.amountInToman)]), [[2_000_000, 'TOMAN', 2_000_000], [30, 'USD', 3_000_000]]);
  assert.equal((await recordArrival(order.id, costs, 'usd', 'arrival-request-01')).message, DUPLICATE_REQUEST_MESSAGE);
  assert.equal(await prisma.transaction.count(), 2);
  await assertLedger('usd');
});

function gift(accountId: string) {
  return createMarketingGift(
    undefined,
    form({
      items: JSON.stringify([{ productId: world.product.id, quantity: 1, warehouseId: world.warehouse.id }]),
      recipientName: 'اینفلوئنسر',
      accountId,
      date: '2026-09-01',
    }),
  );
}

test('a gift is refused on a bank account and booked on an expense account', async () => {
  const refused = await gift('toman');
  assert.notEqual(refused.success, true);
  assert.match(refused.message ?? '', /حساب هزینه/);
  assert.equal(await prisma.transaction.count(), 0);
  assert.equal(await prisma.marketingGift.count(), 0);
  assert.equal(await balanceOf('toman'), OPENING.toman);
  assert.equal((await prisma.inventory.findFirstOrThrow()).quantity, 5);

  const booked = await gift('marketing');
  assert.equal(booked.success, true, booked.message);
  const row = await prisma.transaction.findFirstOrThrow();
  assert.deepEqual([row.accountId, row.type, Number(row.amount)], ['marketing', 'EXPENSE', 300_000]);
  assert.equal((await prisma.inventory.findFirstOrThrow()).quantity, 4);
});
