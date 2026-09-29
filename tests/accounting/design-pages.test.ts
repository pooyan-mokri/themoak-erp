import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { prisma, resetDatabase, form } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { recordExpense, recordWithdrawal } from '@/actions/accounting';
import { getDashboardFinancials } from '@/actions/dashboard';
import { balanceEffect } from '@/lib/balance-reconciliation';
import AccountingPage from '../../src/app/dashboard/accounting/page';
import AccountsPage from '../../src/app/dashboard/accounting/accounts/page';
import NewExpensePage from '../../src/app/dashboard/accounting/expenses/new/page';
import NewWithdrawalPage from '../../src/app/dashboard/accounting/withdrawals/new/page';
import { KpiCard } from '@/components/dashboard/kpi-card';
import { AccountingHubTiles } from '@/components/accounting/accounting-hub';
import { AccountList } from '@/components/accounting/account-list';
import { ExpenseForm } from '@/components/accounting/expense-form';
import { WithdrawalForm } from '@/components/accounting/withdrawal-form';
import { amountInWords } from '@/components/accounting/amount-words';
import { directionOf } from '@/components/accounting/money-direction';
import { openAccount } from './ledger';

// tsx compiles the page's JSX to React.createElement without importing React.
(globalThis as any).React = React;

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
});
after(() => prisma.$disconnect());

/** Every element of `type` in a rendered server page, in order. */
function allPropsOf(node: any, type: unknown, found: any[] = []): any[] {
  if (!node || typeof node !== 'object') return found;
  if (Array.isArray(node)) {
    for (const child of node) allPropsOf(child, type, found);
    return found;
  }
  if (node.type === type) found.push(node.props);
  return allPropsOf(node.props?.children, type, found);
}

const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

test('an amount is written out in Persian words, with its currency', () => {
  assert.equal(amountInWords(12_400_000, 'TOMAN'), 'دوازده میلیون و چهارصد هزار تومان');
  assert.equal(amountInWords(1_500, 'TOMAN'), 'هزار و پانصد تومان');
  assert.equal(amountInWords(1_000_000, 'TOMAN'), 'یک میلیون تومان');
  assert.equal(amountInWords(2_001_000_115, 'TOMAN'), 'دو میلیارد و یک میلیون و صد و پانزده تومان');
  assert.equal(amountInWords(12.5, 'USD'), 'دوازده ممیز پنج دهم دلار');
  assert.equal(amountInWords(0.25, 'EUR'), 'صفر ممیز بیست و پنج صدم یورو');
  assert.equal(amountInWords(3_000, undefined), 'سه هزار', 'no currency chosen yet');
  assert.equal(amountInWords(0, 'TOMAN'), '');
  assert.equal(amountInWords('', 'TOMAN'), '');
});

test('a journal row is signed in the lists exactly as the reconciliation signs it', () => {
  const rows = [
    { type: 'INCOME', amount: 5 },
    { type: 'EXPENSE', amount: 5 },
    { type: 'ADJUSTMENT', amount: -5 },
    { type: 'ADJUSTMENT', amount: 5 },
    { type: 'TRANSFER', amount: 5, description: '[ورود] از صندوق' },
    { type: 'TRANSFER', amount: 5, description: '[خروج] به بانک' },
    { type: 'TRANSFER', amount: 5, description: 'API debit leg' },
  ];
  for (const row of rows) assert.equal(directionOf(row), Math.sign(balanceEffect(row)), JSON.stringify(row));
});

test('the accounts page rebuilds an 8-week trend by walking back from the balance, leaving out a baseline', async () => {
  await openAccount('melli', 1_000_000);
  await prisma.transaction.updateMany({ where: { accountId: 'melli' }, data: { date: daysAgo(60) } });
  await prisma.transaction.createMany({
    data: [
      { type: 'EXPENSE', amount: 200_000, amountInToman: 200_000, accountId: 'melli', date: daysAgo(10), description: 'اجاره' },
      { type: 'INCOME', amount: 50_000, amountInToman: 50_000, accountId: 'melli', date: daysAgo(3), description: 'واریز' },
      // Documents an old difference; it moved no money, so it must not bend the line.
      { type: 'ADJUSTMENT', amount: 999, amountInToman: 999, accountId: 'melli', date: daysAgo(5), category: 'مانده پایه' },
    ],
  });
  await prisma.account.update({ where: { id: 'melli' }, data: { balance: 850_000 } });

  const [props] = allPropsOf(await AccountsPage(), AccountList);
  const melli = props.accounts.find((a: any) => a.id === 'melli');
  assert.deepEqual(melli.history, [1_000_000, 1_000_000, 1_000_000, 1_000_000, 1_000_000, 1_000_000, 1_000_000, 800_000, 850_000]);
  assert.equal(melli.historyGap, null);
  assert.deepEqual(
    melli.movements.map((m: any) => [m.amount, m.direction]),
    [[50_000, 1], [999, 1], [200_000, -1]],
    'the movements of the last 8 weeks, newest first, signed',
  );
  assert.equal(props.canManage, true);
  const bucket = props.accounts.find((a: any) => a.type === 'EXPENSE');
  assert.ok(bucket, 'the system Marketing Expenses account is listed');
  assert.equal(bucket.history, null, 'a P&L bucket kept at 0 gets no trend');

  setTestRole('AUDITOR');
  assert.equal(allPropsOf(await AccountsPage(), AccountList)[0].canManage, false, 'the auditor gets no create, edit or delete');
});

