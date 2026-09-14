import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { connect, createServer as createTcpServer, type AddressInfo, type Server, type Socket } from 'node:net';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { prisma, resetDatabase, form } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { cancelOrder, recordOrderPayment } from '@/actions/sales';
import { returnOrderItem } from '@/actions/order-return';
import { createProduct, updateProduct } from '@/actions/product';
import { updateStock } from '@/actions/inventory';
import { getUnrestoredCancelledOrders, repairCancelledOrderStock } from '@/actions/lost-stock';
import { getSetting, getWooSettings, saveWooSettings } from '@/actions/settings';

// The WooCommerce store is gone (2026-09-14). No ERP action may call it, wait on it, or
// touch what it left behind; the default restock warehouse in woo_settings stays.

const ROOT = process.cwd();
const ENV_KEYS = ['WOOCOMMERCE_URL', 'WOOCOMMERCE_CONSUMER_KEY', 'WOOCOMMERCE_CONSUMER_SECRET'];

/** Stands in for the old store address: counts every request and answers 200 '{}' at once. */
let requests = 0;
const counting = createServer((_request, response) => {
  requests++;
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end('{}');
});

/** Accepts connections, counts them, and never answers. */
let silentConnections = 0;
const silentSockets = new Set<Socket>();
const silent = createTcpServer((socket) => {
  silentConnections++;
  silentSockets.add(socket);
  socket.on('close', () => silentSockets.delete(socket));
});

let countingUrl = '';
let silentUrl = '';

function listen(server: Server) {
  return new Promise<string>((done) =>
    server.listen(0, '127.0.0.1', () => done(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)),
  );
}

before(async () => {
  countingUrl = await listen(counting);
  silentUrl = await listen(silent);
  // Otherwise every "0 requests" below could pass because the counter never counts.
  await (await fetch(countingUrl)).text();
  assert.equal(requests, 1);
  // The same for "0 connections" on the silent server.
  await new Promise<void>((done) => {
    const probe = connect(Number(new URL(silentUrl).port), '127.0.0.1');
    silent.once('connection', () => {
      probe.destroy();
      done();
    });
  });
  assert.equal(silentConnections, 1);
});
beforeEach(async () => {
  for (const key of ENV_KEYS) delete process.env[key];
  setTestRole('ADMIN');
  await resetDatabase();
  requests = 0;
  silentConnections = 0;
});
after(async () => {
  for (const key of ENV_KEYS) delete process.env[key];
  silentSockets.forEach((socket) => socket.destroy());
  counting.closeAllConnections();
  await Promise.all([
    new Promise((done) => counting.close(done)),
    new Promise((done) => silent.close(done)),
  ]);
  await prisma.$disconnect();
});

const PRICE = 18500000; // DAMN RAW - White: the line stamped with a warehouse, 2 units
const PRICE_B = 9000000; // PANJ - Blue: the line with a NULL warehouse, 1 unit
const TOTAL = PRICE * 2 + PRICE_B;
const NEW_PRICE = 19900000;
const SITE = 'انبار سایت';
const WOO_IDS = { order: 7001, customer: 501, product: 9001, productB: 9002 };
const NOT_DEDUCTED_NOTE =
  '«PANJ - Blue»: سفارش ووکامرس بدون انبار ثبت شده بود و هنگام فروش از موجودی کسر نشده؛ موجودی تغییر نکرد.';

type Base = {
  account: { id: string };
  customer: { id: string };
  product: { id: string };
  productB: { id: string };
  siteWarehouse: { id: string };
};

/**
 * woo_settings pointing at `url` (no url when null), an account, two physical warehouses, a Woo
 * customer, a Woo product with a webId, a second Woo product, stock, and one imported Woo order.
 */
