import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase, form } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { cancelOrder, createOrder, getCancelOrderPreview } from '@/actions/sales';
import { createInvoiceFromOrder } from '@/actions/invoice';
import { returnOrderItem } from '@/actions/order-return';
import { calculateCustomerDebt, getCustomerById, getCustomersWithDebt } from '@/actions/customer';
import { getSalesAnalytics } from '@/actions/sales-analytics';
import { getSalesByCustomer, getSalesPerformance } from '@/actions/reporting';
import { agentTools } from '@/lib/ai-agent';
import { discountShare, exchangeChange, returnChange } from '@/lib/return-math';
import { customerBalance, orderTotals } from '@/lib/order-balance';
import {
  A, CHEAPER, PRICIER, SMALL, assertInvoice, giveBack, money, orderRow, sell, shop, swap, tillBalance,
} from './invoice-helpers';

// The actions log every refusal these tests provoke on purpose.
console.error = () => {};

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
});
after(() => prisma.$disconnect());

// ── A. The discount on a return is split proportionally ──────────────────────

test('returned goods take their proportional share of the discount; the refund is the rest, limited by what was paid', () => {
  // 2 × 1,000,000 with 400,000 off, 1,600,000 paid; one comes back.
  const order = money({ totalAmount: 2 * A, discount: 400_000, paidAmount: 1_600_000 });
  assert.equal(discountShare(order, A), 200_000);
  assert.deepEqual(returnChange(order, A), {
    newTotal: A, newDiscount: 200_000, newPaid: 800_000, paymentStatus: 'PAID', cashIn: 0, cashOut: 800_000, creditIn: 0, owedChange: -800_000,
  });
  // Unpaid: nothing moves; the debt falls by the goods less their share.
  assert.deepEqual(returnChange({ ...order, paidAmount: 0 }, A), {
    newTotal: A, newDiscount: 200_000, newPaid: 0, paymentStatus: 'UNPAID', cashIn: 0, cashOut: 0, creditIn: 0, owedChange: -800_000,
  });
  // Rounded to whole Toman.
  assert.equal(discountShare(money({ totalAmount: 3 * A, discount: 100_000 }), A), 33_333);
  // In an exchange the share moves to the new goods instead (exchange-discount tests below).
  const swapped = exchangeChange(order, A, PRICIER, {});
  assert.deepEqual(
    { total: swapped.newTotal, discount: swapped.newDiscount, owed: swapped.owedChange, paid: swapped.newPaid },
    { total: A + PRICIER, discount: 400_000, owed: PRICIER - A, paid: 1_600_000 },
  );
});

test('a discount larger than the goods left never takes the total below zero', () => {
  // 2 × 1,000,000 with 1,200,000 off and 800,000 paid: one comes back.
  const order = money({ totalAmount: 2 * A, discount: 1_200_000, paidAmount: 800_000 });
  const change = returnChange(order, A);
  assert.deepEqual(change, {
    newTotal: A, newDiscount: 600_000, newPaid: 400_000, paymentStatus: 'PAID', cashIn: 0, cashOut: 400_000, creditIn: 0, owedChange: -400_000,
  });
  // An order already left with more discount than goods (by an older return): the rest comes back.
  const legacy = money({ totalAmount: A, discount: 1_200_000, paidAmount: 0 });
  assert.equal(orderTotals(legacy).net, 0);
  const last = returnChange(legacy, A);
  assert.equal(last.newTotal, 0);
  assert.equal(last.newDiscount, 0);
  assert.equal(last.cashOut, 0);
});

test('a return books the proportional refund and the smaller discount, and the invoice follows', async () => {
  const s = await shop();
  const { order, invoiceId, line } = await sell(s, [['A', 2]], 400_000, 1_600_000);
  await giveBack(s, order.id, line('A').id, 1);

  assert.deepEqual(await orderRow(order.id), { total: A, discount: 200_000, paid: 800_000, status: 'PAID' });
  assert.equal(await tillBalance(s), 800_000);
  const refund = await prisma.transaction.findFirstOrThrow({ where: { type: 'EXPENSE', category: 'Return' } });
  assert.equal(Number(refund.amountInToman), 800_000);
  await assertInvoice(order.id, invoiceId, {
    lines: ['SOLD PANJ ×1 = 1000000', 'RETURNED PANJ (برگشتی) ×1 = 1000000'],
    rows: { goods: A, discount: 200_000, net: 800_000, paid: 800_000, remaining: 0 },
  });
});

