import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase, form } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { AccessDenied } from '@/lib/access';
import { getOrderMoney, returnOrderItem } from '@/actions/order-return';
import { exchangeOrderItem } from '@/actions/order-exchange';
import { DUPLICATE_REQUEST_MESSAGE } from '@/lib/request-id';
import { CASH_CHANGED_MESSAGE, lineValue, receivableNow, returnChange } from '@/lib/return-math';

// The actions log every refusal these tests provoke on purpose.
console.error = () => {};

const PRICE = 1_000_000;
const PRICIER = 1_600_000;
const CHEAPER = 700_000;

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
});
after(() => prisma.$disconnect());

/** A shop with three frames in stock, a till and a bank, and a sale of 2 × PRICE of which `paid` came in at the till. */
async function sale(paid: number) {
  const warehouse = await prisma.warehouse.create({ data: { name: 'مشاهیر' } });
  const frame = await prisma.product.create({ data: { name: 'PANJ', sku: 'PANJ', costPrice: 1, sellPrice: PRICE } });
  const pricier = await prisma.product.create({ data: { name: 'HAFT', sku: 'HAFT', costPrice: 1, sellPrice: PRICIER } });
  const cheaper = await prisma.product.create({ data: { name: 'YEK', sku: 'YEK', costPrice: 1, sellPrice: CHEAPER } });
  await prisma.inventory.createMany({
    data: [frame, pricier, cheaper].map((p) => ({ productId: p.id, warehouseId: warehouse.id, quantity: 10 })),
  });
  const till = await prisma.account.create({ data: { name: 'صندوق', type: 'CASH', currency: 'TOMAN', balance: paid } });
  const bank = await prisma.account.create({ data: { name: 'بانک', type: 'BANK', currency: 'TOMAN', balance: 0 } });
  const customer = await prisma.customer.create({ data: { name: 'سارا' } });
  const checkout = paid > 0
    ? await prisma.transaction.create({
        data: { type: 'INCOME', amount: paid, amountInToman: paid, accountId: till.id, customerId: customer.id, category: 'Sales' },
      })
    : null;
  const order = await prisma.order.create({
    data: {
      customerId: customer.id,
      totalAmount: PRICE * 2,
      paidAmount: paid,
      paymentStatus: paid >= PRICE * 2 ? 'PAID' : paid > 0 ? 'PARTIAL' : 'UNPAID',
      status: 'COMPLETED',
      transactionId: checkout?.id,
      items: { create: [{ productId: frame.id, quantity: 2, price: PRICE, warehouseId: warehouse.id }] },
    },
    include: { items: true },
  });
  return { warehouse, frame, pricier, cheaper, till, bank, customer, order, item: order.items[0] };
}
type Sale = Awaited<ReturnType<typeof sale>>;

const giveBack = (s: Sale, fields: Record<string, string> = {}) =>
  returnOrderItem(
    {},
    form({ orderId: s.order.id, orderItemId: s.item.id, quantity: '1', accountId: s.till.id, warehouseId: s.warehouse.id, ...fields }),
  );

const swap = (s: Sale, productId: string, fields: Record<string, string> = {}) =>
  exchangeOrderItem(
    {},
    form({
      orderId: s.order.id,
      originalItemId: s.item.id,
      exchangeProductId: productId,
      quantity: '1',
      accountId: s.till.id,
      returnWarehouseId: s.warehouse.id,
      exchangeWarehouseId: s.warehouse.id,
      ...fields,
    }),
  );

const orderNow = async (s: Sale) => {
  const o = await prisma.order.findUniqueOrThrow({ where: { id: s.order.id } });
  return { total: Number(o.totalAmount), paid: Number(o.paidAmount), status: o.paymentStatus };
};
const balance = async (id: string) => Number((await prisma.account.findUniqueOrThrow({ where: { id } })).balance);
/** Every money row except the sale's own checkout row. */
const newRows = async (s: Sale) =>
  (await prisma.transaction.findMany({ where: { id: { not: s.order.transactionId ?? '' } }, orderBy: { createdAt: 'asc' } })).map(
    (t: any) => ({ type: t.type, amount: Number(t.amount), accountId: t.accountId, orderId: t.orderId }),
  );

