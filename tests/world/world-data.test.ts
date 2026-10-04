// The business world (/dashboard/world): its snapshot has the dashboards' figures, each role sees only what it
// may, and no secret (card number, IBAN, the website's webhook secret) ever leaves the server.
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { getDashboardFinancials, getDashboardSales } from '@/actions/dashboard';
import { buildWorld, orderChannel, productFamily, worldLayers } from '@/lib/world-data';
import { categoryLabel } from '@/lib/category-labels';
import { addDays, tehranDay, tehranDayStart } from '@/lib/tehran-day';
import { productPhotoOnSite } from '@/lib/product-image';
import { GET as worldRoute } from '@/app/api/world/route';
import type { WorldData } from '@/lib/world-types';

console.error = () => {};

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
});
after(() => prisma.$disconnect());

const DAY = 86_400_000;
const CARD = '6037991234567890';
const SHEBA = 'IR120170000000123456789012';
const WEBHOOK_SECRET = 'webhook-secret-never-sent';

/** A small business: a shop and a partner's store, three products, orders on every channel, money and suppliers. */
async function seed(now = new Date()) {
  const todayStart = tehranDayStart(tehranDay(now));
  const today = new Date(Math.max(todayStart.getTime() + 1_000, now.getTime() - 60_000));
  const ago = (days: number) => new Date(now.getTime() - days * DAY);

  const main = await prisma.warehouse.create({ data: { name: 'مشاهیر' } });
  const partner = await prisma.customer.create({ data: { name: 'فروشگاه نقش' } });
  await prisma.consignmentChannel.create({ data: { customerId: partner.id, name: 'پیش‌فرض', commissionRate: 20 } });
  const store = await prisma.warehouse.create({ data: { name: ' انبار امانی - نقش', isVirtual: true, customerId: partner.id } });
  const archived = await prisma.warehouse.create({ data: { name: 'قدیمی', isArchived: true } });

  const yekBlack = await prisma.product.create({ data: { name: 'YEK - Black', sku: 'YEK/BLK', costPrice: 1_000_000, sellPrice: 3_000_000, webId: 'w-1' } });
  const yekBrown = await prisma.product.create({ data: { name: 'YEK - Brown', sku: 'YEK/BRN', costPrice: 2_000_000, sellPrice: 2_000_000 } });
  const voidGreen = await prisma.product.create({ data: { name: 'DAMN VOID - Green', sku: 'DV/GRN', costPrice: 500_000, sellPrice: 4_000_000 } });
  await prisma.product.create({ data: { name: 'جعبه', sku: 'BOX', costPrice: 10_000, sellPrice: 0, productType: 'CONSUMABLE' } });
  await prisma.inventory.createMany({
    data: [
      { productId: yekBlack.id, warehouseId: main.id, quantity: 10 },
      { productId: yekBlack.id, warehouseId: store.id, quantity: 2 },
      { productId: yekBlack.id, warehouseId: archived.id, quantity: 5 },
      { productId: yekBrown.id, warehouseId: main.id, quantity: 2 },
      { productId: voidGreen.id, warehouseId: main.id, quantity: -1 },
    ],
  });

  const ali = await prisma.customer.create({ data: { name: 'علی رضایی' } });
  const sara = await prisma.customer.create({ data: { name: 'سارا احمدی' } });
  const order = (data: any, items: any[]) => prisma.order.create({ data: { ...data, items: { create: items } } });
  // In the shop today: 3M less a 0.5M discount, 1M paid.
  await order(
    { customerId: ali.id, totalAmount: 3_000_000, discount: 500_000, paidAmount: 1_000_000, paymentStatus: 'PARTIAL', status: 'COMPLETED', createdAt: today },
    [{ productId: yekBlack.id, quantity: 1, price: 3_000_000, warehouseId: main.id }],
  );
  await order(
    { customerId: sara.id, siteReference: 'SITE-1', totalAmount: 2_000_000, paidAmount: 2_000_000, paymentStatus: 'PAID', status: 'COMPLETED', createdAt: ago(2) },
    [{ productId: yekBrown.id, quantity: 1, price: 2_000_000, warehouseId: main.id }],
  );
  await order(
    { customerId: partner.id, totalAmount: 4_000_000, paidAmount: 4_000_000, paymentStatus: 'PAID', status: 'COMPLETED', createdAt: ago(3) },
    [{ productId: yekBlack.id, quantity: 1, price: 4_000_000, warehouseId: store.id }],
  );
  await order(
    { customerId: sara.id, totalAmount: 9_000_000, paidAmount: 0, paymentStatus: 'UNPAID', status: 'CANCELLED', createdAt: ago(1) },
    [{ productId: yekBlack.id, quantity: 3, price: 3_000_000, warehouseId: main.id }],
  );
  await order(
    { customerId: ali.id, totalAmount: 1_000_000, paidAmount: 1_000_000, paymentStatus: 'PAID', status: 'COMPLETED', createdAt: ago(60) },
    [{ productId: voidGreen.id, quantity: 1, price: 1_000_000, warehouseId: main.id }],
  );

  await prisma.account.create({ data: { name: 'بانک سامان', type: 'BANK', currency: 'TOMAN', balance: 50_000_000, cardNumber: CARD, sheba: SHEBA } });
  await prisma.account.create({ data: { name: 'ذخیره دلاری', type: 'CASH', currency: 'USD', balance: 100 } });
  await prisma.account.create({ data: { name: 'ذخیره یورویی', type: 'CASH', currency: 'EUR', balance: 200 } });
  await prisma.account.create({ data: { name: 'بهای تمام‌شده', type: 'EXPENSE', currency: 'TOMAN', balance: -700_000 } });
  await prisma.exchangeRate.create({ data: { currency: 'USD', rateToToman: 100_000, date: ago(5) } });
  const tx = (data: any) => prisma.transaction.create({ data: { currency: 'TOMAN', amountInToman: data.amount, ...data } });
  await tx({ type: 'INCOME', amount: 2_500_000, category: 'Sales', date: today });
  await tx({ type: 'EXPENSE', amount: 1_000_000, category: 'Rent', date: ago(2) });
  await tx({ type: 'EXPENSE', amount: 700_000, category: 'COGS', date: today });
  await tx({ type: 'TRANSFER', amount: 5_000_000, category: 'انتقال وجه', date: ago(1) });
  await tx({ type: 'INCOME', amount: 9_999_000, category: 'Sales', date: ago(40) });

  const maker = await prisma.supplier.create({ data: { name: 'کارخانه الف' } });
  const other = await prisma.supplier.create({ data: { name: 'کارخانه ب' } });
  const open = await prisma.purchaseOrder.create({ data: { supplierId: maker.id, totalAmount: 10_000_000, totalAmountInToman: 10_000_000, status: 'PENDING_PAYMENT', createdAt: ago(4) } });
  await prisma.purchaseOrder.create({ data: { supplierId: other.id, totalAmount: 3_000_000, totalAmountInToman: 3_000_000, status: 'CANCELLED', createdAt: ago(20) } });

  const minute = new Date(Math.floor(ago(1).getTime() / 60_000) * 60_000 + 5_000);
  await prisma.inventoryMovement.createMany({
    data: [
      { productId: yekBlack.id, fromWarehouseId: main.id, toWarehouseId: store.id, quantity: 2, type: 'TRANSFER', createdAt: minute },
      { productId: yekBrown.id, fromWarehouseId: main.id, toWarehouseId: store.id, quantity: 1, type: 'TRANSFER', createdAt: new Date(minute.getTime() + 2_000) },
      { productId: yekBrown.id, toWarehouseId: main.id, quantity: 4, type: 'PURCHASE', referenceId: open.id, createdAt: ago(2) },
      { productId: yekBlack.id, fromWarehouseId: main.id, quantity: 1, type: 'SALE', createdAt: today },
      { productId: voidGreen.id, toWarehouseId: main.id, quantity: 1, type: 'ADJUSTMENT', createdAt: ago(3) },
      { productId: voidGreen.id, fromWarehouseId: main.id, toWarehouseId: store.id, quantity: 1, type: 'TRANSFER', createdAt: ago(10) },
    ],
  });

  const project = await prisma.project.create({ data: { name: 'کمپین', status: 'ACTIVE' } });
  await prisma.project.create({ data: { name: 'تمام‌شده', status: 'COMPLETED' } });
  await prisma.task.createMany({
    data: [
      { projectId: project.id, title: 'عقب افتاده', status: 'TODO', dueDate: ago(1) },
      { projectId: project.id, title: 'در جریان', status: 'IN_PROGRESS' },
      { projectId: project.id, title: 'تمام', status: 'DONE' },
    ],
  });

  await prisma.systemSetting.createMany({
    data: [
      { key: 'site_connection', value: JSON.stringify({ siteUrl: 'https://themoak.com', webhookSecret: WEBHOOK_SECRET, stockPushEnabled: true }) },
      { key: 'site_hook_status', value: JSON.stringify({ lastRunAt: ago(0.01).toISOString(), lastOkAt: ago(0.01).toISOString(), failingSince: null, paused: null, lastMessage: null }) },
      { key: 'site_catalogue_last_sync', value: JSON.stringify({ ok: true, at: ago(0.5).toISOString(), message: '', read: 91, updated: 3, notInErp: ['A', 'B'] }) },
    ],
  });

  return { main, store, archived, yekBlack, yekBrown, voidGreen, ali, sara, partner, maker, other, open };
}

