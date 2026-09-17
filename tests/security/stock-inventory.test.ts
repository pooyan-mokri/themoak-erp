import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase, form } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { AccessDenied } from '@/lib/access';
import {
  adjustStock,
  getInventoryByWarehouse,
  getWarehouseDashboardStats,
  transferStock,
  transferStockBatch,
  updateStock,
} from '@/actions/inventory';
import { getInventoryReport } from '@/actions/inventory-reports';
import { getWarehouseDetail } from '@/actions/warehouse-detail';
import {
  archiveWarehouse,
  createWarehouse,
  deleteWarehouse,
  getArchivedWarehouses,
  getWarehouses,
  unarchiveWarehouse,
  updateWarehouse,
} from '@/actions/warehouse';
import { getUnrestoredCancelledOrders, repairCancelledOrderStock } from '@/actions/lost-stock';
import { GET as getWarehouseName } from '../../src/app/api/warehouses/[id]/route';
import { DENIED, exposed } from './stock-helpers';

const COST = 700_000;
const SELL = 2_000_000;
const UNIT_COST = 650_000;
const OLD_NOTE_TAIL = ' - قیمت تمام‌شده هر واحد: ۶۵۰٬۰۰۰ تومان';

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
});
after(() => prisma.$disconnect());

/** A warehouse holding 5 frames, with a sale from it, a received purchase of the frame and an old receipt movement. */
async function seed() {
  const warehouse = await prisma.warehouse.create({ data: { name: 'مرکزی' } });
  const other = await prisma.warehouse.create({ data: { name: 'فروشگاه' } });
  const empty = await prisma.warehouse.create({ data: { name: 'خالی' } });
  const product = await prisma.product.create({
    data: { name: 'PANJ - Blue', sku: 'PANJ/BLUE', costPrice: COST, sellPrice: SELL },
  });
  await prisma.inventory.create({ data: { productId: product.id, warehouseId: warehouse.id, quantity: 5 } });
  const customer = await prisma.customer.create({ data: { name: 'مریم' } });
  await prisma.order.create({
    data: {
      customerId: customer.id,
      totalAmount: SELL,
      status: 'COMPLETED',
      items: { create: [{ productId: product.id, warehouseId: warehouse.id, quantity: 1, price: SELL }] },
    },
  });
  const supplier = await prisma.supplier.create({ data: { name: 'تامین‌کننده' } });
  const po = await prisma.purchaseOrder.create({
    data: {
      supplierId: supplier.id,
      totalAmount: UNIT_COST * 6,
      status: 'RECEIVED',
      items: { create: [{ productId: product.id, quantity: 6, unitCost: UNIT_COST, receivedQuantity: 6 }] },
    },
  });
  await prisma.inventoryMovement.create({
    data: {
      productId: product.id,
      toWarehouseId: warehouse.id,
      quantity: 6,
      type: 'PURCHASE',
      referenceId: po.id,
      note: `دریافت سفارش خرید #${po.number}${OLD_NOTE_TAIL}`,
    },
  });
  return { warehouse, other, empty, product, po };
}

type Seed = Awaited<ReturnType<typeof seed>>;

async function snapshot(s: Seed) {
  const [inventory, movements, warehouses] = await Promise.all([
    prisma.inventory.findMany({ orderBy: [{ warehouseId: 'asc' }, { productId: 'asc' }] }),
    prisma.inventoryMovement.count(),
    prisma.warehouse.findMany({ orderBy: { id: 'asc' } }),
  ]);
  return {
    inventory: inventory.map((row: any) => [row.warehouseId, row.productId, row.quantity]),
    movements,
    warehouses: warehouses.map((w: any) => [w.id, w.name, w.isArchived]),
  };
}

