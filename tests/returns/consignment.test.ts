import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase, form } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import {
  deleteConsignmentOrder,
  getPartnerStatement,
  getPendingSettlements,
  paySettlement,
  recordConsignmentSales,
} from '@/actions/consignment';
import { getConsignmentCommissionsReport } from '@/actions/consignment-commissions';
import { returnOrderItem } from '@/actions/order-return';
import { exchangeOrderItem } from '@/actions/order-exchange';
import { DUPLICATE_REQUEST_MESSAGE } from '@/lib/request-id';

// The actions log every refusal these tests provoke on purpose.
console.error = () => {};

const COST = 300_000;
const PRICE = 1_000_000;
const DAY = '2026-07-20';

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
});
after(() => prisma.$disconnect());

/** A partner on 10% commission holding 5 frames, and a bank, a till and a dollar account. */
async function partner() {
  const customer = await prisma.customer.create({ data: { name: 'همکار', commissionRate: 10 } });
  const warehouse = await prisma.warehouse.create({ data: { name: 'انبار امانی - همکار', isVirtual: true, customerId: customer.id } });
  const frame = await prisma.product.create({ data: { name: 'PANJ', sku: 'PANJ', costPrice: COST, sellPrice: PRICE } });
  const other = await prisma.product.create({ data: { name: 'HAFT', sku: 'HAFT', costPrice: COST, sellPrice: PRICE } });
  await prisma.inventory.createMany({
    data: [
      { productId: frame.id, warehouseId: warehouse.id, quantity: 5 },
      { productId: other.id, warehouseId: warehouse.id, quantity: 5 },
    ],
  });
  const bank = await prisma.account.create({ data: { name: 'بانک', type: 'BANK', currency: 'TOMAN', balance: 0 } });
  const till = await prisma.account.create({ data: { name: 'صندوق', type: 'CASH', currency: 'TOMAN', balance: 0 } });
  const dollars = await prisma.account.create({ data: { name: 'دلار', type: 'CASH', currency: 'USD', balance: 0 } });
  const expenses = await prisma.account.create({ data: { name: 'هزینه‌ها', type: 'EXPENSE', currency: 'TOMAN', balance: 0 } });
  return { customer, warehouse, frame, other, bank, till, dollars, expenses };
}
type Partner = Awaited<ReturnType<typeof partner>>;

/** The partner reports `quantity` frames sold at PRICE on DAY. */
async function report(p: Partner, quantity: number, extra: { requestId?: string; confirmRepeat?: boolean; productId?: string } = {}) {
  return recordConsignmentSales({
    partnerWarehouseId: p.warehouse.id,
    saleDate: DAY,
    items: [{ productId: extra.productId ?? p.frame.id, quantity, unitPrice: PRICE }],
    requestId: extra.requestId,
    confirmRepeat: extra.confirmRepeat,
  });
}

const theOrder = () =>
  prisma.order.findFirstOrThrow({ include: { items: true, commissions: true } });
const balance = async (id: string) => Number((await prisma.account.findUniqueOrThrow({ where: { id } })).balance);
const stockAtPartner = async (p: Partner, productId = p.frame.id) =>
  (await prisma.inventory.findUniqueOrThrow({ where: { productId_warehouseId: { productId, warehouseId: p.warehouse.id } } })).quantity;

/** Returns one frame of the order to the partner's warehouse. */
async function returnOne(p: Partner, accountId = p.bank.id) {
  const order = await theOrder();
  const result = await returnOrderItem(
    {},
    form({ orderId: order.id, orderItemId: order.items[0].id, quantity: '1', accountId, warehouseId: p.warehouse.id }),
  );
  assert.equal(result.success, true, result.message);
}