test('a return on an order whose discount exceeds the goods left keeps the invoice total at or above zero', async () => {
  const s = await shop();
  const { order, invoiceId, line } = await sell(s, [['A', 2]], 1_200_000, 800_000);
  await giveBack(s, order.id, line('A').id, 1);

  assert.deepEqual(await orderRow(order.id), { total: A, discount: 600_000, paid: 400_000, status: 'PAID' });
  assert.equal(await tillBalance(s), 400_000);
  await assertInvoice(order.id, invoiceId, {
    lines: ['SOLD PANJ ×1 = 1000000', 'RETURNED PANJ (برگشتی) ×1 = 1000000'],
    rows: { goods: A, discount: 600_000, net: 400_000, paid: 400_000, remaining: 0 },
  });

  await giveBack(s, order.id, line('A').id, 1);
  assert.deepEqual(await orderRow(order.id), { total: 0, discount: 0, paid: 0, status: 'PAID' });
  const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  assert.equal(Number(invoice.total), 0);
});

// ── D. One invoice, the same on both prints and the invoice page ─────────────

test('invoice: partial return', async () => {
  const s = await shop();
  const { order, invoiceId, line } = await sell(s, [['A', 2]], 0, 2 * A);
  await giveBack(s, order.id, line('A').id, 1);
  await assertInvoice(order.id, invoiceId, {
    lines: ['SOLD PANJ ×1 = 1000000', 'RETURNED PANJ (برگشتی) ×1 = 1000000'],
    rows: { goods: A, net: A, paid: A, remaining: 0 },
  });
  assert.equal(await tillBalance(s), A);
});

test('invoice: full return', async () => {
  const s = await shop();
  const { order, invoiceId, line } = await sell(s, [['A', 2]], 0, 2 * A);
  await giveBack(s, order.id, line('A').id, 2);
  await assertInvoice(order.id, invoiceId, {
    lines: ['RETURNED PANJ (برگشتی) ×2 = 2000000'],
    rows: { goods: 0, net: 0, paid: 0, remaining: 0 },
  });
  assert.equal(await tillBalance(s), 0);
});

test('invoice: a pricier exchange with the difference collected', async () => {
  const s = await shop();
  const { order, invoiceId, line } = await sell(s, [['A', 1]], 0, A);
  await swap(s, order.id, line('A').id, 'PRICIER', 1, { receivedNow: '600000' });
  await assertInvoice(order.id, invoiceId, {
    lines: ['EXCHANGED PANJ (تعویض) ×1 = 1000000', 'SOLD HAFT (به‌جای PANJ (تعویض)) ×1 = 1600000'],
    rows: { goods: PRICIER, net: PRICIER, paid: PRICIER, remaining: 0 },
  });
  assert.equal(await tillBalance(s), PRICIER);
});

test('invoice: a pricier exchange with the difference left unpaid shows what remains', async () => {
  const s = await shop();
  const { order, invoiceId, line } = await sell(s, [['A', 1]], 0, A);
  await swap(s, order.id, line('A').id, 'PRICIER', 1);
  await assertInvoice(order.id, invoiceId, {
    lines: ['EXCHANGED PANJ (تعویض) ×1 = 1000000', 'SOLD HAFT (به‌جای PANJ (تعویض)) ×1 = 1600000'],
    rows: { goods: PRICIER, net: PRICIER, paid: A, remaining: 600_000 },
  });
  assert.equal((await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } })).status, 'PARTIAL');
  assert.equal(await calculateCustomerDebt(s.customer.id), 600_000);
});

test('invoice: a cheaper exchange with the difference refunded', async () => {
  const s = await shop();
  const { order, invoiceId, line } = await sell(s, [['A', 1]], 0, A);
  await swap(s, order.id, line('A').id, 'CHEAPER', 1, { refundNow: '1' });
  await assertInvoice(order.id, invoiceId, {
    lines: ['EXCHANGED PANJ (تعویض) ×1 = 1000000', 'SOLD YEK (به‌جای PANJ (تعویض)) ×1 = 700000'],
    rows: { goods: CHEAPER, net: CHEAPER, paid: CHEAPER, remaining: 0 },
  });
  assert.equal(await tillBalance(s), CHEAPER);
});

