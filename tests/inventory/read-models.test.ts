import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { AccessDenied } from '@/lib/access';
import { getInventoryReport } from '@/actions/inventory-reports';
import { getWarehouseDashboardStats } from '@/actions/inventory';
import { getWarehouseDetail } from '@/actions/warehouse-detail';
import {
  getProductDetail,
  getProductMovementHistory,
  getProductSalesAnalytics,
  getProductSalesHistory,
  getProductStockBreakdown,
} from '@/actions/product-detail';
import { getProductAnalytics, getProductSalesByWarehouse, getProductStockByWarehouse } from '@/actions/product-analytics';
import { stockUp } from './stock';

// Stock and product read models: the inventory report, the product page and product analytics agree with
// the rows underneath and with each other.

console.error = () => {};
console.log = () => {};

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
});
after(() => prisma.$disconnect());

async function world() {
  const partnerCustomer = await prisma.customer.create({ data: { name: 'شریک' } });
  const main = await prisma.warehouse.create({ data: { name: 'مرکزی' } });
  const shop = await prisma.warehouse.create({ data: { name: 'فروشگاه' } });
  const partner = await prisma.warehouse.create({ data: { name: 'امانی', isVirtual: true, customerId: partnerCustomer.id } });
  const panj = await prisma.product.create({ data: { name: 'PANJ', sku: 'PANJ', costPrice: 700_000, sellPrice: 2_000_000 } });
  const yek = await prisma.product.create({ data: { name: 'YEK', sku: 'YEK', costPrice: 400_000, sellPrice: 1_500_000 } });
  const du = await prisma.product.create({ data: { name: 'DU', sku: 'DU', costPrice: 100_000, sellPrice: 500_000 } });
  const spare = await prisma.product.create({ data: { name: 'پیچ', sku: 'SPARE', costPrice: 1_000, sellPrice: 0, productType: 'CONSUMABLE' } });
  await stockUp(panj.id, main.id, 30);
  await stockUp(panj.id, shop.id, 4);
  await stockUp(panj.id, partner.id, 6);
  await stockUp(yek.id, main.id, 8);
  await prisma.inventory.create({ data: { productId: yek.id, warehouseId: shop.id, quantity: 0 } });
  return { partnerCustomer, main, shop, partner, panj, yek, du, spare };
}

test('inventory report: stock at cost, low (1 to 3) and out-of-stock (0 or less) rows, top products and the split by warehouse', async () => {
  const w = await world();
  await stockUp(w.du.id, w.shop.id, 3);
  // The website sold a YEK the shop did not have: a negative row, out of stock.
  await prisma.inventory.update({ where: { productId_warehouseId: { productId: w.yek.id, warehouseId: w.shop.id } }, data: { quantity: -1 } });
  const report = await getInventoryReport();
  assert.deepEqual(report.summary, {
    totalValue: 40 * 700_000 + 7 * 400_000 + 3 * 100_000,
    totalQuantity: 50,
    totalUniqueProducts: 3,
    totalWarehouses: 2,
    lowStockCount: 1,
    outOfStockCount: 1,
  });
  assert.deepEqual(report.lowStockItems.map((i: any) => [i.productName, i.warehouseName, i.quantity]), [['DU', 'فروشگاه', 3]]);
  assert.deepEqual(report.outOfStockItems.map((i: any) => [i.productName, i.warehouseName]), [['YEK', 'فروشگاه']]);
  assert.deepEqual(report.topProductsByQuantity.map((p: any) => [p.productName, p.quantity]), [['PANJ', 40], ['YEK', 7], ['DU', 3]]);
  assert.deepEqual(report.topProductsByValue.map((p: any) => [p.productName, p.value]), [['PANJ', 28_000_000], ['YEK', 2_800_000], ['DU', 300_000]]);
  assert.deepEqual(
    report.warehouseDistribution.map((d: any) => [d.warehouseName, d.quantity, d.value]).sort(),
    [['امانی', 6, 4_200_000], ['فروشگاه', 6, 2_700_000], ['مرکزی', 38, 21_000_000 + 3_200_000]],
  );
  // A product with no row anywhere is out of stock too.
  await prisma.inventory.deleteMany({ where: { productId: w.du.id } });
  const again = await getInventoryReport();
  assert.deepEqual(again.outOfStockItems.map((i: any) => [i.productName, i.warehouseName]).sort(), [['DU', 'بدون موجودی'], ['YEK', 'فروشگاه']]);
  assert.ok(w.spare);
});

