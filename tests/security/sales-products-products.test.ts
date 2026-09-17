import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase, form } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import {
  createProduct,
  deleteProduct,
  generateProductBarcodeAction,
  getProducts,
  giftProduct,
  importProducts,
  updateProduct,
} from '@/actions/product';
import {
  getProductDetail,
  getProductSalesAnalytics,
  getProductSalesHistory,
} from '@/actions/product-detail';
import { getProductAnalytics } from '@/actions/product-analytics';
import { getProductsWithoutWebId, setProductWebId } from '@/actions/web-id';
import { GET as getProductName } from '@/app/api/products/[id]/route';

const DENIED = 'شما به این بخش دسترسی ندارید.';

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
});
after(async () => {
  setTestRole('ADMIN');
  await prisma.$disconnect();
});

async function seed() {
  const warehouse = await prisma.warehouse.create({ data: { name: 'مشاهیر' } });
  const product = await prisma.product.create({
    data: { name: 'PANJ - Blue', sku: 'PANJ/BLUE', costPrice: 4_000_000, sellPrice: 15_700_000 },
  });
  await prisma.inventory.create({ data: { productId: product.id, warehouseId: warehouse.id, quantity: 5 } });
  const customer = await prisma.customer.create({ data: { name: 'سارا' } });
  await prisma.order.create({
    data: {
      customerId: customer.id,
      totalAmount: 15_700_000,
      paidAmount: 15_700_000,
      paymentStatus: 'PAID',
      status: 'COMPLETED',
      items: { create: [{ productId: product.id, quantity: 1, price: 15_700_000, warehouseId: warehouse.id }] },
    },
  });
  return { warehouse, product };
}

/** Every product row as the database holds it, to prove a refused call wrote nothing. */
const productRows = async () =>
  (await prisma.product.findMany({ orderBy: { sku: 'asc' } })).map((p: any) => ({
    ...p,
    costPrice: Number(p.costPrice),
    sellPrice: Number(p.sellPrice),
    updatedAt: undefined,
  }));

test('getProducts sends cost only to cost viewers and sell prices only to sales viewers', async () => {
  await seed();
  const expect: Record<string, { cost: boolean; sell: boolean }> = {
    ADMIN: { cost: true, sell: true },
    AUDITOR: { cost: true, sell: true },
    ACCOUNTANT: { cost: false, sell: true },
    SALES: { cost: false, sell: true },
    WAREHOUSE: { cost: false, sell: false },
  };
  for (const [role, sees] of Object.entries(expect)) {
    setTestRole(role);
    const [row] = await getProducts();
    assert.equal(row.name, 'PANJ - Blue', role);
    assert.equal('costPrice' in row, sees.cost, `${role} costPrice`);
    assert.equal('sellPrice' in row, sees.sell, `${role} sellPrice`);
    if (sees.cost) assert.equal((row as any).costPrice, 4_000_000);
    if (sees.sell) assert.equal((row as any).sellPrice, 15_700_000);
    assert.equal(JSON.stringify(row).includes('4000000'), sees.cost, `${role} leaks the cost somewhere`);
  }
  for (const role of ['USER', 'PROJECT_MANAGER', null]) {
    setTestRole(role);
    await assert.rejects(getProducts(), { message: DENIED }, String(role));
  }
});

test('product detail and analytics: WAREHOUSE gets quantities only, SALES adds sell-price money, ADMIN everything', async () => {
  const { product } = await seed();

  setTestRole('WAREHOUSE');
  const detail = await getProductDetail(product.id);
  assert.ok(detail);
  assert.equal(detail.totalStock, 5);
  for (const key of ['costPrice', 'sellPrice', 'stockValue']) assert.equal(key in detail, false, key);
  const analytics = await getProductSalesAnalytics(product.id);
  assert.equal(analytics.totalUnitsSold, 1);
  assert.equal('totalRevenue' in analytics, false);
  assert.equal('avgSellingPrice' in analytics, false);
  const history = await getProductSalesHistory(product.id);
  assert.deepEqual(Object.keys(history[0]).sort(), ['month', 'units']);
  await assert.rejects(getProductAnalytics(product.id), { message: DENIED });

  setTestRole('SALES');
  const salesDetail = await getProductDetail(product.id);
  assert.equal(salesDetail?.sellPrice, 15_700_000);
  assert.equal('costPrice' in salesDetail!, false);
  assert.equal('stockValue' in salesDetail!, false);
  assert.equal((await getProductSalesAnalytics(product.id)).totalRevenue, 15_700_000);
  assert.equal((await getProductSalesHistory(product.id))[0].revenue, 15_700_000);

  setTestRole('ADMIN');
  const full = await getProductDetail(product.id);
  assert.equal(full?.costPrice, 4_000_000);
  assert.equal(full?.stockValue, 20_000_000);
  assert.equal((await getProductAnalytics(product.id))?.totalProfit, 11_700_000);

  setTestRole('PROJECT_MANAGER');
  await assert.rejects(getProductDetail(product.id), { message: DENIED });
});

test('the product name route needs a signed-in user with stock.view', async () => {
  const { product } = await seed();
  const ask = async () => {
    const res = await getProductName(new Request('http://localhost/api/products/x'), {
      params: Promise.resolve({ id: product.id }),
    });
    return { status: res.status, body: await res.json() };
  };

  setTestRole(null);
  assert.equal((await ask()).status, 401);
  setTestRole('USER');
  assert.deepEqual(await ask(), { status: 404, body: { error: 'Product not found' } });
  setTestRole('WAREHOUSE');
  assert.deepEqual(await ask(), { status: 200, body: { name: 'PANJ - Blue' } });
});

