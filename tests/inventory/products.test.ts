import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { prisma, resetDatabase, form } from '../helpers/db';
import { beforeQuery } from '../helpers/hooks';
import { setTestRole } from '../stubs/auth';
import { createProduct, deleteProduct, giftProduct, importProducts, updateProduct } from '@/actions/product';
import { isStandardBarcode } from '@/lib/barcode-format';
import { driftOf } from '../accounting/ledger';
import { assertStockInvariants, qty, stockSnapshot, stockUp } from './stock';

// Products: create and edit with SKU and barcode uniqueness, product types, delete, the product-page gift,
// and the Excel import.

console.error = () => {};

const COST = 700_000;
const fields = (extra: Record<string, string> = {}) =>
  form({ name: 'PANJ - Blue', sku: 'PANJ/BLUE', productType: 'SALEABLE', costPrice: String(COST), sellPrice: '2000000', ...extra });

beforeEach(async () => {
  setTestRole('ADMIN');
  beforeQuery.fn = null;
  await resetDatabase();
});
after(() => prisma.$disconnect());

// --- create and edit ---

test('createProduct: every product type, with a unique standard barcode; a taken SKU is refused and writes nothing', async () => {
  for (const [i, type] of ['SALEABLE', 'CONSUMABLE', 'FIXED_ASSET', 'OTHER'].entries()) {
    const result = await createProduct({}, fields({ sku: `SKU-${i}`, productType: type }));
    assert.deepEqual(result, { message: 'کالا با موفقیت ثبت شد.', success: true }, type);
  }
  const rows = await prisma.product.findMany({ orderBy: { sku: 'asc' } });
  assert.deepEqual(rows.map((p: any) => p.productType), ['SALEABLE', 'CONSUMABLE', 'FIXED_ASSET', 'OTHER']);
  assert.ok(rows.every((p: any) => isStandardBarcode(p.barcode)));
  assert.equal(new Set(rows.map((p: any) => p.barcode)).size, 4);
  assert.deepEqual([Number(rows[0].costPrice), Number(rows[0].sellPrice)], [COST, 2_000_000]);

  const duplicate = await createProduct({}, fields({ sku: 'SKU-0', name: 'دیگری' }));
  assert.equal(duplicate.success, undefined);
  assert.equal(duplicate.message, 'خطا در ثبت کالا. ممکن است SKU تکراری باشد.');
  assert.equal(await prisma.product.count(), 4);
});

test('createProduct: missing name or SKU, an unknown type and negative prices are refused', async () => {
  for (const extra of [{ name: '' }, { sku: '' }, { productType: 'GIFT' }, { costPrice: '-1' }, { sellPrice: '-5' }]) {
    const result = await createProduct({}, fields(extra));
    assert.equal(result.message, 'لطفا فیلدهای الزامی را پر کنید.', JSON.stringify(extra));
  }
  assert.equal(await prisma.product.count(), 0);
});

test('updateProduct: changes type and prices; a SKU another product has is refused and nothing changes', async () => {
  await createProduct({}, fields());
  await createProduct({}, fields({ sku: 'YEK/BLK', name: 'YEK' }));
  const panj = await prisma.product.findUniqueOrThrow({ where: { sku: 'PANJ/BLUE' } });

  const saved = await updateProduct(panj.id, {}, fields({ productType: 'OTHER', costPrice: '800000' }));
  assert.equal(saved.success, true, saved.message);
  let row = await prisma.product.findUniqueOrThrow({ where: { id: panj.id } });
  assert.deepEqual([row.productType, Number(row.costPrice), row.barcode], ['OTHER', 800_000, panj.barcode]);

  const clash = await updateProduct(panj.id, {}, fields({ sku: 'YEK/BLK', name: 'تغییر' }));
  assert.equal(clash.message, 'خطا در ویرایش کالا. ممکن است SKU تکراری باشد.');
  row = await prisma.product.findUniqueOrThrow({ where: { id: panj.id } });
  assert.deepEqual([row.sku, row.name], ['PANJ/BLUE', 'PANJ - Blue']);
  assert.equal((await updateProduct('missing', {}, fields({ sku: 'NEW' }))).message, 'خطا در ویرایش کالا. ممکن است SKU تکراری باشد.');
});

