import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase, form } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { AccessDenied } from '@/lib/access';
import {
  archiveWarehouse,
  createWarehouse,
  deleteWarehouse,
  getArchivedWarehouses,
  getWarehouseById,
  getWarehouses,
  unarchiveWarehouse,
  updateWarehouse,
} from '@/actions/warehouse';
import { getWarehouseDetail } from '@/actions/warehouse-detail';
import { transferStock } from '@/actions/inventory';
import { assertStockInvariants, stockUp } from './stock';

// Warehouses: create, edit, archive and restore, delete, virtual (consignment) ones, and the warehouse page.

console.error = () => {};
console.log = () => {};
console.warn = () => {};

const DENIED = 'شما به این بخش دسترسی ندارید.';

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
});
after(() => prisma.$disconnect());

const names = (list: Array<{ name: string }>) => list.map((w) => w.name);

test('createWarehouse: a physical and a virtual warehouse; a missing name is refused and writes nothing', async () => {
  assert.deepEqual(await createWarehouse(undefined, form({ name: 'مرکزی' })), { message: 'انبار با موفقیت ثبت شد.' });
  assert.equal((await createWarehouse(undefined, form({ name: 'مجازی', isVirtual: 'on' }))).message, 'انبار با موفقیت ثبت شد.');
  const rows = await prisma.warehouse.findMany({ orderBy: { createdAt: 'asc' } });
  assert.deepEqual(rows.map((w: any) => [w.name, w.isVirtual, w.isArchived]), [['مرکزی', false, false], ['مجازی', true, false]]);

  const refused: any = await createWarehouse(undefined, form({ name: '' }));
  assert.equal(refused.message, 'لطفا فیلدهای الزامی را پر کنید.');
  assert.deepEqual(refused.errors.name, ['نام انبار الزامی است']);
  assert.equal(await prisma.warehouse.count(), 2);
});

test('createWarehouse and updateWarehouse refuse every role without stock.manage', async () => {
  const warehouse = await prisma.warehouse.create({ data: { name: 'مرکزی' } });
  for (const role of ['AUDITOR', 'ACCOUNTANT', 'SALES', 'PROJECT_MANAGER', 'USER', null]) {
    setTestRole(role);
    assert.equal((await createWarehouse(undefined, form({ name: 'جدید' }))).message, DENIED, String(role));
    assert.equal((await updateWarehouse(warehouse.id, undefined, form({ name: 'تغییر' }))).message, DENIED, String(role));
  }
  assert.deepEqual(names(await prisma.warehouse.findMany()), ['مرکزی']);
  setTestRole('WAREHOUSE');
  assert.equal((await createWarehouse(undefined, form({ name: 'جدید' }))).message, 'انبار با موفقیت ثبت شد.');
});

test('updateWarehouse: renames and sets the virtual flag from the switch; an empty name or unknown id changes nothing', async () => {
  const warehouse = await prisma.warehouse.create({ data: { name: 'مرکزی' } });
  assert.deepEqual(await updateWarehouse(warehouse.id, undefined, form({ name: 'انبار اصلی', isVirtual: 'on' })), {
    message: 'انبار با موفقیت ویرایش شد.',
    success: true,
  });
  let row = await prisma.warehouse.findUniqueOrThrow({ where: { id: warehouse.id } });
  assert.deepEqual([row.name, row.isVirtual], ['انبار اصلی', true]);
  // The edit dialog sends the switch only when it is on.
  await updateWarehouse(warehouse.id, undefined, form({ name: 'انبار اصلی' }));
  row = await prisma.warehouse.findUniqueOrThrow({ where: { id: warehouse.id } });
  assert.equal(row.isVirtual, false);

  assert.equal((await updateWarehouse(warehouse.id, undefined, form({ name: '' }))).message, 'لطفا فیلدهای الزامی را پر کنید.');
  assert.equal((await updateWarehouse('missing', undefined, form({ name: 'x' }))).message, 'خطا در ویرایش انبار.');
  assert.equal((await prisma.warehouse.findUniqueOrThrow({ where: { id: warehouse.id } })).name, 'انبار اصلی');
});