async function seed({ url = countingUrl as string | null, paid = false } = {}) {
  const account = await prisma.account.create({ data: { name: 'صندوق', type: 'CASH', currency: 'TOMAN', balance: 0 } });
  const siteWarehouse = await prisma.warehouse.create({ data: { name: SITE } });
  const shop = await prisma.warehouse.create({ data: { name: 'مشاهیر' } });
  const woo = {
    ...(url ? { url } : {}),
    consumerKey: 'ck_test',
    consumerSecret: 'cs_test',
    warehouseId: siteWarehouse.id,
    accountId: account.id,
  };
  await prisma.systemSetting.create({ data: { key: 'woo_settings', value: JSON.stringify(woo) } });
  const customer = await prisma.customer.create({ data: { name: 'مریم', phone: '09121234567', wooId: WOO_IDS.customer } });
  const product = await prisma.product.create({
    data: { name: 'DAMN RAW - White', sku: 'RAW/WHIT', wooId: WOO_IDS.product, webId: 'MOAK-DAMN-RAW-WHITE', costPrice: 1, sellPrice: PRICE },
  });
  const productB = await prisma.product.create({
    data: { name: 'PANJ - Blue', sku: 'PANJ/BLUE', wooId: WOO_IDS.productB, costPrice: 1, sellPrice: PRICE_B },
  });
  await prisma.inventory.createMany({
    data: [
      { productId: product.id, warehouseId: siteWarehouse.id, quantity: 5 },
      { productId: productB.id, warehouseId: siteWarehouse.id, quantity: 5 },
    ],
  });
  const base = { account, siteWarehouse, shop, customer, product, productB };
  return { ...base, order: await addWooOrder(base, WOO_IDS.order, paid) };
}

/** An order as the Woo importer wrote it: a paid one COMPLETED with its income, an unpaid one PENDING. */
async function addWooOrder(base: Base, wooId: number, paid: boolean) {
  const income = paid
    ? await prisma.transaction.create({
        data: {
          type: 'INCOME',
          amount: TOTAL,
          amountInToman: TOTAL,
          accountId: base.account.id,
          customerId: base.customer.id,
          category: 'Sales',
          wooId,
          wooStatus: 'completed',
        },
      })
    : null;
  if (income) await prisma.account.update({ where: { id: base.account.id }, data: { balance: { increment: TOTAL } } });
  const order = await prisma.order.create({
    data: {
      wooId,
      customerId: base.customer.id,
      totalAmount: TOTAL,
      discount: 0,
      paidAmount: paid ? TOTAL : 0,
      paymentStatus: paid ? 'PAID' : 'UNPAID',
      status: paid ? 'COMPLETED' : 'PENDING',
      transactionId: income?.id,
      items: {
        create: [
          { productId: base.product.id, quantity: 2, price: PRICE, warehouseId: base.siteWarehouse.id },
          { productId: base.productB.id, quantity: 1, price: PRICE_B, warehouseId: null },
        ],
      },
    },
    include: { items: true },
  });
  const line = (productId: string) => order.items.find((item: { productId: string }) => item.productId === productId)!;
  return { id: order.id, incomeId: income?.id ?? null, stamped: line(base.product.id), unstamped: line(base.productB.id) };
}

type Seeded = Awaited<ReturnType<typeof seed>>;
type WooOrder = Seeded['order'];

const payInFull = (s: Seeded) => recordOrderPayment(s.order.id, s.account.id, TOTAL);

const returnLine = (s: Seeded, order: WooOrder, item: { id: string }, quantity: number) =>
  returnOrderItem(
    {},
    form({ orderId: order.id, orderItemId: item.id, quantity: String(quantity), accountId: s.account.id, warehouseId: s.siteWarehouse.id }),
  );

/** Returns every unit of the order: what used to cancel it on WooCommerce. */
async function returnEverything(s: Seeded, order: WooOrder) {
  return [await returnLine(s, order, order.stamped, 2), await returnLine(s, order, order.unstamped, 1)];
}

