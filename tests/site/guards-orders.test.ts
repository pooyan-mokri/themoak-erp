import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase, form } from '../helpers/db';
import { beforeQuery } from '../helpers/hooks';
import { cancelOrder, getOrder, getOrders } from '@/actions/sales';
import { returnOrderItem } from '@/actions/order-return';
import { exchangeOrderItem } from '@/actions/order-exchange';
import { WEBSITE_ORDER_LOCKED, type SiteOrderData } from '@/lib/site-sale-data';

beforeEach(async () => {
  beforeQuery.fn = null;
  await resetDatabase();
});
after(() => prisma.$disconnect());

const PRICE = 18500000;
const FREIGHT = 450000;
const PAID = PRICE * 2 + FREIGHT;
const REFERENCE = 'M-2K4F9J-X7Q';

const siteData: SiteOrderData = {
  issuedAt: '2026-09-10T18:40:00.000Z',
  tag: null,
  customer: { name: 'سارا', mobile: '09123456789', email: null, siteId: 'site-user-1', ordersBefore: 0 },
  shipTo: { province: 'تهران', city: 'تهران', address: 'خیابان ولیعصر', postal: '1234567890', note: null },
  shipping: { zone: 'tehran', carrier: 'tipax', freight: FREIGHT, free: false, trackingCode: null },
  payment: { gateway: 'zibal', trackId: 'T-1', refNumber: 'R-1', paidAt: '2026-09-10T18:41:55.000Z', amount: PAID },
  subtotal: PRICE * 2,
  discount: 0,
  coupon: null,
  total: PAID,
  unknownLines: [],
  history: [],
  review: [],
};

/** A paid order of 2 × PRICE plus freight, stock already taken, income already in the account. */
async function seedOrder(siteReference: string | null) {
  const customer = await prisma.customer.create({
    data: { name: 'سارا', phone: '09123456789', ...(siteReference ? { source: 'website', siteId: 'site-user-1' } : {}) },
  });
  const warehouse = await prisma.warehouse.create({ data: { name: 'مشاهیر' } });
  const product = await prisma.product.create({
    data: { name: 'DAMN RAW - White', sku: 'RAW/WHIT', webId: 'MOAK-DAMN-RAW-WHITE', costPrice: 1, sellPrice: PRICE },
  });
  const other = await prisma.product.create({ data: { name: 'PANJ - Blue', sku: 'PANJ/BLUE', costPrice: 1, sellPrice: PRICE } });
  await prisma.inventory.createMany({
    data: [
      { productId: product.id, warehouseId: warehouse.id, quantity: 5 },
      { productId: other.id, warehouseId: warehouse.id, quantity: 5 },
    ],
  });
  const account = await prisma.account.create({ data: { name: 'زیبال', type: 'BANK', currency: 'TOMAN', balance: PAID } });
  const income = await prisma.transaction.create({
    data: { type: 'INCOME', amount: PAID, amountInToman: PAID, accountId: account.id, customerId: customer.id, category: 'Sales' },
  });
  const order = await prisma.order.create({
    data: {
      customerId: customer.id,
      totalAmount: PAID,
      discount: 0,
      paidAmount: PAID,
      paymentStatus: 'PAID',
      status: 'COMPLETED',
      transactionId: income.id,
      siteReference,
      ...(siteReference ? { siteData } : {}),
      items: { create: [{ productId: product.id, quantity: 2, price: PRICE, warehouseId: warehouse.id }] },
    },
    include: { items: true },
  });
  return { order, item: order.items[0], account, warehouse, product, other };
}

/** Everything a reversal could move. */
async function snapshot(orderId: string) {
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: { orderBy: { id: 'asc' } } } });
  return {
    status: order.status,
    paymentStatus: order.paymentStatus,
    totalAmount: Number(order.totalAmount),
    discount: Number(order.discount),
    paidAmount: Number(order.paidAmount),
    transactionId: order.transactionId,
    items: order.items.map((item: { id: string; status: string; quantity: number }) => [item.id, item.status, item.quantity]),
    inventory: (await prisma.inventory.findMany({ orderBy: [{ productId: 'asc' }, { warehouseId: 'asc' }] })).map(
      (row: { productId: string; warehouseId: string; quantity: number }) => [row.productId, row.warehouseId, row.quantity],
    ),
    balances: (await prisma.account.findMany({ orderBy: { id: 'asc' } })).map((account: { balance: unknown }) =>
      Number(account.balance),
    ),
    transactions: await prisma.transaction.count(),
    returns: await prisma.orderReturn.count(),
    exchanges: await prisma.orderExchange.count(),
    movements: await prisma.inventoryMovement.count(),
  };
}