test('a partial return makes the settlement remaining 900,000, not 1,920,000, and paying it keeps the sale amount', async () => {
  const p = await partner();
  assert.equal((await report(p, 2)).success, true);
  await returnOne(p);

  // 1 frame still sold: 1,000,000 gross − 10% = 900,000. The old arithmetic
  // took the gross refund off the net total and shrank the commission record,
  // so the list pre-filled 2,000,000 − 80,000 = 1,920,000.
  const [pending] = await getPendingSettlements();
  assert.deepEqual(
    [pending.grossAmount, pending.commissionAmount, pending.totalAmount, pending.remainingAmount, pending.items[0].soldQuantity],
    [PRICE, PRICE * 0.1, 900_000, 900_000, 1],
  );
  const order = await theOrder();
  assert.equal(Number(order.totalAmount), 900_000);
  assert.deepEqual([Number(order.commissions[0].orderAmount), Number(order.commissions[0].commissionAmount)], [PRICE, PRICE * 0.1]);
  assert.equal((await getConsignmentCommissionsReport()).grandTotal, 900_000);
  assert.equal((await getPartnerStatement(p.warehouse.id))!.financials.balance, 900_000);

  // No amount: the remaining is paid, into the bank, on the order.
  const paid = await paySettlement(undefined, form({ orderId: order.id, accountId: p.bank.id }));
  assert.equal(paid.success, true, paid.message);
  const income = await prisma.transaction.findFirstOrThrow({ where: { type: 'INCOME' } });
  assert.deepEqual([Number(income.amount), income.accountId, income.orderId], [900_000, p.bank.id, order.id]);
  assert.equal(await balance(p.bank.id), 900_000);
  const settled = await theOrder();
  assert.deepEqual([Number(settled.totalAmount), Number(settled.paidAmount), settled.paymentStatus], [900_000, 900_000, 'PAID']);
});

test('a settlement lands only on a bank or cash account, converted into that account currency', async () => {
  const p = await partner();
  await report(p, 1);
  const order = await theOrder();

  const toExpense = await paySettlement(undefined, form({ orderId: order.id, accountId: p.expenses.id }));
  assert.equal(toExpense.message, 'حساب مقصد باید از نوع بانک یا صندوق باشد.');
  const noRate = await paySettlement(undefined, form({ orderId: order.id, accountId: p.dollars.id }));
  assert.equal(noRate.success, undefined);
  assert.equal(await prisma.transaction.count({ where: { type: 'INCOME' } }), 0);

  await prisma.exchangeRate.create({ data: { currency: 'USD', rateToToman: 100_000, date: new Date('2026-07-19') } });
  const paid = await paySettlement(undefined, form({ orderId: order.id, accountId: p.dollars.id }));
  assert.equal(paid.success, true, paid.message);
  const income = await prisma.transaction.findFirstOrThrow({ where: { type: 'INCOME' } });
  assert.deepEqual(
    [income.currency, Number(income.amount), Number(income.amountInToman), Number(income.rateSnapshot)],
    ['USD', 9, 900_000, 100_000],
  );
  assert.equal(await balance(p.dollars.id), 9);
});

test('an exchange on a consignment sale moves the order total and the settlement together, net of commission', async () => {
  const p = await partner();
  await report(p, 2);
  const dearer = await prisma.product.create({ data: { name: 'NOH', sku: 'NOH', costPrice: COST, sellPrice: 1_500_000 } });
  await prisma.inventory.create({ data: { productId: dearer.id, warehouseId: p.warehouse.id, quantity: 1 } });
  const order = await theOrder();

  const result = await exchangeOrderItem(
    {},
    form({
      orderId: order.id,
      originalItemId: order.items[0].id,
      exchangeProductId: dearer.id,
      quantity: '1',
      accountId: p.bank.id,
      returnWarehouseId: p.warehouse.id,
      exchangeWarehouseId: p.warehouse.id,
    }),
  );
  assert.equal(result.success, true, result.message);

  // Still sold: 1 × 1,000,000 + 1 × 1,500,000 gross; we are owed 90% of it and nothing was collected.
  const after = await theOrder();
  assert.equal(Number(after.totalAmount), 2_500_000 * 0.9);
  assert.deepEqual([Number(after.commissions[0].orderAmount), Number(after.commissions[0].commissionAmount)], [2_500_000, 250_000]);
  assert.equal((await getPendingSettlements())[0].remainingAmount, 2_500_000 * 0.9);
  assert.equal(await prisma.transaction.count({ where: { accountId: p.bank.id } }), 0);
});

test('a cancelled consignment order cannot be paid from a stale settlement list', async () => {
  const p = await partner();
  await report(p, 1);
  const order = await theOrder();
  await prisma.order.update({ where: { id: order.id }, data: { status: 'CANCELLED' } });

  const result = await paySettlement(undefined, form({ orderId: order.id, accountId: p.bank.id }));
  assert.equal(result.message, 'این سفارش لغو شده است و نمی‌توان برای آن پرداخت ثبت کرد.');
  assert.equal(await prisma.transaction.count({ where: { type: 'INCOME' } }), 0);
  assert.equal(await balance(p.bank.id), 0);
});

