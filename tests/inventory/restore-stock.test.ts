import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { prisma, resetDatabase } from '../helpers/db';
import { beforeQuery } from '../helpers/hooks';
import { setTestRole } from '../stubs/auth';
import { AccessDenied } from '@/lib/access';
import { resolveRestoreWarehouse, restorableQuantity, restoreOrderItemStock } from '@/lib/restore-warehouse';
import { getUnrestoredCancelledOrders, repairCancelledOrderStock } from '@/actions/lost-stock';
import { qty } from './stock';

// Where cancelled or repaired sale stock goes back to (src/lib/restore-warehouse.ts), and the lost-stock
// report and repair built on it.

console.error = () => {};

let main: { id: string };
let product: { id: string };
let customer: { id: string };
let account: { id: string };

beforeEach(async () => {
  setTestRole('ADMIN');
  beforeQuery.fn = null;
  await resetDatabase();
  main = await prisma.warehouse.create({ data: { name: 'مرکزی' } });
  product = await prisma.product.create({ data: { name: 'PANJ - Blue', sku: 'PANJ/BLUE', costPrice: 700_000, sellPrice: 2_000_000 } });
  customer = await prisma.customer.create({ data: { name: 'مریم' } });
  account = await prisma.account.create({ data: { name: 'بانک', type: 'BANK', currency: 'TOMAN' } });
});
after(() => prisma.$disconnect());

type Line = { warehouseId?: string | null; quantity?: number; productId?: string };

/** A sale whose lines carry (or lack) a warehouse. */
async function sale(lines: Line[], extra: Record<string, unknown> = {}) {
  return prisma.order.create({
    data: {
      customerId: customer.id,
      totalAmount: 2_000_000,
      status: 'CANCELLED',
      ...extra,
      items: {
        create: lines.map((l) => ({
          productId: l.productId ?? product.id,
          warehouseId: l.warehouseId ?? null,
          quantity: l.quantity ?? 1,
          price: 2_000_000,
        })),
      },
    },
    include: { items: true },
  });
}

const decide = (order: any, item = order.items[0]) => resolveRestoreWarehouse(prisma, order, item, 'PANJ - Blue');

test('restorableQuantity: what is still with the customer after returns and exchanges, never below zero', async () => {
  const order = await sale([{ quantity: 5 }]);
  const item = order.items[0];
  const other = (await sale([{ quantity: 1 }])).items[0];
  assert.equal(await restorableQuantity(prisma, item), 5);
  await prisma.orderReturn.create({ data: { orderId: order.id, orderItemId: item.id, quantity: 2, refundAmount: 0, accountId: account.id } });
  await prisma.orderExchange.create({
    data: { orderId: order.id, originalItemId: item.id, exchangeItemId: other.id, quantity: 1, priceDifference: 0, accountId: account.id },
  });
  assert.equal(await restorableQuantity(prisma, item), 2);
  await prisma.orderReturn.create({ data: { orderId: order.id, orderItemId: item.id, quantity: 9, refundAmount: 0, accountId: account.id } });
  assert.equal(await restorableQuantity(prisma, item), 0);
});

test('resolve: the line\'s own warehouse wins; a WooCommerce line without one is not credited', async () => {
  const shop = await prisma.warehouse.create({ data: { name: 'فروشگاه' } });
  assert.deepEqual(await decide(await sale([{ warehouseId: shop.id }])), { restore: true, warehouseId: shop.id, source: 'ثبت‌شده روی قلم' });
  const woo = await decide(await sale([{}], { wooId: 777 }));
  assert.equal(woo.restore, false);
  assert.match((woo as any).reason, /ووکامرس/);
});

test('resolve: the SALE movement recorded for the order, then the partner\'s only virtual warehouse', async () => {
  const shop = await prisma.warehouse.create({ data: { name: 'فروشگاه' } });
  const order = await sale([{}]);
  await prisma.inventoryMovement.create({ data: { productId: product.id, fromWarehouseId: shop.id, quantity: 1, type: 'SALE', referenceId: order.id } });
  assert.deepEqual(await decide(order), { restore: true, warehouseId: shop.id, source: 'گردش انبار' });

  const partner = await prisma.warehouse.create({ data: { name: 'امانی', isVirtual: true, customerId: customer.id } });
  await prisma.warehouse.create({ data: { name: 'امانی قدیمی', isVirtual: true, customerId: customer.id, isArchived: true } });
  assert.deepEqual(await decide(await sale([{}])), { restore: true, warehouseId: partner.id, source: 'انبار امانی مشتری' });
});

test('resolve: with two partner warehouses, the one holding the product; with none holding it, the oldest', async () => {
  const first = await prisma.warehouse.create({ data: { name: 'امانی ۱', isVirtual: true, customerId: customer.id, createdAt: new Date('2026-01-01') } });
  const second = await prisma.warehouse.create({ data: { name: 'امانی ۲', isVirtual: true, customerId: customer.id, createdAt: new Date('2026-02-01') } });
  assert.equal(((await decide(await sale([{}]))) as any).warehouseId, first.id);
  await prisma.inventory.create({ data: { productId: product.id, warehouseId: second.id, quantity: 4 } });
  assert.equal(((await decide(await sale([{}]))) as any).warehouseId, second.id);
});

