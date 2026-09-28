import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase } from '../helpers/db';
import { beforeQuery } from '../helpers/hooks';
import { setTestRole } from '../stubs/auth';
import { AccessDenied } from '@/lib/access';
import { createOrder, getOrder, getOrders, recordOrderPayment } from '@/actions/sales';
import { DUPLICATE_REQUEST_MESSAGE } from '@/lib/request-id';
import { INVALID_RECEIPT_MESSAGE } from '@/lib/receipt-ref';
import { DENIED, NON_SELLERS, NON_VIEWERS, SELLERS, VIEWERS, assertInvariants, balanceOf, openAccount, snapshot, stockIn } from './world';

// The actions log every refusal these tests provoke on purpose.
console.error = () => {};

const PRICE = 10_000_000;
const OPENING = 50_000_000;
const RECEIPT = 'ftp:/receipts/0f8fad5b-d9cb-469f-a165-70867728950e.pdf';

beforeEach(async () => {
  beforeQuery.fn = null;
  setTestRole('ADMIN');
  await resetDatabase();
});
after(() => prisma.$disconnect());

async function shop() {
  const store = await prisma.warehouse.create({ data: { name: 'مشاهیر' } });
  const frame = await prisma.product.create({ data: { name: 'PANJ', sku: 'PANJ', costPrice: 4_000_000, sellPrice: PRICE } });
  await stockIn(frame.id, store.id, 10);
  const customer = await prisma.customer.create({ data: { name: 'سارا' } });
  const bank = await openAccount('بانک سامان', { opening: OPENING });
  const till = await openAccount('صندوق', { type: 'CASH', opening: OPENING });
  const usd = await openAccount('حساب دلاری', { currency: 'USD', opening: 100 });
  const expense = await openAccount('هزینه تبلیغات', { type: 'EXPENSE' });
  return { store, frame, customer, bank, till, usd, expense };
}
type Shop = Awaited<ReturnType<typeof shop>>;

/** 2 frames, 2,000,000 off: 18,000,000 owed, `paid` of it into the bank at checkout. */
async function sale(s: Shop, paid: number) {
  const result = await createOrder({
    customerId: s.customer.id,
    items: [{ productId: s.frame.id, quantity: 2, price: PRICE }],
    paymentMethod: 'CASH',
    accountId: paid > 0 ? s.bank.id : '',
    totalAmount: 2 * PRICE,
    discount: 2_000_000,
    paidAmount: paid,
    warehouseId: s.store.id,
    saleDate: '2026-09-20T06:00:00.000Z',
  });
  assert.equal(result.success, true, result.message);
  return prisma.order.findFirstOrThrow({ orderBy: { number: 'desc' } });
}

const orderOf = (id: string) => prisma.order.findUniqueOrThrow({ where: { id } });

test('payments into two accounts after the checkout: PARTIAL until the discounted total is paid, then PAID', async () => {
  const shopData = await shop();
  const s = await sale(shopData, 3_000_000);

  assert.deepEqual(await recordOrderPayment(s.id, shopData.till.id, 5_000_000, 'pay-till-000001', RECEIPT), { success: true, message: 'پرداخت با موفقیت ثبت شد.' });
  let order = await orderOf(s.id);
  assert.deepEqual([Number(order.paidAmount), order.paymentStatus], [8_000_000, 'PARTIAL']);

  // More than the 10,000,000 left is refused and nothing moves.
  const before = await snapshot();
  const tooMuch = await recordOrderPayment(s.id, shopData.bank.id, 10_000_001);
  assert.equal(tooMuch.success, false);
  assert.match(tooMuch.message, /بیشتر از بدهی باقیمانده/);
  assert.deepEqual(await snapshot(), before);

  assert.equal((await recordOrderPayment(s.id, shopData.bank.id, 10_000_000)).success, true);
  order = await orderOf(s.id);
  assert.deepEqual([Number(order.paidAmount), order.paymentStatus], [18_000_000, 'PAID']);
  assert.deepEqual([await balanceOf(shopData.bank.id), await balanceOf(shopData.till.id)], [OPENING + 13_000_000, OPENING + 5_000_000]);

  const rows = await prisma.transaction.findMany({ where: { orderId: s.id, type: 'INCOME' }, orderBy: { createdAt: 'asc' } });
  assert.deepEqual(
    rows.map((row: any) => [row.type, Number(row.amountInToman), row.accountId, row.customerId, row.category]),
    [
      ['INCOME', 3_000_000, shopData.bank.id, shopData.customer.id, 'Sales'],
      ['INCOME', 5_000_000, shopData.till.id, shopData.customer.id, 'Sales'],
      ['INCOME', 10_000_000, shopData.bank.id, shopData.customer.id, 'Sales'],
    ],
  );
  assert.equal(rows[1].receiptUrl, RECEIPT);
  assert.equal(rows[1].clientRequestId, 'pay-till-000001');
  assert.match(rows[1].description ?? '', new RegExp(`سفارش #${order.number}`));

  // Nothing is left to pay.
  assert.equal((await recordOrderPayment(s.id, shopData.bank.id, 1)).success, false);

  // The order page lists every row that brought money in, oldest first.
  const detail = await getOrder(s.id);
  assert.deepEqual(detail!.received.map((row: any) => [row.amountInToman, row.accountName]), [
    [3_000_000, 'بانک سامان'],
    [5_000_000, 'صندوق'],
    [10_000_000, 'بانک سامان'],
  ]);
  assert.deepEqual([detail!.totalAmount, detail!.discount, detail!.paidAmount, detail!.isConsignmentSale], [2 * PRICE, 2_000_000, 18_000_000, false]);
  await assertInvariants();
});