/** A price edit as the product form sends it: no wooId, and no webId, which means "leave it". */
const editPrice = (s: Seeded) =>
  updateProduct(
    s.product.id,
    {},
    form({ name: 'DAMN RAW - White', sku: 'RAW/WHIT', productType: 'SALEABLE', costPrice: '1', sellPrice: String(NEW_PRICE) }),
  );

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** Requests the old store address received, after time for an unawaited call to land. */
async function wooRequests() {
  await sleep(300);
  return requests;
}

/** The Woo columns of the seeded order, customer, products and, on a paid order, its imported income. */
async function wooColumns(s: Seeded) {
  const [order, customer, product, productB, income] = await Promise.all([
    prisma.order.findUniqueOrThrow({ where: { id: s.order.id } }),
    prisma.customer.findUniqueOrThrow({ where: { id: s.customer.id } }),
    prisma.product.findUniqueOrThrow({ where: { id: s.product.id } }),
    prisma.product.findUniqueOrThrow({ where: { id: s.productB.id } }),
    s.order.incomeId ? prisma.transaction.findUniqueOrThrow({ where: { id: s.order.incomeId } }) : null,
  ]);
  return {
    order: order.wooId,
    customer: customer.wooId,
    product: product.wooId,
    productB: productB.wooId,
    income: income && { wooId: income.wooId, wooStatus: income.wooStatus },
  };
}

/** What the seed recorded in those columns. */
const recordedWoo = (s: Seeded) => ({
  ...WOO_IDS,
  income: s.order.incomeId ? { wooId: WOO_IDS.order, wooStatus: 'completed' } : null,
});

/** One product's stock, by warehouse name. */
async function stockOf(productId: string) {
  const rows = await prisma.inventory.findMany({ where: { productId }, include: { warehouse: true } });
  return Object.fromEntries(rows.map((row: { warehouse: { name: string }; quantity: number }) => [row.warehouse.name, row.quantity]));
}

async function balanceOf(accountId: string) {
  return Number((await prisma.account.findUniqueOrThrow({ where: { id: accountId } })).balance);
}

/** Each return with its refund transaction, largest first. */
async function returnsWithRefunds() {
  const rows = await prisma.orderReturn.findMany({ include: { transaction: true }, orderBy: { quantity: 'desc' } });
  return rows.map((row: any) => [
    row.orderItemId,
    row.quantity,
    Number(row.refundAmount),
    row.transaction?.type,
    row.transaction?.accountId,
    Number(row.transaction?.amount),
  ]);
}

test('payment: paying a Woo order in full calls no Woo address and books the income', async () => {
  const s = await seed();

  const result = await payInFull(s);
  assert.equal(await wooRequests(), 0);
  assert.equal(result.success, true, result.message);

  const incomes = await prisma.transaction.findMany({ where: { type: 'INCOME' } });
  assert.deepEqual(incomes.map((tx: any) => [tx.accountId, Number(tx.amount)]), [[s.account.id, TOTAL]]);
  assert.equal(await balanceOf(s.account.id), TOTAL);
  const order = await prisma.order.findUniqueOrThrow({ where: { id: s.order.id } });
  assert.equal(Number(order.paidAmount), TOTAL);
  assert.equal(order.paymentStatus, 'PAID');
  assert.deepEqual(await wooColumns(s), recordedWoo(s));
});

test('payment: a partial payment on a Woo order books the income and marks the order PARTIAL', async () => {
  const s = await seed();

  const result = await recordOrderPayment(s.order.id, s.account.id, PRICE);
  assert.equal(await wooRequests(), 0);
  assert.equal(result.success, true, result.message);

  const incomes = await prisma.transaction.findMany({ where: { type: 'INCOME' } });
  assert.deepEqual(incomes.map((tx: any) => [tx.accountId, Number(tx.amount)]), [[s.account.id, PRICE]]);
  assert.equal(await balanceOf(s.account.id), PRICE);
  const order = await prisma.order.findUniqueOrThrow({ where: { id: s.order.id } });
  assert.equal(Number(order.paidAmount), PRICE);
  assert.equal(order.paymentStatus, 'PARTIAL');
  assert.deepEqual(await wooColumns(s), recordedWoo(s));
});

