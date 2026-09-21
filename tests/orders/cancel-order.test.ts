import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { cancelOrder, createOrder, getCancelOrderPreview, recordOrderPayment } from '@/actions/sales';
import { OPENING, PRICE, STOCK, USD_OPENING, balances, seedShop, stockOf, theOrder, type Shop } from './seed';

// The actions log every refusal these tests provoke on purpose.
console.error = () => {};

const DENIED = 'شما به این بخش دسترسی ندارید.';
const RETURNED =
  'این سفارش مرجوعی یا تعویض ثبت‌شده دارد و قابل لغو نیست؛ به‌جای لغو، اقلام باقی‌ماندهٔ آن را مرجوع کنید.';
const PREVIEW_CHANGED =
  'پرداخت‌های این سفارش پس از نمایش پیغام تأیید تغییر کرده است و سفارش لغو نشد؛ دوباره «لغو» را بزنید تا مبالغ تازه را ببینید.';

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
});
after(() => prisma.$disconnect());

/** A POS sale of `quantity` × PRICE, `paid` of it into `accountId` at checkout. Returns the order. */
async function sell(shop: Shop, paid: number, accountId = '', quantity = 1) {
  const result = await createOrder({
    customerId: shop.customer.id,
    items: [{ productId: shop.product.id, quantity, price: PRICE }],
    paymentMethod: 'CASH',
    accountId,
    totalAmount: PRICE * quantity,
    paidAmount: paid,
    warehouseId: shop.warehouse.id,
  });
  assert.equal(result.success, true, result.message);
  return theOrder();
}

async function pay(orderId: string, accountId: string, amount: number) {
  const result = await recordOrderPayment(orderId, accountId, amount);
  assert.equal(result.success, true, result.message);
}

/** Everything a refused cancel must leave alone. */
async function snapshot() {
  return JSON.parse(
    JSON.stringify({
      orders: await prisma.order.findMany({ include: { items: true }, orderBy: { id: 'asc' } }),
      transactions: await prisma.transaction.findMany({ orderBy: { id: 'asc' } }),
      accounts: await prisma.account.findMany({ orderBy: { id: 'asc' } }),
      inventory: await prisma.inventory.findMany({ orderBy: [{ productId: 'asc' }, { warehouseId: 'asc' }] }),
      returns: await prisma.orderReturn.findMany({ orderBy: { id: 'asc' } }),
      exchanges: await prisma.orderExchange.findMany({ orderBy: { id: 'asc' } }),
    }),
  );
}

test('a credit sale paid later through «ثبت پرداخت» and then cancelled leaves every account as it was', async () => {
  const shop = await seedShop();
  const before = await balances();

  const order = await sell(shop, 0, '', 2);
  await pay(order.id, shop.saman.id, 3_000_000);
  assert.equal((await balances())['بانک سامان'], OPENING + 3_000_000);

  const result = await cancelOrder(order.id);
  assert.equal(result.success, true, result.message);

  assert.deepEqual(await balances(), before);
  assert.equal(await prisma.transaction.count(), 0);
  assert.equal(await stockOf(shop), STOCK);
  const cancelled = await theOrder(order.id);
  assert.equal(cancelled.status, 'CANCELLED');
  assert.equal(Number(cancelled.paidAmount), 0);
});

test('4M at checkout and 6M paid later, then cancelled: both accounts go back, as the confirm dialog said', async () => {
  const shop = await seedShop();
  const before = await balances();

  const order = await sell(shop, 4_000_000, shop.saman.id);
  await pay(order.id, shop.novin.id, 6_000_000);
  assert.equal((await theOrder(order.id)).paymentStatus, 'PAID');
  assert.equal((await balances())['بانک سامان'], OPENING + 4_000_000);
  assert.equal((await balances())['اقتصاد نوین'], OPENING + 6_000_000);

  const preview = await getCancelOrderPreview(order.id);
  assert.equal(preview.success, true);
  assert.deepEqual(
    preview.success && [...preview.accounts].sort((a, b) => a.label.localeCompare(b.label)),
    [
      { label: 'اقتصاد نوین (TOMAN) •••• 8888', currency: 'TOMAN', change: -6_000_000, rows: 1, moves: true },
      { label: 'بانک سامان (TOMAN)', currency: 'TOMAN', change: -4_000_000, rows: 1, moves: true },
    ],
  );

  // As order-list.tsx sends it: exactly the rows the dialog showed.
  const result = await cancelOrder(order.id, preview.success ? preview.moneyRowIds : []);
  assert.equal(result.success, true, result.message);
  assert.deepEqual(await balances(), before);
  assert.equal(await prisma.transaction.count(), 0);
  assert.equal(await stockOf(shop), STOCK);
});

