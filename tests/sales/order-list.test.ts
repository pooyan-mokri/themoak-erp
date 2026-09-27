import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { cancelOrder, createOrder, getOrders, recordOrderPayment } from '@/actions/sales';
import { filterOrders, orderExportRow, orderRemaining } from '@/lib/order-list';
import { openAccount, stockIn } from './world';

// The actions log every refusal these tests provoke on purpose.
console.error = () => {};

const PRICE = 10_000_000;

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
});
after(() => prisma.$disconnect());

/** Four orders over two days and two warehouses, one of them later cancelled. */
async function history() {
  const store = await prisma.warehouse.create({ data: { name: 'مشاهیر' } });
  const central = await prisma.warehouse.create({ data: { name: 'انبار مرکزی' } });
  const frame = await prisma.product.create({ data: { name: 'PANJ', sku: 'PANJ', costPrice: 1, sellPrice: PRICE } });
  await stockIn(frame.id, store.id, 10);
  await stockIn(frame.id, central.id, 10);
  const sara = await prisma.customer.create({ data: { name: 'سارا احمدی' } });
  const ali = await prisma.customer.create({ data: { name: 'Ali Rezaei' } });
  const bank = await openAccount('بانک');
  const sell = async (customerId: string, warehouseId: string, saleDate: string, discount: number, paid: number) => {
    const result = await createOrder({
      customerId,
      items: [{ productId: frame.id, quantity: 1, price: PRICE }],
      paymentMethod: 'CASH',
      accountId: paid > 0 ? bank.id : '',
      totalAmount: PRICE,
      discount,
      paidAmount: paid,
      warehouseId,
      saleDate,
    });
    assert.equal(result.success, true, result.message);
    return prisma.order.findFirstOrThrow({ orderBy: { number: 'desc' } });
  };
  // Tehran days: 1405/06/29 is 2026-09-20; 23:50 Tehran on it is 20:20 UTC.
  const paid = await sell(sara.id, store.id, '2026-09-20T05:00:00.000Z', 1_000_000, 9_000_000);
  const late = await sell(ali.id, central.id, '2026-09-20T20:20:00.000Z', 0, 4_000_000);
  const credit = await sell(sara.id, store.id, '2026-09-20T21:00:00.000Z', 2_000_000, 0); // 00:30 on the 21st in Tehran
  const cancelled = await sell(ali.id, store.id, '2026-09-21T08:00:00.000Z', 0, 0);
  assert.equal((await cancelOrder(cancelled.id)).success, true);
  return { store, central, paid, late, credit, cancelled, bank };
}

test('the list and its Excel export agree on what is left to pay: the discount is taken off, a cancelled order owes nothing', async () => {
  const h = await history();
  const orders = await getOrders();
  const byNumber = Object.fromEntries(orders.map((o: any) => [o.number, o]));

  assert.equal(orderRemaining(byNumber[h.paid.number]), 0);
  assert.equal(orderRemaining(byNumber[h.late.number]), 6_000_000);
  assert.equal(orderRemaining(byNumber[h.credit.number]), 8_000_000);
  assert.equal(orderRemaining(byNumber[h.cancelled.number]), 0);

  const rows = orders.map(orderExportRow);
  const row = (number: number) => rows.find((r: any) => r['شماره سفارش'] === number)!;
  assert.deepEqual(
    [row(h.credit.number)['مبلغ کل (تومان)'], row(h.credit.number)['تخفیف (تومان)'], row(h.credit.number)['مبلغ پرداختی (تومان)'], row(h.credit.number)['باقیمانده (تومان)']],
    [PRICE, 2_000_000, 0, 8_000_000],
  );
  assert.equal(row(h.paid.number)['باقیمانده (تومان)'], 0, 'a discounted order paid in full owes nothing');
  assert.deepEqual([row(h.cancelled.number)['باقیمانده (تومان)'], row(h.cancelled.number)['وضعیت سفارش']], [0, 'لغو شده']);
  assert.deepEqual([row(h.paid.number)['مشتری'], row(h.paid.number)['وضعیت پرداخت'], row(h.paid.number)['تعداد اقلام'], row(h.paid.number)['منبع']], ['سارا احمدی', 'پرداخت شده', 1, 'سیستم']);

  // Paying the rest moves both figures together.
  assert.equal((await recordOrderPayment(h.credit.id, h.bank.id, 8_000_000)).success, true);
  const paidUp = (await getOrders()).find((o: any) => o.id === h.credit.id)!;
  assert.deepEqual([orderRemaining(paidUp), orderExportRow(paidUp)['باقیمانده (تومان)'], orderExportRow(paidUp)['وضعیت پرداخت']], [0, 0, 'پرداخت شده']);
});

test('the filters keep Tehran calendar days, the customer by part of the name, the status, the amount after discount and the warehouse', async () => {
  process.env.TZ = 'Asia/Tehran';
  const h = await history();
  const orders = await getOrders();
  const numbers = (list: any[]) => list.map((o) => o.number).sort((a, b) => a - b);

  // 20 Sept in Tehran: the morning sale and the one at 23:50, not the one at 00:30 on the 21st.
  const day = new Date('2026-09-20T12:00:00+03:30');
  assert.deepEqual(numbers(filterOrders(orders, { from: day, to: day })), [h.paid.number, h.late.number]);
  assert.deepEqual(numbers(filterOrders(orders, { from: new Date('2026-09-21T12:00:00+03:30') })), [h.credit.number, h.cancelled.number]);

  assert.deepEqual(numbers(filterOrders(orders, { customer: 'سارا' })), [h.paid.number, h.credit.number]);
  assert.deepEqual(numbers(filterOrders(orders, { customer: 'ali' })), [h.late.number, h.cancelled.number], 'case does not matter');
  assert.deepEqual(numbers(filterOrders(orders, { paymentStatus: 'PARTIAL' })), [h.late.number]);
  // After the discount: 9,000,000 and 8,000,000 are below 9,500,000; the two undiscounted ones are not.
  assert.deepEqual(numbers(filterOrders(orders, { maxAmount: '9500000' })), [h.paid.number, h.credit.number]);
  assert.deepEqual(numbers(filterOrders(orders, { minAmount: '9000000', maxAmount: '9000000' })), [h.paid.number]);
  assert.deepEqual(numbers(filterOrders(orders, { warehouse: h.central.id })), [h.late.number]);
  assert.deepEqual(numbers(filterOrders(orders, { paymentStatus: 'all', warehouse: 'all' })), numbers(orders));
});
