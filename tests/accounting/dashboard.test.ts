import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { prisma, resetDatabase } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { getDashboardFinancials, getDashboardSales, getLowStockItems, getRecentActivity, getUserTasks } from '@/actions/dashboard';
import { getSalesByProduct } from '@/actions/accounting';
import { getBalanceSheet } from '@/actions/reports';
import { recordPurchasePartialPayment, updatePurchaseOrderStatus } from '@/actions/supplier-workflow';
import { FinancialCards } from '@/components/dashboard/financial-cards';
import { BalanceSheetReport } from '@/components/reports/balance-sheet-report';
import { totalsByCurrency, unpaidOnPurchaseOrder } from '@/lib/money-totals';
import { assertBooksAddUp, openAccount } from './ledger';

(globalThis as any).React = React;
// The actions log every refusal these tests provoke on purpose.
console.error = () => {};

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
});
after(() => prisma.$disconnect());

/** Two Toman accounts, a dollar and a euro account, and what must stay out of «موجودی کل». */
async function seedAccounts() {
  await openAccount('saman', 50_000_000, 'TOMAN', { type: 'BANK' });
  await openAccount('cash', 10_000_000, 'TOMAN', { type: 'CASH' });
  await openAccount('usd', 1_000, 'USD', { type: 'BANK' });
  await openAccount('usd-cash', 250.5, 'USD', { type: 'CASH' });
  await openAccount('eur', 200, 'EUR', { type: 'CASH' });
  // Not a bank or the cash box: the card is labelled «بانک‌ها و صندوق».
  await openAccount('person', 5_000_000, 'TOMAN', { type: 'PERSON' });
  // A P&L bucket, never money.
  await prisma.account.create({ data: { name: 'COGS', type: 'EXPENSE', currency: 'TOMAN', balance: -9_000_000 } });
  // An older dollar rate and the latest one; no euro rate at all.
  await prisma.exchangeRate.create({ data: { currency: 'USD', rateToToman: 90_000, date: new Date('2026-09-01T08:00:00Z') } });
  await prisma.exchangeRate.create({ data: { currency: 'USD', rateToToman: 100_000, date: new Date('2026-09-20T08:00:00Z') } });
}

test('«موجودی کل» adds Toman accounts only; each other currency is shown on its own, valued at its latest rate', async () => {
  await seedAccounts();
  const financials = await getDashboardFinancials();

  assert.equal(financials.totalBalance, 60_000_000, 'dollars and euros are not added as Toman');
  assert.deepEqual(financials.foreignBalances, [
    { currency: 'EUR', total: 200, rate: null, rateDate: null, approxToman: null },
    {
      currency: 'USD',
      total: 1_250.5,
      rate: 100_000,
      rateDate: new Date('2026-09-20T08:00:00Z'),
      approxToman: 125_050_000,
    },
  ]);
  await assertBooksAddUp();
});

test('the dashboard card shows the Toman total, and each currency with its rate and date or «no rate»', async () => {
  await seedAccounts();
  const html = renderToStaticMarkup(React.createElement(FinancialCards, { financials: await getDashboardFinancials() }));
  assert.ok(html.includes('۶۰٬۰۰۰٬۰۰۰ تومان'), 'the Toman total');
  assert.ok(html.includes('۱٬۲۵۰٫۵ USD'), 'the dollar total in dollars');
  assert.ok(html.includes('۱۲۵٬۰۵۰٬۰۰۰ تومان'), 'its approximate Toman value');
  assert.ok(html.includes('نرخ ۱۰۰٬۰۰۰ در ۱۴۰۵/۰۶/۲۹'), 'the rate and its Jalali date');
  assert.ok(html.includes('۲۰۰ EUR'), 'the euro total');
  assert.ok(html.includes('نرخی ثبت نشده است'), 'a currency with no rate says so');
});

test('with no foreign account there is no foreign line, and an account with no rows counts as 0', async () => {
  await prisma.account.create({ data: { name: 'تازه', type: 'BANK', currency: 'TOMAN', balance: 0 } });
  const financials = await getDashboardFinancials();
  assert.equal(financials.totalBalance, 0);
  assert.deepEqual(financials.foreignBalances, []);
});

