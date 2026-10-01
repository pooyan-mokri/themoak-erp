import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { prisma, resetDatabase, form } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { getBalanceSheet, getProfitLossReport } from '@/actions/reports';
import { getBalanceSheet as getReportingBalanceSheet, getProfitAndLoss } from '@/actions/reporting';
import { getExpenseBreakdown, recordDeposit, recordExpense, recordWithdrawal } from '@/actions/accounting';
import { calculateShareholderProfits, getShareholderProfits } from '@/actions/shareholder-profit';
import { BalanceSheetReport } from '@/components/reports/balance-sheet-report';
import { BalanceSheetCard } from '@/components/reporting/balance-sheet-card';
import { DEPOSIT_CATEGORIES, EXPENSE_CATEGORIES, PAYMENT_CATEGORIES } from '@/components/accounting/entry-categories';
import { categoryLabel } from '@/lib/category-labels';
import { RENT_DEPOSIT_CATEGORY, RENT_DEPOSIT_RETURN_CATEGORY, profitLine } from '@/lib/profit-rows';
import { assertBooksAddUp, balanceOf, openAccount } from './ledger';

// Pooyan, 2026-10-01: a rent deposit («ودیعه اجاره») is an asset, not an expense.
// It stays out of profit and loss and the expense breakdown, and the balance
// sheet shows «ودیعه‌ها» = deposits paid − deposits returned («بازگشت ودیعه»).

console.error = () => {};
// The components are compiled with the classic JSX runtime.
(globalThis as any).React = React;

const FROM = new Date('2026-01-01T00:00:00Z');
const TO = new Date('2027-12-31T23:59:59Z');
const ok = (result: { success?: boolean; message?: string }) => assert.equal(result.success, true, result.message);

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
  await openAccount('bank', 3_000_000_000);
});
after(() => prisma.$disconnect());

test('the expense, payment and deposit forms offer the deposit categories, named in Persian', () => {
  assert.ok(EXPENSE_CATEGORIES.some((c) => c.value === RENT_DEPOSIT_CATEGORY));
  assert.ok(PAYMENT_CATEGORIES.includes(RENT_DEPOSIT_CATEGORY));
  assert.ok(DEPOSIT_CATEGORIES.includes(RENT_DEPOSIT_RETURN_CATEGORY));
  assert.equal(categoryLabel(RENT_DEPOSIT_CATEGORY), 'ودیعه اجاره (دارایی)');
  assert.equal(categoryLabel(RENT_DEPOSIT_RETURN_CATEGORY), 'بازگشت ودیعه');
});

test('a deposit paid or returned is no line of profit and loss; rent is still an expense', () => {
  assert.equal(profitLine({ type: 'EXPENSE', category: RENT_DEPOSIT_CATEGORY }), null);
  assert.equal(profitLine({ type: 'INCOME', category: RENT_DEPOSIT_RETURN_CATEGORY }), null);
  assert.equal(profitLine({ type: 'EXPENSE', category: 'Rent' }), 'expense');
  assert.equal(profitLine({ type: 'INCOME', category: 'واریز بانکی' }), 'revenue');
});

