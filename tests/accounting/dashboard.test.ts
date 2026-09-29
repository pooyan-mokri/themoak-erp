import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { prisma, resetDatabase } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { getDashboardFinancials, getDashboardSales, getLowStockItems, getRecentActivity, getUserTasks } from '@/actions/dashboard';
import { getSalesByProduct } from '@/actions/accounting';
import { getARAgingReport } from '@/actions/invoice';
import { getBalanceSheet } from '@/actions/reports';
import { receivePurchaseOrderItems } from '@/actions/supplier';
import { recordArrival, recordPurchasePartialPayment, updatePurchaseOrderStatus } from '@/actions/supplier-workflow';
import { FinancialCards } from '@/components/dashboard/financial-cards';
import { BalanceSheetReport } from '@/components/reports/balance-sheet-report';
import { cashPosition, unpaidOnPurchaseOrder } from '@/lib/money-totals';
import { assertBooksAddUp, openAccount } from './ledger';

(globalThis as any).React = React;
// The actions log every refusal these tests provoke on purpose.
console.error = () => {};

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
});
after(() => prisma.$disconnect());

/** Accounts of every type: Toman, dollars at the latest rate, euros with no rate, and a P&L bucket. */
async function seedAccounts() {
  await openAccount('saman', 50_000_000, 'TOMAN', { type: 'BANK' });
  await openAccount('cash', 10_000_000, 'TOMAN', { type: 'CASH' });
  await openAccount('person', 5_000_000, 'TOMAN', { type: 'PERSON' });
  await openAccount('usd', 1_000, 'USD', { type: 'BANK' });
  await openAccount('usd-cash', 250.5, 'USD', { type: 'CASH' });
  await openAccount('usdt', 300, 'USD', { type: 'CRYPTO' });
  await openAccount('eur', 200, 'EUR', { type: 'CASH' });
  // A P&L bucket, never money.
  await prisma.account.create({ data: { name: 'COGS', type: 'EXPENSE', currency: 'TOMAN', balance: -9_000_000 } });
  // An older dollar rate and the latest one; no euro rate at all.
  await prisma.exchangeRate.create({ data: { currency: 'USD', rateToToman: 90_000, date: new Date('2026-09-01T08:00:00Z') } });
  await prisma.exchangeRate.create({ data: { currency: 'USD', rateToToman: 100_000, date: new Date('2026-09-20T08:00:00Z') } });
}

// 65M Toman + 1,550.5 dollars at 100,000.
const TOTAL = 65_000_000 + 155_050_000;

test('«موجودی کل» adds every account that holds money, dollars at the latest rate; a currency with no rate is listed, not added', async () => {
  await seedAccounts();
  const financials = await getDashboardFinancials();

  assert.equal(financials.totalBalance, TOTAL);
  assert.deepEqual(
    financials.balancesByType.map((t: any) => [t.type, t.total]).sort(),
    [['BANK', 150_000_000], ['CASH', 35_050_000], ['CRYPTO', 30_000_000], ['PERSON', 5_000_000]],
  );
  assert.deepEqual(financials.foreignBalances, [
    { currency: 'USD', total: 1_550.5, rate: 100_000, rateDate: new Date('2026-09-20T08:00:00Z'), approxToman: 155_050_000 },
  ]);
  assert.deepEqual(financials.unpricedBalances, [{ currency: 'EUR', total: 200 }]);
  await assertBooksAddUp();
});

test('the dashboard card shows the total, its account types, the rate and date used, and a currency with no rate', async () => {
  await seedAccounts();
  const html = renderToStaticMarkup(React.createElement(FinancialCards, { financials: await getDashboardFinancials() }));
  // The card shows the figure, with its unit beside it (src/components/dashboard/kpi-card.tsx).
  assert.ok(/>۲۲۰٬۰۵۰٬۰۰۰<small[^>]*>تومان</.test(html), 'the total');
  assert.ok(html.includes('بانک: ۱۵۰٬۰۰۰٬۰۰۰ تومان'));
  assert.ok(html.includes('شخص: ۵٬۰۰۰٬۰۰۰ تومان'));
  assert.ok(html.includes('کیف پول دیجیتال: ۳۰٬۰۰۰٬۰۰۰ تومان'));
  assert.ok(html.includes('شامل ۱٬۵۵۰٫۵ USD'), 'the dollars it includes');
  assert.ok(html.includes('نرخ ۱۰۰٬۰۰۰ در ۱۴۰۵/۰۶/۲۹'), 'the rate and its Jalali date');
  assert.ok(html.includes('۲۰۰ EUR: نرخی ثبت نشده است (در جمع نیست)'), 'a currency with no rate says so');
});