test('the balance sheet counts only Toman cash in its Toman figures and lists the foreign cash on its own', async () => {
  await seedAccounts();
  const sheet = await getBalanceSheet(new Date());
  assert.equal(sheet.assets.cash, 60_000_000);
  assert.deepEqual(
    sheet.assets.foreignCash.map((f) => [f.currency, f.total, f.approxToman]),
    [['EUR', 200, null], ['USD', 1_250.5, 125_050_000]],
  );
  assert.equal(sheet.assets.total, 60_000_000, 'nothing else is on this balance sheet');
  assert.equal(sheet.assets.approxTotalWithForeign, null, 'the euro has no rate, so no approximate total');
  assert.equal(sheet.equity.total, sheet.assets.total - sheet.liabilities.total);

  // The dashboard and the balance sheet show the same Toman cash.
  assert.equal((await getDashboardFinancials()).totalBalance, sheet.assets.cash);

  await prisma.exchangeRate.create({ data: { currency: 'EUR', rateToToman: 110_000, date: new Date('2026-09-21T08:00:00Z') } });
  const priced = await getBalanceSheet(new Date());
  assert.equal(priced.assets.approxTotalWithForeign, 60_000_000 + 125_050_000 + 22_000_000);

  const html = renderToStaticMarkup(React.createElement(BalanceSheetReport, { data: priced }));
  assert.ok(html.includes('نقدینگی USD'));
  assert.ok(html.includes('جمع با احتساب ارز (تقریبی)'));
  assert.ok(html.includes('۲۰۷٬۰۵۰٬۰۰۰ تومان'));
});

test('totalsByCurrency sums in exact decimals', () => {
  const totals = totalsByCurrency(
    [
      { currency: 'USD', balance: '0.1' },
      { currency: 'USD', balance: '0.2' },
      { currency: 'TOMAN', balance: '1000000000000' },
      { currency: 'TOMAN', balance: '-250' },
    ],
    [{ currency: 'USD', rateToToman: '100000', date: new Date('2026-09-20') }],
  );
  assert.equal(totals.toman, 999_999_999_750);
  assert.equal(totals.foreign[0].total, 0.3);
  assert.equal(totals.foreign[0].approxToman, 30_000);
});

// ─── «بدهی‌ها»: what is still unpaid to suppliers ────────────────────────────

/** A purchase order as the supplier module leaves it, with its payment records. */
async function purchaseOrder(status: string, totalAmountInToman: number | null, paid: number[] = [], totalAmount = totalAmountInToman ?? 0) {
  const supplierId = (await prisma.supplier.findFirst())?.id ?? (await prisma.supplier.create({ data: { name: 'تامین‌کننده' } })).id;
  if (paid.length && !(await prisma.account.findUnique({ where: { id: 'po-bank' } }))) await openAccount('po-bank', 0);
  const order = await prisma.purchaseOrder.create({ data: { supplierId, status, totalAmount, totalAmountInToman } });
  for (const amount of paid) {
    await prisma.purchaseOrderPayment.create({ data: { purchaseOrderId: order.id, amount, accountId: 'po-bank' } });
  }
  return order;
}

test('«بدهی‌ها» is what is still unpaid on every placed, uncancelled purchase order, in Toman', async () => {
  await purchaseOrder('DRAFT', 10_000_000); // not placed with the supplier yet
  await purchaseOrder('CANCELLED', 20_000_000, [5_000_000]);
  await purchaseOrder('PENDING_PAYMENT', 30_000_000); // 30M
  await purchaseOrder('PARTIALLY_PAID', 40_000_000, [10_000_000, 5_000_000]); // 25M
  await purchaseOrder('PAID', 50_000_000, [50_000_000]); // 0
  await purchaseOrder('IN_PRODUCTION', 5_000_000, [1_000_000]); // 4M
  await purchaseOrder('ARRIVED', 7_000_000, [7_000_000]); // 0
  // Received the old way, with nothing paid; its totalAmount is in dollars.
  await purchaseOrder('RECEIVED', 60_000_000, [], 600); // 60M
  await purchaseOrder('PARTIALLY_RECEIVED', 3_000_000, [1_000_000]); // 2M
  await purchaseOrder('PAID', 10_000_000, [10_500_000]); // overpaid: 0, never negative
  await purchaseOrder('PAID', 8_000_000, [7_999_999]); // paid at total − 1, as the payment code allows: 0
  await purchaseOrder('PENDING_PAYMENT', 50_000_000, [], 500); // a 500-dollar order: 50M, not 500

  assert.equal((await getDashboardFinancials()).totalPayables, 30_000_000 + 25_000_000 + 4_000_000 + 60_000_000 + 2_000_000 + 50_000_000);
});

