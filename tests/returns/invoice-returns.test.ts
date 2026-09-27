import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { prisma, resetDatabase, form } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { cancelOrder, createOrder, getCancelOrderPreview } from '@/actions/sales';
import { createInvoiceFromOrder } from '@/actions/invoice';
import { returnOrderItem } from '@/actions/order-return';
import { exchangeOrderItem } from '@/actions/order-exchange';
import { calculateCustomerDebt, getCustomerById, getCustomersWithDebt } from '@/actions/customer';
import { getSalesAnalytics } from '@/actions/sales-analytics';
import { getSalesByCustomer, getSalesPerformance } from '@/actions/reporting';
import { agentTools } from '@/lib/ai-agent';
import { discountShare, exchangeChange, returnChange, type OrderMoney } from '@/lib/return-math';
import { customerBalance, orderTotals } from '@/lib/order-balance';
import PrintOrderPage from '@/app/dashboard/sales/orders/[id]/print/page';
import PrintInvoicePage from '@/app/dashboard/sales/invoices/[id]/print/page';
import InvoiceDetailsPage from '@/app/dashboard/sales/invoices/[id]/page';

// The pages compile to React.createElement under the test runner.
(globalThis as any).React = React;
// The actions log every refusal these tests provoke on purpose.
console.error = () => {};

const A = 1_000_000;
const PRICIER = 1_600_000;
const CHEAPER = 700_000;
const SMALL = 500_000;

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
});
after(() => prisma.$disconnect());

/** A shop: one warehouse holding 10 of each frame, a till, a customer. */
async function shop() {
  const warehouse = await prisma.warehouse.create({ data: { name: 'مشاهیر' } });
  const make = (name: string, price: number) =>
    prisma.product.create({ data: { name, sku: name, costPrice: 1, sellPrice: price } });
  const p = { A: await make('PANJ', A), PRICIER: await make('HAFT', PRICIER), CHEAPER: await make('YEK', CHEAPER), SMALL: await make('DO', SMALL) };
  await prisma.inventory.createMany({ data: Object.values(p).map((x) => ({ productId: x.id, warehouseId: warehouse.id, quantity: 10 })) });
  const till = await prisma.account.create({ data: { name: 'صندوق', type: 'CASH', currency: 'TOMAN', balance: 0 } });
  const customer = await prisma.customer.create({ data: { name: 'سارا' } });
  return { warehouse, p, till, customer };
}
type Shop = Awaited<ReturnType<typeof shop>>;
type Frame = keyof Shop['p'];

/** A POS sale through createOrder, invoiced at once. */
async function sell(s: Shop, lines: Array<[Frame, number]>, discount: number, paid: number) {
  const items = lines.map(([k, quantity]) => ({ productId: s.p[k].id, quantity, price: Number(s.p[k].sellPrice) }));
  const totalAmount = items.reduce((t, i) => t + i.price * i.quantity, 0);
  const sale: any = await createOrder({
    customerId: s.customer.id, items, paymentMethod: 'CASH', accountId: s.till.id,
    totalAmount, discount, paidAmount: paid, warehouseId: s.warehouse.id,
  });
  assert.equal(sale.success, true, sale.message);
  const order = await prisma.order.findFirstOrThrow({ orderBy: { number: 'desc' }, include: { items: true } });
  const invoice: any = await createInvoiceFromOrder(order.id);
  assert.equal(invoice.success, true, invoice.message);
  const line = (k: Frame) => order.items.find((i: any) => i.productId === s.p[k].id)!;
  return { order, invoiceId: invoice.invoiceId as string, line };
}

async function giveBack(s: Shop, orderId: string, itemId: string, quantity: number) {
  const r = await returnOrderItem({}, form({ orderId, orderItemId: itemId, quantity: String(quantity), accountId: s.till.id, warehouseId: s.warehouse.id }));
  assert.equal(r.success, true, r.message);
}

async function swap(s: Shop, orderId: string, itemId: string, to: Frame, quantity: number, extra: Record<string, string> = {}) {
  const r = await exchangeOrderItem({}, form({
    orderId, originalItemId: itemId, exchangeProductId: s.p[to].id, quantity: String(quantity),
    accountId: s.till.id, returnWarehouseId: s.warehouse.id, exchangeWarehouseId: s.warehouse.id, ...extra,
  }));
  assert.equal(r.success, true, r.message);
}

const digits = (text: string) =>
  text.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٬,]/g, '').replace(/[‎‏]/g, '');
const plain = (html: string) => digits(html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim());
const lastCellNumber = (row: string) => {
  const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => plain(c[1]));
  return Number(cells[cells.length - 1].replace(/[^\d-]/g, ''));
};