test('invoice: a cheaper exchange whose difference is kept shows it as بستانکار', async () => {
  const s = await shop();
  const { order, invoiceId, line } = await sell(s, [['A', 1]], 0, A);
  await swap(s, order.id, line('A').id, 'CHEAPER', 1);
  await assertInvoice(order.id, invoiceId, {
    lines: ['EXCHANGED PANJ (تعویض) ×1 = 1000000', 'SOLD YEK (به‌جای PANJ (تعویض)) ×1 = 700000'],
    rows: { goods: CHEAPER, net: CHEAPER, paid: A, credit: 300_000 },
  });
  assert.equal(await tillBalance(s), A);
  const profile: any = await getCustomerById(s.customer.id);
  assert.deepEqual([profile.stats.totalDebt, profile.stats.totalCredit], [0, 300_000]);
});

test('invoice: an exchange, then a return of the new item', async () => {
  const s = await shop();
  const { order, invoiceId, line } = await sell(s, [['A', 1]], 0, A);
  await swap(s, order.id, line('A').id, 'PRICIER', 1, { receivedNow: '600000' });
  const issued = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id, productId: s.p.PRICIER.id } });
  await giveBack(s, order.id, issued.id, 1);
  await assertInvoice(order.id, invoiceId, {
    lines: ['EXCHANGED PANJ (تعویض) ×1 = 1000000', 'RETURNED HAFT (برگشتی؛ به‌جای PANJ (تعویض)) ×1 = 1600000'],
    rows: { goods: 0, net: 0, paid: 0, remaining: 0 },
  });
  assert.equal(await tillBalance(s), 0);
  // Both frames are back on the shelf.
  const stock = await prisma.inventory.findMany({ where: { warehouseId: s.warehouse.id }, include: { product: true } });
  assert.deepEqual(stock.map((x: any) => x.quantity), stock.map(() => 10));
});

test('invoice: a mixed line, one unit returned and one exchanged, and the line is closed', async () => {
  const s = await shop();
  const { order, invoiceId, line } = await sell(s, [['A', 2]], 0, 2 * A);
  await giveBack(s, order.id, line('A').id, 1);
  await swap(s, order.id, line('A').id, 'PRICIER', 1, { receivedNow: '600000' });
  await assertInvoice(order.id, invoiceId, {
    lines: [
      'RETURNED PANJ (برگشتی) ×1 = 1000000',
      'EXCHANGED PANJ (تعویض) ×1 = 1000000',
      'SOLD HAFT (به‌جای PANJ (تعویض)) ×1 = 1600000',
    ],
    rows: { goods: PRICIER, net: PRICIER, paid: PRICIER, remaining: 0 },
  });
  // Finding 5: returned + exchanged cover the line, so it is closed.
  assert.equal((await prisma.orderItem.findUniqueOrThrow({ where: { id: line('A').id } })).status, 'EXCHANGED');
  const again = await returnOrderItem({}, form({ orderId: order.id, orderItemId: line('A').id, quantity: '1', accountId: s.till.id, warehouseId: s.warehouse.id }));
  assert.equal(again.success, false);
});

test('invoice: a return that closes a line an exchange already took part of marks it returned', async () => {
  const s = await shop();
  const { order, line } = await sell(s, [['A', 2]], 0, 2 * A);
  await swap(s, order.id, line('A').id, 'CHEAPER', 1, { refundNow: '1' });
  await giveBack(s, order.id, line('A').id, 1);
  assert.equal((await prisma.orderItem.findUniqueOrThrow({ where: { id: line('A').id } })).status, 'RETURNED');
});

test('invoice: an old WooCommerce order, whose total is already after the discount, owes nothing and holds no credit', async () => {
  const s = await shop();
  const woo = await prisma.order.create({
    data: {
      customerId: s.customer.id, wooId: 4242, totalAmount: 900_000, discount: 100_000, paidAmount: 900_000,
      paymentStatus: 'PAID', status: 'COMPLETED',
      items: { create: [{ productId: s.p.A.id, quantity: 1, price: A, warehouseId: s.warehouse.id }] },
    },
  });
  const invoice: any = await createInvoiceFromOrder(woo.id);
  await assertInvoice(woo.id, invoice.invoiceId, {
    lines: ['SOLD PANJ ×1 = 1000000'],
    rows: { goods: A, discount: 100_000, net: 900_000, paid: 900_000, remaining: 0 },
  });
  const profile: any = await getCustomerById(s.customer.id);
  assert.deepEqual([profile.stats.totalDebt, profile.stats.totalCredit], [0, 0]);
});