test('deleteProduct: refused with stock rows (even at zero) or sales, or with stock history; a clean product goes', async () => {
  const warehouse = await prisma.warehouse.create({ data: { name: 'مرکزی' } });
  const make = (sku: string) => prisma.product.create({ data: { name: sku, sku, costPrice: 1, sellPrice: 1 } });
  const stocked = await make('STOCKED');
  await prisma.inventory.create({ data: { productId: stocked.id, warehouseId: warehouse.id, quantity: 0 } });
  const sold = await make('SOLD');
  await prisma.order.create({ data: { totalAmount: 1, items: { create: [{ productId: sold.id, quantity: 1, price: 1 }] } } });
  const moved = await make('MOVED');
  await prisma.inventoryMovement.create({ data: { productId: moved.id, toWarehouseId: warehouse.id, quantity: 1, type: 'ADJUSTMENT' } });
  const clean = await make('CLEAN');

  assert.deepEqual(await deleteProduct(stocked.id), { success: false, message: 'این محصول دارای موجودی است و قابل حذف نیست.' });
  assert.deepEqual(await deleteProduct(sold.id), { success: false, message: 'این محصول در سفارشات استفاده شده و قابل حذف نیست.' });
  assert.deepEqual(await deleteProduct(moved.id), { success: false, message: 'خطا در حذف محصول.' });
  assert.deepEqual(await deleteProduct(clean.id), { success: true, message: 'محصول با موفقیت حذف شد.' });
  assert.deepEqual((await prisma.product.findMany({ orderBy: { sku: 'asc' } })).map((p: any) => p.sku), ['MOVED', 'SOLD', 'STOCKED']);
});

// --- gift from the product page ---

async function giftWorld() {
  const customer = await prisma.customer.create({ data: { name: 'شریک' } });
  const main = await prisma.warehouse.create({ data: { name: 'مرکزی' } });
  const shop = await prisma.warehouse.create({ data: { name: 'فروشگاه' } });
  const partner = await prisma.warehouse.create({ data: { name: 'امانی', isVirtual: true, customerId: customer.id } });
  const product = await prisma.product.create({ data: { name: 'PANJ - Blue', sku: 'PANJ/BLUE', costPrice: COST, sellPrice: 2_000_000 } });
  await stockUp(product.id, main.id, 2);
  await stockUp(product.id, shop.id, 4);
  await stockUp(product.id, partner.id, 50);
  return { main, shop, partner, product };
}

test('giftProduct: takes the units from the physical warehouse holding most, books the cost once, and records the movement', async () => {
  const g = await giftWorld();
  const result = await giftProduct(g.product.id, 3, 'اینفلوئنسر', 'کمپین پاییز');
  assert.deepEqual(result, { success: true, message: 'هدیه با موفقیت ثبت شد.' });
  assert.deepEqual([await qty(g.product.id, g.main.id), await qty(g.product.id, g.shop.id), await qty(g.product.id, g.partner.id)], [2, 1, 50]);

  const expense = await prisma.account.findFirstOrThrow({ where: { name: 'Marketing Expenses' } });
  assert.equal(expense.type, 'EXPENSE');
  const row = await prisma.transaction.findFirstOrThrow();
  assert.deepEqual(
    [row.type, Number(row.amount), Number(row.amountInToman), row.accountId, row.category, row.description],
    ['EXPENSE', 3 * COST, 3 * COST, expense.id, 'Marketing/Gift', 'هدیه به اینفلوئنسر: کمپین پاییز'],
  );
  assert.equal(await driftOf(expense.id), 0);
  const movement = await prisma.inventoryMovement.findFirstOrThrow({ where: { referenceId: row.id } });
  assert.deepEqual([movement.type, movement.fromWarehouseId, movement.quantity, movement.note], ['ADJUSTMENT', g.shop.id, 3, 'هدیه به اینفلوئنسر']);
  await assertStockInvariants();

  // The account is reused, not created again.
  assert.equal((await giftProduct(g.product.id, 1, 'مشتری')).success, true);
  assert.equal(await prisma.account.count(), 1);
  assert.equal(await driftOf(expense.id), 0);
});