test('cancel: cancelling a Woo order calls no Woo address and restocks only the stamped line', async () => {
  const s = await seed();

  const result = await cancelOrder(s.order.id);
  assert.equal(await wooRequests(), 0);
  assert.equal(result.success, true, result.message);
  assert.ok(result.message.includes(NOT_DEDUCTED_NOTE), result.message);

  assert.deepEqual(await stockOf(s.product.id), { [SITE]: 7 });
  assert.deepEqual(await stockOf(s.productB.id), { [SITE]: 5 });
  assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: s.order.id } })).status, 'CANCELLED');
  assert.deepEqual(await wooColumns(s), recordedWoo(s));
});

test('return: returning all of a paid Woo order calls no Woo address and records returns, refunds and stock', async () => {
  const s = await seed({ paid: true });

  const results = await returnEverything(s, s.order);
  assert.equal(await wooRequests(), 0);
  for (const result of results) assert.equal(result.success, true, result.message);

  assert.deepEqual(await returnsWithRefunds(), [
    [s.order.stamped.id, 2, PRICE * 2, 'EXPENSE', s.account.id, PRICE * 2],
    [s.order.unstamped.id, 1, PRICE_B, 'EXPENSE', s.account.id, PRICE_B],
  ]);
  assert.equal(await balanceOf(s.account.id), 0);
  assert.deepEqual(await stockOf(s.product.id), { [SITE]: 7 });
  assert.deepEqual(await stockOf(s.productB.id), { [SITE]: 6 });
  assert.deepEqual(await wooColumns(s), recordedWoo(s));
});

test('return: returning one unit of a paid Woo order records the return, refund and stock', async () => {
  const s = await seed({ paid: true });

  const result = await returnLine(s, s.order, s.order.stamped, 1);
  assert.equal(await wooRequests(), 0);
  assert.equal(result.success, true, result.message);

  assert.deepEqual(await returnsWithRefunds(), [[s.order.stamped.id, 1, PRICE, 'EXPENSE', s.account.id, PRICE]]);
  assert.equal(await balanceOf(s.account.id), TOTAL - PRICE);
  assert.deepEqual(await stockOf(s.product.id), { [SITE]: 6 });
  assert.deepEqual(await wooColumns(s), recordedWoo(s));
});

test('price edit: a new price on a Woo product calls no Woo address and keeps wooId and webId', async () => {
  const s = await seed();

  const result = await editPrice(s);
  assert.equal(await wooRequests(), 0);
  assert.equal(result.message, 'کالا با موفقیت ویرایش شد.');
  assert.equal(result.success, true);

  const product = await prisma.product.findUniqueOrThrow({ where: { id: s.product.id } });
  assert.equal(Number(product.sellPrice), NEW_PRICE);
  assert.equal(product.webId, 'MOAK-DAMN-RAW-WHITE');
  assert.deepEqual(await wooColumns(s), recordedWoo(s));
});

test('stock: setting stock of a Woo product in the woo_settings warehouse calls no Woo address', async () => {
  const s = await seed();

  const result = await updateStock(s.product.id, s.siteWarehouse.id, 9);
  assert.equal(await wooRequests(), 0);
  assert.deepEqual(result, { success: true });
  assert.deepEqual(await stockOf(s.product.id), { [SITE]: 9 });
  assert.deepEqual(await wooColumns(s), recordedWoo(s));
});

/** woo_settings without a url, and the old environment fallback pointing at the counting server. */
async function seedWithEnvFallback() {
  const s = await seed({ url: null });
  process.env.WOOCOMMERCE_URL = countingUrl;
  process.env.WOOCOMMERCE_CONSUMER_KEY = 'ck_env';
  process.env.WOOCOMMERCE_CONSUMER_SECRET = 'cs_env';
  return s;
}