/** Every key anywhere in the snapshot. */
function keysOf(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((item) => keysOf(item, into));
  else if (value && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      into.add(key);
      // byWarehouse is keyed by warehouse id.
      if (key !== 'byWarehouse') keysOf(inner, into);
    }
  }
  return into;
}

const MONEY_KEYS = ['amount', 'net', 'total', 'spend', 'debt', 'valueAtCost', 'unpaid', 'payables', 'receivables', 'balance', 'toman', 'revenue', 'cogs', 'expenses', 'profit'];

test('which parts each role sees follows the permission matrix', () => {
  assert.deepEqual(worldLayers('ADMIN'), { stock: true, sales: true, customers: true, suppliers: true, site: true, finance: true, profit: true, cost: true });
  assert.deepEqual(worldLayers('WAREHOUSE'), { stock: true, sales: false, customers: false, suppliers: true, site: true, finance: false, profit: false, cost: false });
  assert.deepEqual(worldLayers('SALES'), { stock: true, sales: true, customers: true, suppliers: true, site: true, finance: false, profit: false, cost: false });
  assert.deepEqual(worldLayers('ACCOUNTANT'), { stock: true, sales: true, customers: true, suppliers: true, site: true, finance: true, profit: false, cost: false });
  assert.deepEqual(worldLayers('AUDITOR'), { stock: true, sales: true, customers: true, suppliers: true, site: true, finance: true, profit: true, cost: true });
  assert.deepEqual(Object.values(worldLayers(null)), Array(8).fill(false));
  assert.deepEqual(Object.values(worldLayers('NOBODY')), Array(8).fill(false));
});