test('deposits paid from the expense and payment forms are an asset; one returned lowers it and is not revenue', async () => {
  const day = '2026-07-20T00:00:00.000Z';
  ok(await recordExpense(undefined as any, form({ amount: '500000000', currency: 'TOMAN', category: RENT_DEPOSIT_CATEGORY, accountId: 'bank', description: 'بخشی از ودیعه showroom', date: day })));
  ok(await recordWithdrawal(undefined as any, form({ amount: '200000000', currency: 'TOMAN', accountId: 'bank', payee: 'موجر', category: RENT_DEPOSIT_CATEGORY, date: day })));
  ok(await recordExpense(undefined as any, form({ amount: '50000000', currency: 'TOMAN', category: 'Rent', accountId: 'bank', description: 'اجاره تیر', date: day })));
  ok(await recordDeposit(undefined as any, form({ amount: '100000000', currency: 'TOMAN', accountId: 'bank', description: 'بازگشت بخشی از ودیعه', category: RENT_DEPOSIT_RETURN_CATEGORY, date: day })));
  ok(await recordDeposit(undefined as any, form({ amount: '100000000', currency: 'TOMAN', accountId: 'bank', description: 'واریز', category: 'واریز بانکی', date: day })));

  // The money really moved: the bank paid both deposits and got one part back.
  assert.equal(await balanceOf('bank'), 3_000_000_000 - 500_000_000 - 200_000_000 - 50_000_000 + 100_000_000 + 100_000_000);
  await assertBooksAddUp();

  // Profit and loss: the rent and the plain deposit only, on every P&L.
  const pl = await getProfitLossReport(FROM, TO);
  assert.deepEqual([pl.summary.income, pl.summary.operatingExpenses, pl.summary.netProfit], [100_000_000, 50_000_000, 50_000_000]);
  assert.deepEqual(Object.keys(pl.expensesByCategory), ['Rent']);
  assert.deepEqual(Object.keys(pl.incomeByCategory), ['واریز بانکی']);
  assert.deepEqual(await getProfitAndLoss(), { totalIncome: 100_000_000, totalExpense: 50_000_000, netProfit: 50_000_000 });
  assert.deepEqual(await getExpenseBreakdown(), [{ category: 'Rent', amount: 50_000_000 }]);
  // Nor does a deposit come off the profit the shareholders share.
  await prisma.shareholder.create({ data: { name: 'Ali', percentage: 100 } });
  ok(await calculateShareholderProfits(undefined as any, form({ periodStart: '2026-07-01T00:00:00.000Z', periodEnd: '2026-07-31T00:00:00.000Z' })));
  assert.deepEqual((await getShareholderProfits()).map((p: any) => [p.amount, p.periodNetProfit]), [[50_000_000, 50_000_000]]);

  // The balance sheet: «ودیعه‌ها» = 700 − 100 million; paying a deposit moved cash into it, so
  // equity is the opening balance plus the profit.
  const sheet = await getBalanceSheet(new Date());
  assert.equal(sheet.assets.rentDeposits, 600_000_000);
  assert.equal(sheet.assets.cash, 2_450_000_000);
  assert.equal(sheet.assets.total, 3_050_000_000);
  assert.equal(sheet.equity.total, 3_000_000_000 + 50_000_000);
  const card = await getReportingBalanceSheet();
  assert.equal(card.assets.rentDeposits, 600_000_000);
  assert.equal(card.assets.total, sheet.assets.total);

  // Both balance-sheet screens name the line.
  const html = renderToStaticMarkup(React.createElement(BalanceSheetReport, { data: sheet }));
  assert.ok(html.includes('ودیعه‌ها'));
  assert.ok(html.includes('>۶۰۰٬۰۰۰٬۰۰۰<'));
  const cardHtml = renderToStaticMarkup(React.createElement(BalanceSheetCard, { data: card }));
  assert.ok(cardHtml.includes('ودیعه‌ها:</span><span>۶۰۰٬۰۰۰٬۰۰۰</span>'));
});

test('a deposit paid in dollars counts at its Toman equivalent', async () => {
  await openAccount('usd', 10_000, 'USD');
  await prisma.exchangeRate.create({ data: { currency: 'USD', rateToToman: 100_000, date: new Date('2026-07-01T00:00:00Z') } });
  ok(await recordExpense(undefined as any, form({ amount: '1000', currency: 'USD', category: RENT_DEPOSIT_CATEGORY, accountId: 'usd', description: 'ودیعه' })));
  assert.equal((await getBalanceSheet(new Date())).assets.rentDeposits, 100_000_000);
  assert.equal((await getProfitLossReport(FROM, TO)).summary.operatingExpenses, 0);
});