test('a settlement payment submitted twice with the same requestId is booked once', async () => {
  const p = await partner();
  await report(p, 1);
  const order = await theOrder();
  const pay = () => paySettlement(undefined, form({ orderId: order.id, accountId: p.bank.id, amount: '300000', requestId: 'settle-request-01' }));

  assert.equal((await pay()).success, true);
  assert.deepEqual(await pay(), { message: DUPLICATE_REQUEST_MESSAGE, success: true });
  assert.equal(await prisma.transaction.count({ where: { type: 'INCOME' } }), 1);
  assert.equal(await balance(p.bank.id), 300_000);
  assert.equal(Number((await theOrder()).paidAmount), 300_000);
});

test('deleting a consignment order reverses every money row linked to it, payments from «ثبت پرداخت» and the POS included', async () => {
  const p = await partner();
  await report(p, 2);
  const order = await theOrder();

  // A settlement payment, a payment through «ثبت پرداخت» (linked by orderId
  // only: no customer, no order number in its text) and a POS checkout row
  // (linked only as the order's transactionId).
  assert.equal((await paySettlement(undefined, form({ orderId: order.id, accountId: p.bank.id, amount: '1000000' }))).success, true);
  await prisma.transaction.create({
    data: { type: 'INCOME', amount: 500_000, amountInToman: 500_000, accountId: p.till.id, orderId: order.id, description: 'دریافت از همکار', category: 'Sales' },
  });
  const pos = await prisma.transaction.create({
    data: { type: 'INCOME', amount: 300_000, amountInToman: 300_000, accountId: p.bank.id, description: 'سفارش فروش - مشتری: همکار', category: 'Sales' },
  });
  await prisma.account.update({ where: { id: p.till.id }, data: { balance: { increment: 500_000 } } });
  await prisma.account.update({ where: { id: p.bank.id }, data: { balance: { increment: 300_000 } } });
  await prisma.order.update({
    where: { id: order.id },
    data: { transactionId: pos.id, paidAmount: 1_800_000, paymentStatus: 'PAID' },
  });

  // Then a frame comes back: 900,000 of the 1,800,000 paid goes back from the till.
  await returnOne(p, p.till.id);
  assert.equal(await balance(p.till.id), 500_000 - 900_000);
  assert.equal(await stockAtPartner(p), 4);

  // Deleting recorded money is for an admin.
  setTestRole('SALES');
  const refused = await deleteConsignmentOrder(order.id);
  assert.equal(refused.success, undefined);
  assert.match(refused.message ?? '', /فقط مدیر سیستم/);
  assert.equal(await prisma.order.count(), 1);

  setTestRole('ADMIN');
  const deleted = await deleteConsignmentOrder(order.id);
  assert.equal(deleted.success, true, deleted.message);

  assert.equal(await prisma.order.count(), 0);
  assert.equal(await prisma.transaction.count(), 0);
  assert.deepEqual([await balance(p.bank.id), await balance(p.till.id)], [0, 0]);
  // The two sold frames are back: one by the return, one by the delete.
  assert.equal(await stockAtPartner(p), 5);
});

test('deleting a consignment order waits for a payment in flight on it and reverses that payment too', async () => {
  const p = await partner();
  await report(p, 1);
  const order = await theOrder();

  let deletion!: ReturnType<typeof deleteConsignmentOrder>;
  await prisma.$transaction(
    async (tx: any) => {
      // A settlement payment holding the order row, as paySettlement does, while the delete starts.
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${order.id} FOR UPDATE`;
      deletion = deleteConsignmentOrder(order.id);
      await new Promise((resolve) => setTimeout(resolve, 500));
      await tx.transaction.create({
        data: {
          type: 'INCOME', amount: 400_000, amountInToman: 400_000, accountId: p.bank.id, orderId: order.id,
          description: `تسویه فروش امانی - سفارش #${order.number} (پرداخت جزئی)`,
        },
      });
      await tx.account.update({ where: { id: p.bank.id }, data: { balance: { increment: 400_000 } } });
      await tx.order.update({ where: { id: order.id }, data: { paidAmount: 400_000, paymentStatus: 'PARTIAL' } });
    },
    { timeout: 20_000 },
  );

  const deleted = await deletion;
  assert.equal(deleted.success, true, deleted.message);
  // Not left behind with its order gone: the payment is reversed with the rest.
  assert.equal(await prisma.transaction.count(), 0);
  assert.equal(await balance(p.bank.id), 0);
});

