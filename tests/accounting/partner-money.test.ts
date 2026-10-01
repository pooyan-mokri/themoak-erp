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
import AccountingReportsPage from '@/app/dashboard/accounting/reports/page';
import { BalanceSheetReport } from '@/components/reports/balance-sheet-report';
import { BalanceSheetCard } from '@/components/reporting/balance-sheet-card';
import { DEPOSIT_CATEGORIES, EXPENSE_CATEGORIES, PAYMENT_CATEGORIES } from '@/components/accounting/entry-categories';
import {
  PARTNER_LOAN_CATEGORY,
  PARTNER_LOAN_REPAYMENT_CATEGORY,
  PARTNER_WITHDRAWAL_CATEGORY,
  profitLine,
} from '@/lib/profit-rows';
import { assertBooksAddUp, balanceOf, openAccount } from './ledger';

// Pooyan, 2026-10-01: money lent to a partner («قرض به شریک») and its repayment («بازپرداخت قرض شریک») are
// neither expense nor revenue; the balance sheet shows «طلب از شرکا» = lent − repaid, only when it is not 0.
// A partner's withdrawal booked without a shareholder («برداشت شریک») stays out of profit and loss too.

console.error = () => {};
(globalThis as any).React = React;

const FROM = new Date('2026-01-01T00:00:00Z');
const TO = new Date('2027-12-31T23:59:59Z');
const day = '2026-07-20T00:00:00.000Z';
const ok = (result: { success?: boolean; message?: string }) => assert.equal(result.success, true, result.message);

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
  await openAccount('bank', 3_000_000_000);
});
after(() => prisma.$disconnect());

test('the expense, payment and deposit forms offer the partner loan and its repayment', () => {
  assert.ok(EXPENSE_CATEGORIES.some((c) => c.value === PARTNER_LOAN_CATEGORY));
  assert.ok(PAYMENT_CATEGORIES.includes(PARTNER_LOAN_CATEGORY));
  assert.ok(DEPOSIT_CATEGORIES.includes(PARTNER_LOAN_REPAYMENT_CATEGORY));
  for (const [type, category] of [
    ['EXPENSE', PARTNER_LOAN_CATEGORY],
    ['INCOME', PARTNER_LOAN_REPAYMENT_CATEGORY],
    ['EXPENSE', PARTNER_WITHDRAWAL_CATEGORY],
  ]) {
    assert.equal(profitLine({ type, category }), null, category);
  }
});

test('a loan to a partner and its repayment stay out of profit; «طلب از شرکا» is what is still owed', async () => {
  ok(await recordExpense(undefined as any, form({ amount: '500000000', currency: 'TOMAN', category: PARTNER_LOAN_CATEGORY, accountId: 'bank', description: 'سهم شریک از ودیعه', date: day })));
  ok(await recordWithdrawal(undefined as any, form({ amount: '34000000', currency: 'TOMAN', accountId: 'bank', payee: 'شریک', category: PARTNER_LOAN_CATEGORY, date: day })));
  ok(await recordDeposit(undefined as any, form({ amount: '300000000', currency: 'TOMAN', accountId: 'bank', description: 'بازپرداخت', category: PARTNER_LOAN_REPAYMENT_CATEGORY, date: day })));
  ok(await recordExpense(undefined as any, form({ amount: '20000000', currency: 'TOMAN', category: 'Rent', accountId: 'bank', description: 'اجاره', date: day })));
  await prisma.transaction.create({
    data: { type: 'EXPENSE', category: PARTNER_WITHDRAWAL_CATEGORY, amount: 5_000_000, amountInToman: 5_000_000, accountId: 'bank', date: new Date(day) },
  });
  await prisma.account.update({ where: { id: 'bank' }, data: { balance: { decrement: 5_000_000 } } });
  assert.equal(await balanceOf('bank'), 3_000_000_000 - 500_000_000 - 34_000_000 + 300_000_000 - 20_000_000 - 5_000_000);
  await assertBooksAddUp();

  // Only the rent is in profit and loss, on every reader of it.
  const pl = await getProfitLossReport(FROM, TO);
  assert.deepEqual([pl.summary.income, pl.summary.operatingExpenses], [0, 20_000_000]);
  assert.deepEqual(await getProfitAndLoss(), { totalIncome: 0, totalExpense: 20_000_000, netProfit: -20_000_000 });
  assert.deepEqual(await getExpenseBreakdown(), [{ category: 'Rent', amount: 20_000_000 }]);
  await prisma.shareholder.create({ data: { name: 'Ali', percentage: 100 } });
  await recordDeposit(undefined as any, form({ amount: '50000000', currency: 'TOMAN', accountId: 'bank', description: 'فروش', category: 'واریز بانکی', date: day }));
  ok(await calculateShareholderProfits(undefined as any, form({ periodStart: '2026-07-01T00:00:00.000Z', periodEnd: '2026-07-31T00:00:00.000Z' })));
  assert.deepEqual((await getShareholderProfits()).map((p: any) => p.periodNetProfit), [30_000_000]);

  // The balance sheet: lent 534 million, 300 back.
  const sheet = await getBalanceSheet(new Date());
  assert.equal(sheet.assets.partnerLoans, 234_000_000);
  assert.equal(sheet.assets.total, sheet.assets.cash + 234_000_000);
  const card = await getReportingBalanceSheet();
  assert.equal(card.assets.partnerLoans, 234_000_000);
  const html = renderToStaticMarkup(React.createElement(BalanceSheetReport, { data: sheet }));
  assert.ok(html.includes('طلب از شرکا') && html.includes('>۲۳۴٬۰۰۰٬۰۰۰<'));
  assert.ok(renderToStaticMarkup(React.createElement(BalanceSheetCard, { data: card })).includes('طلب از شرکا:</span><span>۲۳۴٬۰۰۰٬۰۰۰</span>'));
  assert.match(renderToStaticMarkup(await AccountingReportsPage()), /طلب از شرکا:<\/span><span[^>]*>۲۳۴٬۰۰۰٬۰۰۰<\/span>/);

  // Repaid in full: the line is 0 and no screen shows it.
  ok(await recordDeposit(undefined as any, form({ amount: '234000000', currency: 'TOMAN', accountId: 'bank', description: 'بازپرداخت', category: PARTNER_LOAN_REPAYMENT_CATEGORY, date: day })));
  const settled = await getBalanceSheet(new Date());
  assert.equal(settled.assets.partnerLoans, 0);
  assert.ok(!renderToStaticMarkup(React.createElement(BalanceSheetReport, { data: settled })).includes('طلب از شرکا'));
  assert.ok(!renderToStaticMarkup(React.createElement(BalanceSheetCard, { data: await getReportingBalanceSheet() })).includes('طلب از شرکا'));
  assert.ok(!renderToStaticMarkup(await AccountingReportsPage()).includes('طلب از شرکا'));
});
