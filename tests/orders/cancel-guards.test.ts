import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { cancelOrder, createOrder, getCancelOrderPreview, recordOrderPayment } from '@/actions/sales';
import { deleteExpense } from '@/actions/accounting';
import { OPENING, PRICE, balances, seedShop, theOrder, type Shop } from './seed';

// The actions log every refusal these tests provoke on purpose.
console.error = () => {};

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
});
after(() => prisma.$disconnect());

async function sell(shop: Shop, paid: number, accountId = '') {
  const result = await createOrder({
    customerId: shop.customer.id,
    items: [{ productId: shop.product.id, quantity: 1, price: PRICE }],
    paymentMethod: 'CASH',
    accountId,
    totalAmount: PRICE,
    paidAmount: paid,
    warehouseId: shop.warehouse.id,
  });
  assert.equal(result.success, true, result.message);
  return prisma.order.findFirstOrThrow({ orderBy: { number: 'desc' } });
}

test('a payment the order-link backfill missed blocks the cancel, so it is not left booked', async () => {
  const shop = await seedShop();
  const order = await sell(shop, 1_000_000, shop.saman.id);
  // An older «ثبت پرداخت» row, as the old code wrote it: no orderId.
  await prisma.transaction.create({
    data: {
      type: 'INCOME', amount: 4_000_000, amountInToman: 4_000_000, currency: 'TOMAN', accountId: shop.saman.id,
      category: 'Sales', description: `دریافت بابت سفارش #${order.number} - مشتری: ${shop.customer.name}`,
    },
  });
  await prisma.account.update({ where: { id: shop.saman.id }, data: { balance: { increment: 4_000_000 } } });
  await prisma.order.update({ where: { id: order.id }, data: { paidAmount: 5_000_000 } });
  const before = await balances();

  const preview = await getCancelOrderPreview(order.id);
  assert.equal(preview.success, false);
  assert.match((preview as { message: string }).message, /نمی‌خواند/);

  const result = await cancelOrder(order.id);
  assert.equal(result.success, false);
  assert.match(result.message, /نمی‌خواند/);
  assert.deepEqual(await balances(), before);
  assert.notEqual((await theOrder(order.id)).status, 'CANCELLED');
  assert.equal(await prisma.transaction.count(), 2);
});

test('SALES may cancel a sale paid at checkout, but only an admin reverses a payment recorded later', async () => {
  const shop = await seedShop();
  setTestRole('SALES');

  const atCheckout = await sell(shop, PRICE, shop.saman.id);
  const cancelled = await cancelOrder(atCheckout.id);
  assert.equal(cancelled.success, true, cancelled.message);
  assert.equal((await balances())['بانک سامان'], OPENING);

  const later = await sell(shop, 0);
  const paid = await recordOrderPayment(later.id, shop.saman.id, 2_000_000);
  assert.equal(paid.success, true, paid.message);
  const before = await balances();

  const preview = await getCancelOrderPreview(later.id);
  assert.equal(preview.success, false);
  assert.match((preview as { message: string }).message, /فقط مدیر سیستم/);
  const refused = await cancelOrder(later.id);
  assert.equal(refused.success, false);
  assert.match(refused.message, /فقط مدیر سیستم/);
  assert.deepEqual(await balances(), before);

  setTestRole('ADMIN');
  const byAdmin = await cancelOrder(later.id);
  assert.equal(byAdmin.success, true, byAdmin.message);
  assert.equal((await balances())['بانک سامان'], OPENING);
});

test('an order payment cannot be deleted from the expense list', async () => {
  const shop = await seedShop();
  const order = await sell(shop, 0);
  const refund = await prisma.transaction.create({
    data: {
      type: 'EXPENSE', amount: 500_000, amountInToman: 500_000, currency: 'TOMAN', accountId: shop.saman.id,
      category: 'Return', description: 'بازپرداخت', orderId: order.id,
    },
  });
  const result = await deleteExpense(refund.id);
  assert.equal(result.success, false);
  assert.match(result.message ?? '', /پول یک سفارش/);
  assert.equal(await prisma.transaction.count({ where: { id: refund.id } }), 1);
});