test('deleting a consignment order reverses its older unlinked rows in the app wording, and leaves a cost typed by hand alone', async () => {
  const p = await partner();
  await report(p, 2);
  const order = await theOrder();

  // Written before rows carried orderId:
  // - a payment through «ثبت پرداخت», with no customer on the row, into the bank;
  // - a settlement the old modal let land on an EXPENSE account, whose balance it raised;
  // - a courier cost typed by hand that names the order: money that moved for its own reason.
  await prisma.transaction.createMany({
    data: [
      { type: 'INCOME', amount: 200_000, amountInToman: 200_000, accountId: p.bank.id, category: 'Sales', description: `دریافت بابت سفارش #${order.number} - مشتری: همکار` },
      { type: 'INCOME', amount: 300_000, amountInToman: 300_000, accountId: p.expenses.id, customerId: p.customer.id, description: `تسویه حساب امانی - سفارش #${order.number}` },
      { type: 'EXPENSE', amount: 50_000, amountInToman: 50_000, accountId: p.bank.id, category: 'Other', description: `هزینه پیک سفارش #${order.number}` },
    ],
  });
  await prisma.account.update({ where: { id: p.bank.id }, data: { balance: 200_000 - 50_000 } });
  await prisma.account.update({ where: { id: p.expenses.id }, data: { balance: 300_000 } });
  await prisma.order.update({ where: { id: order.id }, data: { paidAmount: 500_000, paymentStatus: 'PARTIAL' } });

  const deleted = await deleteConsignmentOrder(order.id);
  assert.equal(deleted.success, true, deleted.message);

  const left = await prisma.transaction.findMany();
  assert.deepEqual(left.map((t: any) => [t.description, Number(t.amount)]), [[`هزینه پیک سفارش #${order.number}`, 50_000]]);
  // Each account holds exactly what its remaining rows say.
  assert.deepEqual([await balance(p.bank.id), await balance(p.expenses.id)], [-50_000, 0]);
});

test('the same consignment report is booked once: a resent submission is ignored and repeated lines need a confirmation', async () => {
  const p = await partner();

  const first = await report(p, 2, { requestId: 'report-request-01' });
  assert.equal(first.success, true, first.message);
  // The same submission again (a retry after an error, a double click).
  assert.deepEqual(await report(p, 2, { requestId: 'report-request-01' }), { message: DUPLICATE_REQUEST_MESSAGE, success: true });

  const order = await theOrder();
  const rows = await prisma.transaction.findMany({ orderBy: { category: 'asc' } });
  assert.deepEqual(
    rows.map((t: any) => [t.category, Number(t.amount), t.orderId]),
    [['COGS', 2 * COST, order.id], ['CONSIGNMENT_COMMISSION', 2 * PRICE * 0.1, order.id]],
  );
  assert.equal(order.items.length, 1);
  assert.equal(await stockAtPartner(p), 3);

  // The same lines typed in again for the same day: refused until confirmed.
  const repeat = await report(p, 2, { requestId: 'report-request-02' });
  assert.equal(repeat.success, undefined);
  assert.deepEqual(repeat.data, { repeatOf: order.number });
  assert.equal(await prisma.transaction.count(), 2);
  assert.equal(await stockAtPartner(p), 3);

  const confirmed = await report(p, 2, { requestId: 'report-request-02', confirmRepeat: true });
  assert.equal(confirmed.success, true, confirmed.message);
  assert.equal(await prisma.transaction.count(), 4);
  assert.equal(await stockAtPartner(p), 1);

  // Different lines on the same day are simply added.
  assert.equal((await report(p, 1, { requestId: 'report-request-03', productId: p.other.id })).success, true);
  assert.equal(await prisma.transaction.count(), 6);
});

test('a sale added to the day\'s order after a return does not bring the returned frame back into what is owed', async () => {
  const p = await partner();
  await report(p, 2);
  await returnOne(p);
  assert.equal((await report(p, 1, { productId: p.other.id })).success, true);

  // Still sold: 1 + 1 frames.
  const order = await theOrder();
  assert.equal(Number(order.totalAmount), 2 * PRICE * 0.9);
  assert.deepEqual([Number(order.commissions[0].orderAmount), Number(order.commissions[0].commissionAmount)], [2 * PRICE, 2 * PRICE * 0.1]);
  const commissionRows = await prisma.transaction.findMany({ where: { category: 'CONSIGNMENT_COMMISSION' }, orderBy: { createdAt: 'asc' } });
  // The new frame's own commission only.
  assert.deepEqual(commissionRows.map((t: any) => Number(t.amount)), [2 * PRICE * 0.1, PRICE * 0.1]);
  assert.equal((await getPendingSettlements())[0].remainingAmount, 2 * PRICE * 0.9);
});