test('resolve: a sibling line\'s warehouse, unless it is archived or another customer\'s virtual one', async () => {
  const other = await prisma.product.create({ data: { name: 'YEK', sku: 'YEK', costPrice: 1, sellPrice: 1 } });
  const shop = await prisma.warehouse.create({ data: { name: 'فروشگاه' } });
  const order = await sale([{}, { productId: other.id, warehouseId: shop.id }]);
  assert.deepEqual(await decide(order), { restore: true, warehouseId: shop.id, source: 'انبار سایر اقلام همین سفارش' });

  const someoneElse = await prisma.customer.create({ data: { name: 'شریک دیگر' } });
  const theirs = await prisma.warehouse.create({ data: { name: 'امانی دیگر', isVirtual: true, customerId: someoneElse.id } });
  const leaky = await sale([{}, { productId: other.id, warehouseId: theirs.id }], { customerId: null });
  // Falls through to the only physical live warehouses: main and shop exist, so the product's holder decides.
  await prisma.inventory.create({ data: { productId: product.id, warehouseId: main.id, quantity: 3 } });
  assert.deepEqual(await decide(leaky), { restore: true, warehouseId: main.id, source: 'انبار فعلی همین کالا' });
});

test('resolve: the configured default warehouse, then one named «انبار اصلی», archived or virtual ones skipped', async () => {
  const configured = await prisma.warehouse.create({ data: { name: 'پیش‌فرض' } });
  await prisma.systemSetting.create({ data: { key: 'woo_settings', value: JSON.stringify({ warehouseId: configured.id }) } });
  const order = await sale([{}], { customerId: null });
  assert.deepEqual(await decide(order), { restore: true, warehouseId: configured.id, source: 'انبار پیش‌فرض' });

  await prisma.warehouse.update({ where: { id: configured.id }, data: { isArchived: true } });
  const named = await prisma.warehouse.create({ data: { name: 'انبار اصلی' } });
  assert.deepEqual(await decide(order), { restore: true, warehouseId: named.id, source: 'انبار اصلی' });

  await prisma.systemSetting.update({ where: { key: 'woo_settings' }, data: { value: 'not json' } });
  assert.equal(((await decide(order)) as any).warehouseId, named.id);
});

test('resolve: the only physical warehouse; with several and no clue it refuses rather than lose the goods', async () => {
  await prisma.warehouse.create({ data: { name: 'مجازی', isVirtual: true } });
  const order = await sale([{}], { customerId: null });
  assert.deepEqual(await decide(order), { restore: true, warehouseId: main.id, source: 'تنها انبار فیزیکی' });
  await prisma.warehouse.create({ data: { name: 'فروشگاه' } });
  await assert.rejects(decide(order), /قابل تشخیص نیست/);
});

test('restoreOrderItemStock credits what is owed with a RETURN movement; nothing owed or a Woo line changes nothing', async () => {
  const order = await sale([{ warehouseId: main.id, quantity: 3 }]);
  await prisma.orderReturn.create({ data: { orderId: order.id, orderItemId: order.items[0].id, quantity: 1, refundAmount: 0, accountId: account.id } });
  const note = await restoreOrderItemStock(prisma, order, order.items[0], 'PANJ - Blue', order.number);
  assert.equal(note, null);
  assert.equal(await qty(product.id, main.id), 2);
  const movement = await prisma.inventoryMovement.findFirstOrThrow();
  assert.deepEqual(
    [movement.type, movement.toWarehouseId, movement.quantity, movement.referenceId, movement.note],
    ['RETURN', main.id, 2, order.id, `بازگشت از لغو سفارش #${order.number} — تشخیص انبار: ثبت‌شده روی قلم`],
  );

  const returned = await sale([{ warehouseId: main.id, quantity: 1 }]);
  await prisma.orderReturn.create({ data: { orderId: returned.id, orderItemId: returned.items[0].id, quantity: 1, refundAmount: 0, accountId: account.id } });
  assert.equal(await restoreOrderItemStock(prisma, returned, returned.items[0], 'PANJ - Blue', returned.number), null);
  const woo = await sale([{}], { wooId: 55 });
  assert.match((await restoreOrderItemStock(prisma, woo, woo.items[0], 'PANJ - Blue', woo.number))!, /ووکامرس/);
  assert.equal(await qty(product.id, main.id), 2);
  assert.equal(await prisma.inventoryMovement.count(), 1);
});

// --- lost stock ---