/** The invoice table of a rendered page: its lines as text, and its money rows by key. */
function readInvoice(html: string) {
  const lines = [...html.matchAll(/<tr data-line="(\w+)" data-counted="(\d)" data-amount="(-?\d+)"[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => {
    const cells = [...m[4].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => plain(c[1]));
    // What is shown is what is counted.
    assert.equal(Number(cells[4].replace(/\D/g, '')), Number(m[3]), `shown amount of ${cells[1]}`);
    return { kind: m[1], counted: m[2] === '1', amount: Number(m[3]), text: `${m[1]} ${cells[1]} ×${cells[2]} = ${m[3]}` };
  });
  const rows: Record<string, number> = {};
  for (const m of html.matchAll(/<tr data-row="(\w+)" data-amount="(-?\d+)"[^>]*>([\s\S]*?)<\/tr>/g)) {
    rows[m[1]] = Number(m[2]);
    assert.equal(Math.abs(lastCellNumber(m[3])), Number(m[2]), `shown ${m[1]}`);
  }
  return { lines, rows };
}

/** The rows add up: counted lines = جمع کالا; جمع کالا − deductions = net; net − paid = remaining or −credit. */
function assertAddsUp(inv: ReturnType<typeof readInvoice>) {
  const r = inv.rows;
  const counted = inv.lines.filter((l) => l.counted).reduce((sum, l) => sum + l.amount, 0);
  assert.equal(counted, r.goods, 'counted lines add up to جمع کالا');
  const net = r.goods + (r.freight ?? 0) - (r.siteRefunded ?? 0) - (r.commission ?? 0) - (r.discount ?? 0);
  assert.equal(net, r.net, 'جمع کالا less deductions is the net');
  if ('credit' in r) assert.equal(r.paid - r.net, r.credit, 'paid beyond the net is بستانکار');
  else assert.equal(r.net - r.paid, r.remaining, 'net less paid is باقی‌مانده');
}

const render = async (page: Promise<any>) => renderToStaticMarkup(await page);

/**
 * The order's «چاپ فاکتور», the invoice print and the invoice page show the
 * same lines and money rows, which add up to `expected`.
 */
async function assertInvoice(
  orderId: string,
  invoiceId: string,
  expected: { lines: string[]; rows: Record<string, number> },
) {
  const views = {
    orderPrint: readInvoice(await render(PrintOrderPage({ params: { id: orderId } }))),
    invoicePrint: readInvoice(await render(PrintInvoicePage({ params: { id: invoiceId } }))),
    invoicePage: readInvoice(await render(InvoiceDetailsPage({ params: { id: invoiceId } }))),
  };
  for (const [name, view] of Object.entries(views)) {
    assert.deepEqual(view.lines.map((l) => l.text), expected.lines, `${name} lines`);
    assert.deepEqual(view.rows, expected.rows, `${name} money rows`);
    assertAddsUp(view);
  }
  // The invoice row the lists read agrees with the printed net and paid.
  const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  assert.equal(Number(invoice.total), expected.rows.net, 'Invoice.total');
  assert.equal(Number(invoice.paidAmount), expected.rows.paid, 'Invoice.paidAmount');
}

const tillBalance = async (s: Shop) => Number((await prisma.account.findUniqueOrThrow({ where: { id: s.till.id } })).balance);
const orderRow = async (id: string) => {
  const o = await prisma.order.findUniqueOrThrow({ where: { id } });
  return { total: Number(o.totalAmount), discount: Number(o.discount), paid: Number(o.paidAmount), status: o.paymentStatus };
};
const money = (m: Partial<OrderMoney>): OrderMoney => ({ totalAmount: 0, discount: 0, paidAmount: 0, commissionRate: 0, ...m });

// ── A. The discount on a return is split proportionally ──────────────────────

test('returned goods take their proportional share of the discount; the refund is the rest, limited by what was paid', () => {
  // 2 × 1,000,000 with 400,000 off, 1,600,000 paid; one comes back.
  const order = money({ totalAmount: 2 * A, discount: 400_000, paidAmount: 1_600_000 });
  assert.equal(discountShare(order, A), 200_000);
  assert.deepEqual(returnChange(order, A), {
    newTotal: A, newDiscount: 200_000, newPaid: 800_000, paymentStatus: 'PAID', cashIn: 0, cashOut: 800_000, owedChange: -800_000,
  });
  // Unpaid: nothing moves; the debt falls by the goods less their share.
  assert.deepEqual(returnChange({ ...order, paidAmount: 0 }, A), {
    newTotal: A, newDiscount: 200_000, newPaid: 0, paymentStatus: 'UNPAID', cashIn: 0, cashOut: 0, owedChange: -800_000,
  });
  // Rounded to whole Toman.
  assert.equal(discountShare(money({ totalAmount: 3 * A, discount: 100_000 }), A), 33_333);
  // An exchange's returned side takes its share too; the new goods carry none.
  const swapped = exchangeChange(order, A, PRICIER, {});
  assert.deepEqual(
    { total: swapped.newTotal, discount: swapped.newDiscount, owed: swapped.owedChange, paid: swapped.newPaid },
    { total: A + PRICIER, discount: 200_000, owed: PRICIER - A + 200_000, paid: 1_600_000 },
  );
});

test('a discount larger than the goods left never takes the total below zero', () => {
  // 2 × 1,000,000 with 1,200,000 off and 800,000 paid: one comes back.
  const order = money({ totalAmount: 2 * A, discount: 1_200_000, paidAmount: 800_000 });
  const change = returnChange(order, A);
  assert.deepEqual(change, {
    newTotal: A, newDiscount: 600_000, newPaid: 400_000, paymentStatus: 'PAID', cashIn: 0, cashOut: 400_000, owedChange: -400_000,
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
  const refund = await prisma.transaction.findFirstOrThrow({ where: { type: 'EXPENSE' } });
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