test('cancelOrder refuses a website order and nothing changes', async () => {
  const { order } = await seedOrder(REFERENCE);
  const before = await snapshot(order.id);

  assert.deepEqual(await cancelOrder(order.id), { success: false, message: WEBSITE_ORDER_LOCKED });
  assert.deepEqual(await snapshot(order.id), before);
});

test('returnOrderItem refuses a website order and nothing changes', async () => {
  const { order, item, account, warehouse } = await seedOrder(REFERENCE);
  const before = await snapshot(order.id);

  const result = await returnOrderItem(
    {},
    form({ orderId: order.id, orderItemId: item.id, quantity: '1', accountId: account.id, warehouseId: warehouse.id }),
  );
  assert.equal(result.success, false);
  assert.equal(result.message, WEBSITE_ORDER_LOCKED);
  assert.deepEqual(await snapshot(order.id), before);
});

test('exchangeOrderItem refuses a website order and nothing changes', async () => {
  const { order, item, account, warehouse, other } = await seedOrder(REFERENCE);
  const before = await snapshot(order.id);

  const result = await exchangeOrderItem(
    {},
    form({
      orderId: order.id,
      originalItemId: item.id,
      exchangeProductId: other.id,
      quantity: '1',
      accountId: account.id,
      returnWarehouseId: warehouse.id,
      exchangeWarehouseId: warehouse.id,
    }),
  );
  assert.equal(result.success, false);
  assert.equal(result.message, WEBSITE_ORDER_LOCKED);
  assert.deepEqual(await snapshot(order.id), before);
});

test('a normal order can still be cancelled', async () => {
  const { order, account, warehouse, product } = await seedOrder(null);

  const result = await cancelOrder(order.id);
  assert.equal(result.success, true, result.message);

  const cancelled = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(cancelled.status, 'CANCELLED');
  assert.equal(cancelled.transactionId, null);
  const stock = await prisma.inventory.findUniqueOrThrow({
    where: { productId_warehouseId: { productId: product.id, warehouseId: warehouse.id } },
  });
  assert.equal(stock.quantity, 7);
  assert.equal(Number((await prisma.account.findUniqueOrThrow({ where: { id: account.id } })).balance), 0);
  assert.equal(await prisma.transaction.count(), 0);
});

test('an order that turns into a website order between the check and the claim is not cancelled', async () => {
  const { order } = await seedOrder(null);
  const before = await snapshot(order.id);
  beforeQuery.fn = async (params) => {
    if (params.model === 'Order' && params.action === 'updateMany') {
      beforeQuery.fn = null;
      await prisma.$executeRawUnsafe('UPDATE "Order" SET "siteReference" = $1 WHERE id = $2', REFERENCE, order.id);
    }
  };

  const result = await cancelOrder(order.id);
  assert.equal(result.success, false);
  assert.deepEqual(await snapshot(order.id), before);
});

test('getOrder and getOrders return the website reference, data and refunds', async () => {
  const { order, account } = await seedOrder(REFERENCE);
  const refundTx = await prisma.transaction.create({
    data: { type: 'EXPENSE', amount: FREIGHT, amountInToman: FREIGHT, accountId: account.id, category: 'Return' },
  });
  const at = new Date('2026-09-11T10:00:00.000Z');
  await prisma.siteRefund.create({ data: { orderId: order.id, refundId: 'RF-1', transactionId: refundTx.id, amount: FREIGHT, at } });
  const expected = { siteReference: REFERENCE, siteData, siteRefunds: [{ refundId: 'RF-1', amount: FREIGHT, at }] };

  const one = await getOrder(order.id);
  assert.deepEqual({ siteReference: one?.siteReference, siteData: one?.siteData, siteRefunds: one?.siteRefunds }, expected);

  const [listed] = await getOrders();
  assert.deepEqual({ siteReference: listed.siteReference, siteData: listed.siteData, siteRefunds: listed.siteRefunds }, expected);
});