test('WAREHOUSE gets stock quantities with no cost, stock value, sell price or sale and purchase amounts', async () => {
  const s = await seed();
  setTestRole('WAREHOUSE');

  const inventory = await getInventoryByWarehouse(s.warehouse.id);
  assert.equal(inventory[0].quantity, 5);
  assert.equal(inventory[0].product.name, 'PANJ - Blue');
  assert.deepEqual(exposed(inventory, ['costPrice', 'sellPrice']), []);

  const stats = await getWarehouseDashboardStats();
  assert.equal(stats.totalValue, null);
  assert.equal(stats.totalWarehouses, 3);

  const detail = (await getWarehouseDetail(s.warehouse.id))!;
  assert.equal(detail.statistics.totalItems, 5);
  assert.deepEqual(exposed(detail, ['costPrice', 'sellPrice', 'totalValue', 'price', 'total']), []);
  assert.deepEqual(detail.topProductsByValue, []);
  assert.equal(detail.inventory[0].quantity, 5);
  assert.equal(detail.recentOrderItems[0].quantity, 1);
  assert.equal(detail.recentPurchaseItems[0].quantity, 6);
  assert.equal(detail.movements[0].note, `دریافت سفارش خرید #${s.po.number}`);
});

test('SALES gets sell prices and sale amounts but no cost; AUDITOR and ADMIN get everything', async () => {
  const s = await seed();

  setTestRole('SALES');
  const inventory = await getInventoryByWarehouse(s.warehouse.id);
  assert.equal(inventory[0].product.sellPrice, SELL);
  assert.deepEqual(exposed(inventory, ['costPrice']), []);
  const detail = (await getWarehouseDetail(s.warehouse.id))!;
  assert.equal(detail.inventory[0].sellPrice, SELL);
  assert.equal(detail.recentOrderItems[0].price, SELL);
  assert.equal(detail.recentPurchaseItems[0].price, null);
  assert.equal(detail.statistics.totalValue, null);
  assert.deepEqual(exposed(detail, ['costPrice', 'totalValue']), []);
  assert.doesNotMatch(JSON.stringify(detail.movements), /قیمت تمام‌شده/);

  for (const role of ['AUDITOR', 'ADMIN']) {
    setTestRole(role);
    const full = (await getWarehouseDetail(s.warehouse.id))!;
    assert.equal(full.statistics.totalValue, 5 * COST, role);
    assert.equal(full.inventory[0].costPrice, COST, role);
    assert.equal(full.recentPurchaseItems[0].price, UNIT_COST, role);
    assert.equal(full.topProductsByValue.length, 1, role);
    assert.equal(full.movements[0].note, `دریافت سفارش خرید #${s.po.number}${OLD_NOTE_TAIL}`, role);
    assert.equal((await getWarehouseDashboardStats()).totalValue, 5 * COST, role);
    assert.equal((await getInventoryByWarehouse(s.warehouse.id))[0].product.costPrice, COST, role);
  }
});

test('the inventory report needs cost.view; stock reads need stock.view; strangers get nothing', async () => {
  const s = await seed();
  for (const role of ['WAREHOUSE', 'SALES', 'ACCOUNTANT']) {
    setTestRole(role);
    await assert.rejects(getInventoryReport(), AccessDenied, role);
  }
  setTestRole('AUDITOR');
  assert.equal((await getInventoryReport()).summary.totalValue, 5 * COST);

  for (const role of ['PROJECT_MANAGER', 'USER', null]) {
    setTestRole(role);
    const label = String(role);
    await assert.rejects(getInventoryByWarehouse(s.warehouse.id), AccessDenied, label);
    await assert.rejects(getWarehouseDashboardStats(), AccessDenied, label);
    await assert.rejects(getWarehouseDetail(s.warehouse.id), AccessDenied, label);
    await assert.rejects(getWarehouses(), AccessDenied, label);
    await assert.rejects(getArchivedWarehouses(), AccessDenied, label);
    await assert.rejects(getUnrestoredCancelledOrders(), AccessDenied, label);
    await assert.rejects(getInventoryReport(), AccessDenied, label);
    const response = await getWarehouseName(new Request('http://erp.test'), { params: Promise.resolve({ id: s.warehouse.id }) });
    assert.equal(response.status, 403, label);
  }

  setTestRole('WAREHOUSE');
  const response = await getWarehouseName(new Request('http://erp.test'), { params: Promise.resolve({ id: s.warehouse.id }) });
  assert.deepEqual(await response.json(), { name: 'مرکزی' });
});