test('a payment booked while the confirm dialog was open is not deleted: the cancel is refused and nothing changes', async () => {
  const shop = await seedShop();
  const before = await balances();
  const order = await sell(shop, 4_000_000, shop.saman.id);

  // The dialog shows only the 4M checkout...
  const preview = await getCancelOrderPreview(order.id);
  assert.equal(preview.success, true);
  assert.equal(preview.success && preview.accounts.length, 1);
  // ...then someone else takes 6M on the same order.
  await pay(order.id, shop.novin.id, 6_000_000);
  const changed = await snapshot();

  const refused = await cancelOrder(order.id, preview.success ? preview.moneyRowIds : []);
  assert.deepEqual(refused, { success: false, message: PREVIEW_CHANGED });
  assert.deepEqual(await snapshot(), changed);

  // A fresh preview shows both payments, and that cancel goes through.
  const fresh = await getCancelOrderPreview(order.id);
  assert.equal(fresh.success && fresh.accounts.length, 2);
  const result = await cancelOrder(order.id, fresh.success ? fresh.moneyRowIds : []);
  assert.equal(result.success, true, result.message);
  assert.deepEqual(await balances(), before);
});

test('a later payment into the USD account is taken back in dollars, to the cent', async () => {
  const shop = await seedShop();

  const order = await sell(shop, 0);
  // 3,333,333 Toman at 100,000 is 33.33333 USD: an inexact figure must still come back exactly.
  await pay(order.id, shop.usd.id, 3_333_333);
  assert.notEqual((await balances())['حساب ذخیره دلاری'], USD_OPENING);

  const result = await cancelOrder(order.id);
  assert.equal(result.success, true, result.message);
  const usd = await prisma.account.findUniqueOrThrow({ where: { id: shop.usd.id } });
  assert.equal(usd.balance.toString(), String(USD_OPENING));
});