test('product writes refuse AUDITOR and SALES and write nothing', async () => {
  const { product, warehouse } = await seed();
  await prisma.account.create({ data: { name: 'Marketing Expenses', type: 'EXPENSE', currency: 'TOMAN' } });
  const before = await productRows();
  const [inventoryBefore, transactionsBefore] = [await prisma.inventory.findMany(), await prisma.transaction.count()];

  for (const role of ['AUDITOR', 'SALES', 'ACCOUNTANT', 'USER']) {
    setTestRole(role);
    const fields = { name: 'X', sku: 'NEW/1', productType: 'SALEABLE', costPrice: '1', sellPrice: '1' };
    assert.equal((await createProduct({}, form(fields))).message, DENIED, role);
    assert.equal((await updateProduct(product.id, {}, form({ ...fields, sku: 'PANJ/BLUE' }))).message, DENIED, role);
    assert.deepEqual(await deleteProduct(product.id), { success: false, error: DENIED, message: DENIED }, role);
    assert.equal((await generateProductBarcodeAction(product.id, true)).message, DENIED, role);
    const imported = await importProducts([{ name: 'X', sku: 'PANJ/BLUE', costPrice: 1, sellPrice: 1 }]);
    assert.equal(imported.success, false, role);
    assert.equal((await setProductWebId(product.id, 'MOAK-PANJ-BLUE')).message, DENIED, role);
    assert.equal((await giftProduct(product.id, 1, 'someone')).success, false, role);
  }
  // A gift also books an expense: stock.manage alone is not enough.
  setTestRole('WAREHOUSE');
  assert.deepEqual(await giftProduct(product.id, 1, 'someone'), { success: false, error: DENIED, message: DENIED });

  assert.deepEqual(await productRows(), before);
  assert.deepEqual(await prisma.inventory.findMany(), inventoryBefore);
  assert.equal(await prisma.transaction.count(), transactionsBefore);
  assert.equal(warehouse.name, 'مشاهیر');
});

test('a WAREHOUSE save keeps the stored cost and sell price; an ADMIN save changes them', async () => {
  const { product } = await seed();

  setTestRole('WAREHOUSE');
  // What the WAREHOUSE form sends: no price fields at all.
  const saved = await updateProduct(product.id, {}, form({ name: 'PANJ - Navy', sku: 'PANJ/BLUE', productType: 'SALEABLE' }));
  assert.equal(saved.success, true, saved.message);
  let row = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
  assert.equal(row.name, 'PANJ - Navy');
  assert.equal(Number(row.costPrice), 4_000_000);
  assert.equal(Number(row.sellPrice), 15_700_000);

  // A crafted request with prices changes neither.
  await updateProduct(
    product.id,
    {},
    form({ name: 'PANJ - Navy', sku: 'PANJ/BLUE', productType: 'SALEABLE', costPrice: '1', sellPrice: '2' }),
  );
  row = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
  assert.equal(Number(row.costPrice), 4_000_000);
  assert.equal(Number(row.sellPrice), 15_700_000);

  // Nor does an import; a new product starts at 0.
  const imported = await importProducts([
    { name: 'PANJ - Navy', sku: 'PANJ/BLUE', costPrice: 9, sellPrice: 9 },
    { name: 'YEK - Black', sku: 'YEK/BLK', costPrice: 9, sellPrice: 9 },
  ]);
  assert.equal(imported.successCount, 2);
  row = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
  assert.equal(Number(row.costPrice), 4_000_000);
  assert.equal(Number(row.sellPrice), 15_700_000);
  const created = await prisma.product.findUniqueOrThrow({ where: { sku: 'YEK/BLK' } });
  assert.deepEqual([Number(created.costPrice), Number(created.sellPrice)], [0, 0]);

  const newOne = await createProduct({}, form({ name: 'SE - Gold', sku: 'SE/GLD', productType: 'SALEABLE', costPrice: '7', sellPrice: '8' }));
  assert.equal(newOne.success, true, newOne.message);
  const se = await prisma.product.findUniqueOrThrow({ where: { sku: 'SE/GLD' } });
  assert.deepEqual([Number(se.costPrice), Number(se.sellPrice)], [0, 0]);

  // WAREHOUSE may still give a product its webId and a barcode.
  assert.equal((await setProductWebId(created.id, 'MOAK-YEK-BLACK')).success, true);
  assert.equal((await generateProductBarcodeAction(created.id, true)).success, true);

  setTestRole('ADMIN');
  const adminSave = await updateProduct(
    product.id,
    {},
    form({ name: 'PANJ - Navy', sku: 'PANJ/BLUE', productType: 'SALEABLE', costPrice: '4500000', sellPrice: '16000000' }),
  );
  assert.equal(adminSave.success, true, adminSave.message);
  row = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
  assert.deepEqual([Number(row.costPrice), Number(row.sellPrice)], [4_500_000, 16_000_000]);
});

test('getProductsWithoutWebId drops the sell price for WAREHOUSE', async () => {
  await seed();
  setTestRole('WAREHOUSE');
  const [row] = await getProductsWithoutWebId();
  assert.deepEqual(Object.keys(row).sort(), ['id', 'name', 'sku']);
  setTestRole('SALES');
  assert.equal((await getProductsWithoutWebId())[0].sellPrice, 15_700_000);
});