test('a product belongs to the model before « - »; an order to the website, a partner or the shop', () => {
  assert.equal(productFamily('YEK - Black'), 'YEK');
  assert.equal(productFamily('DAMN VOID - Green'), 'DAMN VOID');
  assert.equal(productFamily('310ºW - Brown'), '310ºW');
  assert.equal(productFamily('جعبه'), 'جعبه');
  assert.equal(orderChannel({ siteReference: 'S-1', items: [{ warehouse: { isVirtual: true } }] }), 'site');
  assert.equal(orderChannel({ wooId: 7, items: [] }), 'site');
  assert.equal(orderChannel({ items: [{ warehouse: { isVirtual: true } }] }), 'consignment');
  assert.equal(orderChannel({ items: [{ warehouse: { isVirtual: false } }] }), 'shop');
  assert.equal(orderChannel({ items: [] }), 'shop');
});

test('stock: archived warehouses and non-stock products are left out; levels, units and value are the dashboards\'', async () => {
  const s = await seed();
  const world = await buildWorld(prisma, 'ADMIN');
  const stock = world.stock!;

  assert.deepEqual(stock.warehouses.map((w) => [w.name, w.virtual, w.partner, w.units, w.products, w.valueAtCost]), [
    ['مشاهیر', false, null, 11, 2, 14_000_000],
    ['انبار امانی - نقش', true, 'فروشگاه نقش', 2, 1, 2_000_000],
  ]);
  const byName = new Map(stock.products.map((p) => [p.name, p]));
  assert.deepEqual([...byName.keys()].sort(), ['DAMN VOID - Green', 'YEK - Black', 'YEK - Brown']);
  assert.deepEqual(byName.get('YEK - Black'), {
    id: s.yekBlack.id, name: 'YEK - Black', family: 'YEK', units: 12, level: 'OK',
    byWarehouse: { [s.main.id]: 10, [s.store.id]: 2 }, onSite: true, sold: 2,
  });
  assert.equal(byName.get('YEK - Brown')!.level, 'LOW');
  assert.equal(byName.get('DAMN VOID - Green')!.level, 'OUT');
  assert.equal(byName.get('DAMN VOID - Green')!.units, -1);
  assert.deepEqual(stock.totals, { products: 3, units: 13, low: 1, out: 1, valueAtCost: 16_000_000 });
  assert.equal(stock.lowMax, 3);
});

