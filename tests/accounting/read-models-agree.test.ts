import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { prisma, resetDatabase, form } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { createOrder } from '@/actions/sales';
import { returnOrderItem } from '@/actions/order-return';
import { getBalanceSheet, getProfitLossReport, getSalesByCustomer, getSalesByProduct } from '@/actions/reports';
import {
  getBalanceSheet as getReportingBalanceSheet,
  getInventoryValuation,
  getProfitAndLoss,
  getSalesByCustomer as getReportingSalesByCustomer,
  getSalesPerformance,
} from '@/actions/reporting';
import { getSalesByProduct as getAccountingSalesByProduct } from '@/actions/accounting';
import { getSalesAnalytics } from '@/actions/sales-analytics';
import { getDashboardFinancials, getDashboardSales } from '@/actions/dashboard';
import { agentTools } from '@/lib/ai-agent';
import { GET } from '@/app/api/erp/route';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AccountingReportsPage from '@/app/dashboard/accounting/reports/page';
import { openAccount, stockIn } from '../sales/world';

// Pooyan: the same figure must be the same on every screen that shows it. Money in toman at the latest rate
// (src/lib/money-totals.ts), profit on a cost-of-goods-sold basis without capital, loans, exchanges or transfers
// (src/lib/profit-rows.ts), revenue after the discount (src/lib/order-balance.ts, src/lib/product-sales.ts).

console.error = () => {};

const TOKEN = 'read-models-agree-token';
const run = (name: string, params: Record<string, unknown> = {}) => agentTools.find((tool) => tool.name === name)!.execute(params);
const api = async (query: string) =>
  (await GET(new NextRequest(`http://localhost/api/erp?${query}`, { headers: { authorization: `Bearer ${TOKEN}` } }))).json();

beforeEach(async () => {
  process.env.ERP_API_SECRET = TOKEN;
  setTestRole('ADMIN');
  await resetDatabase();
  await prisma.user.create({ data: { id: 'test-user', name: 'Owner', email: 'owner@x.test', password: 'x', role: 'ADMIN' } });
});
after(() => prisma.$disconnect());

test('profit, cash, stock, what is owed and revenue agree on the reports, reporting, dashboard, analytics, AI and API', async () => {
  const bank = await openAccount('بانک', { opening: 100_000_000 });
  await openAccount('دلاری', { currency: 'USD', opening: 1_000 });
  await prisma.exchangeRate.create({ data: { currency: 'USD', rateToToman: 100_000, date: new Date() } });
  // Capital in: money, not profit.
  await prisma.transaction.create({ data: { type: 'INCOME', amount: 50_000_000, amountInToman: 50_000_000, category: 'Shareholder Deposit', accountId: bank.id } });
  await prisma.account.update({ where: { id: bank.id }, data: { balance: { increment: 50_000_000 } } });
  // Rent: an operating expense.
  await prisma.transaction.create({ data: { type: 'EXPENSE', amount: 300_000, amountInToman: 300_000, category: 'اجاره', accountId: bank.id } });
  await prisma.account.update({ where: { id: bank.id }, data: { balance: { decrement: 300_000 } } });

  const store = await prisma.warehouse.create({ data: { name: 'مشاهیر' } });
  const frame = await prisma.product.create({ data: { name: 'PANJ', sku: 'PANJ', costPrice: 400_000, sellPrice: 1_000_000 } });
  const cups = await prisma.product.create({ data: { name: 'لیوان', sku: 'CUP', costPrice: 50_000, sellPrice: 0, productType: 'CONSUMABLE' } });
  await stockIn(frame.id, store.id, 5);
  await stockIn(cups.id, store.id, 10);
  const customer = await prisma.customer.create({ data: { name: 'سارا' } });
  // 2 frames at 1,000,000 less 200,000, paid in full; one comes back: 900,000 refunded, 900,000 stays sold.
  const sale = await createOrder({
    customerId: customer.id, items: [{ productId: frame.id, quantity: 2, price: 1_000_000 }], paymentMethod: 'CASH',
    accountId: bank.id, totalAmount: 2_000_000, discount: 200_000, paidAmount: 1_800_000, warehouseId: store.id,
  });
  assert.equal(sale.success, true, sale.message);
  const order = await prisma.order.findFirstOrThrow({ include: { items: true } });
  const back = await returnOrderItem({}, form({ orderId: order.id, orderItemId: order.items[0].id, quantity: '1', accountId: bank.id, warehouseId: store.id }));
  assert.equal(back.success, true, back.message);

  // Profit: 1,800,000 in, 900,000 refunded, 300,000 rent, one frame's cost 400,000 = 200,000.
  const from = new Date(Date.now() - 86_400_000);
  const to = new Date(Date.now() + 86_400_000);
  const report = await getProfitLossReport(from, to);
  const reporting = await getProfitAndLoss();
  const ai = await run('get_financial_summary', { days: 2 });
  const apiSummary = await api('action=summary');
  assert.deepEqual(
    { report: report.summary.netProfit, reporting: reporting.netProfit, ai: ai.netProfit, api: apiSummary.last30Days.profit },
    { report: 200_000, reporting: 200_000, ai: 200_000, api: 200_000 },
  );
  assert.deepEqual([reporting.totalIncome, reporting.totalExpense], [report.summary.income, report.summary.expenses]);
  assert.deepEqual([ai.totalIncome, ai.totalExpense], [report.summary.income, report.summary.expenses]);
  assert.deepEqual([apiSummary.last30Days.income, apiSummary.last30Days.expense], [report.summary.income, report.summary.expenses]);

  // Cash: every account in toman, the dollars at the latest rate.
  const cash = 100_000_000 + 50_000_000 - 300_000 + 1_800_000 - 900_000 + 1_000 * 100_000;
  const sheet = await getBalanceSheet(new Date());
  const card = await getReportingBalanceSheet();
  assert.deepEqual(
    { dashboard: (await getDashboardFinancials()).totalBalance, sheet: sheet.assets.cash, card: card.assets.cashAndBank, ai: ai.totalBalanceToman, api: apiSummary.totalBalanceToman },
    { dashboard: cash, sheet: cash, card: cash, ai: cash, api: cash },
  );
  // Stock: the frames (4 at 400,000); the consumable is not stock value.
  const valuation = await getInventoryValuation();
  const aiStock = await run('get_inventory_summary');
  const apiStock = await api('action=inventory');
  assert.deepEqual(
    { sheet: sheet.assets.inventory, card: card.assets.inventory, valuation: valuation.totalValue, ai: aiStock.totalValue, api: apiStock.totals.valueAtCost },
    { sheet: 1_600_000, card: 1_600_000, valuation: 1_600_000, ai: 1_600_000, api: 1_600_000 },
  );
  // The whole balance sheet is the same on both pages.
  assert.deepEqual(
    [card.assets.total, card.liabilities.total, card.equity.total],
    [sheet.assets.total, sheet.liabilities.total, sheet.equity.total],
  );

  // Revenue from the customer: the frame that stayed sold, after its share of the discount.
  const analytics = await getSalesAnalytics({ startDate: from, endDate: to });
  const aiSales = await run('get_sales_summary', { days: 2 });
  assert.deepEqual(
    {
      reports: (await getSalesByCustomer(from, to))[0].revenue,
      reporting: (await getReportingSalesByCustomer()).topCustomers[0].total,
      analytics: analytics!.topCustomers[0].revenue,
      analyticsTotal: analytics!.summary.totalRevenue,
      dashboard: (await getDashboardSales()).today.total,
      ai: aiSales.totalRevenue,
      aiCustomer: (await run('get_customer_info', { customerId: customer.id })).totalSpent,
    },
    { reports: 900_000, reporting: 900_000, analytics: 900_000, analyticsTotal: 900_000, dashboard: 900_000, ai: 900_000, aiCustomer: 900_000 },
  );
  // Revenue and units by product: the same on every product list.
  const product = (rows: any[], name = 'name', revenue = 'revenue', units = 'quantity') =>
    rows.filter((row) => row[name] === 'PANJ').map((row) => [row[units], row[revenue]])[0];
  assert.deepEqual(
    {
      reports: product(await getSalesByProduct(from, to)),
      reporting: product((await getSalesPerformance()).topProducts, 'name', 'total'),
      accounting: product(await getAccountingSalesByProduct(), 'name', 'total'),
      analytics: product(analytics!.topProducts),
      dashboard: product((await getDashboardSales()).topProducts, 'name', 'units', 'units'),
    },
    { reports: [1, 900_000], reporting: [1, 900_000], accounting: [1, 900_000], analytics: [1, 900_000], dashboard: [1, 1] },
  );
});