test('an old order with no Toman total is priced as the payment code prices it: its lines and costs at the latest rate', async () => {
  await prisma.exchangeRate.create({ data: { currency: 'USD', rateToToman: 90_000, date: new Date('2026-09-01T08:00:00Z') } });
  await prisma.exchangeRate.create({ data: { currency: 'USD', rateToToman: 100_000, date: new Date('2026-09-20T08:00:00Z') } });
  const product = await prisma.product.create({ data: { name: 'PANJ', sku: 'PANJ-1', costPrice: 1, sellPrice: 1 } });
  const legacy = await purchaseOrder('RECEIVED', null, [2_000_000], 0);
  await prisma.purchaseOrderItem.createMany({
    data: [
      { purchaseOrderId: legacy.id, productId: product.id, quantity: 10, unitCost: 20, currency: 'USD', exchangeRateSnapshot: 80_000 },
      { purchaseOrderId: legacy.id, productId: product.id, quantity: 2, unitCost: 1_500_000, currency: 'TOMAN' },
    ],
  });
  await prisma.purchaseOrderAdditionalCost.create({ data: { purchaseOrderId: legacy.id, title: 'حمل', amount: 5, currency: 'USD' } });
  // Paid when recorded, never owed.
  await prisma.purchaseOrderArrivalCost.create({ data: { purchaseOrderId: legacy.id, title: 'گمرک', amount: 9_000_000, currency: 'TOMAN', amountInToman: 9_000_000 } });

  // 10 × 20 × 100,000 + 2 × 1,500,000 + 5 × 100,000 − 2,000,000
  assert.equal((await getDashboardFinancials()).totalPayables, 20_000_000 + 3_000_000 + 500_000 - 2_000_000);
});

test('recording a supplier payment lowers «بدهی‌ها» by that payment; cancelling the order clears it', async () => {
  await openAccount('bank', 100_000_000);
  const order = await purchaseOrder('DRAFT', 30_000_000);
  assert.equal((await getDashboardFinancials()).totalPayables, 0);

  assert.equal((await updatePurchaseOrderStatus(order.id, 'PENDING_PAYMENT')).success, true);
  assert.equal((await getDashboardFinancials()).totalPayables, 30_000_000);

  const paid = await recordPurchasePartialPayment({ orderId: order.id, accountId: 'bank', amount: 12_000_000 });
  assert.equal(paid.success, true, paid.message);
  assert.equal((await getDashboardFinancials()).totalPayables, 18_000_000);

  assert.equal((await updatePurchaseOrderStatus(order.id, 'CANCELLED')).success, true);
  assert.equal((await getDashboardFinancials()).totalPayables, 0);
  await assertBooksAddUp();
});

test('unpaidOnPurchaseOrder sums exactly, never goes below zero, and reads 1 Toman or less as paid', () => {
  assert.equal(unpaidOnPurchaseOrder({ totalAmountInToman: '100.5', payments: [{ amount: '0.2' }, { amount: '0.3' }] }), 100);
  assert.equal(unpaidOnPurchaseOrder({ totalAmountInToman: 100, payments: [{ amount: 150 }] }), 0);
  assert.equal(unpaidOnPurchaseOrder({ totalAmountInToman: 100, payments: [{ amount: 99 }] }), 0);
  assert.equal(unpaidOnPurchaseOrder({ totalAmountInToman: 100, payments: [{ amount: 98.5 }] }), 1.5);
  assert.equal(unpaidOnPurchaseOrder({ totalAmountInToman: null, payments: [] }), 0);
  // A foreign line with no rate recorded falls back to the rate kept on it.
  assert.equal(
    unpaidOnPurchaseOrder({ totalAmountInToman: null, payments: [], items: [{ quantity: 2, unitCost: 10, currency: 'CNY', exchangeRateSnapshot: 14_000 }] }),
    280_000,
  );
});

