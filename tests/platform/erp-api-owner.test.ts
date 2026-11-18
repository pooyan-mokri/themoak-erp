import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { prisma, resetDatabase } from '../helpers/db';
import { GET } from '@/app/api/erp/route';

console.error = () => {};

const FULL = 'full-key-for-owner-api-tests';
const SITE = 'site-key-for-owner-api-tests';

beforeEach(async () => {
  process.env.ERP_API_SECRET = FULL;
  process.env.ERP_SITE_API_SECRET = SITE;
  await resetDatabase();
});
after(() => prisma.$disconnect());

const get = async (query: string, key = FULL) => {
  const res = await GET(new NextRequest(`http://localhost/api/erp?${query}`, { headers: { authorization: `Bearer ${key}` } }));
  return { status: res.status, body: await res.json() };
};

async function seed() {
  const shop = await prisma.warehouse.create({ data: { name: 'مشاهیر' } });
  const partner = await prisma.customer.create({ data: { name: 'همکار' } });
  const consignment = await prisma.warehouse.create({ data: { name: 'امانی همکار', isVirtual: true, customerId: partner.id } });
  const old = await prisma.warehouse.create({ data: { name: 'قدیمی', isArchived: true } });
  const a = await prisma.product.create({ data: { name: 'A', sku: 'A-1', costPrice: 1_000, sellPrice: 3_000 } });
  const b = await prisma.product.create({ data: { name: 'B', sku: 'B-1', costPrice: 2_000, sellPrice: 5_000 } });
  await prisma.inventory.createMany({
    data: [
      { productId: a.id, warehouseId: shop.id, quantity: 8 },
      { productId: a.id, warehouseId: consignment.id, quantity: 2 },
      { productId: a.id, warehouseId: old.id, quantity: 50 },
      { productId: b.id, warehouseId: shop.id, quantity: -3 },
    ],
  });
  const customer = await prisma.customer.create({ data: { name: 'مشتری' } });
  const account = await prisma.account.create({ data: { name: 'بانک', type: 'BANK', currency: 'TOMAN', balance: 0 } });
  return { shop, consignment, a, b, customer, account };
}

test('productSales counts the units still sold: returned and exchanged-away units and cancelled orders are not sales', async () => {
  const { shop, a, b, customer, account } = await seed();
  const order = await prisma.order.create({
    data: { customerId: customer.id, totalAmount: 30_000, paidAmount: 30_000, items: { create: [{ productId: a.id, quantity: 10, price: 3_000, warehouseId: shop.id }] } },
    include: { items: true },
  });
  const line = order.items[0];
  await prisma.orderReturn.create({ data: { orderId: order.id, orderItemId: line.id, quantity: 3, refundAmount: 9_000, accountId: account.id } });
  const replacement = await prisma.orderItem.create({ data: { orderId: order.id, productId: b.id, quantity: 2, price: 5_000, warehouseId: shop.id } });
  await prisma.orderExchange.create({ data: { orderId: order.id, originalItemId: line.id, exchangeItemId: replacement.id, quantity: 2, priceDifference: 4_000, accountId: account.id } });
  await prisma.order.create({
    data: { customerId: customer.id, status: 'CANCELLED', totalAmount: 3_000, paidAmount: 0, items: { create: [{ productId: a.id, quantity: 1, price: 3_000, warehouseId: shop.id }] } },
  });
  // Older than the window.
  await prisma.order.create({
    data: { customerId: customer.id, createdAt: new Date(Date.now() - 100 * 86400000), totalAmount: 3_000, paidAmount: 0, items: { create: [{ productId: a.id, quantity: 4, price: 3_000, warehouseId: shop.id }] } },
  });

  const { status, body } = await get('action=productSales&days=90');
  assert.equal(status, 200);
  const bySku = Object.fromEntries(body.products.map((p: any) => [p.sku, p]));
  assert.equal(bySku['A-1'].sold, 10 - 3 - 2);
  assert.equal(bySku['B-1'].sold, 2);
  // Available: non-archived warehouses, negative rows counted as none.
  assert.equal(bySku['A-1'].available, 10);
  assert.equal(bySku['B-1'].available, 0);
  assert.equal(bySku['A-1'].perMonth, Math.round((5 / 90) * 30 * 100) / 100);
  assert.equal((await get('action=productSales&days=120')).body.products.find((p: any) => p.sku === 'A-1').sold, 9);
  for (const days of ['abc', '0']) assert.equal((await get(`action=productSales&days=${days}`)).body.days, 90, days);
  assert.equal((await get('action=productSales&days=-3')).body.days, 1);
  assert.equal((await get('action=productSales&days=5000')).body.days, 730);
  assert.equal((await get('action=productSales', SITE)).status, 403);
});