test('getWarehouses hides archived ones unless asked; getArchivedWarehouses lists only them, newest first; getWarehouseById', async () => {
  const main = await prisma.warehouse.create({ data: { name: 'مرکزی', createdAt: new Date('2026-01-01') } });
  await prisma.warehouse.create({ data: { name: 'فروشگاه', createdAt: new Date('2026-02-01') } });
  await prisma.warehouse.create({ data: { name: 'قدیمی ۱', isArchived: true, archivedAt: new Date('2026-03-01'), createdAt: new Date('2025-01-01') } });
  await prisma.warehouse.create({ data: { name: 'قدیمی ۲', isArchived: true, archivedAt: new Date('2026-04-01'), createdAt: new Date('2025-02-01') } });

  assert.deepEqual(names(await getWarehouses()), ['مرکزی', 'فروشگاه']);
  assert.deepEqual(names(await getWarehouses(true)), ['قدیمی ۱', 'قدیمی ۲', 'مرکزی', 'فروشگاه']);
  assert.deepEqual(names(await getArchivedWarehouses()), ['قدیمی ۲', 'قدیمی ۱']);
  const one = await getWarehouseById(main.id);
  assert.deepEqual([one?.name, one?.customerId], ['مرکزی', undefined]);
  assert.equal(await getWarehouseById('missing'), undefined);
});

test('warehouse reads: pickers open to stock, sales and settings roles; the archive and one warehouse need stock.view', async () => {
  await prisma.warehouse.create({ data: { name: 'مرکزی' } });
  for (const role of ['ADMIN', 'AUDITOR', 'ACCOUNTANT', 'SALES', 'WAREHOUSE']) {
    setTestRole(role);
    assert.deepEqual(names(await getWarehouses()), ['مرکزی'], role);
  }
  setTestRole('ACCOUNTANT');
  assert.equal((await getArchivedWarehouses()).length, 0);
  for (const role of ['PROJECT_MANAGER', 'USER', null]) {
    setTestRole(role);
    await assert.rejects(getWarehouses(), AccessDenied, String(role));
    await assert.rejects(getArchivedWarehouses(), AccessDenied, String(role));
    await assert.rejects(getWarehouseById('x'), AccessDenied, String(role));
  }
});

test('archive then restore: the warehouse leaves every picker with its history kept, and comes back', async () => {
  const main = await prisma.warehouse.create({ data: { name: 'مرکزی' } });
  const old = await prisma.warehouse.create({ data: { name: 'قدیمی' } });
  const product = await prisma.product.create({ data: { name: 'PANJ', sku: 'PANJ', costPrice: 1, sellPrice: 2 } });
  await stockUp(product.id, old.id, 3);
  assert.equal((await transferStock(product.id, old.id, main.id, 3)).success, true);

  const archived = await archiveWarehouse(old.id);
  assert.deepEqual(archived, { message: 'انبار با موفقیت آرشیو شد.', success: true });
  const row = await prisma.warehouse.findUniqueOrThrow({ where: { id: old.id } });
  assert.equal(row.isArchived, true);
  assert.ok(row.archivedAt);
  assert.deepEqual(names(await getWarehouses()), ['مرکزی']);
  // Its movements stay, and the page still opens.
  const detail = (await getWarehouseDetail(old.id))!;
  assert.equal(detail.warehouse.isArchived, true);
  assert.equal(detail.movements.length, 2);
  // No stock can go into it while archived.
  assert.match(((await transferStock(product.id, main.id, old.id, 1)) as any).error, /آرشیو/);

  assert.deepEqual(await unarchiveWarehouse(old.id), { message: 'انبار از آرشیو خارج شد.', success: true });
  const restored = await prisma.warehouse.findUniqueOrThrow({ where: { id: old.id } });
  assert.deepEqual([restored.isArchived, restored.archivedAt], [false, null]);
  assert.deepEqual(names(await getWarehouses()), ['مرکزی', 'قدیمی']);
  assert.equal((await transferStock(product.id, main.id, old.id, 1)).success, true);
  await assertStockInvariants();
});