test('an exchange to a pricier item on an unpaid order books no income and raises the debt', async () => {
  const s = await sale(0);

  const result = await swap(s, s.pricier.id);
  assert.equal(result.success, true, result.message);

  assert.deepEqual(await newRows(s), []);
  assert.equal(await balance(s.till.id), 0);
  // The customer now owes the difference on the order.
  assert.deepEqual(await orderNow(s), { total: PRICE * 2 + (PRICIER - PRICE), paid: 0, status: 'UNPAID' });
  const exchange = await prisma.orderExchange.findFirstOrThrow();
  assert.equal(Number(exchange.priceDifference), PRICIER - PRICE);
  assert.equal(exchange.transactionId, null);
});

test('only the amount received now is booked, into the chosen account and on the order; the rest stays owed', async () => {
  const s = await sale(PRICE * 2);

  const tooMuch = await swap(s, s.pricier.id, { receivedNow: String(PRICIER - PRICE + 1), accountId: s.bank.id });
  assert.equal(tooMuch.success, false);
  assert.equal(tooMuch.message, 'مبلغ دریافتی نمی‌تواند بیشتر از مابه‌التفاوت باشد.');
  assert.equal(await prisma.orderExchange.count(), 0);

  const result = await swap(s, s.pricier.id, { receivedNow: '250000', accountId: s.bank.id });
  assert.equal(result.success, true, result.message);

  assert.deepEqual(await newRows(s), [{ type: 'INCOME', amount: 250_000, accountId: s.bank.id, orderId: s.order.id }]);
  assert.equal(await balance(s.bank.id), 250_000);
  assert.deepEqual(await orderNow(s), { total: PRICE * 2 + 600_000, paid: PRICE * 2 + 250_000, status: 'PARTIAL' });
});

test('a cheaper exchange pays cash back only when the cashier chooses it; otherwise the payment stays as credit', async () => {
  const kept = await sale(PRICE * 2);
  const credit = await swap(kept, kept.cheaper.id);
  assert.equal(credit.success, true, credit.message);
  assert.deepEqual(await newRows(kept), []);
  assert.equal(await balance(kept.till.id), PRICE * 2);
  // Still everything the customer paid: 300,000 of it is now their credit on the order.
  assert.deepEqual(await orderNow(kept), { total: PRICE + CHEAPER, paid: PRICE * 2, status: 'PAID' });

  await resetDatabase();
  const refunded = await sale(PRICE * 2);
  const result = await swap(refunded, refunded.cheaper.id, { refundNow: '1' });
  assert.equal(result.success, true, result.message);
  assert.deepEqual(await newRows(refunded), [
    { type: 'EXPENSE', amount: PRICE - CHEAPER, accountId: refunded.till.id, orderId: refunded.order.id },
  ]);
  assert.equal(await balance(refunded.till.id), PRICE * 2 - (PRICE - CHEAPER));
  assert.deepEqual(await orderNow(refunded), { total: PRICE + CHEAPER, paid: PRICE + CHEAPER, status: 'PAID' });
});

test('a pricier exchange on an order holding the customer\'s credit takes the credit first; cash only for what is still owed', async () => {
  const s = await sale(PRICE * 2);
  // A cheaper swap kept as credit: 300,000 of the 2,000,000 paid is now the customer's credit.
  assert.equal((await swap(s, s.cheaper.id)).success, true);

  // The other frame for the dearer one: 600,000 more, of which the credit covers 300,000.
  // The dialog caps what it collects at the same figure.
  assert.equal(receivableNow((await getOrderMoney(s.order.id))!, PRICIER - PRICE), 300_000);
  const tooMuch = await swap(s, s.pricier.id, { receivedNow: String(PRICIER - PRICE), accountId: s.bank.id });
  assert.equal(tooMuch.success, false);
  assert.equal(await prisma.orderExchange.count(), 1);
  assert.equal(await balance(s.bank.id), 0);

  const result = await swap(s, s.pricier.id, { receivedNow: '300000', accountId: s.bank.id });
  assert.equal(result.success, true, result.message);
  assert.deepEqual(await newRows(s), [{ type: 'INCOME', amount: 300_000, accountId: s.bank.id, orderId: s.order.id }]);
  assert.deepEqual(await orderNow(s), { total: CHEAPER + PRICIER, paid: CHEAPER + PRICIER, status: 'PAID' });
});