// ─── «مطالبات»: what customers still owe ─────────────────────────────────────

test('«مطالبات» adds what customers still owe on their unpaid and partly paid orders', async () => {
  const customer = await prisma.customer.create({ data: { name: 'سارا' } });
  const order = (data: Record<string, unknown>) =>
    prisma.order.create({ data: { customerId: customer.id, totalAmount: 1, ...data } as any });
  await order({ totalAmount: 10_000_000, paidAmount: 0, paymentStatus: 'UNPAID' }); // 10M
  await order({ totalAmount: 8_000_000, paidAmount: 3_000_000, paymentStatus: 'PARTIAL' }); // 5M
  await order({ totalAmount: 9_000_000, paidAmount: 9_000_000, paymentStatus: 'PAID' });
  await order({ totalAmount: 7_000_000, paidAmount: 0, paymentStatus: 'UNPAID', status: 'CANCELLED' });
  await order({ totalAmount: 1_000_000, paidAmount: 2_000_000, paymentStatus: 'PARTIAL' }); // overpaid: 0
  // A walk-in order has no customer to owe it.
  await prisma.order.create({ data: { totalAmount: 6_000_000, paidAmount: 0, paymentStatus: 'UNPAID' } });

  assert.equal((await getDashboardFinancials()).totalReceivables, 15_000_000);
});

// ─── The other dashboard cards ────────────────────────────────────────────────

test('«my tasks» lists the signed-in user\'s open tasks, newest first, with their real due date and priority', async () => {
  await prisma.user.create({ data: { id: 'test-user', name: 'Test', email: 'test@example.com', password: 'x' } });
  await prisma.user.create({ data: { id: 'other', name: 'Other', email: 'other@example.com', password: 'x' } });
  const project = await prisma.project.create({ data: { name: 'غرفه' } });
  const task = (title: string, data: Record<string, unknown>) =>
    prisma.task.create({ data: { title, projectId: project.id, assignedTo: 'test-user', ...data } as any });
  await task('طراحی', { priority: 'HIGH', dueDate: new Date('2026-10-01T20:30:00Z'), createdAt: new Date('2026-09-01') });
  await task('چاپ', { status: 'IN_PROGRESS', priority: 'URGENT', createdAt: new Date('2026-09-02') });
  await task('تمام‌شده', { status: 'DONE', createdAt: new Date('2026-09-03') });
  await task('مال دیگری', { assignedTo: 'other', createdAt: new Date('2026-09-04') });

  const tasks = await getUserTasks();
  assert.deepEqual(
    tasks.map((t: any) => [t.title, t.projectName, t.status, t.priority, t.deadline?.toISOString()]),
    [
      ['چاپ', 'غرفه', 'IN_PROGRESS', 'URGENT', undefined],
      ['طراحی', 'غرفه', 'TODO', 'HIGH', '2026-10-01T20:30:00.000Z'],
    ],
  );
  setTestRole(null);
  assert.deepEqual(await getUserTasks(), []);
});

test('sales by product leave out cancelled orders, as every other sales figure does', async () => {
  const warehouse = await prisma.warehouse.create({ data: { name: 'مشاهیر' } });
  const panj = await prisma.product.create({ data: { name: 'PANJ', sku: 'P1', costPrice: 1, sellPrice: 10_000_000 } });
  const raw = await prisma.product.create({ data: { name: 'RAW', sku: 'R1', costPrice: 1, sellPrice: 9_000_000 } });
  const order = (status: string, productId: string, quantity: number, price: number) =>
    prisma.order.create({ data: { totalAmount: quantity * price, status, items: { create: [{ productId, warehouseId: warehouse.id, quantity, price }] } } });
  await order('COMPLETED', panj.id, 2, 10_000_000);
  await order('CANCELLED', panj.id, 5, 10_000_000);
  await order('COMPLETED', raw.id, 1, 9_000_000);
  assert.deepEqual(await getSalesByProduct(), [
    { name: 'PANJ', quantity: 2, total: 20_000_000 },
    { name: 'RAW', quantity: 1, total: 9_000_000 },
  ]);
});