test('inventory report needs cost.view', async () => {
  await world();
  setTestRole('AUDITOR');
  assert.equal((await getInventoryReport()).summary.totalQuantity, 48);
  for (const role of ['WAREHOUSE', 'SALES', 'ACCOUNTANT', 'PROJECT_MANAGER', 'USER', null]) {
    setTestRole(role);
    await assert.rejects(getInventoryReport(), AccessDenied, String(role));
  }
});

test('the same stock value everywhere: console, warehouse pages, product pages and the report count SALEABLE and OTHER stock', async () => {
  const w = await world();
  // 10 straps (OTHER) are stock; a consumable's leftover row (its type changed after it was stocked) is not.
  const strap = await prisma.product.create({ data: { name: 'بند', sku: 'STRAP', costPrice: 50_000, sellPrice: 0, productType: 'OTHER' } });
  await stockUp(strap.id, w.main.id, 10);
  await stockUp(w.spare.id, w.main.id, 100);
  const console = (await getWarehouseDashboardStats()).totalValue;
  const pages = await Promise.all([w.main, w.shop, w.partner].map((x) => getWarehouseDetail(x.id)));
  const byWarehouse = pages.reduce((sum, d) => sum + (d!.statistics.totalValue ?? 0), 0);
  const byProduct = (await Promise.all([w.panj, w.yek, w.du, strap, w.spare].map((p) => getProductDetail(p.id)))).reduce(
    (sum, d) => sum + (d!.stockValue ?? 0),
    0,
  );
  const report = (await getInventoryReport()).summary.totalValue;
  assert.equal(console, 31_200_000 + 500_000);
  assert.deepEqual([byWarehouse, byProduct, report], [console, console, console]);
  assert.equal((await getProductDetail(w.spare.id))!.stockValue, 0);
  assert.ok(!pages[0]!.topProductsByValue.some((p: any) => p.productName === 'پیچ'));
});

test('product page: stock totals, what is on hand outside consignment, and value; the breakdown marks low and out-of-stock rows', async () => {
  const w = await world();
  const detail = (await getProductDetail(w.panj.id))!;
  assert.deepEqual([detail.totalStock, detail.availableStock, detail.stockValue, detail.costPrice, detail.sellPrice], [40, 34, 28_000_000, 700_000, 2_000_000]);
  await stockUp(w.yek.id, w.partner.id, 2);
  const breakdown = await getProductStockBreakdown(w.yek.id);
  assert.deepEqual(breakdown.map((b: any) => [b.warehouseName, b.quantity, b.isVirtual, b.status]).sort(), [
    ['امانی', 2, true, 'LOW'],
    ['فروشگاه', 0, false, 'OUT'],
    ['مرکزی', 8, false, 'OK'],
  ]);
  assert.deepEqual((await getProductStockByWarehouse(w.panj.id)).map((b: any) => b.quantity).sort((a: number, b: number) => a - b), [4, 6, 30]);
  assert.equal(await getProductDetail('missing'), undefined);
});

async function sales(w: Awaited<ReturnType<typeof world>>) {
  const customer = await prisma.customer.create({ data: { name: 'سارا' } });
  const order = (status: string, quantity: number, price: number, createdAt: Date, extra: Record<string, unknown> = {}) =>
    prisma.order.create({
      data: {
        customerId: customer.id,
        status,
        totalAmount: quantity * price,
        createdAt,
        ...extra,
        items: { create: [{ productId: w.panj.id, warehouseId: w.main.id, quantity, price }] },
      },
    });
  // 1 Mehr 1405 starts at midnight Tehran, 20:30 UTC on 22 Sep 2026: 23:30 Tehran is still 31 Shahrivar.
  await order('COMPLETED', 2, 2_000_000, new Date('2026-09-22T20:00:00Z'));
  await order('COMPLETED', 1, 1_800_000, new Date('2026-09-22T21:00:00Z'));
  await order('CANCELLED', 5, 2_000_000, new Date('2026-09-22T20:00:00Z'));
  await order('PENDING', 1, 2_000_000, new Date('2026-09-25T10:00:00Z'), { wooId: 501 });
  await prisma.order.create({
    data: {
      customerId: w.partnerCustomer.id,
      status: 'COMPLETED',
      totalAmount: 2_000_000,
      createdAt: new Date('2026-09-26T10:00:00Z'),
      items: { create: [{ productId: w.panj.id, warehouseId: w.partner.id, quantity: 1, price: 2_000_000 }] },
    },
  });
}