test('an amount of 0, below 0 or not a number is refused, and so are an unknown order and an unknown account', async () => {
  const s = await shop();
  const order = await sale(s, 0);
  const before = await snapshot();
  for (const amount of [0, -5_000, Number.NaN]) {
    assert.deepEqual(await recordOrderPayment(order.id, s.bank.id, amount), { success: false, message: 'مبلغ پرداخت باید بیشتر از صفر باشد.' }, String(amount));
  }
  assert.deepEqual(await recordOrderPayment('no-such-order', s.bank.id, 1_000), { success: false, message: 'سفارش یافت نشد.' });
  assert.deepEqual(await recordOrderPayment(order.id, 'no-such-account', 1_000), { success: false, message: 'حساب دریافت وجه یافت نشد.' });
  assert.deepEqual(await recordOrderPayment(order.id, s.expense.id, 1_000), { success: false, message: 'حساب دریافت وجه باید از نوع بانک یا صندوق باشد.' });
  assert.deepEqual(await recordOrderPayment(order.id, s.bank.id, 1_000, undefined, 'not-a-receipt'), { success: false, message: INVALID_RECEIPT_MESSAGE });
  assert.deepEqual(await snapshot(), before);
});

test('a payment into the dollar account without any rate is refused and writes nothing; with one it moves amount ÷ rate', async () => {
  const s = await shop();
  const order = await sale(s, 0);
  const before = await snapshot();
  const refused = await recordOrderPayment(order.id, s.usd.id, 4_500_000);
  assert.deepEqual(refused, { success: false, message: 'نرخ تبدیل برای ارز USD یافت نشد. لطفا ابتدا نرخ امروز را وارد کنید.' });
  assert.deepEqual(await snapshot(), before);

  await prisma.exchangeRate.create({ data: { currency: 'USD', rateToToman: 90_000, date: new Date('2026-09-25') } });
  assert.equal((await recordOrderPayment(order.id, s.usd.id, 4_500_000)).success, true);
  assert.equal(await balanceOf(s.usd.id), 150);
  const row = await prisma.transaction.findFirstOrThrow({ where: { orderId: order.id, type: 'INCOME' } });
  assert.deepEqual([Number(row.amount), Number(row.amountInToman), Number(row.rateSnapshot), row.currency], [50, 4_500_000, 90_000, 'USD']);
  await assertInvariants();
});

test('the same payment sent again after it went through is booked once', async () => {
  const s = await shop();
  const order = await sale(s, 0);
  assert.equal((await recordOrderPayment(order.id, s.bank.id, 1_000_000, 'pay-again-00001')).message, 'پرداخت با موفقیت ثبت شد.');
  const before = await snapshot();
  assert.deepEqual(await recordOrderPayment(order.id, s.bank.id, 1_000_000, 'pay-again-00001'), { success: true, message: DUPLICATE_REQUEST_MESSAGE });
  assert.deepEqual(await snapshot(), before);
});

test('a payment that fails after its row is written leaves the order, the row and the account as they were', async () => {
  const s = await shop();
  const order = await sale(s, 0);
  const before = await snapshot();
  beforeQuery.fn = async (params) => {
    if (params.model === 'Order' && params.action === 'update') throw new Error('simulated failure');
  };
  const result = await recordOrderPayment(order.id, s.bank.id, 1_000_000);
  beforeQuery.fn = null;
  assert.equal(result.success, false);
  assert.deepEqual(await snapshot(), before);
});

test('only sales.manage records a payment; sales.view reads orders, and the rest are refused', async () => {
  const s = await shop();
  const order = await sale(s, 0);
  const before = await snapshot();
  for (const role of NON_SELLERS) {
    setTestRole(role);
    const result = await recordOrderPayment(order.id, s.bank.id, 1_000_000);
    assert.deepEqual([result.success, result.message], [false, DENIED], String(role));
  }
  assert.deepEqual(await snapshot(), before);
  for (const role of SELLERS) {
    setTestRole(role);
    assert.equal((await recordOrderPayment(order.id, s.bank.id, 1_000_000)).success, true, role);
  }
  for (const role of VIEWERS) {
    setTestRole(role);
    assert.equal((await getOrders()).length, 1, role);
    assert.equal((await getOrder(order.id))!.paidAmount, 3_000_000, role);
  }
  for (const role of NON_VIEWERS) {
    setTestRole(role);
    await assert.rejects(getOrders(), AccessDenied, String(role));
    await assert.rejects(getOrder(order.id), AccessDenied, String(role));
  }
});

test('the order list carries numbers, not Decimals, newest first, with each line and its warehouse', async () => {
  const s = await shop();
  const first = await sale(s, 18_000_000);
  const second = await sale(s, 0);
  await prisma.order.update({ where: { id: second.id }, data: { createdAt: new Date('2026-09-21T06:00:00.000Z') } });

  const orders = await getOrders();
  assert.deepEqual(orders.map((o: any) => o.id), [second.id, first.id]);
  const [latest] = orders;
  assert.deepEqual(
    [typeof latest.totalAmount, latest.totalAmount, latest.discount, latest.paidAmount, latest.paymentStatus, latest.customer?.name],
    ['number', 2 * PRICE, 2_000_000, 0, 'UNPAID', 'سارا'],
  );
  assert.deepEqual(latest.items.map((item: any) => [item.quantity, item.price, item.warehouse?.name]), [[2, PRICE, 'مشاهیر']]);
  assert.equal(await getOrder('no-such-order'), undefined);
});