test('sales: the window\'s figures, the days and the best sellers are the dashboard\'s; a cancelled order is listed, not counted', async () => {
  await seed();
  const world = await buildWorld(prisma, 'ADMIN');
  const dashboard = await getDashboardSales();
  const sales = world.sales!;

  const dashboardWindow = dashboard.dailySales.reduce((sum: number, d: any) => sum + d.total, 0);
  assert.equal(sales.window.total, dashboardWindow);
  assert.equal(sales.window.total, 2_500_000 + 2_000_000 + 4_000_000);
  assert.equal(sales.window.orders, 3);
  assert.deepEqual(sales.today, { orders: dashboard.today.count, total: dashboard.today.total });
  assert.deepEqual(sales.today, { orders: 1, total: 2_500_000 });
  assert.equal(sales.days.length, 31, 'every Tehran day of the window, empty ones too');
  assert.equal(sales.days.reduce((sum, d) => sum + d.total, 0), sales.window.total);
  for (const d of dashboard.dailySales as any[]) {
    assert.deepEqual(sales.days.find((row) => row.day === d.date), { day: d.date, orders: d.count, total: d.total });
  }
  assert.deepEqual(sales.channels, [
    { channel: 'site', orders: 1, total: 2_000_000 },
    { channel: 'shop', orders: 1, total: 2_500_000 },
    { channel: 'consignment', orders: 1, total: 4_000_000 },
  ]);
  assert.deepEqual(sales.topProducts.map((p) => [p.name, p.units]), dashboard.topProducts.map((p: any) => [p.name, p.units]));
  assert.deepEqual(sales.topProducts.map((p) => [p.name, p.family, p.units]), [['YEK - Black', 'YEK', 2], ['YEK - Brown', 'YEK', 1]]);

  const recent = sales.recentOrders;
  assert.deepEqual(recent.map((o) => [o.status, o.channel, o.units, o.net, o.customer]), [
    ['COMPLETED', 'shop', 1, 2_500_000, 'علی رضایی'],
    ['CANCELLED', 'shop', 3, 9_000_000, 'سارا احمدی'],
    ['COMPLETED', 'site', 1, 2_000_000, 'سارا احمدی'],
    ['COMPLETED', 'consignment', 1, 4_000_000, 'فروشگاه نقش'],
    ['COMPLETED', 'shop', 1, 1_000_000, 'علی رضایی'],
  ]);
});