test('the sales card counts today\'s and yesterday\'s uncancelled orders, and the five best sellers of 30 days', async () => {
  const warehouse = await prisma.warehouse.create({ data: { name: 'مشاهیر' } });
  const products = await Promise.all(
    ['A', 'B', 'C', 'D', 'E', 'F'].map((sku) => prisma.product.create({ data: { name: `عینک ${sku}`, sku, costPrice: 1, sellPrice: 1 } })),
  );
  const now = Date.now();
  const sell = (productId: string, quantity: number, status = 'COMPLETED', createdAt = new Date(now - 60_000)) =>
    prisma.order.create({ data: { totalAmount: quantity * 1_000_000, status, createdAt, items: { create: [{ productId, warehouseId: warehouse.id, quantity, price: 1_000_000 }] } } });
  for (const [i, product] of products.entries()) await sell(product.id, i + 1);
  await sell(products[0].id, 100, 'CANCELLED');
  await sell(products[0].id, 50, 'COMPLETED', new Date(now - 40 * 86_400_000));

  const sales = await getDashboardSales();
  assert.deepEqual(sales.today, { total: 21_000_000, count: 6 });
  assert.deepEqual(sales.topProducts.map((p: any) => [p.name, p.units]), [
    ['عینک F', 6], ['عینک E', 5], ['عینک D', 4], ['عینک C', 3], ['عینک B', 2],
  ]);
  assert.equal(sales.dailySales.reduce((sum: number, d: any) => sum + d.total, 0), 21_000_000);
});

test('low stock lists the ten products with the least stock below the threshold, across warehouses', async () => {
  const [a, b] = [await prisma.warehouse.create({ data: { name: 'الف' } }), await prisma.warehouse.create({ data: { name: 'ب' } })];
  for (let i = 0; i < 13; i++) {
    const product = await prisma.product.create({ data: { name: `P${i}`, sku: `S${i}`, costPrice: 1, sellPrice: 1 } });
    await prisma.inventory.create({ data: { productId: product.id, warehouseId: a.id, quantity: i } });
    if (i === 12) await prisma.inventory.create({ data: { productId: product.id, warehouseId: b.id, quantity: 3 } });
  }
  const low = await getLowStockItems(5);
  assert.deepEqual(low.map((p: any) => [p.sku, p.totalStock]), [['S0', 0], ['S1', 1], ['S2', 2], ['S3', 3], ['S4', 4]]);
  const ten = await getLowStockItems();
  assert.equal(ten.length, 10);
  assert.ok(!ten.some((p: any) => p.sku === 'S12'), '12 + 3 in two warehouses is not low');
});

test('recent activity is for the admin only, newest first, as many as asked for', async () => {
  await prisma.user.create({ data: { id: 'test-user', name: 'پویان', email: 'test@example.com', password: 'x' } });
  for (let i = 0; i < 7; i++) {
    await prisma.activityLog.create({ data: { userId: i === 6 ? null : 'test-user', action: `A${i}`, details: `کار ${i}`, createdAt: new Date(Date.UTC(2026, 8, 1, i)) } });
  }
  const recent = await getRecentActivity();
  assert.deepEqual(recent.map((a: any) => [a.action, a.userName, a.description]), [
    ['A6', 'System', 'کار 6'], ['A5', 'پویان', 'کار 5'], ['A4', 'پویان', 'کار 4'], ['A3', 'پویان', 'کار 3'], ['A2', 'پویان', 'کار 2'],
  ]);
  assert.equal((await getRecentActivity(2)).length, 2);
  for (const role of ['ACCOUNTANT', 'AUDITOR', 'SALES', null]) {
    setTestRole(role);
    assert.deepEqual(await getRecentActivity(), [], String(role));
  }
});
