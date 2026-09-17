import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { prisma, resetDatabase, form } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { AccessDenied, ACCESS_DENIED_MESSAGE } from '@/lib/access';
import {
  adjustAccountBalance,
  createAccount,
  deleteExpense,
  getAccountReconciliation,
  getAccounts,
  getExpenseBreakdown,
  getLatestExchangeRates,
  getTransactions,
  recordDeposit,
  recordExpense,
  setExchangeRate,
} from '@/actions/accounting';
import { exchangeCurrency, getCurrencyExchangeHistory } from '@/actions/currency-exchange';
import ExpensesPage from '../../src/app/dashboard/accounting/expenses/page';
import { ExpenseList } from '@/components/accounting/expense-list';

// tsx compiles the page's JSX to React.createElement without importing React.
(globalThis as any).React = React;

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
});
after(() => prisma.$disconnect());

// Distinctive figures, so a leak shows up anywhere in a serialized payload.
const COGS = 7_310_411;
const GIFT = 6_220_733;
const PAGE_GIFT = 5_130_977;
const RENT = 2_000_000;

/** A bank account, a rent expense, and the three kinds of cost-valued EXPENSE rows. */
async function seedJournal() {
  const bank = await prisma.account.create({ data: { name: 'Bank', type: 'BANK', currency: 'TOMAN', balance: 50_000_000 } });
  const cogsAccount = await prisma.account.create({ data: { name: 'COGS', type: 'EXPENSE', currency: 'TOMAN', balance: 0 } });
  const row = (amount: number, category: string, accountId: string, description: string) =>
    prisma.transaction.create({
      data: { type: 'EXPENSE', amount, amountInToman: amount, currency: 'TOMAN', accountId, category, description },
    });
  const rent = await row(RENT, 'اجاره', bank.id, 'اجاره - دفتر');
  const cogs = await row(COGS, 'COGS', cogsAccount.id, 'بهای تمام‌شده کالای فروش امانی - سفارش #1');
  const gift = await row(GIFT, 'Marketing - Gift', bank.id, 'هزینه بازاریابی - هدیه: PANJ (1 عدد)');
  const pageGift = await row(PAGE_GIFT, 'Marketing/Gift', bank.id, 'Gift to someone');
  const product = await prisma.product.create({ data: { name: 'PANJ', sku: 'PANJ-1', costPrice: GIFT, sellPrice: 9_000_000 } });
  await prisma.marketingGift.create({
    data: { productId: product.id, quantity: 1, accountId: bank.id, transactionId: gift.id, costPrice: GIFT, totalCost: GIFT },
  });
  return { bank, rent, cogs, gift, pageGift };
}

async function rejectsAccess(promise: Promise<unknown>, label: string) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof AccessDenied, label);
    return true;
  });
}

function assertDenied(result: { success?: boolean; message?: string }, label: string) {
  assert.equal(result.success, false, label);
  assert.equal(result.message, ACCESS_DENIED_MESSAGE, label);
}

/** The props of the first element of `type` in a rendered server component tree. */
function propsOf(node: any, type: unknown): any {
  if (!node || typeof node !== 'object') return undefined;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = propsOf(child, type);
      if (found) return found;
    }
    return undefined;
  }
  if (node.type === type) return node.props;
  return propsOf(node.props?.children, type);
}

test('getAccounts, the reconciliation and the exchange history need finance.view', async () => {
  await seedJournal();
  for (const role of ['SALES', 'WAREHOUSE', 'PROJECT_MANAGER', 'USER']) {
    setTestRole(role);
    await rejectsAccess(getAccounts(), `getAccounts / ${role}`);
    await rejectsAccess(getAccountReconciliation(), `getAccountReconciliation / ${role}`);
    await rejectsAccess(getCurrencyExchangeHistory(), `getCurrencyExchangeHistory / ${role}`);
  }
  for (const role of ['ADMIN', 'AUDITOR', 'ACCOUNTANT']) {
    setTestRole(role);
    const bank = (await getAccounts()).find((a: any) => a.name === 'Bank');
    assert.equal(bank?.balance, 50_000_000, role);
    assert.ok((await getAccountReconciliation()).length > 0, role);
  }
});

test('the journal withholds COGS and gift amounts from an accountant, and keeps the rows', async () => {
  const { rent, cogs, gift, pageGift } = await seedJournal();

  setTestRole('ACCOUNTANT');
  const rows = await getTransactions();
  assert.equal(rows.length, 4, 'every row is still listed');
  const byId = new Map(rows.map((r: any) => [r.id, r]));
  for (const id of [cogs.id, gift.id, pageGift.id]) {
    const row: any = byId.get(id);
    assert.ok(row, 'a cost row stays in the list');
    assert.equal(row.amount, null);
    assert.equal(row.amountInToman, null);
  }
  assert.equal((byId.get(rent.id) as any).amount, RENT, 'an ordinary expense keeps its amount');
  const served = JSON.stringify(rows);
  for (const cost of [COGS, GIFT, PAGE_GIFT]) assert.equal(served.includes(String(cost)), false, `${cost} leaked`);

  for (const role of ['ADMIN', 'AUDITOR']) {
    setTestRole(role);
    const full = new Map((await getTransactions()).map((r: any) => [r.id, r]));
    assert.equal((full.get(cogs.id) as any).amount, COGS, role);
    assert.equal((full.get(gift.id) as any).amountInToman, GIFT, role);
    assert.equal((full.get(pageGift.id) as any).amount, PAGE_GIFT, role);
  }

  for (const role of ['SALES', 'WAREHOUSE', 'USER']) {
    setTestRole(role);
    await rejectsAccess(getTransactions(), `getTransactions / ${role}`);
  }
});