test('delete: a warehouse with movement history is refused and kept; an empty one without history goes, with its zero rows', async () => {
  const main = await prisma.warehouse.create({ data: { name: 'مرکزی' } });
  const used = await prisma.warehouse.create({ data: { name: 'با سابقه' } });
  const clean = await prisma.warehouse.create({ data: { name: 'خالی' } });
  const product = await prisma.product.create({ data: { name: 'PANJ', sku: 'PANJ', costPrice: 1, sellPrice: 2 } });
  await stockUp(product.id, used.id, 2);
  await transferStock(product.id, used.id, main.id, 2);
  await prisma.inventory.create({ data: { productId: product.id, warehouseId: clean.id, quantity: 0 } });

  const refused = await deleteWarehouse(used.id);
  assert.deepEqual(refused, { message: 'این انبار دارای سابقه جابجایی یا فروش است و قابل حذف نیست.', success: false });
  assert.ok(await prisma.warehouse.findUnique({ where: { id: used.id } }));
  assert.equal(await prisma.inventory.count({ where: { warehouseId: used.id } }), 1, 'its zero row is kept with it');

  // A sale line alone (the POS writes no movement) is history too: deleting would blank the line's warehouse.
  const sold = await prisma.warehouse.create({ data: { name: 'فروش قدیمی' } });
  const order = await prisma.order.create({
    data: { status: 'COMPLETED', totalAmount: 2, items: { create: [{ productId: product.id, warehouseId: sold.id, quantity: 1, price: 2 }] } },
    include: { items: true },
  });
  assert.equal((await deleteWarehouse(sold.id)).success, false);
  assert.equal((await prisma.orderItem.findUniqueOrThrow({ where: { id: order.items[0].id } })).warehouseId, sold.id);
  const transfer = await prisma.inventoryMovement.findFirstOrThrow({ where: { type: 'TRANSFER' } });
  assert.equal(transfer.fromWarehouseId, used.id, 'the movement keeps its warehouse');

  assert.deepEqual(await deleteWarehouse(clean.id), { message: 'انبار با موفقیت حذف شد.', success: true });
  assert.equal(await prisma.warehouse.findUnique({ where: { id: clean.id } }), null);
  assert.equal(await prisma.inventory.count({ where: { warehouseId: clean.id } }), 0);
});

test('archive, restore and delete are admin only, also for WAREHOUSE and AUDITOR; unknown ids fail with a Persian message', async () => {
  const warehouse = await prisma.warehouse.create({ data: { name: 'خالی' } });
  for (const role of ['AUDITOR', 'ACCOUNTANT', 'SALES', 'WAREHOUSE', 'PROJECT_MANAGER', 'USER', null]) {
    setTestRole(role);
    for (const result of [await archiveWarehouse(warehouse.id), await unarchiveWarehouse(warehouse.id), await deleteWarehouse(warehouse.id)]) {
      assert.equal(result.success, false, String(role));
      assert.match(result.message, /فقط مدیر سیستم/, String(role));
    }
  }
  assert.equal((await prisma.warehouse.findUniqueOrThrow({ where: { id: warehouse.id } })).isArchived, false);
  setTestRole('ADMIN');
  assert.deepEqual(await archiveWarehouse('missing'), { message: 'خطا در آرشیو انبار.', success: false });
  assert.deepEqual(await unarchiveWarehouse('missing'), { message: 'خطا در بازگرداندن انبار.', success: false });
  assert.deepEqual(await deleteWarehouse('missing'), { message: 'خطا در حذف انبار.', success: false });
});

// --- the warehouse page ---

async function detailWorld() {
  const main = await prisma.warehouse.create({ data: { name: 'مرکزی' } });
  const shop = await prisma.warehouse.create({ data: { name: 'فروشگاه' } });
  const panj = await prisma.product.create({ data: { name: 'PANJ', sku: 'PANJ', costPrice: 700_000, sellPrice: 2_000_000 } });
  const yek = await prisma.product.create({ data: { name: 'YEK', sku: 'YEK', costPrice: 400_000, sellPrice: 1_500_000 } });
  const du = await prisma.product.create({ data: { name: 'DU', sku: 'DU', costPrice: 100_000, sellPrice: 500_000 } });
  await stockUp(panj.id, main.id, 12);
  await stockUp(yek.id, main.id, 3);
  await prisma.inventory.create({ data: { productId: du.id, warehouseId: main.id, quantity: 0 } });
  const supplier = await prisma.supplier.create({ data: { name: 'Mazzucchelli' } });
  return { main, shop, panj, yek, du, supplier };
}