test('env fallback: a full payment calls no Woo address', async () => {
  const s = await seedWithEnvFallback();

  const result = await payInFull(s);
  assert.equal(await wooRequests(), 0);
  assert.equal(result.success, true, result.message);
});

test('env fallback: a price edit calls no Woo address', async () => {
  const s = await seedWithEnvFallback();

  const result = await editPrice(s);
  assert.equal(await wooRequests(), 0);
  assert.equal(result.success, true, result.message);
});

async function timed<T>(run: () => Promise<T>) {
  const start = Date.now();
  const result = await run();
  return { result, ms: Date.now() - start };
}

/** Connections the silent server received, after time for an unawaited call to land. */
async function silentConnectionCount() {
  await sleep(300);
  return silentConnections;
}

const NO_WAIT = { timeout: 10000 };

test('no wait: a full payment returns at once when the old Woo address never answers', NO_WAIT, async () => {
  const s = await seed({ url: silentUrl });

  const { result, ms } = await timed(() => payInFull(s));
  assert.ok(ms < 2000, `took ${ms} ms`);
  assert.equal(await silentConnectionCount(), 0);
  assert.equal(result.success, true, result.message);
});

test('no wait: a cancel returns at once when the old Woo address never answers', NO_WAIT, async () => {
  const s = await seed({ url: silentUrl });

  const { result, ms } = await timed(() => cancelOrder(s.order.id));
  assert.ok(ms < 2000, `took ${ms} ms`);
  assert.equal(await silentConnectionCount(), 0);
  assert.equal(result.success, true, result.message);
});

test('no wait: a full return returns at once when the old Woo address never answers', NO_WAIT, async () => {
  const s = await seed({ url: silentUrl, paid: true });

  const { result: results, ms } = await timed(() => returnEverything(s, s.order));
  assert.ok(ms < 2000, `took ${ms} ms`);
  assert.equal(await silentConnectionCount(), 0);
  for (const result of results) assert.equal(result.success, true, result.message);
});

test('no wait: a price edit returns at once when the old Woo address never answers', NO_WAIT, async () => {
  const s = await seed({ url: silentUrl });

  const { result, ms } = await timed(() => editPrice(s));
  assert.ok(ms < 2000, `took ${ms} ms`);
  assert.equal(await silentConnectionCount(), 0);
  assert.equal(result.success, true, result.message);
});

test('no wait: setting stock returns at once when the old Woo address never answers', NO_WAIT, async () => {
  const s = await seed({ url: silentUrl });

  const { result, ms } = await timed(() => updateStock(s.product.id, s.siteWarehouse.id, 9));
  assert.ok(ms < 2000, `took ${ms} ms`);
  assert.equal(await silentConnectionCount(), 0);
  assert.deepEqual(result, { success: true });
});

/**
 * Cancels a walk-in sale of a product stocked only in `stockedIn`, its line with no warehouse and no other
 * clue, so the "wherever it lives today" fallback would pick `stockedIn`. Returns that product's stock.
 */
async function cancelSaleWithNoWarehouse(stockedIn: string) {
  const frame = await prisma.product.create({ data: { name: 'SEVEN - Black', sku: 'SEVN/BLCK', costPrice: 1, sellPrice: PRICE_B } });
  await prisma.inventory.create({ data: { productId: frame.id, warehouseId: stockedIn, quantity: 4 } });
  const walkIn = await prisma.customer.create({ data: { name: 'مشتری حضوری' } });
  const order = await prisma.order.create({
    data: {
      customerId: walkIn.id,
      totalAmount: PRICE_B,
      paidAmount: 0,
      paymentStatus: 'UNPAID',
      status: 'COMPLETED',
      items: { create: [{ productId: frame.id, quantity: 1, price: PRICE_B, warehouseId: null }] },
    },
  });

  const result = await cancelOrder(order.id);
  assert.equal(result.success, true, result.message);
  return stockOf(frame.id);
}