test('sales: the window before is as long as the window and ends where it starts, by the same rules', async () => {
  const now = new Date();
  const s = await seed(now);
  const since = tehranDayStart(addDays(tehranDay(now), -30));
  const start = new Date(since.getTime() - (now.getTime() - since.getTime()));
  const order = (createdAt: Date, data: any = {}) => prisma.order.create({
    data: {
      customerId: s.ali.id, totalAmount: 2_000_000, discount: 500_000, paidAmount: 0, paymentStatus: 'UNPAID', status: 'COMPLETED', createdAt, ...data,
      items: { create: [{ productId: s.yekBrown.id, quantity: 1, price: 2_000_000, warehouseId: s.main.id }] },
    },
  });
  await order(start); // its first moment
  await order(new Date(since.getTime() - 1)); // its last
  await order(new Date(since.getTime() - DAY), { status: 'CANCELLED' }); // cancelled: not a sale
  await order(new Date(start.getTime() - 1)); // before it
  await order(since); // the window's
  const sales = (await buildWorld(prisma, 'ADMIN', now)).sales!;
  // The seed's order 60 days ago falls in it too, 1 000 000 with no discount; each of these nets 1 500 000.
  assert.deepEqual(sales.previous, { orders: 3, total: 1_000_000 + 2 * 1_500_000 });
  assert.deepEqual(sales.window, { orders: 4, total: 2_500_000 + 2_000_000 + 4_000_000 + 1_500_000 });
});

test('the best sellers carry their photo at an address on this site, the website\'s first, as every screen shows it', async () => {
  const s = await seed();
  const uploaded = '/api/product-images/0f8fad5b-d9cb-469f-a165-70867728950e.webp';
  await prisma.product.update({ where: { id: s.yekBlack.id }, data: { imageUrl: 'https://themoak.com/media/products/yek-black.webp', image: uploaded } });
  await prisma.product.update({ where: { id: s.yekBrown.id }, data: { image: uploaded } });
  const top = (await buildWorld(prisma, 'ADMIN')).sales!.topProducts;
  assert.deepEqual(top.map((p) => [p.name, p.image]), [
    ['YEK - Black', '/_next/image?url=https%3A%2F%2Fthemoak.com%2Fmedia%2Fproducts%2Fyek-black.webp&w=384&q=75'],
    ['YEK - Brown', uploaded],
  ]);
  await prisma.product.update({ where: { id: s.yekBrown.id }, data: { image: null } });
  assert.equal((await buildWorld(prisma, 'ADMIN')).sales!.topProducts[1].image, null);
  // Another host's photo cannot be drawn on this site's canvas: the uploaded one, else none.
  assert.equal(productPhotoOnSite({ imageUrl: 'https://cdn.example.com/a.webp', image: uploaded }), uploaded);
  assert.equal(productPhotoOnSite({ imageUrl: 'https://cdn.example.com/a.webp', image: null }), null);
  assert.equal(productPhotoOnSite({ imageUrl: 'http://themoak.com/a.webp' }), null);
  assert.equal(productPhotoOnSite({ imageUrl: '//themoak.com/a.webp' }), null);
  assert.equal(productPhotoOnSite({}), null);
});

test('money: «موجودی کل», receivables and payables are the dashboard\'s; flows and profit follow profit and loss', async () => {
  const s = await seed();
  const world = await buildWorld(prisma, 'ADMIN');
  const dashboard = await getDashboardFinancials();
  const finance = world.finance!;

  assert.equal(finance.total, dashboard.totalBalance);
  assert.equal(finance.total, 50_000_000 + 100 * 100_000);
  assert.equal(finance.receivables, dashboard.totalReceivables);
  assert.equal(finance.receivables, 1_500_000);
  assert.equal(finance.payables, dashboard.totalPayables);
  assert.equal(finance.payables, 10_000_000);
  assert.deepEqual(finance.accounts.map((a) => [a.name, a.currency, a.balance, a.toman]), [
    ['بانک سامان', 'TOMAN', 50_000_000, 50_000_000],
    ['ذخیره دلاری', 'USD', 100, 10_000_000],
    ['ذخیره یورویی', 'EUR', 200, null],
  ]);
  assert.deepEqual(finance.flows.income, [{ category: categoryLabel('Sales'), amount: 2_500_000 }]);
  assert.deepEqual(finance.flows.expense, [
    { category: categoryLabel('Rent'), amount: 1_000_000 },
    { category: categoryLabel('COGS'), amount: 700_000 },
  ]);
  assert.deepEqual(world.profit, { revenue: 2_500_000, cogs: 700_000, expenses: 1_000_000, profit: 800_000 });

  const suppliers = world.suppliers!;
  assert.deepEqual(suppliers.suppliers.map((x) => [x.name, x.orders, x.open, x.unpaid]), [
    ['کارخانه الف', 1, 1, 10_000_000],
    ['کارخانه ب', 0, 0, 0],
  ]);
  assert.equal(suppliers.payables, dashboard.totalPayables);
  assert.ok(suppliers.suppliers.find((x) => x.id === s.maker.id)!.lastOrderAt);
});