test('warehouse page: counts, value at cost, stock and low-stock figures, and the movement list signed for this warehouse', async () => {
  const s = await detailWorld();
  await transferStock(s.panj.id, s.main.id, s.shop.id, 2);
  const detail = (await getWarehouseDetail(s.main.id))!;
  assert.deepEqual(detail.statistics, {
    totalItems: 13,
    totalValue: 10 * 700_000 + 3 * 400_000,
    uniqueProducts: 3,
    itemsWithStock: 2,
    itemsOutOfStock: 1,
    lowStockCount: 1,
  });
  assert.deepEqual(detail.lowStockItems.map((i: any) => i.productName), ['YEK']);
  assert.deepEqual(detail.topProductsByValue.map((i: any) => [i.productName, i.totalValue]), [['PANJ', 7_000_000], ['YEK', 1_200_000], ['DU', 0]]);
  const transfer = detail.movements.find((m: any) => m.type === 'TRANSFER')!;
  assert.deepEqual([transfer.quantity, transfer.counterpart, transfer.reference], [-2, 'فروشگاه', 'انتقال']);
  const shopView = (await getWarehouseDetail(s.shop.id))!;
  assert.deepEqual(shopView.movements.map((m: any) => [m.quantity, m.counterpart]), [[2, 'مرکزی']]);
  assert.equal(await getWarehouseDetail('missing'), undefined);
});

test('warehouse page: recent sales are this warehouse\'s completed and pending lines only', async () => {
  const s = await detailWorld();
  const customer = await prisma.customer.create({ data: { name: 'مریم' } });
  const order = (status: string, warehouseId: string) =>
    prisma.order.create({
      data: { customerId: customer.id, status, totalAmount: 2_000_000, items: { create: [{ productId: s.panj.id, warehouseId, quantity: 1, price: 2_000_000 }] } },
    });
  await order('COMPLETED', s.main.id);
  await order('PENDING', s.main.id);
  await order('CANCELLED', s.main.id);
  await order('COMPLETED', s.shop.id);
  const detail = (await getWarehouseDetail(s.main.id))!;
  assert.equal(detail.recentOrderItems.length, 2);
  assert.ok(detail.recentOrderItems.every((i: any) => i.customerName === 'مریم' && i.total === 2_000_000));
});

test('warehouse page: purchases are the ones received into this warehouse, with the received quantity priced in Toman', async () => {
  const s = await detailWorld();
  const RATE = 100_000;
  // A dollar order: 10 frames at $50, received 4 here and 6 into the shop.
  const usdOrder = await prisma.purchaseOrder.create({
    data: {
      supplierId: s.supplier.id,
      status: 'RECEIVED',
      totalAmount: 500,
      totalAmountInToman: 500 * RATE,
      items: { create: [{ productId: s.panj.id, quantity: 10, unitCost: 50, currency: 'USD', exchangeRateSnapshot: RATE, unitCostInToman: 50 * RATE, receivedQuantity: 10 }] },
    },
  });
  // A Toman order received only into the shop, for a product this warehouse also holds.
  const shopOrder = await prisma.purchaseOrder.create({
    data: {
      supplierId: s.supplier.id,
      status: 'RECEIVED',
      totalAmount: 800_000,
      items: { create: [{ productId: s.yek.id, quantity: 2, unitCost: 400_000, receivedQuantity: 2 }] },
    },
  });
  const receipt = (orderId: string, productId: string, warehouseId: string, quantity: number) =>
    prisma.inventoryMovement.create({ data: { productId, toWarehouseId: warehouseId, quantity, type: 'PURCHASE', referenceId: orderId } });
  await receipt(usdOrder.id, s.panj.id, s.main.id, 4);
  await receipt(usdOrder.id, s.panj.id, s.shop.id, 6);
  await receipt(shopOrder.id, s.yek.id, s.shop.id, 2);

  const main = (await getWarehouseDetail(s.main.id))!;
  assert.deepEqual(
    main.recentPurchaseItems.map((i: any) => [i.productName, i.quantity, i.price, i.total, i.orderNumber, i.supplierName]),
    [['PANJ', 4, 5_000_000, 20_000_000, usdOrder.number, 'Mazzucchelli']],
  );
  const shop = (await getWarehouseDetail(s.shop.id))!;
  assert.deepEqual(shop.recentPurchaseItems.map((i: any) => [i.productName, i.quantity, i.total]).sort(), [['PANJ', 6, 30_000_000], ['YEK', 2, 800_000]]);

  setTestRole('WAREHOUSE');
  const blind = (await getWarehouseDetail(s.main.id))!;
  assert.deepEqual(blind.recentPurchaseItems.map((i: any) => [i.quantity, i.price, i.total]), [[4, null, null]]);
});

test('warehouse page: needs stock.view', async () => {
  const s = await detailWorld();
  for (const role of ['PROJECT_MANAGER', 'USER', null]) {
    setTestRole(role);
    await assert.rejects(getWarehouseDetail(s.main.id), AccessDenied);
  }
});