test('product sales: cancelled orders sold nothing, on the product page and in product analytics alike', async () => {
  const w = await world();
  await sales(w);
  const page = await getProductSalesAnalytics(w.panj.id);
  assert.deepEqual([page.totalUnitsSold, page.totalRevenue, page.avgSellingPrice], [5, 9_800_000, 1_960_000]);

  const analytics = (await getProductAnalytics(w.panj.id))!;
  assert.deepEqual(
    [analytics.totalUnitsSold, analytics.totalRevenue, analytics.totalProfit, analytics.salesByChannel],
    [5, 9_800_000, 9_800_000 - 5 * 700_000, { POS: 3, Online: 1, Consignment: 1 }],
  );
  assert.equal(Math.round(analytics.profitMargin * 100) / 100, Math.round(((9_800_000 - 3_500_000) / 9_800_000) * 10000) / 100);
  assert.deepEqual(await getProductSalesByWarehouse(w.panj.id), [{ warehouseId: 'default', units: 5, revenue: 9_800_000 }]);
  assert.equal(analytics.stockByWarehouse.length, 3);
});

test('product sales chart: months are Jalali months in Tehran time, so a sale after midnight on 1 Mehr is in Mehr', async () => {
  const w = await world();
  await sales(w);
  const history = await getProductSalesHistory(w.panj.id, 1200);
  assert.deepEqual(history, [
    { month: '1405-06', units: 2, revenue: 4_000_000 },
    { month: '1405-07', units: 3, revenue: 1_800_000 + 2_000_000 + 2_000_000 },
  ]);
});

test('product movement history: sales and purchases newest first, with Persian names for a walk-in customer', async () => {
  const w = await world();
  await prisma.order.create({
    data: { status: 'COMPLETED', totalAmount: 1, createdAt: new Date('2026-09-10'), items: { create: [{ productId: w.yek.id, quantity: 2, price: 1 }] } },
  });
  const supplier = await prisma.supplier.create({ data: { name: 'Mazzucchelli' } });
  await prisma.purchaseOrder.create({
    data: {
      supplierId: supplier.id,
      totalAmount: 1,
      status: 'PENDING_PAYMENT',
      createdAt: new Date('2026-09-15'),
      items: { create: [{ productId: w.yek.id, quantity: 10, unitCost: 1 }] },
    },
  });
  const history = await getProductMovementHistory(w.yek.id);
  assert.deepEqual(
    history.map((m: any) => [m.type, m.quantity, m.reference, m.status]),
    [['PURCHASE', 10, 'Mazzucchelli', 'PENDING_PAYMENT'], ['SALE', -2, 'مشتری عمومی', 'COMPLETED']],
  );
});

test('product reads: page reads need stock.view, analytics profit.view, sales by warehouse sales.view', async () => {
  const w = await world();
  for (const role of ['PROJECT_MANAGER', 'USER', null]) {
    setTestRole(role);
    for (const read of [getProductDetail, getProductStockBreakdown, getProductSalesAnalytics, getProductMovementHistory, getProductSalesHistory, getProductStockByWarehouse]) {
      await assert.rejects(read(w.panj.id), AccessDenied, `${role} ${read.name}`);
    }
  }
  for (const role of ['WAREHOUSE', 'SALES', 'ACCOUNTANT']) {
    setTestRole(role);
    await assert.rejects(getProductAnalytics(w.panj.id), AccessDenied, role);
  }
  setTestRole('WAREHOUSE');
  await assert.rejects(getProductSalesByWarehouse(w.panj.id), AccessDenied);
  setTestRole('AUDITOR');
  assert.equal((await getProductAnalytics(w.panj.id))!.totalUnitsSold, 0);
});