test('a consignment order with two settlement rows is cancelled through their order link', async () => {
  const shop = await seedShop();
  const partner = await prisma.customer.create({ data: { name: 'همکار امانی', commissionRate: 10 } });
  const partnerWarehouse = await prisma.warehouse.create({ data: { name: 'انبار امانی همکار', isVirtual: true, customerId: partner.id } });
  await prisma.inventory.create({ data: { productId: shop.product.id, warehouseId: partnerWarehouse.id, quantity: 3 } });
  const cogsAccount = await prisma.account.create({ data: { name: 'بهای تمام‌شده کالای فروش‌رفته', type: 'EXPENSE', currency: 'TOMAN', balance: 0 } });
  const before = await balances();

  // As consignment.ts records it: 2 units sold from the partner's warehouse,
  // settled in two instalments, each carrying the order id.
  const order = await prisma.order.create({
    data: {
      customerId: partner.id,
      totalAmount: 18_000_000,
      paidAmount: 18_000_000,
      paymentStatus: 'PAID',
      status: 'COMPLETED',
      items: { create: [{ productId: shop.product.id, quantity: 2, price: PRICE, warehouseId: partnerWarehouse.id }] },
    },
  });
  await prisma.inventory.update({
    where: { productId_warehouseId: { productId: shop.product.id, warehouseId: partnerWarehouse.id } },
    data: { quantity: { decrement: 2 } },
  });
  const settle = async (accountId: string, amount: number, partial: boolean) => {
    const row = await prisma.transaction.create({
      data: {
        type: 'INCOME',
        amount,
        amountInToman: amount,
        accountId,
        customerId: partner.id,
        orderId: order.id,
        description: `تسویه فروش امانی - سفارش #${order.number}${partial ? ' (پرداخت جزئی)' : ''}`,
      },
    });
    await prisma.account.update({ where: { id: accountId }, data: { balance: { increment: amount } } });
    return row;
  };
  await settle(shop.saman.id, 5_000_000, true);
  const last = await settle(shop.novin.id, 13_000_000, false);
  await prisma.order.update({ where: { id: order.id }, data: { transactionId: last.id } });
  // Non-cash COGS on its EXPENSE account, whose balance consignment.ts never moves.
  await prisma.transaction.create({
    data: {
      type: 'EXPENSE',
      amount: 8_000_000,
      amountInToman: 8_000_000,
      accountId: cogsAccount.id,
      customerId: partner.id,
      orderId: order.id,
      category: 'COGS',
      description: `بهای تمام‌شده کالای فروش امانی - سفارش #${order.number}`,
    },
  });

  const preview = await getCancelOrderPreview(order.id);
  assert.equal(preview.success, true);
  assert.deepEqual(
    preview.success && [...preview.accounts].sort((a, b) => a.label.localeCompare(b.label)),
    [
      { label: 'اقتصاد نوین (TOMAN) •••• 8888', currency: 'TOMAN', change: -13_000_000, rows: 1, moves: true },
      { label: 'بانک سامان (TOMAN)', currency: 'TOMAN', change: -5_000_000, rows: 1, moves: true },
      { label: 'بهای تمام‌شده کالای فروش‌رفته (TOMAN)', currency: 'TOMAN', change: 0, rows: 1, moves: false },
    ],
  );

  const result = await cancelOrder(order.id);
  assert.equal(result.success, true, result.message);
  assert.deepEqual(await balances(), before);
  assert.equal(await prisma.transaction.count(), 0);
  const partnerStock = await prisma.inventory.findUniqueOrThrow({
    where: { productId_warehouseId: { productId: shop.product.id, warehouseId: partnerWarehouse.id } },
  });
  assert.equal(partnerStock.quantity, 3);
});

test('an order with a return is refused, says what to do instead, and nothing changes', async () => {
  const shop = await seedShop();
  const order = await sell(shop, PRICE * 2, shop.saman.id, 2);
  const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
  await prisma.orderReturn.create({
    data: { orderId: order.id, orderItemId: item.id, quantity: 1, refundAmount: 0, accountId: shop.saman.id },
  });
  const before = await snapshot();

  assert.deepEqual(await cancelOrder(order.id), { success: false, message: RETURNED });
  assert.deepEqual(await getCancelOrderPreview(order.id), { success: false, message: RETURNED });
  assert.deepEqual(await snapshot(), before);
});

test('an order with an exchange is refused too, and nothing changes', async () => {
  const shop = await seedShop();
  const order = await sell(shop, PRICE, shop.saman.id);
  const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
  const exchanged = await prisma.orderItem.create({
    data: { orderId: order.id, productId: shop.product.id, quantity: 1, price: PRICE, warehouseId: shop.warehouse.id },
  });
  await prisma.orderExchange.create({
    data: {
      orderId: order.id,
      originalItemId: item.id,
      exchangeItemId: exchanged.id,
      quantity: 1,
      priceDifference: 0,
      accountId: shop.saman.id,
    },
  });
  const before = await snapshot();

  assert.deepEqual(await cancelOrder(order.id), { success: false, message: RETURNED });
  assert.deepEqual(await snapshot(), before);
});

test('the cancel preview needs sales.manage, like the cancel', async () => {
  const shop = await seedShop();
  const order = await sell(shop, PRICE, shop.saman.id);

  for (const role of ['AUDITOR', 'WAREHOUSE', 'USER']) {
    setTestRole(role);
    assert.deepEqual(await getCancelOrderPreview(order.id), { success: false, error: DENIED, message: DENIED }, role);
  }
  setTestRole('SALES');
  assert.equal((await getCancelOrderPreview(order.id)).success, true);
});