test('the expense breakdown leaves out cost rows for an accountant', async () => {
  await seedJournal();
  setTestRole('ACCOUNTANT');
  const breakdown = await getExpenseBreakdown();
  const total = breakdown.reduce((sum, row) => sum + row.amount, 0);
  assert.equal(total, RENT);
  for (const cost of [COGS, GIFT, PAGE_GIFT]) assert.equal(JSON.stringify(breakdown).includes(String(cost)), false);

  setTestRole('AUDITOR');
  const all = await getExpenseBreakdown();
  assert.equal(all.reduce((sum, row) => sum + row.amount, 0), RENT + COGS + GIFT + PAGE_GIFT);

  setTestRole('SALES');
  await rejectsAccess(getExpenseBreakdown(), 'SALES');
});

test('the expenses page sends an accountant no cost amount, and keeps editing for the admin', async () => {
  const { rent, cogs, gift } = await seedJournal();

  setTestRole('ACCOUNTANT');
  let props = propsOf(await ExpensesPage(), ExpenseList);
  assert.ok(props, 'the page renders the expense list');
  assert.equal(props.isAdmin, false, 'editing and deleting a recorded expense stays admin-only');
  const byId = new Map(props.expenses.map((e: any) => [e.id, e]));
  assert.equal((byId.get(cogs.id) as any).amount, null);
  assert.equal((byId.get(gift.id) as any).amountInToman, null);
  assert.equal((byId.get(rent.id) as any).amount, RENT);
  for (const cost of [COGS, GIFT, PAGE_GIFT]) assert.equal(JSON.stringify(props.expenses).includes(String(cost)), false);

  setTestRole('AUDITOR');
  props = propsOf(await ExpensesPage(), ExpenseList);
  assert.equal(props.isAdmin, false, 'the read-only auditor gets no edit controls');
  assert.equal(props.expenses.find((e: any) => e.id === cogs.id).amount, COGS);
});

test('finance mutations refuse AUDITOR and SALES and write nothing; ACCOUNTANT succeeds', async () => {
  const { bank, rent } = await seedJournal();
  const before = await prisma.transaction.count();
  const deposit = form({ amount: '1000', currency: 'TOMAN', accountId: bank.id, description: 'واریز' });
  const expense = form({ amount: '1000', currency: 'TOMAN', category: 'اداری', accountId: bank.id });

  for (const role of ['AUDITOR', 'SALES', 'WAREHOUSE']) {
    setTestRole(role);
    assertDenied(await recordDeposit(undefined, deposit), `recordDeposit / ${role}`);
    assertDenied(await recordExpense(undefined, expense), `recordExpense / ${role}`);
    assertDenied(await createAccount(undefined, form({ name: 'X', type: 'BANK', currency: 'TOMAN' })), `createAccount / ${role}`);
    assertDenied(await setExchangeRate(undefined, form({ currency: 'USD', rateToToman: '60000' })), `setExchangeRate / ${role}`);
    assert.equal((await deleteExpense(rent.id)).success, false, `deleteExpense / ${role}`);
    assert.equal((await adjustAccountBalance({ accountId: bank.id, targetBalance: 1 })).success, false, `adjustAccountBalance / ${role}`);
    const exchanged = await exchangeCurrency(undefined, form({}));
    assert.equal(exchanged.success, false, `exchangeCurrency / ${role}`);
    assert.equal(exchanged.message, ACCESS_DENIED_MESSAGE, `exchangeCurrency / ${role}`);
  }
  assert.equal(await prisma.transaction.count(), before);
  assert.equal(await prisma.account.count(), 2);
  assert.equal(await prisma.exchangeRate.count(), 0);
  assert.equal(Number((await prisma.account.findUniqueOrThrow({ where: { id: bank.id } })).balance), 50_000_000);

  setTestRole('ACCOUNTANT');
  assert.equal((await recordDeposit(undefined, deposit)).success, true);
  assert.equal(Number((await prisma.account.findUniqueOrThrow({ where: { id: bank.id } })).balance), 50_001_000);
  // Deleting a recorded expense and correcting a balance stay admin-only, as before.
  const ADMIN_ONLY = 'دسترسی غیرمجاز — فقط مدیر سیستم می‌تواند این عملیات را انجام دهد.';
  assert.equal((await deleteExpense(rent.id)).message, ADMIN_ONLY);
  assert.equal((await adjustAccountBalance({ accountId: bank.id, targetBalance: 1 })).message, ADMIN_ONLY);
  assert.equal(Number((await prisma.account.findUniqueOrThrow({ where: { id: bank.id } })).balance), 50_001_000);

  setTestRole('ADMIN');
  const deleted = await deleteExpense(rent.id);
  assert.equal(deleted.success, true, deleted.message);
  const adjusted = await adjustAccountBalance({ accountId: bank.id, targetBalance: 49_000_000 });
  assert.equal(adjusted.success, true, adjusted.message);
  assert.equal(Number((await prisma.account.findUniqueOrThrow({ where: { id: bank.id } })).balance), 49_000_000);
});

test('exchange rates carry no balance: stock and finance viewers read them, others get nothing', async () => {
  await prisma.exchangeRate.create({ data: { currency: 'USD', rateToToman: 60000, date: new Date() } });
  for (const role of ['WAREHOUSE', 'ACCOUNTANT', 'AUDITOR']) {
    setTestRole(role);
    assert.equal((await getLatestExchangeRates()).length, 1, role);
  }
  for (const role of ['USER', 'PROJECT_MANAGER', null]) {
    setTestRole(role);
    assert.deepEqual(await getLatestExchangeRates(), [], String(role));
  }
});