test('lost-stock report: cancelled lines without a warehouse, net of returns; not Woo, not website, not live orders', async () => {
  const lost = await sale([{ quantity: 3 }, { quantity: 2 }], { createdAt: new Date('2026-09-01') });
  await prisma.orderReturn.create({ data: { orderId: lost.id, orderItemId: lost.items[1].id, quantity: 2, refundAmount: 0, accountId: account.id } });
  const anonymous = await sale([{ quantity: 1 }], { customerId: null, createdAt: new Date('2026-09-10') });
  await sale([{ warehouseId: main.id }]);
  await sale([{}], { wooId: 12 });
  await sale([{}], { siteReference: 'WEB-1' });
  await sale([{}], { status: 'COMPLETED' });

  setTestRole('WAREHOUSE');
  const report = await getUnrestoredCancelledOrders();
  assert.deepEqual(
    report.map((o) => [o.orderId, o.customerName, o.totalUnits, o.lines.map((l) => [l.orderItemId, l.quantity, l.sku])]),
    [
      [anonymous.id, 'مشتری عمومی', 1, [[anonymous.items[0].id, 1, 'PANJ/BLUE']]],
      [lost.id, 'مریم', 3, [[lost.items[0].id, 3, 'PANJ/BLUE']]],
    ],
  );
  for (const role of ['PROJECT_MANAGER', 'USER', null]) {
    setTestRole(role);
    await assert.rejects(getUnrestoredCancelledOrders(), AccessDenied);
  }
});

test('lost-stock repair: credits the owed units, stamps the lines, drops out of the report, and a second repair finds nothing', async () => {
  const order = await sale([{ quantity: 3 }, { quantity: 2 }]);
  await prisma.orderReturn.create({ data: { orderId: order.id, orderItemId: order.items[1].id, quantity: 2, refundAmount: 0, accountId: account.id } });
  const repaired = await repairCancelledOrderStock(order.id);
  assert.deepEqual(repaired, { success: true, message: 'موجودی ۱ قلم به انبار بازگشت.' });
  assert.equal(await qty(product.id, main.id), 3);
  const lines = await prisma.orderItem.findMany({ where: { orderId: order.id }, orderBy: { quantity: 'desc' } });
  assert.deepEqual(lines.map((l: any) => l.warehouseId), [main.id, null]);
  assert.deepEqual(await getUnrestoredCancelledOrders(), []);
  assert.deepEqual(await repairCancelledOrderStock(order.id), { success: false, message: 'قلمی برای ترمیم یافت نشد.' });
  assert.equal(await qty(product.id, main.id), 3);
});

test('lost-stock repair: two repairs at once credit the stock once', async () => {
  const order = await sale([{ quantity: 4 }]);
  let started: Promise<any> | null = null;
  beforeQuery.fn = async (params) => {
    if (params.model !== 'Inventory' || params.action !== 'upsert') return;
    beforeQuery.fn = null;
    started = repairCancelledOrderStock(order.id);
    await Promise.race([started, sleep(500)]);
  };
  const first = await repairCancelledOrderStock(order.id);
  beforeQuery.fn = null;
  const second = await started!;
  assert.deepEqual([first.success, second.success].sort(), [false, true]);
  assert.equal(await qty(product.id, main.id), 4);
  assert.equal(await prisma.inventoryMovement.count(), 1);
});

test('lost-stock repair: refuses unknown, live, WooCommerce and website orders, and rolls back when no warehouse is clear', async () => {
  assert.deepEqual(await repairCancelledOrderStock('missing'), { success: false, message: 'سفارش یافت نشد.' });
  assert.match((await repairCancelledOrderStock((await sale([{}], { status: 'COMPLETED' })).id)).message!, /لغو نشده/);
  assert.match((await repairCancelledOrderStock((await sale([{}], { wooId: 9 })).id)).message!, /ووکامرس/);
  const site = await repairCancelledOrderStock((await sale([{}], { siteReference: 'WEB-9' })).id);
  assert.equal(site.success, false);

  // Two physical warehouses and no clue for the second line: the first line's credit is rolled back too.
  const shop = await prisma.warehouse.create({ data: { name: 'فروشگاه' } });
  const other = await prisma.product.create({ data: { name: 'YEK', sku: 'YEK', costPrice: 1, sellPrice: 1 } });
  await prisma.inventory.create({ data: { productId: product.id, warehouseId: shop.id, quantity: 1 } });
  const order = await sale([{ quantity: 2 }, { productId: other.id, quantity: 1 }], { customerId: null });
  const refused = await repairCancelledOrderStock(order.id);
  assert.equal(refused.success, false);
  assert.match(refused.message!, /«YEK» قابل تشخیص نیست/);
  assert.equal(await qty(product.id, shop.id), 1);
  assert.equal(await prisma.inventoryMovement.count(), 0);
  assert.deepEqual((await prisma.orderItem.findMany({ where: { orderId: order.id } })).map((l: any) => l.warehouseId), [null, null]);
});

test('lost-stock repair is admin only; a refusal writes nothing', async () => {
  const order = await sale([{ quantity: 2 }]);
  for (const role of ['AUDITOR', 'ACCOUNTANT', 'SALES', 'WAREHOUSE', 'PROJECT_MANAGER', 'USER', null]) {
    setTestRole(role);
    const refused = await repairCancelledOrderStock(order.id);
    assert.equal(refused.success, false, String(role));
    assert.match(refused.message!, /فقط مدیر سیستم/, String(role));
  }
  assert.equal(await prisma.inventoryMovement.count(), 0);
  assert.equal(await qty(product.id, main.id), null);
});