test('customers: partners are not customers; the best of 90 days with what they still owe', async () => {
  const s = await seed();
  const customers = (await buildWorld(prisma, 'ADMIN')).customers!;
  assert.equal(customers.total, 3);
  assert.equal(customers.buyers90, 2);
  assert.equal(customers.debtors, 1);
  assert.equal(customers.receivables, 1_500_000);
  assert.deepEqual(customers.top, [
    { id: s.ali.id, name: 'علی رضایی', orders: 2, spend: 3_500_000, debt: 1_500_000 },
    { id: s.sara.id, name: 'سارا احمدی', orders: 1, spend: 2_000_000, debt: 0 },
  ]);
});

test('the website: its address and sync state, never its secret', async () => {
  await seed();
  const world = await buildWorld(prisma, 'ADMIN');
  assert.deepEqual(world.site, {
    host: 'themoak.com',
    stockPush: true,
    productsOnSite: 1,
    hook: { lastOkAt: world.site!.hook.lastOkAt, failingSince: null, paused: false },
    catalogue: { at: world.site!.catalogue.at, ok: true, read: 91, updated: 3, notInErp: 2 },
    orders: { count: 1, total: 2_000_000 },
  });
  assert.ok(world.site!.hook.lastOkAt && world.site!.catalogue.at);
});

test('no card number, IBAN or webhook secret is ever in the snapshot, for any role', async () => {
  await seed();
  for (const role of ['ADMIN', 'AUDITOR', 'ACCOUNTANT', 'SALES', 'WAREHOUSE']) {
    const json = JSON.stringify(await buildWorld(prisma, role));
    for (const secret of [CARD, SHEBA, WEBHOOK_SECRET, 'webhookSecret', 'cardNumber', 'sheba']) {
      assert.ok(!json.includes(secret), `${role}: ${secret}`);
    }
  }
});

test('the warehouse sees stock, suppliers and the website, with no money and no customer anywhere', async () => {
  await seed();
  const world = await buildWorld(prisma, 'WAREHOUSE');
  assert.deepEqual(Object.keys(world).sort(), ['events', 'generatedAt', 'layers', 'office', 'site', 'stock', 'suppliers']);
  // `layers` names every part (profit: false…): the parts themselves are what must hold no money.
  const keys = keysOf({ ...world, layers: undefined });
  for (const key of [...MONEY_KEYS, 'sold', 'customer', 'orders']) {
    if (key === 'orders') continue; // a supplier's count of purchase orders
    assert.ok(!keys.has(key), key);
  }
  assert.ok(!('orders' in world.site!));
  const json = JSON.stringify(world);
  for (const name of ['علی رضایی', 'سارا احمدی']) assert.ok(!json.includes(name), name);
  // With no sales to show, the stock that left for a sale is the event.
  assert.ok(world.events.some((e) => e.kind === 'sale' && e.label.startsWith('فروش ۱ عدد')));
  assert.ok(!world.events.some((e) => e.kind === 'order' || e.kind === 'income' || e.kind === 'expense'));
});

test('the accountant sees money but never the cost of goods or profit', async () => {
  await seed();
  const world = await buildWorld(prisma, 'ACCOUNTANT');
  assert.ok(world.finance && world.sales && world.stock);
  assert.equal(world.profit, undefined);
  assert.deepEqual(world.finance!.flows.expense, [{ category: categoryLabel('Rent'), amount: 1_000_000 }]);
  assert.equal(world.stock!.totals.valueAtCost, undefined);
  assert.ok(world.stock!.warehouses.every((w) => w.valueAtCost === undefined));
  assert.ok(!world.events.some((e) => e.label.includes(categoryLabel('COGS'))));
});

