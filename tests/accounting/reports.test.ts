import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { getInventoryAgingReport, getSalesByCustomer, getSalesOverTime, getStockTurnoverReport } from '@/actions/reports';

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
});
after(() => prisma.$disconnect());

const FROM = new Date('2026-01-01T00:00:00Z');
const TO = new Date('2026-12-31T23:59:59Z');

async function orders() {
  const sara = await prisma.customer.create({ data: { name: 'سارا' } });
  const order = (createdAt: string, totalAmount: number, data: Record<string, unknown> = {}) =>
    prisma.order.create({ data: { totalAmount, createdAt: new Date(createdAt), ...data } as any });
  await order('2026-09-30T20:45:00Z', 4_000_000, { customerId: sara.id }); // 1 Oct 00:15 in Tehran
  await order('2026-09-30T10:00:00Z', 1_000_000, { customerId: sara.id });
  await order('2026-09-15T10:00:00Z', 2_500_000);
  await order('2026-09-16T10:00:00Z', 9_000_000, { status: 'CANCELLED', customerId: sara.id });
  return sara;
}

test('sales by customer add each customer\'s uncancelled orders; walk-ins are one line', async () => {
  await orders();
  assert.deepEqual(await getSalesByCustomer(FROM, TO), [
    { name: 'سارا', orderCount: 2, revenue: 5_000_000 },
    { name: 'مشتری حضوری', orderCount: 1, revenue: 2_500_000 },
  ]);
});

test('sales over time are grouped by Tehran day or month', async () => {
  await orders();
  assert.deepEqual(await getSalesOverTime(FROM, TO, 'month'), [
    { period: '2026-09', revenue: 3_500_000, orders: 2 },
    { period: '2026-10', revenue: 4_000_000, orders: 1 },
  ]);
  assert.deepEqual(
    (await getSalesOverTime(FROM, TO, 'day')).map((d: any) => [d.period, d.revenue]),
    [['2026-09-15', 2_500_000], ['2026-09-30', 1_000_000], ['2026-10-01', 4_000_000]],
  );
  const weeks = await getSalesOverTime(FROM, TO, 'week');
  assert.equal(weeks.reduce((sum: number, w: any) => sum + w.revenue, 0), 7_500_000);
});

test('stock turnover is units sold in 90 days over units in stock; inventory age reads the product\'s age', async () => {
  const warehouse = await prisma.warehouse.create({ data: { name: 'مشاهیر' } });
  const fresh = await prisma.product.create({ data: { name: 'PANJ', sku: 'P1', costPrice: 4_000_000, sellPrice: 10_000_000 } });
  const old = await prisma.product.create({
    data: { name: 'RAW', sku: 'R1', costPrice: 3_000_000, sellPrice: 9_000_000, createdAt: new Date(Date.now() - 200 * 86400000) },
  });
  await prisma.inventory.create({ data: { productId: fresh.id, warehouseId: warehouse.id, quantity: 4 } });
  await prisma.inventory.create({ data: { productId: old.id, warehouseId: warehouse.id, quantity: 10 } });
  await prisma.order.create({
    data: { totalAmount: 60_000_000, items: { create: [{ productId: fresh.id, warehouseId: warehouse.id, quantity: 6, price: 10_000_000 }] } },
  });
  await prisma.order.create({
    data: { totalAmount: 1, status: 'CANCELLED', items: { create: [{ productId: old.id, warehouseId: warehouse.id, quantity: 5, price: 1 }] } },
  });

  assert.deepEqual(await getStockTurnoverReport(), [
    { name: 'PANJ', soldQuantity: 6, currentStock: 4, turnoverRate: 1.5 },
    { name: 'RAW', soldQuantity: 0, currentStock: 10, turnoverRate: 0 },
  ]);
  const aging = await getInventoryAgingReport();
  assert.deepEqual(aging.map((a: any) => [a.name, a.quantity, a.value, a.category]), [
    ['RAW', 10, 30_000_000, 'بیش از 180 روز'],
    ['PANJ', 4, 16_000_000, 'کمتر از 90 روز'],
  ]);

  // A fixed asset or a consumable is not stock (src/lib/stock-levels.ts): the aging report, and the stock value
  // the reports page adds up from it, leave it out; OTHER is stock like SALEABLE.
  for (const [name, productType] of [['SHELF', 'FIXED_ASSET'], ['BAGS', 'CONSUMABLE'], ['CASE', 'OTHER']]) {
    const product = await prisma.product.create({ data: { name, sku: name, costPrice: 1_000, sellPrice: 1, productType: productType as any } });
    await prisma.inventory.create({ data: { productId: product.id, warehouseId: warehouse.id, quantity: 3 } });
  }
  assert.deepEqual((await getInventoryAgingReport()).map((a: any) => a.name).sort(), ['CASE', 'PANJ', 'RAW']);
});