test('a return pays back only what was paid beyond the new total, on the order, exactly as the dialog computes it', async () => {
  const s = await sale(1_500_000);

  // What the dialog shows: the order's money from getOrderMoney, through the same function.
  const money = (await getOrderMoney(s.order.id))!;
  const shown = returnChange(money, lineValue(money, PRICE, 1));
  assert.equal(shown.cashOut, 500_000);

  const result = await giveBack(s, { expectedCash: String(shown.cashOut) });
  assert.equal(result.success, true, result.message);
  assert.deepEqual(await newRows(s), [{ type: 'EXPENSE', amount: shown.cashOut, accountId: s.till.id, orderId: s.order.id }]);
  assert.equal(await balance(s.till.id), 1_500_000 - shown.cashOut);
  assert.deepEqual(await orderNow(s), { total: shown.newTotal, paid: shown.newPaid, status: shown.paymentStatus });

  // Unpaid: nothing moves, the debt shrinks.
  await resetDatabase();
  const unpaid = await sale(0);
  const money0 = (await getOrderMoney(unpaid.order.id))!;
  assert.equal(returnChange(money0, lineValue(money0, PRICE, 1)).cashOut, 0);
  assert.equal((await giveBack(unpaid, { expectedCash: '0' })).success, true);
  assert.deepEqual(await newRows(unpaid), []);
  assert.deepEqual(await orderNow(unpaid), { total: PRICE, paid: 0, status: 'UNPAID' });
});

test('the server refuses when its cash differs from what the dialog showed, and writes nothing', async () => {
  const s = await sale(PRICE * 2);
  // The dialog was opened while the order was unpaid; a payment came in since.
  const result = await giveBack(s, { expectedCash: '0' });
  assert.equal(result.success, false);
  assert.equal(result.message, CASH_CHANGED_MESSAGE);
  assert.deepEqual(await newRows(s), []);
  assert.equal(await prisma.orderReturn.count(), 0);
  assert.deepEqual(await orderNow(s), { total: PRICE * 2, paid: PRICE * 2, status: 'PAID' });
});

test('a return or an exchange submitted twice with the same requestId is booked once', async () => {
  const s = await sale(PRICE * 2);

  const first = await giveBack(s, { requestId: 'return-request-0001' });
  assert.equal(first.success, true, first.message);
  const again = await giveBack(s, { requestId: 'return-request-0001' });
  assert.deepEqual(again, { message: DUPLICATE_REQUEST_MESSAGE, success: true });
  assert.equal(await prisma.orderReturn.count(), 1);
  assert.deepEqual(await newRows(s), [{ type: 'EXPENSE', amount: PRICE, accountId: s.till.id, orderId: s.order.id }]);
  assert.equal(await balance(s.till.id), PRICE);
  const stock = await prisma.inventory.findUniqueOrThrow({
    where: { productId_warehouseId: { productId: s.frame.id, warehouseId: s.warehouse.id } },
  });
  assert.equal(stock.quantity, 11);

  const swapped = await swap(s, s.pricier.id, { receivedNow: '600000', requestId: 'exchange-request-01' });
  assert.equal(swapped.success, true, swapped.message);
  const swappedAgain = await swap(s, s.pricier.id, { receivedNow: '600000', requestId: 'exchange-request-01' });
  assert.deepEqual(swappedAgain, { message: DUPLICATE_REQUEST_MESSAGE, success: true });
  assert.equal(await prisma.orderExchange.count(), 1);
  assert.equal((await prisma.transaction.findMany({ where: { type: 'INCOME', orderId: s.order.id } })).length, 1);
  assert.equal(await balance(s.till.id), PRICE + 600_000);
});

test('getOrderMoney offers the account the sale was paid into, and needs sales.view', async () => {
  const s = await sale(PRICE);
  assert.deepEqual(await getOrderMoney(s.order.id), {
    totalAmount: PRICE * 2,
    discount: 0,
    paidAmount: PRICE,
    commissionRate: 0,
    saleAccountId: s.till.id,
  });

  // Paid later through «ثبت پرداخت», with no checkout row: that payment's account.
  await prisma.order.update({ where: { id: s.order.id }, data: { transactionId: null } });
  await prisma.transaction.create({
    data: { type: 'INCOME', amount: 1, amountInToman: 1, accountId: s.bank.id, orderId: s.order.id, category: 'Sales' },
  });
  assert.equal((await getOrderMoney(s.order.id))!.saleAccountId, s.bank.id);

  setTestRole('WAREHOUSE');
  await assert.rejects(getOrderMoney(s.order.id), AccessDenied);
});