test('restore default: a cancelled line with no warehouse and no other clue goes to the woo_settings warehouse', async () => {
  const s = await seed();

  assert.deepEqual(await cancelSaleWithNoWarehouse(s.shop.id), { [SITE]: 1, 'مشاهیر': 4 });
});

async function allStock() {
  const rows = await prisma.inventory.findMany({ orderBy: [{ productId: 'asc' }, { warehouseId: 'asc' }] });
  return {
    inventory: rows.map((row: { productId: string; warehouseId: string; quantity: number }) => [row.productId, row.warehouseId, row.quantity]),
    movements: await prisma.inventoryMovement.count(),
  };
}

test('lost stock: a cancelled Woo order with a NULL-warehouse line is neither listed nor repaired', async () => {
  const s = await seed();
  await prisma.order.update({ where: { id: s.order.id }, data: { status: 'CANCELLED' } });
  // The same shape without a wooId is listed, so an empty report is not an error swallowed.
  const control = await prisma.order.create({
    data: {
      totalAmount: PRICE_B,
      paymentStatus: 'UNPAID',
      status: 'CANCELLED',
      items: { create: [{ productId: s.productB.id, quantity: 1, price: PRICE_B, warehouseId: null }] },
    },
  });

  const listed = await getUnrestoredCancelledOrders();
  assert.deepEqual(listed.map((order) => order.orderId), [control.id]);

  const before = await allStock();
  assert.deepEqual(await repairCancelledOrderStock(s.order.id), {
    success: false,
    message: 'سفارش ووکامرس در زمان فروش از موجودی کسر نشده بود.',
  });
  assert.deepEqual(await allStock(), before);
});

/** Woo-era records: an imported paid order with its transaction, another imported transaction, and what they point at. */
async function seedHistory(warehouseId: string) {
  const account = await prisma.account.create({ data: { name: 'زرین‌پال', type: 'BANK', currency: 'TOMAN', balance: 7500000 } });
  const customer = await prisma.customer.create({ data: { name: 'رضا', phone: '09351112233', wooId: 402 } });
  const product = await prisma.product.create({ data: { name: 'NIMA - Gold', sku: 'NIMA/GOLD', wooId: 8801, costPrice: 1, sellPrice: 2500000 } });
  await prisma.inventory.create({ data: { productId: product.id, warehouseId, quantity: 12 } });
  const income = await prisma.transaction.create({
    data: {
      type: 'INCOME',
      amount: 5000000,
      amountInToman: 5000000,
      accountId: account.id,
      customerId: customer.id,
      category: 'Sales',
      description: 'سفارش WooCommerce #6601 - مشتری: رضا',
      wooId: 6601,
      wooStatus: 'completed',
    },
  });
  const other = await prisma.transaction.create({
    data: { type: 'INCOME', amount: 2500000, amountInToman: 2500000, accountId: account.id, category: 'Sales', wooId: 6602, wooStatus: 'completed' },
  });
  const order = await prisma.order.create({
    data: {
      wooId: 6601,
      customerId: customer.id,
      totalAmount: 5000000,
      paidAmount: 5000000,
      paymentStatus: 'PAID',
      status: 'COMPLETED',
      transactionId: income.id,
      items: { create: [{ productId: product.id, quantity: 2, price: 2500000, warehouseId }] },
    },
  });
  return { accountId: account.id, customerId: customer.id, productId: product.id, orderId: order.id, transactionIds: [income.id, other.id] };
}

async function historySnapshot(history: Awaited<ReturnType<typeof seedHistory>>) {
  return JSON.parse(
    JSON.stringify({
      order: await prisma.order.findUniqueOrThrow({ where: { id: history.orderId }, include: { items: true } }),
      transactions: await prisma.transaction.findMany({ where: { id: { in: history.transactionIds } }, orderBy: { wooId: 'asc' } }),
      customer: await prisma.customer.findUniqueOrThrow({ where: { id: history.customerId } }),
      product: await prisma.product.findUniqueOrThrow({ where: { id: history.productId } }),
      inventory: await prisma.inventory.findMany({ where: { productId: history.productId } }),
      account: await prisma.account.findUniqueOrThrow({ where: { id: history.accountId } }),
    }),
  );
}