test('stock and warehouse writes refuse AUDITOR, SALES and ACCOUNTANT and change nothing; WAREHOUSE may make them, removal stays admin-only', async () => {
  const s = await seed();
  const before = await snapshot(s);
  const line = [{ productId: s.product.id, quantity: 1 }];

  for (const role of ['AUDITOR', 'SALES', 'ACCOUNTANT', null]) {
    setTestRole(role);
    const label = String(role);
    for (const result of [
      await updateStock(s.product.id, s.warehouse.id, 99),
      await adjustStock(s.product.id, s.warehouse.id, 3),
      await transferStock(s.product.id, s.warehouse.id, s.other.id, 1),
      await transferStockBatch({ fromWarehouseId: s.warehouse.id, toWarehouseId: s.other.id, items: line }),
    ]) {
      assert.equal(result.success, false, label);
      assert.equal((result as { message?: string }).message, DENIED, label);
    }
    for (const result of [
      await archiveWarehouse(s.empty.id),
      await deleteWarehouse(s.empty.id),
      await unarchiveWarehouse(s.empty.id),
    ]) {
      assert.equal(result.success, false, label);
    }
    assert.equal((await createWarehouse(undefined, form({ name: 'جدید' }))).message, DENIED, label);
    assert.equal((await updateWarehouse(s.other.id, undefined, form({ name: 'تغییر' }))).message, DENIED, label);
    assert.deepEqual(await snapshot(s), before, label);
  }

  setTestRole('WAREHOUSE');
  assert.equal((await adjustStock(s.product.id, s.warehouse.id, 3)).success, true);
  assert.equal((await transferStockBatch({ fromWarehouseId: s.warehouse.id, toWarehouseId: s.other.id, items: line })).success, true);
  assert.equal((await updateWarehouse(s.other.id, undefined, form({ name: 'فروشگاه ۲' }))).success, true);
  assert.match((await createWarehouse(undefined, form({ name: 'جدید' }))).message, /موفقیت/);
  // Archiving, restoring and deleting a warehouse stay admin-only, as before.
  for (const result of [
    await archiveWarehouse(s.empty.id),
    await deleteWarehouse(s.empty.id),
    await unarchiveWarehouse(s.empty.id),
  ]) {
    assert.match(result.message, /فقط مدیر سیستم/);
  }
  assert.equal((await prisma.warehouse.findUniqueOrThrow({ where: { id: s.empty.id } })).isArchived, false);

  setTestRole('ADMIN');
  const archived = await archiveWarehouse(s.empty.id);
  assert.equal(archived.success, true, archived.message);
  const stock = await prisma.inventory.findMany({ where: { productId: s.product.id }, orderBy: { quantity: 'asc' } });
  assert.deepEqual(stock.map((row: any) => row.quantity), [1, 7]);
  assert.equal(await prisma.warehouse.count(), 4);
  assert.equal((await prisma.warehouse.findUniqueOrThrow({ where: { id: s.empty.id } })).isArchived, true);
});

test('WAREHOUSE sees lost stock; repairing it stays admin-only and a refusal writes nothing', async () => {
  const warehouse = await prisma.warehouse.create({ data: { name: 'مشاهیر' } });
  const product = await prisma.product.create({ data: { name: 'YEK', sku: 'YEK/BLK', costPrice: COST, sellPrice: SELL } });
  await prisma.inventory.create({ data: { productId: product.id, warehouseId: warehouse.id, quantity: 1 } });
  const order = await prisma.order.create({
    data: { status: 'CANCELLED', totalAmount: SELL, items: { create: [{ productId: product.id, quantity: 2, price: SELL }] } },
  });

  setTestRole('WAREHOUSE');
  assert.deepEqual((await getUnrestoredCancelledOrders()).map((o) => o.orderId), [order.id]);

  for (const role of ['AUDITOR', 'SALES', 'WAREHOUSE']) {
    setTestRole(role);
    const refused = await repairCancelledOrderStock(order.id);
    assert.equal(refused.success, false, role);
    assert.equal(await prisma.inventoryMovement.count(), 0, role);
  }
  assert.equal((await prisma.inventory.findFirstOrThrow({ where: { productId: product.id } })).quantity, 1);

  setTestRole('ADMIN');
  const repaired = await repairCancelledOrderStock(order.id);
  assert.equal(repaired.success, true, repaired.message);
  assert.equal((await prisma.inventory.findFirstOrThrow({ where: { productId: product.id } })).quantity, 3);
});