test('with only an empty Toman account the total is 0 and there is no foreign line', async () => {
  await prisma.account.create({ data: { name: 'تازه', type: 'BANK', currency: 'TOMAN', balance: 0 } });
  const financials = await getDashboardFinancials();
  assert.equal(financials.totalBalance, 0);
  assert.deepEqual([financials.foreignBalances, financials.unpricedBalances], [[], []]);
});

test('the balance sheet\'s cash is the dashboard\'s «موجودی کل», and it is in the total assets', async () => {
  await seedAccounts();
  const sheet = await getBalanceSheet(new Date());
  assert.equal(sheet.assets.cash, TOTAL);
  assert.equal((await getDashboardFinancials()).totalBalance, sheet.assets.cash);
  assert.deepEqual(sheet.assets.unpricedCash, [{ currency: 'EUR', total: 200 }]);
  assert.equal(sheet.assets.total, TOTAL, 'nothing else is on this balance sheet');
  assert.equal(sheet.equity.total, sheet.assets.total - sheet.liabilities.total);

  // Once the euro has a rate, it is added too.
  await prisma.exchangeRate.create({ data: { currency: 'EUR', rateToToman: 110_000, date: new Date('2026-09-21T08:00:00Z') } });
  const priced = await getBalanceSheet(new Date());
  assert.equal(priced.assets.cash, TOTAL + 22_000_000);
  assert.deepEqual(priced.assets.unpricedCash, []);

  const html = renderToStaticMarkup(React.createElement(BalanceSheetReport, { data: priced }));
  assert.ok(html.includes('شامل USD'));
  assert.ok(html.includes('نرخ ۱۱۰٬۰۰۰ در ۱۴۰۵/۰۶/۳۰'));
  assert.ok(html.includes('کیف پول دیجیتال'));
});

