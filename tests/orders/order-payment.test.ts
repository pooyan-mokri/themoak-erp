import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase } from '../helpers/db';
import { beforeQuery } from '../helpers/hooks';
import { setTestRole } from '../stubs/auth';
import { cancelOrder, createOrder, recordOrderPayment } from '@/actions/sales';
import { createInvoiceFromOrder, recordInvoicePayment } from '@/actions/invoice';
import { DUPLICATE_REQUEST_MESSAGE } from '@/lib/request-id';
import { WEBSITE_ORDER_LOCKED } from '@/lib/site-sale-data';
import { OPENING, PRICE, STOCK, USD_OPENING, USD_RATE, balances, seedShop, stockOf, theOrder, type Shop } from './seed';

// The actions log every refusal these tests provoke on purpose.
console.error = () => {};

const REQUEST = 'pos-3f9c2a71-request';

beforeEach(async () => {
  beforeQuery.fn = null;
  setTestRole('ADMIN');
  await resetDatabase();
});
after(() => prisma.$disconnect());

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

function checkout(shop: Shop, fields: { paid: number; accountId?: string; discount?: number; requestId?: string }) {
  return createOrder({
    customerId: shop.customer.id,
    items: [{ productId: shop.product.id, quantity: 1, price: PRICE }],
    paymentMethod: 'CASH',
    accountId: fields.accountId ?? '',
    totalAmount: PRICE,
    discount: fields.discount,
    paidAmount: fields.paid,
    warehouseId: shop.warehouse.id,
    requestId: fields.requestId,
  });
}

/** A credit sale of PRICE, nothing paid yet. */
async function creditSale(shop: Shop) {
  const result = await checkout(shop, { paid: 0 });
  assert.equal(result.success, true, result.message);
  return theOrder();
}

/** Holds each payment's money row back a little, so concurrent calls really overlap. */
function slowMoneyRows() {
  beforeQuery.fn = async (params) => {
    if (params.model === 'Transaction' && params.action === 'create') await sleep(200);
  };
}

// --- recordOrderPayment ---

test('two concurrent payments with the same requestId book one row and move the balance once', async () => {
  const shop = await seedShop();
  const order = await creditSale(shop);
  slowMoneyRows();

  const results = await Promise.all([
    recordOrderPayment(order.id, shop.saman.id, 4_000_000, REQUEST),
    recordOrderPayment(order.id, shop.saman.id, 4_000_000, REQUEST),
  ]);
  beforeQuery.fn = null;

  for (const result of results) assert.equal(result.success, true, result.message);
  assert.deepEqual(results.map((r) => r.message).sort(), ['پرداخت با موفقیت ثبت شد.', DUPLICATE_REQUEST_MESSAGE].sort());
  const rows = await prisma.transaction.findMany({ where: { orderId: order.id } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].clientRequestId, REQUEST);
  assert.equal((await balances())['بانک سامان'], OPENING + 4_000_000);
  const paid = await theOrder(order.id);
  assert.equal(Number(paid.paidAmount), 4_000_000);
  assert.equal(paid.paymentStatus, 'PARTIAL');
});

test('two concurrent payments of the whole debt: the second sees the first under the lock and is refused', async () => {
  const shop = await seedShop();
  const order = await creditSale(shop);
  slowMoneyRows();

  const results = await Promise.all([
    recordOrderPayment(order.id, shop.saman.id, PRICE, 'pay-full-aaaaaaaa'),
    recordOrderPayment(order.id, shop.novin.id, PRICE, 'pay-full-bbbbbbbb'),
  ]);
  beforeQuery.fn = null;

  assert.deepEqual(results.map((r) => r.success).sort(), [false, true]);
  assert.equal(await prisma.transaction.count({ where: { orderId: order.id } }), 1);
  const paid = await theOrder(order.id);
  assert.equal(Number(paid.paidAmount), PRICE);
  assert.equal(paid.paymentStatus, 'PAID');
  const after = await balances();
  assert.equal(after['بانک سامان'] + after['اقتصاد نوین'], OPENING * 2 + PRICE);
});