// ── C (stage 1). Debt is the same on every customer screen ───────────────────

test('a cancelled paid order is not debt, and the profile, the debtors list and calculateCustomerDebt agree', async () => {
  const s = await shop();
  // Paid in full, then cancelled.
  const cancelled = await sell(s, [['A', 1]], 0, A);
  const preview: any = await getCancelOrderPreview(cancelled.order.id);
  assert.equal(preview.success, true, preview.message);
  const r = await cancelOrder(cancelled.order.id, preview.moneyRowIds);
  assert.equal(r.success, true, r.message);
  // Part paid: 400,000 owed after 200,000 off.
  await sell(s, [['A', 1]], 200_000, 400_000);
  // Paid, then a cheaper exchange kept: 300,000 paid beyond the net.
  const over = await sell(s, [['A', 1]], 0, A);
  await swap(s, over.order.id, over.line('A').id, 'CHEAPER', 1);

  const profile: any = await getCustomerById(s.customer.id);
  const listed: any = (await getCustomersWithDebt()).find((c: any) => c.id === s.customer.id);
  const debt = await calculateCustomerDebt(s.customer.id);
  assert.deepEqual(
    { profile: [profile.stats.totalDebt, profile.stats.totalCredit], list: [listed.totalDebt, listed.totalCredit], debt },
    { profile: [400_000, 300_000], list: [400_000, 300_000], debt: 400_000 },
  );

  // The pure rule behind all three.
  assert.deepEqual(
    customerBalance([
      { status: 'CANCELLED', totalAmount: A, discount: 0, paidAmount: 0 },
      { status: 'COMPLETED', totalAmount: A, discount: 200_000, paidAmount: 400_000 },
      { status: 'INVOICED', totalAmount: CHEAPER, discount: 0, paidAmount: A },
    ], 50_000),
    { debt: 400_000, credit: 350_000 },
  );
});

// ── E. An invoiced sale still counts in the analytics ────────────────────────

test('an invoiced sale counts in the sales analytics, the sales reports and the AI summary; a cancelled one does not', async () => {
  const s = await shop();
  await sell(s, [['A', 1]], 0, A); // invoiced by sell()
  const plainSale: any = await createOrder({
    customerId: s.customer.id, items: [{ productId: s.p.SMALL.id, quantity: 1, price: SMALL }], paymentMethod: 'CASH',
    accountId: s.till.id, totalAmount: SMALL, discount: 0, paidAmount: SMALL, warehouseId: s.warehouse.id,
  });
  assert.equal(plainSale.success, true);
  const cancelled = await sell(s, [['CHEAPER', 1]], 0, CHEAPER);
  const preview: any = await getCancelOrderPreview(cancelled.order.id);
  assert.equal((await cancelOrder(cancelled.order.id, preview.moneyRowIds)).success, true);
  // A web order the old WooCommerce store left unpaid is not a sale.
  await prisma.order.create({ data: { customerId: s.customer.id, wooId: 7, totalAmount: PRICIER, status: 'PENDING', paymentStatus: 'UNPAID', paidAmount: 0 } });

  const analytics: any = await getSalesAnalytics();
  assert.deepEqual([analytics.summary.totalOrders, analytics.summary.totalRevenue], [2, A + SMALL]);
  const top = Object.fromEntries(analytics.topProducts.map((p: any) => [p.name, p.quantity]));
  assert.deepEqual(top, { PANJ: 1, DO: 1 });

  const performance: any = await getSalesPerformance();
  assert.deepEqual(performance.topProducts.map((p: any) => p.name).sort(), ['DO', 'PANJ']);
  const byCustomer: any = await getSalesByCustomer();
  assert.deepEqual(byCustomer.topCustomers, [{ name: 'سارا', count: 2, total: A + SMALL }]);

  const summary: any = await agentTools.find((t) => t.name === 'get_sales_summary')!.execute({ days: 30 });
  assert.deepEqual([summary.totalOrders, summary.totalRevenue], [2, A + SMALL]);
});

test('units returned or exchanged away do not count as sold in the product analytics', async () => {
  const s = await shop();
  const { order, line } = await sell(s, [['A', 2]], 0, 2 * A);
  await giveBack(s, order.id, line('A').id, 1);
  const analytics: any = await getSalesAnalytics();
  const top = Object.fromEntries(analytics.topProducts.map((p: any) => [p.name, [p.quantity, p.revenue]]));
  assert.deepEqual(top, { PANJ: [1, A] });
});
