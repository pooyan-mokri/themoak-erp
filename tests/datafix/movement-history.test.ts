import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase } from '../helpers/db';
import { stockIn } from '../sales/world';
import { reportRows, runTwice } from './sql';

// prisma/sql/datafix-2026-10-01-movement-history.sql: the movement history that old sales, returns
// and exchanges never wrote is rebuilt, each row dated at its event and noted «بازسازی تاریخچه».
// Inventory is never touched; what the history still cannot explain is reported, not forced.

beforeEach(() => resetDatabase());
after(() => prisma.$disconnect());

const NOTE = 'بازسازی تاریخچه';
const day = (d: string) => new Date(`${d}T09:00:00Z`);

test('sales, returns and exchanges get their movements at their dates; stock stays; the rest is left and reported', async () => {
  const shop = await prisma.warehouse.create({ data: { name: 'مشاهیر' } });
  const partnerCustomer = await prisma.customer.create({ data: { name: 'همکار' } });
  const partner = await prisma.warehouse.create({ data: { name: 'امانی', isVirtual: true, customerId: partnerCustomer.id } });
  const bank = await prisma.account.create({ data: { name: 'بانک', type: 'BANK', currency: 'TOMAN', balance: 0 } });
  const product = (sku: string) => prisma.product.create({ data: { name: sku, sku, costPrice: 1, sellPrice: 1 } });
  const a = await product('A');
  const b = await product('B');
  const c = await product('C');
  await stockIn(a.id, shop.id, 10);
  await stockIn(b.id, shop.id, 10);
  await stockIn(c.id, partner.id, 5);

  /** Stock taken (−) or put back (+) the old way: no movement. */
  const take = (productId: string, warehouseId: string, units: number) =>
    prisma.inventory.update({ where: { productId_warehouseId: { productId, warehouseId } }, data: { quantity: { increment: units } } });
  const order = (lines: Array<[string, number, string | null]>, data: Record<string, unknown> = {}) =>
    prisma.order.create({
      data: {
        totalAmount: 1, ...data,
        items: { create: lines.map(([productId, quantity, warehouseId]) => ({ productId, quantity, price: 1, warehouseId })) },
      },
      include: { items: true },
    });
  const movement = (data: Record<string, unknown>) => prisma.inventoryMovement.create({ data: data as any });

  // 1. A POS sale and a consignment sale with no movement.
  const pos = await order([[a.id, 2, shop.id]], { createdAt: day('2026-03-01') });
  await take(a.id, shop.id, -2);
  const consignment = await order([[c.id, 1, partner.id]], { createdAt: day('2026-03-02') });
  await take(c.id, partner.id, -1);
  // 2. A sale whose movement is on record: left as it is.
  const recorded = await order([[b.id, 1, shop.id]], { createdAt: day('2026-03-03') });
  await take(b.id, shop.id, -1);
  await movement({ productId: b.id, fromWarehouseId: shop.id, quantity: 1, type: 'SALE', referenceId: recorded.id, note: `فروش سفارش #${recorded.number}` });
  // 3. A line with no warehouse: nothing to take it from.
  const nowhere = await order([[a.id, 1, null]], { createdAt: day('2026-03-04') });
  // 4. Cancelled: one whose cancel wrote what it put back (its sale is rebuilt), one from before (left).
  const cancelledOnRecord = await order([[b.id, 1, shop.id]], { createdAt: day('2026-03-05'), status: 'CANCELLED' });
  await movement({ productId: b.id, toWarehouseId: shop.id, quantity: 1, type: 'RETURN', referenceId: cancelledOnRecord.id, note: `بازگشت از لغو سفارش #${cancelledOnRecord.number} — تشخیص انبار: ثبت‌شده` });
  const cancelledUnknown = await order([[a.id, 1, shop.id]], { createdAt: day('2026-03-06'), status: 'CANCELLED' });
  // 5. A sale of 2 with 1 returned later.
  const withReturn = await order([[b.id, 2, shop.id]], { createdAt: day('2026-03-07') });
  await take(b.id, shop.id, -2);
  const returned = await prisma.orderReturn.create({
    data: { orderId: withReturn.id, orderItemId: withReturn.items[0].id, quantity: 1, refundAmount: 0, accountId: bank.id, createdAt: day('2026-03-20') },
  });
  await take(b.id, shop.id, 1);
  // 6. An old exchange: A given back, B issued in its place.
  const exchanged = await order([[a.id, 1, shop.id]], { createdAt: day('2026-03-08') });
  await take(a.id, shop.id, -1);
  const issued = await prisma.orderItem.create({ data: { orderId: exchanged.id, productId: b.id, quantity: 1, price: 1, warehouseId: shop.id } });
  const exchange = await prisma.orderExchange.create({
    data: { orderId: exchanged.id, originalItemId: exchanged.items[0].id, exchangeItemId: issued.id, quantity: 1, priceDifference: 0, accountId: bank.id, createdAt: day('2026-03-25') },
  });
  await take(a.id, shop.id, 1);
  await take(b.id, shop.id, -1);
  // 7. Two returns of one line: the later one wrote its movement, the earlier did not.
  const twoReturns = await order([[b.id, 2, shop.id]], { createdAt: day('2026-03-09') });
  await take(b.id, shop.id, -2);
  await movement({ productId: b.id, fromWarehouseId: shop.id, quantity: 2, type: 'SALE', referenceId: twoReturns.id, note: 'x' });
  const early = await prisma.orderReturn.create({
    data: { orderId: twoReturns.id, orderItemId: twoReturns.items[0].id, quantity: 1, refundAmount: 0, accountId: bank.id, createdAt: day('2026-04-01') },
  });
  await prisma.orderReturn.create({
    data: { orderId: twoReturns.id, orderItemId: twoReturns.items[0].id, quantity: 1, refundAmount: 0, accountId: bank.id, createdAt: day('2026-09-01') },
  });
  await take(b.id, shop.id, 2);
  await movement({ productId: b.id, toWarehouseId: shop.id, quantity: 1, type: 'RETURN', referenceId: twoReturns.id, note: 'new' });
  // 8. Left: a website sale (always wrote its own), and a gift (its warehouse was never stored).
  await order([[a.id, 1, shop.id]], { createdAt: day('2026-03-10'), siteReference: 'M-SITE1' });
  await prisma.marketingGift.create({ data: { productId: a.id, quantity: 1, accountId: bank.id, costPrice: 1, totalCost: 1, date: day('2026-03-11') } });
  await take(a.id, shop.id, -1);

  const stock = await prisma.inventory.findMany({ orderBy: [{ productId: 'asc' }, { warehouseId: 'asc' }] });
  await runTwice('datafix-2026-10-01-movement-history.sql', ['InventoryMovement']);
  assert.deepEqual(await prisma.inventory.findMany({ orderBy: [{ productId: 'asc' }, { warehouseId: 'asc' }] }), stock);

  const rebuilt = await prisma.inventoryMovement.findMany({ where: { note: { contains: NOTE } }, orderBy: [{ createdAt: 'asc' }, { type: 'asc' }] });
  const sku = { [a.id]: 'A', [b.id]: 'B', [c.id]: 'C' } as Record<string, string>;
  const place = { [shop.id]: 'shop', [partner.id]: 'partner' } as Record<string, string>;
  assert.deepEqual(
    rebuilt.map((m: any) => [m.type, sku[m.productId], m.quantity, place[m.fromWarehouseId] ?? null, place[m.toWarehouseId] ?? null, m.createdAt.toISOString().slice(0, 10), m.note]),
    [
      ['SALE', 'A', 2, 'shop', null, '2026-03-01', `فروش سفارش #${pos.number} — ${NOTE}`],
      ['SALE', 'C', 1, 'partner', null, '2026-03-02', `فروش امانی - سفارش #${consignment.number} — ${NOTE}`],
      ['SALE', 'B', 1, 'shop', null, '2026-03-05', `فروش سفارش #${cancelledOnRecord.number} — ${NOTE}`],
      ['SALE', 'B', 2, 'shop', null, '2026-03-07', `فروش سفارش #${withReturn.number} — ${NOTE}`],
      ['SALE', 'A', 1, 'shop', null, '2026-03-08', `فروش سفارش #${exchanged.number} — ${NOTE}`],
      ['RETURN', 'B', 1, null, 'shop', '2026-03-20', `مرجوعی سفارش #${withReturn.number} — ${NOTE}`],
      ['SALE', 'B', 1, 'shop', null, '2026-03-25', `تعویض سفارش #${exchanged.number} — ${NOTE}`],
      ['RETURN', 'A', 1, null, 'shop', '2026-03-25', `تعویض سفارش #${exchanged.number} — ${NOTE}`],
      ['RETURN', 'B', 1, null, 'shop', '2026-04-01', `مرجوعی سفارش #${twoReturns.number} — ${NOTE}`],
    ],
  );
  // Each points at its order, as the app's own movements do.
  assert.ok(rebuilt.every((m: any) => [pos, consignment, cancelledOnRecord, withReturn, exchanged, twoReturns].some((o) => o.id === m.referenceId)));
  assert.ok(returned && exchange && early);

  // What the reports still list: the line with no warehouse, the cancel off the record, the website sale; the gift.
  assert.deepEqual(
    (await reportRows('report-pos-sales-without-movements.sql', 1)).map((r: any) => r.order_number).sort(),
    [nowhere.number, cancelledUnknown.number].sort(),
  );
  assert.deepEqual(await reportRows('report-returns-without-movements.sql'), []);
  assert.equal((await reportRows('report-gifts-without-movements.sql')).length, 1);
  // The history now explains the stock but for the gift: 1 A taken from the shop with no movement.
  assert.deepEqual(
    (await reportRows('report-stock-movement-gaps.sql', 1)).map((r: any) => [r.warehouse, r.sku, Number(r.stock), Number(r.net_movements), Number(r.gap)]),
    [['مشاهیر', 'A', 7, 8, -1]],
  );
});