test('no trend is drawn for an account with a row whose amount the role may not see', async () => {
  await openAccount('melli', 500_000);
  await prisma.transaction.create({
    data: { type: 'EXPENSE', amount: 100_000, amountInToman: 100_000, accountId: 'melli', category: 'COGS', date: daysAgo(2) },
  });
  setTestRole('ACCOUNTANT');
  const melli = allPropsOf(await AccountsPage(), AccountList)[0].accounts.find((a: any) => a.id === 'melli');
  assert.equal(melli.history, null);
  assert.ok(melli.historyGap);
  assert.ok(melli.movements.some((m: any) => m.amount === null), 'the cost row stays listed without its amount');
});

test('the hub adds a dollar balance at the latest rate, never as Toman, and leaves out a currency with no rate', async () => {
  await openAccount('rial', 1_000_000);
  // «موجودی کل» is every account that holds money, a person's and a wallet's too (src/lib/money-totals.ts).
  await openAccount('person', 250_000, 'TOMAN', { type: 'PERSON' });
  await openAccount('wallet', 30_000, 'TOMAN', { type: 'CRYPTO' });
  await prisma.account.create({ data: { name: 'COGS', type: 'EXPENSE', currency: 'TOMAN', balance: -9_000_000 } });
  await openAccount('dollar', 100, 'USD');
  await openAccount('euro', 50, 'EUR');
  await prisma.exchangeRate.createMany({
    data: [
      { currency: 'USD', rateToToman: 50_000, date: daysAgo(3) },
      { currency: 'USD', rateToToman: 60_000, date: daysAgo(1) },
    ],
  });

  const kpis = allPropsOf(await AccountingPage(), KpiCard);
  const cash = kpis.find((k) => k.label === 'موجودی کل');
  assert.equal(cash.value, (1_000_000 + 250_000 + 30_000 + 100 * 60_000).toLocaleString('fa-IR'));
  // The same figure as the dashboard's «موجودی کل».
  assert.equal(cash.value, Math.round((await getDashboardFinancials()).totalBalance).toLocaleString('fa-IR'));
  assert.match(cash.note, /یورو/, 'the euro account, with no rate, is named as left out');
});

test('the hub shows this month’s expenses from the journal, and each tile only to a role that may open it', async () => {
  await openAccount('melli', 5_000_000);
  const recorded = await recordExpense(undefined, form({ amount: '300000', currency: 'TOMAN', category: 'Rent', accountId: 'melli' }));
  assert.equal(recorded.success, true, recorded.message);
  // Not operating expenses (src/lib/profit-rows.ts): a supplier payment is stock, a fixed asset an asset, the
  // cost of goods sold is not an operating cost, and a shareholder's withdrawal is capital.
  for (const category of ['Purchase Payment', 'خرید تجهیزات', 'COGS', 'Shareholder Withdrawal']) {
    await prisma.transaction.create({ data: { type: 'EXPENSE', amount: 7_000_000, amountInToman: 7_000_000, currency: 'TOMAN', category, date: new Date() } });
  }

  let page = await AccountingPage();
  const expenses = allPropsOf(page, KpiCard).find((k) => k.label.startsWith('هزینه‌های عملیاتی'));
  assert.equal(expenses.value, (300_000).toLocaleString('fa-IR'));
  const admin = allPropsOf(page, AccountingHubTiles)[0].visible;
  assert.ok(admin.includes('/dashboard/accounting/reconciliation') && admin.includes('/dashboard/accounting/assets'));
  assert.ok(admin.includes('/dashboard/accounting/expenses/new'));

  setTestRole('ACCOUNTANT');
  page = await AccountingPage();
  const accountant = allPropsOf(page, AccountingHubTiles)[0].visible;
  assert.ok(!accountant.includes('/dashboard/accounting/reports'), 'profit.view only');
  assert.ok(accountant.includes('/dashboard/accounting/expenses/new'));

  setTestRole('AUDITOR');
  const auditor = allPropsOf(await AccountingPage(), AccountingHubTiles)[0].visible;
  assert.ok(auditor.includes('/dashboard/accounting/reports'));
  assert.ok(!auditor.some((href: string) => href.endsWith('/new')), 'read-only: no form that records money');
});

test('each money form offers only the recent entries it made itself', async () => {
  await openAccount('melli', 5_000_000);
  assert.equal((await recordExpense(undefined, form({ amount: '120000', currency: 'TOMAN', category: 'Office', accountId: 'melli', description: 'کاغذ' }))).success, true);
  assert.equal((await recordWithdrawal(undefined, form({ amount: '80000', currency: 'TOMAN', accountId: 'melli', payee: 'پیک' }))).success, true);

  const expense = allPropsOf(await NewExpensePage(), ExpenseForm)[0].recent;
  assert.deepEqual(expense.map((e: any) => [e.title, e.amount, e.fill.category, e.fill.accountId]), [['کاغذ', 120_000, 'Office', 'melli']]);

  const payment = allPropsOf(await NewWithdrawalPage(), WithdrawalForm)[0].recent;
  assert.deepEqual(payment.map((p: any) => [p.title, p.amount, p.fill.payee]), [['پیک', 80_000, 'پیک']]);
});