test('history: the events above leave Woo-era orders, transactions, customers, products and stock as recorded', async () => {
  const s = await seed();
  const history = await seedHistory(s.siteWarehouse.id);
  const second = await addWooOrder(s, 7002, false);
  const before = await historySnapshot(history);

  const outcomes = [
    await payInFull(s),
    ...(await returnEverything(s, s.order)),
    await cancelOrder(second.id),
    await editPrice(s),
    await updateStock(s.product.id, s.siteWarehouse.id, 9),
  ];
  for (const outcome of outcomes) assert.equal(outcome.success, true, JSON.stringify(outcome));

  assert.deepEqual(await historySnapshot(history), before);
});

const storedWoo = async () =>
  JSON.parse((await prisma.systemSetting.findUniqueOrThrow({ where: { key: 'woo_settings' } })).value);

/** Saves as the settings card does: its state is only { warehouseId }, loaded from getWooSettings, then picked. */
async function saveFromCard(warehouseId: string) {
  const loaded = await getWooSettings();
  const state = { warehouseId: loaded.warehouseId || '' };
  return saveWooSettings({ ...state, warehouseId });
}

test('settings: saving the warehouse drops the Woo url and keys and keeps every other stored key', async () => {
  const s = await seed();
  // A key nothing reads any more must survive the save too.
  await prisma.systemSetting.update({
    where: { key: 'woo_settings' },
    data: { value: JSON.stringify({ ...(await storedWoo()), autoSyncInterval: 15 }) },
  });

  assert.deepEqual(await saveFromCard(s.shop.id), { success: true });
  assert.deepEqual(await storedWoo(), { warehouseId: s.shop.id, accountId: s.account.id, autoSyncInterval: 15 });
});

test('settings: neither getter serves the Woo url or keys, before or after a save', async () => {
  const s = await seed();

  assert.deepEqual(await getWooSettings(), { warehouseId: s.siteWarehouse.id });
  assert.deepEqual(await getSetting('woo_settings'), { warehouseId: s.siteWarehouse.id, accountId: s.account.id });
  assert.deepEqual(await saveFromCard(s.shop.id), { success: true });
  assert.deepEqual(await getWooSettings(), { warehouseId: s.shop.id });
  assert.deepEqual(await getSetting('woo_settings'), { warehouseId: s.shop.id, accountId: s.account.id });
});

test('settings: a row with no url is served and saved the same way', async () => {
  const s = await seed({ url: null });

  assert.deepEqual(await getWooSettings(), { warehouseId: s.siteWarehouse.id });
  assert.deepEqual(await getSetting('woo_settings'), { warehouseId: s.siteWarehouse.id, accountId: s.account.id });
  assert.deepEqual(await saveFromCard(s.shop.id), { success: true });
  assert.deepEqual(await storedWoo(), { warehouseId: s.shop.id, accountId: s.account.id });
});

test('settings: only an admin can save the warehouse, and a refused save leaves the row as it was', async () => {
  const s = await seed();
  const before = await storedWoo();

  for (const role of ['USER', null] as const) {
    setTestRole(role);
    const refused = await saveWooSettings({ warehouseId: s.shop.id });
    assert.equal(refused.success, false, String(role));
    assert.deepEqual(await storedWoo(), before, String(role));
  }
});

test('settings: a save takes only the warehouse from the caller, whatever else it sends', async () => {
  const s = await seed();

  const saved = await saveWooSettings({
    warehouseId: s.shop.id,
    url: 'https://example.com',
    consumerKey: 'ck_new',
    consumerSecret: 'cs_new',
    accountId: 'someone-else',
  } as any);
  assert.deepEqual(saved, { success: true });
  assert.deepEqual(await storedWoo(), { warehouseId: s.shop.id, accountId: s.account.id });
});