test('a payment into the USD account moves it by amount ÷ rate, linked to the order and its customer', async () => {
  const shop = await seedShop();
  const order = await creditSale(shop);

  const result = await recordOrderPayment(order.id, shop.usd.id, 5_000_000);
  assert.equal(result.success, true, result.message);

  assert.equal((await balances())['حساب ذخیره دلاری'], USD_OPENING + 5_000_000 / USD_RATE);
  const [row] = await prisma.transaction.findMany({ where: { orderId: order.id } });
  assert.deepEqual(
    {
      type: row.type,
      amount: Number(row.amount),
      currency: row.currency,
      rate: Number(row.rateSnapshot),
      toman: Number(row.amountInToman),
      accountId: row.accountId,
      customerId: row.customerId,
    },
    { type: 'INCOME', amount: 50, currency: 'USD', rate: USD_RATE, toman: 5_000_000, accountId: shop.usd.id, customerId: shop.customer.id },
  );
  assert.equal(Number((await theOrder(order.id)).paidAmount), 5_000_000);
});

test('a payment on a cancelled order is refused and nothing changes', async () => {
  const shop = await seedShop();
  const order = await creditSale(shop);
  assert.equal((await cancelOrder(order.id)).success, true);
  const before = await balances();

  const result = await recordOrderPayment(order.id, shop.saman.id, 1_000_000);
  assert.deepEqual(result, { success: false, message: 'این سفارش لغو شده است و نمی‌توان برای آن پرداخت ثبت کرد.' });
  assert.equal(await prisma.transaction.count(), 0);
  assert.deepEqual(await balances(), before);
  assert.equal(Number((await theOrder(order.id)).paidAmount), 0);
});

test('a payment on a website order is refused and nothing changes', async () => {
  const shop = await seedShop();
  const order = await creditSale(shop);
  await prisma.order.update({ where: { id: order.id }, data: { siteReference: 'M-TLD3KJ' } });
  const before = await balances();

  assert.deepEqual(await recordOrderPayment(order.id, shop.saman.id, 1_000_000), { success: false, message: WEBSITE_ORDER_LOCKED });
  assert.equal(await prisma.transaction.count(), 0);
  assert.deepEqual(await balances(), before);
});

// --- createOrder (POS checkout) ---

test('a checkout that pays more than the total after discount is rejected and writes nothing', async () => {
  const shop = await seedShop();
  const before = await balances();

  const result = await checkout(shop, { paid: 9_500_000, discount: 1_000_000, accountId: shop.saman.id });
  assert.deepEqual(result, { success: false, message: 'مبلغ پرداختی نمی‌تواند بیشتر از مبلغ قابل پرداخت (پس از تخفیف) باشد.' });
  assert.equal(await prisma.order.count(), 0);
  assert.equal(await prisma.transaction.count(), 0);
  assert.deepEqual(await balances(), before);
  assert.equal(await stockOf(shop), STOCK);

  // Exactly the total after discount is fine.
  const paidInFull = await checkout(shop, { paid: 9_000_000, discount: 1_000_000, accountId: shop.saman.id });
  assert.equal(paidInFull.success, true, paidInFull.message);
  assert.equal((await theOrder()).paymentStatus, 'PAID');
});

test('a checkout with a negative paid amount is rejected: it would let «ثبت پرداخت» book more than the price', async () => {
  const shop = await seedShop();
  const before = await balances();

  const result = await checkout(shop, { paid: -1_000_000, accountId: shop.saman.id });
  assert.deepEqual(result, { success: false, message: 'مبلغ پرداختی نمی‌تواند منفی باشد.' });
  assert.equal(await prisma.order.count(), 0);
  assert.equal(await prisma.transaction.count(), 0);
  assert.deepEqual(await balances(), before);
  assert.equal(await stockOf(shop), STOCK);
});

test('order money goes to a bank or cash account only: an EXPENSE account is refused at checkout and in «ثبت پرداخت»', async () => {
  const shop = await seedShop();
  // cancelOrder never moves an EXPENSE account back, so money booked there would stay after a cancel.
  const expense = await prisma.account.create({ data: { name: 'Marketing Expenses', type: 'EXPENSE', currency: 'TOMAN', balance: 0 } });
  const message = 'حساب دریافت وجه باید از نوع بانک یا صندوق باشد.';

  assert.deepEqual(await checkout(shop, { paid: PRICE, accountId: expense.id }), { success: false, message });
  assert.equal(await prisma.order.count(), 0);

  const order = await creditSale(shop);
  assert.deepEqual(await recordOrderPayment(order.id, expense.id, 1_000_000), { success: false, message });
  assert.equal(await prisma.transaction.count(), 0);
  assert.equal(Number((await prisma.account.findUniqueOrThrow({ where: { id: expense.id } })).balance), 0);
  assert.equal(Number((await theOrder(order.id)).paidAmount), 0);
});