test('cashPosition sums in exact decimals', () => {
  const position = cashPosition(
    [
      { type: 'BANK', currency: 'USD', balance: '0.1' },
      { type: 'BANK', currency: 'USD', balance: '0.2' },
      { type: 'CASH', currency: 'TOMAN', balance: '1000000000000' },
      { type: 'CASH', currency: 'TOMAN', balance: '-250' },
    ],
    [{ currency: 'USD', rateToToman: '100000', date: new Date('2026-09-20') }],
  );
  assert.equal(position.total, 999_999_999_750 + 30_000);
  assert.equal(position.foreign[0].total, 0.3);
  assert.equal(position.foreign[0].approxToman, 30_000);
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

test('low stock lists the stock products with 3 or fewer units in all, the least first, at most ten', async () => {
  // Pooyan's rule: low stock is 3 units or fewer, everywhere (src/lib/stock-levels.ts).
  const [a, b] = [await prisma.warehouse.create({ data: { name: 'الف' } }), await prisma.warehouse.create({ data: { name: 'ب' } })];
  for (let i = 0; i < 13; i++) {
    const product = await prisma.product.create({ data: { name: `P${i}`, sku: `S${i}`, costPrice: 1, sellPrice: 1 } });
    await prisma.inventory.create({ data: { productId: product.id, warehouseId: a.id, quantity: i } });
    // 2 + 2 in two warehouses is 4: not low.
    if (i === 2) await prisma.inventory.create({ data: { productId: product.id, warehouseId: b.id, quantity: 2 } });
  }
  // A consumable is not stock (src/lib/stock-levels.ts STOCK_TYPES).
  const cups = await prisma.product.create({ data: { name: 'لیوان', sku: 'CUP', costPrice: 1, sellPrice: 1, productType: 'CONSUMABLE' } });
  await prisma.inventory.create({ data: { productId: cups.id, warehouseId: a.id, quantity: 0 } });
  const low = await getLowStockItems();
  assert.deepEqual(low.map((p: any) => [p.sku, p.totalStock]), [['S0', 0], ['S1', 1], ['S3', 3]]);

  for (let i = 0; i < 12; i++) await prisma.product.create({ data: { name: `Z${i}`, sku: `Z${i}`, costPrice: 1, sellPrice: 1 } });
  assert.equal((await getLowStockItems()).length, 10);
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

// ─── The same figure on every screen ─────────────────────────────────────────

test('«مطالبات» on the dashboard is the total of the receivables aging report', async () => {
  const [sara, reza] = await Promise.all([prisma.customer.create({ data: { name: 'سارا' } }), prisma.customer.create({ data: { name: 'رضا' } })]);
  const order = (customerId: string | null, totalAmount: number, paidAmount: number, paymentStatus: string, createdAt: Date, status = 'COMPLETED') =>
    prisma.order.create({ data: { customerId, totalAmount, paidAmount, paymentStatus, createdAt, status } });
  await order(sara.id, 10_000_000, 0, 'UNPAID', new Date());
  await order(sara.id, 8_000_000, 3_000_000, 'PARTIAL', new Date(Date.now() - 45 * 86_400_000));
  await order(reza.id, 4_000_000, 1_000_000, 'PARTIAL', new Date(Date.now() - 100 * 86_400_000));
  await order(reza.id, 9_000_000, 0, 'UNPAID', new Date(), 'CANCELLED');
  await order(null, 6_000_000, 0, 'UNPAID', new Date());

  const aging = await getARAgingReport();
  const agingTotal = aging.reduce((sum: number, row: any) => sum + row.totalDue, 0);
  assert.equal(agingTotal, 18_000_000);
  assert.equal((await getDashboardFinancials()).totalReceivables, agingTotal);
});

test('the balance sheet values own and consignment stock at cost', async () => {
  const own = await prisma.warehouse.create({ data: { name: 'مشاهیر' } });
  const partner = await prisma.warehouse.create({ data: { name: 'امانی', isVirtual: true } });
  const product = await prisma.product.create({ data: { name: 'PANJ', sku: 'P1', costPrice: 4_000_000, sellPrice: 10_000_000 } });
  await prisma.inventory.create({ data: { productId: product.id, warehouseId: own.id, quantity: 3 } });
  await prisma.inventory.create({ data: { productId: product.id, warehouseId: partner.id, quantity: 2 } });
  const sheet = await getBalanceSheet(new Date());
  assert.deepEqual([sheet.assets.inventory, sheet.assets.consignmentInventory], [12_000_000, 8_000_000]);
  assert.equal(sheet.assets.total, 20_000_000 + sheet.assets.cash + sheet.assets.accountsReceivable);
});

test('the balance sheet owes for goods received and unpaid, and holds what was paid beyond the goods received', async () => {
  const product = await prisma.product.create({ data: { name: 'PANJ', sku: 'P1', costPrice: 0, sellPrice: 1 } });
  const withLines = async (status: string, total: number, paid: number[], received: number) => {
    const order = await purchaseOrder(status, total, paid);
    await prisma.purchaseOrderItem.create({
      data: { purchaseOrderId: order.id, productId: product.id, quantity: 10, unitCost: total / 10, unitCostInToman: total / 10, currency: 'TOMAN', receivedQuantity: received },
    });
    return order;
  };
  await withLines('PENDING_PAYMENT', 30_000_000, [], 0); // placed only: a commitment
  await withLines('PARTIALLY_PAID', 20_000_000, [8_000_000], 0); // 8M prepaid
  const arrived = await withLines('ARRIVED', 5_000_000, [5_000_000], 0); // 5M + 1M arrival prepaid
  await prisma.purchaseOrderArrivalCost.create({ data: { purchaseOrderId: arrived.id, title: 'گمرک', amount: 1_000_000, currency: 'TOMAN', amountInToman: 1_000_000 } });
  await withLines('PARTIALLY_RECEIVED', 10_000_000, [2_000_000], 6); // 6M received, 2M paid: owes 4M
  await withLines('PARTIALLY_RECEIVED', 10_000_000, [9_000_000], 4); // 4M received, 9M paid: 5M prepaid
  await withLines('RECEIVED', 8_000_000, [8_000_000], 10); // settled
  await purchaseOrder('RECEIVED', 3_000_000, []); // received the old way, no quantities: owes 3M
  await withLines('DRAFT', 9_000_000, [], 0);
  await withLines('CANCELLED', 7_000_000, [2_000_000], 0);

  const sheet = await getBalanceSheet(new Date());
  assert.equal(sheet.liabilities.accountsPayable, 4_000_000 + 3_000_000);
  assert.equal(sheet.assets.prepaidPurchases, 8_000_000 + 6_000_000 + 5_000_000);
  assert.equal(sheet.equity.total, sheet.assets.total - sheet.liabilities.total);
  // The dashboard's operational figure: everything still to pay on placed orders.
  assert.equal((await getDashboardFinancials()).totalPayables, 30_000_000 + 12_000_000 + 8_000_000 + 1_000_000 + 3_000_000);

  const html = renderToStaticMarkup(React.createElement(BalanceSheetReport, { data: sheet }));
  assert.ok(html.includes('پیش‌پرداخت خرید'));
  // The blocks name the unit once, in their header (تومان), and show the figures in the rows.
  assert.ok(html.includes('>۱۹٬۰۰۰٬۰۰۰<'));
  assert.ok(html.includes('>۷٬۰۰۰٬۰۰۰<'));
  const card = renderToStaticMarkup(React.createElement(FinancialCards, { financials: await getDashboardFinancials() }));
  assert.ok(card.includes('مانده پرداخت به تأمین‌کنندگان'));
});

test('placing, paying and receiving an order each leave equity where it was', async () => {
  await openAccount('bank', 100_000_000);
  const warehouse = await prisma.warehouse.create({ data: { name: 'مشاهیر' } });
  const product = await prisma.product.create({ data: { name: 'PANJ', sku: 'P1', costPrice: 0, sellPrice: 1 } });
  const supplier = await prisma.supplier.create({ data: { name: 'تامین‌کننده' } });
  const order = (total: number) =>
    prisma.purchaseOrder.create({
      data: {
        supplierId: supplier.id, status: 'DRAFT', totalAmount: total, totalAmountInToman: total,
        items: { create: [{ productId: product.id, quantity: 10, unitCost: total / 10, unitCostInToman: total / 10, currency: 'TOMAN' }] },
      },
      include: { items: true },
    });
  const equity = async () => (await getBalanceSheet(new Date())).equity.total;
  const same = async (before: number, step: string) => assert.ok(Math.abs((await equity()) - before) < 1, `${step}: ${await equity()} ≠ ${before}`);
  const ok = (r: { success?: boolean; message?: string }) => assert.equal(r.success, true, r.message);
  const start = await equity();

  // Paid ahead: place, pay, arrive (an arrival cost paid), receive.
  const ahead = await order(20_000_000);
  ok(await updatePurchaseOrderStatus(ahead.id, 'PENDING_PAYMENT'));
  await same(start, 'placed');
  assert.deepEqual([(await getBalanceSheet(new Date())).liabilities.accountsPayable, (await getBalanceSheet(new Date())).assets.prepaidPurchases], [0, 0]);
  ok(await recordPurchasePartialPayment({ orderId: ahead.id, accountId: 'bank', amount: 20_000_000 }));
  await same(start, 'paid');
  assert.equal((await getBalanceSheet(new Date())).assets.prepaidPurchases, 20_000_000);
  ok(await updatePurchaseOrderStatus(ahead.id, 'IN_PRODUCTION'));
  ok(await recordArrival(ahead.id, [{ title: 'حمل', amount: 2_000_000, currency: 'TOMAN' }], 'bank'));
  await same(start, 'arrived, its freight paid');
  ok(await receivePurchaseOrderItems(ahead.id, warehouse.id, [{ itemId: ahead.items[0].id, receivedQuantity: 10 }]));
  await same(start, 'received');
  let sheet = await getBalanceSheet(new Date());
  assert.deepEqual([sheet.assets.inventory, sheet.assets.prepaidPurchases, sheet.liabilities.accountsPayable], [22_000_000, 0, 0]);

  // Received before it is paid: half, then paid, then the rest.
  const later = await order(10_000_000);
  ok(await updatePurchaseOrderStatus(later.id, 'PENDING_PAYMENT'));
  await same(start, 'second order placed');
  // Goods are received once arrived, which the lifecycle reaches only when paid; an older order
  // could be received first, and the balance sheet must still hold for it.
  await prisma.purchaseOrder.update({ where: { id: later.id }, data: { status: 'ARRIVED' } });
  ok(await receivePurchaseOrderItems(later.id, warehouse.id, [{ itemId: later.items[0].id, receivedQuantity: 5 }]));
  await same(start, 'half received, unpaid');
  assert.equal((await getBalanceSheet(new Date())).liabilities.accountsPayable, 5_000_000);
  // The payment form takes an order waiting for payment; an order received first is paid the same way.
  await prisma.purchaseOrder.update({ where: { id: later.id }, data: { status: 'PENDING_PAYMENT' } });
  ok(await recordPurchasePartialPayment({ orderId: later.id, accountId: 'bank', amount: 10_000_000 }));
  await prisma.purchaseOrder.update({ where: { id: later.id }, data: { status: 'PARTIALLY_RECEIVED' } });
  await same(start, 'paid in full');
  sheet = await getBalanceSheet(new Date());
  assert.deepEqual([sheet.liabilities.accountsPayable, sheet.assets.prepaidPurchases], [0, 5_000_000]);
  ok(await receivePurchaseOrderItems(later.id, warehouse.id, [{ itemId: later.items[0].id, receivedQuantity: 5 }]));
  await same(start, 'the rest received');
  sheet = await getBalanceSheet(new Date());
  assert.deepEqual([sheet.assets.prepaidPurchases, sheet.liabilities.accountsPayable], [0, 0]);
  await assertBooksAddUp();
});