test('sales sees orders and customers, but no balance, no supplier debt and no cost', async () => {
  await seed();
  const world = await buildWorld(prisma, 'SALES');
  assert.ok(world.sales && world.customers && world.stock && world.suppliers && world.site);
  assert.equal(world.finance, undefined);
  assert.equal(world.profit, undefined);
  assert.equal(world.suppliers!.payables, undefined);
  assert.ok(world.suppliers!.suppliers.every((x) => x.unpaid === undefined));
  assert.equal(world.stock!.totals.valueAtCost, undefined);
  assert.ok(!world.events.some((e) => e.kind === 'income' || e.kind === 'expense'));
});

test('events: the last 7 days newest first; a move of several products at once is one event; ids stay the same', async () => {
  const s = await seed();
  const first = await buildWorld(prisma, 'ADMIN');
  const events = first.events;
  assert.ok(events.every((e, i) => i === 0 || events[i - 1].at >= e.at), 'newest first');
  assert.ok(events.every((e) => Date.parse(e.at) >= Date.now() - 7 * DAY - 60_000), 'nothing older than 7 days');

  const transfers = events.filter((e) => e.kind === 'transfer');
  assert.deepEqual(transfers.map((e) => [e.from, e.to, e.units, e.label]), [[`wh:${s.main.id}`, `wh:${s.store.id}`, 3, 'انتقال ۳ عدد · ۲ کالا']]);
  const purchase = events.find((e) => e.kind === 'purchase')!;
  assert.deepEqual([purchase.from, purchase.to, purchase.units], [`sup:${s.maker.id}`, `wh:${s.main.id}`, 4]);
  assert.ok(events.some((e) => e.kind === 'adjust' && e.from === `wh:${s.main.id}` && e.to === `wh:${s.main.id}`));
  // With sales shown, the order is the event, not its stock movement.
  assert.ok(!events.some((e) => e.kind === 'sale'));
  const orders = events.filter((e) => e.kind === 'order');
  assert.deepEqual(orders.map((e) => [e.from, e.to, e.amount]), [
    [`wh:${s.main.id}`, 'customers', 2_500_000],
    [`wh:${s.main.id}`, 'site', 2_000_000],
    [`wh:${s.store.id}`, 'customers', 4_000_000],
  ]);
  assert.ok(events.some((e) => e.kind === 'income' && e.from === 'customers' && e.to === 'treasury' && e.amount === 2_500_000));
  assert.ok(events.some((e) => e.kind === 'expense' && e.from === 'treasury' && e.to === 'out' && e.amount === 1_000_000));
  assert.ok(!events.some((e) => e.label.includes(categoryLabel('COGS'))), 'a sale\'s cost is not an event of its own');

  const second = await buildWorld(prisma, 'ADMIN');
  assert.deepEqual(second.events.map((e) => e.id), events.map((e) => e.id));
});

test('the office: open projects, open, overdue and done tasks, for everyone', async () => {
  await seed();
  for (const role of ['ADMIN', 'WAREHOUSE', 'SALES']) {
    assert.deepEqual((await buildWorld(prisma, role)).office, { projects: 1, tasks: { open: 2, overdue: 1, done: 1 } });
  }
});

test('an empty business still has a world', async () => {
  const world = await buildWorld(prisma, 'ADMIN');
  assert.deepEqual(world.stock!.totals, { products: 0, units: 0, low: 0, out: 0, valueAtCost: 0 });
  assert.equal(world.sales!.days.length, 31);
  assert.deepEqual(world.events, []);
  assert.equal(world.finance!.total, 0);
});

test('/api/world: a stranger gets 401, an unknown role 403, a user their world, never cached', async () => {
  await seed();
  setTestRole(null);
  assert.equal((await worldRoute()).status, 401);
  setTestRole('NOBODY');
  assert.equal((await worldRoute()).status, 403);
  setTestRole('WAREHOUSE');
  const res = await worldRoute();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const body = (await res.json()) as WorldData;
  assert.equal(body.finance, undefined);
  assert.ok(body.stock);
});