test('giftProduct: never takes a consignment partner\'s goods; refusals are in Persian and write nothing', async () => {
  const g = await giftWorld();
  const before = await stockSnapshot();
  const cases: Array<[() => Promise<any>, string]> = [
    [() => giftProduct(g.product.id, 5, 'x'), 'موجودی کافی برای این هدیه در هیچ انباری نیست.'],
    [() => giftProduct(g.product.id, 0, 'x'), 'تعداد هدیه باید عدد صحیح و بزرگ‌تر از صفر باشد.'],
    [() => giftProduct(g.product.id, -2, 'x'), 'تعداد هدیه باید عدد صحیح و بزرگ‌تر از صفر باشد.'],
    [() => giftProduct(g.product.id, 1.5, 'x'), 'تعداد هدیه باید عدد صحیح و بزرگ‌تر از صفر باشد.'],
    [() => giftProduct(g.product.id, Number.NaN, 'x'), 'تعداد هدیه باید عدد صحیح و بزرگ‌تر از صفر باشد.'],
    [() => giftProduct('missing', 1, 'x'), 'کالا یافت نشد.'],
  ];
  for (const [call, message] of cases) assert.deepEqual(await call(), { success: false, error: message });
  assert.deepEqual(await stockSnapshot(), before);
  assert.equal(await prisma.transaction.count(), 0);
  assert.equal(await prisma.account.count(), 0);
});

test('giftProduct: two gifts of the same last units at once, exactly one is booked', async () => {
  const g = await giftWorld();
  let started: Promise<any> | null = null;
  beforeQuery.fn = async (params) => {
    if (params.model !== 'Inventory' || params.action !== 'updateMany') return;
    beforeQuery.fn = null;
    started = giftProduct(g.product.id, 4, 'دوم');
    await Promise.race([started, sleep(500)]);
  };
  const first = await giftProduct(g.product.id, 4, 'اول');
  beforeQuery.fn = null;
  const second = await started!;
  assert.deepEqual([first.success, second.success].sort(), [false, true]);
  assert.equal(await qty(g.product.id, g.shop.id), 0);
  assert.equal(await prisma.transaction.count(), 1);
  await assertStockInvariants();
});

// --- Excel import ---

test('importProducts: a sheet without price columns keeps the stored prices; new products start at 0', async () => {
  await prisma.product.create({ data: { name: 'PANJ', sku: 'PANJ/BLUE', costPrice: COST, sellPrice: 2_000_000, barcode: '2900000000017' } });
  const result = await importProducts([{ name: 'PANJ - Navy', sku: 'PANJ/BLUE' }, { name: 'YEK', sku: 'YEK/BLK' }]);
  assert.deepEqual(result, { success: true, successCount: 2, errorCount: 0 });
  const panj = await prisma.product.findUniqueOrThrow({ where: { sku: 'PANJ/BLUE' } });
  assert.deepEqual([panj.name, Number(panj.costPrice), Number(panj.sellPrice), panj.barcode], ['PANJ - Navy', COST, 2_000_000, '2900000000017']);
  const yek = await prisma.product.findUniqueOrThrow({ where: { sku: 'YEK/BLK' } });
  assert.deepEqual([Number(yek.costPrice), Number(yek.sellPrice), yek.productType], [0, 0, 'SALEABLE']);
  assert.ok(isStandardBarcode(yek.barcode));
});

test('importProducts: prices in Persian or Arabic digits with separators are read; a non-number or negative price fails the row', async () => {
  await prisma.product.create({ data: { name: 'PANJ', sku: 'PANJ/BLUE', costPrice: COST, sellPrice: 2_000_000 } });
  const result = await importProducts([
    { name: 'PANJ', sku: 'PANJ/BLUE', costPrice: '۸۵۰٬۰۰۰', sellPrice: '2,500,000' },
    { name: 'YEK', sku: 'YEK/BLK', costPrice: '٤٠٠٠٠٠', sellPrice: 1_500_000 },
    { name: 'BAD', sku: 'BAD/1', costPrice: 'گران', sellPrice: 1 },
    { name: 'NEG', sku: 'NEG/1', costPrice: -5 },
    { name: '', sku: 'NONAME' },
    { name: 'NOSKU' },
  ]);
  assert.deepEqual(result, { success: true, successCount: 2, errorCount: 4 });
  const rows = await prisma.product.findMany({ orderBy: { sku: 'asc' } });
  assert.deepEqual(rows.map((p: any) => [p.sku, Number(p.costPrice), Number(p.sellPrice)]), [
    ['PANJ/BLUE', 850_000, 2_500_000],
    ['YEK/BLK', 400_000, 1_500_000],
  ]);
});
