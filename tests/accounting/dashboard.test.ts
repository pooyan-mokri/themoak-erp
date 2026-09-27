import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { prisma, resetDatabase } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { getDashboardFinancials } from '@/actions/dashboard';
import { getBalanceSheet } from '@/actions/reports';
import { FinancialCards } from '@/components/dashboard/financial-cards';
import { BalanceSheetReport } from '@/components/reports/balance-sheet-report';
import { totalsByCurrency } from '@/lib/money-totals';
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