test('settings: a cancelled line with no warehouse goes to the warehouse saved from the card', async () => {
  const s = await seed();
  assert.deepEqual(await saveFromCard(s.shop.id), { success: true });

  // Stocked only in the previous default, so only the saved warehouseId sends the unit to مشاهیر.
  assert.deepEqual(await cancelSaleWithNoWarehouse(s.siteWarehouse.id), { [SITE]: 4, 'مشاهیر': 1 });
});

test('product form: a crafted wooId on an edit leaves the stored wooId as recorded', async () => {
  const s = await seed();

  const result = await updateProduct(
    s.product.id,
    {},
    form({ name: 'DAMN RAW - White', sku: 'RAW/WHIT', productType: 'SALEABLE', costPrice: '1', sellPrice: String(PRICE), wooId: '4242' }),
  );
  assert.equal(result.success, true, result.message);
  assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: s.product.id } })).wooId, WOO_IDS.product);
});

test('product form: a crafted wooId on a new product stores no wooId', async () => {
  const result = await createProduct(
    {},
    form({ name: 'SEVEN - Black', sku: 'SEVN/BLCK', productType: 'SALEABLE', costPrice: '1', sellPrice: String(PRICE_B), wooId: '4242' }),
  );
  assert.equal(result.success, true, result.message);
  assert.equal((await prisma.product.findUniqueOrThrow({ where: { sku: 'SEVN/BLCK' } })).wooId, null);
});

const WOO_PACKAGE = '@woocommerce/woocommerce-rest-api';
const WOO_MODULES = ['src/lib/woocommerce', 'src/actions/woocommerce', 'src/actions/woocommerce-settings'];

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(tsx?|jsx?|mjs|cjs)$/.test(entry.name) ? [path] : [];
  });
}

/** Every module a file imports, re-exports, requires or loads with import(). */
function specifiers(code: string) {
  const pattern = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)(['"])([^'"\n]+)\1/gm;
  const found: string[] = [];
  for (let match = pattern.exec(code); match; match = pattern.exec(code)) found.push(match[2]);
  return found;
}

/** The Woo client package, or a Woo module however the path is spelled ('@/…', './woocommerce', '../src/…'). */
function isWooImport(file: string, specifier: string) {
  if (specifier === WOO_PACKAGE || specifier.startsWith(`${WOO_PACKAGE}/`)) return true;
  let target: string;
  if (specifier.startsWith('@/')) target = join('src', specifier.slice(2));
  else if (specifier.startsWith('.')) target = relative(ROOT, resolve(dirname(file), specifier));
  else return false;
  return WOO_MODULES.includes(target.replace(/\.(tsx?|jsx?|mjs|cjs)$/, '').replace(/\/index$/, ''));
}

test('static guard: nothing in src/, scripts/ or the root *.ts files imports WooCommerce code', () => {
  const rootTs = readdirSync(ROOT, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => join(ROOT, entry.name));
  const files = [...sourceFiles(join(ROOT, 'src')), ...sourceFiles(join(ROOT, 'scripts')), ...rootTs];

  const offenders = files.flatMap((file) =>
    specifiers(readFileSync(file, 'utf8'))
      .filter((specifier) => isWooImport(file, specifier))
      .map((specifier) => `${relative(ROOT, file)}: ${specifier}`),
  );
  assert.deepEqual(offenders, []);
});

test('static guard: the WooCommerce page and API route are gone', () => {
  assert.equal(existsSync(join(ROOT, 'src/app/dashboard/woocommerce')), false);
  assert.equal(existsSync(join(ROOT, 'src/app/api/woocommerce')), false);
});

test('static guard: package.json does not depend on the WooCommerce client', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.equal(Object.keys(pkg.dependencies ?? {}).includes(WOO_PACKAGE), false);
});