test('the accounting reports page shows every asset and liability line, and they add up to its totals', async () => {
  (globalThis as any).React = React;
  await openAccount('بانک', { opening: 10_000_000 });
  const own = await prisma.warehouse.create({ data: { name: 'مشاهیر' } });
  const partner = await prisma.customer.create({ data: { name: 'همکار' } });
  const atPartner = await prisma.warehouse.create({ data: { name: 'امانی', isVirtual: true, customerId: partner.id } });
  const frame = await prisma.product.create({ data: { name: 'PANJ', sku: 'PANJ', costPrice: 400_000, sellPrice: 1_000_000 } });
  await stockIn(frame.id, own.id, 3);
  await stockIn(frame.id, atPartner.id, 2);
  await prisma.order.create({ data: { customerId: partner.id, totalAmount: 1_000_000, paidAmount: 0, paymentStatus: 'UNPAID' } });

  const sheet = await getReportingBalanceSheet();
  const lines = [sheet.assets.cashAndBank, sheet.assets.inventory, sheet.assets.consignmentInventory, sheet.assets.accountsReceivable, sheet.assets.prepaidPurchases];
  assert.deepEqual(lines, [10_000_000, 1_200_000, 800_000, 1_000_000, 0]);
  assert.equal(lines.reduce((sum, v) => sum + v, 0), sheet.assets.total);
  const html = renderToStaticMarkup(await AccountingReportsPage());
  for (const [label, value] of [
    ['نقد و بانک', sheet.assets.cashAndBank], ['ارزش موجودی کالا', sheet.assets.inventory], ['کالای امانی نزد همکاران', sheet.assets.consignmentInventory],
    ['حساب‌های دریافتنی', sheet.assets.accountsReceivable], ['پیش‌پرداخت خرید', sheet.assets.prepaidPurchases], ['جمع دارایی‌ها', sheet.assets.total],
    ['بدهی به تأمین‌کنندگان', sheet.liabilities.accountsPayable], ['جمع بدهی‌ها', sheet.liabilities.total],
  ] as Array<[string, number]>) {
    assert.match(html, new RegExp(`${label}:</span><span[^>]*>${value.toLocaleString('fa-IR')}</span>`), label);
  }
});