test('inventory separates own, consignment and short stock, with totals that add up', async () => {
  const { a } = await seed();
  const { status, body } = await get('action=inventory');
  assert.equal(status, 200);
  const bySku = Object.fromEntries(body.products.map((p: any) => [p.sku, p]));
  assert.deepEqual(
    [bySku['A-1'].onHand, bySku['A-1'].consigned, bySku['A-1'].available, bySku['A-1'].shortfall, bySku['A-1'].net],
    [8, 2, 10, 0, 10],
  );
  assert.deepEqual([bySku['B-1'].available, bySku['B-1'].shortfall, bySku['B-1'].net], [0, 3, -3]);
  assert.deepEqual(bySku['A-1'].byWarehouse, { مشاهیر: 8, 'امانی همکار': 2 }, 'the archived warehouse is left out');
  assert.deepEqual(
    [body.totals.available, body.totals.net, body.totals.shortfall, body.totals.valueAtCost],
    [10, 7, 3, 10 * 1_000],
  );
  assert.equal(body.totals.available, body.products.reduce((s: number, p: any) => s + p.available, 0));

  const archived = await get('action=inventory&includeArchived=true');
  assert.equal(archived.body.products.find((p: any) => p.sku === 'A-1').onHand, 58);
  assert.deepEqual((await get('action=inventory&filter=negative')).body.products.map((p: any) => p.sku), ['B-1']);
  assert.deepEqual((await get('action=inventory&filter=zero')).body.products.map((p: any) => p.sku), ['B-1']);
  assert.deepEqual((await get('action=inventory&sku=a-1')).body.products.map((p: any) => p.id ?? p.sku), ['A-1']);
  assert.ok(a.id);
  assert.equal((await get('action=inventory', SITE)).status, 403);
});

test('loans, search, accounts and transactions read what is stored, for the full key only', async () => {
  const { customer, account } = await seed();
  const employee = await prisma.employee.create({ data: { name: 'کارمند', position: 'فروش', salary: 10_000_000 } });
  await prisma.loan.create({ data: { employeeId: employee.id, amount: 5_000_000, remaining: 2_000_000 } });
  await prisma.transaction.create({ data: { type: 'INCOME', amount: 3_000, amountInToman: 3_000, currency: 'TOMAN', accountId: account.id, description: 'فروش مشتری' } });
  await prisma.order.create({ data: { customerId: customer.id, totalAmount: 3_000, paidAmount: 0 } });

  const loans = await get('action=loans');
  assert.deepEqual(loans.body.map((l: any) => [l.employee, l.amount, l.remaining, l.paid]), [['کارمند', 5_000_000, 2_000_000, 3_000_000]]);

  const found = await get(`action=search&q=${encodeURIComponent('مشتری')}`);
  assert.deepEqual([found.body.customers.length, found.body.transactions.length, found.body.orders.length], [1, 1, 1]);
  assert.equal(found.body.transactions[0].amountInToman, 3_000);
  assert.equal((await get('action=search&q=a')).status, 400);

  const accounts = await get('action=accounts');
  assert.deepEqual(accounts.body.map((a: any) => [a.name, a.currency, a.balance]), [['بانک', 'TOMAN', 0]]);
  const rows = await get('action=transactions');
  assert.deepEqual(rows.body.transactions.map((t: any) => [t.type, t.amount, t.amountInToman, t.account]), [['INCOME', 3_000, 3_000, 'بانک']]);
  assert.deepEqual([rows.body.total, rows.body.nextOffset], [1, null]);

  for (const action of ['loans', 'search&q=abc', 'accounts', 'transactions', 'orders', 'settlements', 'summary']) {
    assert.equal((await get(`action=${action}`, SITE)).status, 403, action);
    assert.equal((await get(`action=${action}`, 'wrong')).status, 401, action);
  }
});