test('a checkout sent twice with the same requestId is one sale: one order, one income linked to it, stock taken once', async () => {
  const shop = await seedShop();

  const results = await Promise.all([
    checkout(shop, { paid: PRICE, accountId: shop.saman.id, requestId: REQUEST }),
    checkout(shop, { paid: PRICE, accountId: shop.saman.id, requestId: REQUEST }),
  ]);

  for (const result of results) assert.equal(result.success, true, result.message);
  assert.ok(results.some((r) => r.message === DUPLICATE_REQUEST_MESSAGE));
  const order = await theOrder();
  assert.equal(await prisma.order.count(), 1);
  const rows = await prisma.transaction.findMany();
  assert.deepEqual(
    rows.map((row: any) => [row.orderId, row.clientRequestId, Number(row.amount)]),
    [[order.id, REQUEST, PRICE]],
  );
  assert.equal(order.transactionId, rows[0].id);
  assert.equal((await balances())['بانک سامان'], OPENING + PRICE);
  assert.equal(await stockOf(shop), STOCK - 1);
});

// --- recordInvoicePayment ---

async function invoicedCreditSale(shop: Shop) {
  const order = await creditSale(shop);
  const invoiced = await createInvoiceFromOrder(order.id);
  assert.equal(invoiced.success, true, invoiced.message);
  return { order, invoiceId: (invoiced as { invoiceId: string }).invoiceId };
}

test('an invoice payment is the order payment: one row linked to the order, and the invoice follows the order', async () => {
  const shop = await seedShop();
  const { order, invoiceId } = await invoicedCreditSale(shop);

  const result = await recordInvoicePayment(invoiceId, 4_000_000, shop.saman.id);
  assert.equal(result.success, true, result.message);

  const rows = await prisma.transaction.findMany();
  assert.deepEqual(rows.map((row: any) => [row.orderId, row.accountId, Number(row.amount)]), [[order.id, shop.saman.id, 4_000_000]]);
  assert.equal((await balances())['بانک سامان'], OPENING + 4_000_000);
  const paid = await theOrder(order.id);
  assert.equal(Number(paid.paidAmount), 4_000_000);
  assert.equal(paid.paymentStatus, 'PARTIAL');
  const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  assert.equal(Number(invoice.paidAmount), 4_000_000);
  assert.equal(invoice.status, 'PARTIAL');
});

test('a payment already taken on the order is not taken again on its invoice', async () => {
  const shop = await seedShop();
  const { order, invoiceId } = await invoicedCreditSale(shop);
  assert.equal((await recordOrderPayment(order.id, shop.saman.id, PRICE)).success, true);
  const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  assert.equal(invoice.status, 'PAID');

  const result = await recordInvoicePayment(invoiceId, PRICE, shop.novin.id);
  assert.equal(result.success, false);
  assert.equal(await prisma.transaction.count(), 1);
  assert.equal((await balances())['اقتصاد نوین'], OPENING);
  assert.equal(Number((await theOrder(order.id)).paidAmount), PRICE);
});

test('an invoice payment that fails half way writes nothing at all', async () => {
  const shop = await seedShop();
  const { order, invoiceId } = await invoicedCreditSale(shop);
  beforeQuery.fn = async (params) => {
    if (params.model === 'Account' && params.action === 'update') throw new Error('simulated failure');
  };

  const result = await recordInvoicePayment(invoiceId, 4_000_000, shop.saman.id);
  beforeQuery.fn = null;

  assert.equal(result.success, false);
  assert.equal(await prisma.transaction.count(), 0);
  assert.equal((await balances())['بانک سامان'], OPENING);
  assert.equal(Number((await theOrder(order.id)).paidAmount), 0);
  const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  assert.equal(Number(invoice.paidAmount), 0);
});
