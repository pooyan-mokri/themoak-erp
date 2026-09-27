import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase, form } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { AccessDenied } from '@/lib/access';
import {
  createAccount,
  deleteAccount,
  getAccounts,
  getLatestExchangeRates,
  setExchangeRate,
  updateAccount,
} from '@/actions/accounting';
import { getAccountOptions } from '@/actions/account-options';
import { assertBooksAddUp, balanceOf, openAccount } from './ledger';

// The actions log every refusal these tests provoke on purpose.
console.error = () => {};

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
});
after(() => prisma.$disconnect());

const accountForm = (fields: Record<string, string>) =>
  form({ name: 'بانک ملت', type: 'BANK', currency: 'TOMAN', cardNumber: '', sheba: '', ...fields });

test('the accounts page opened many times at once makes one «Marketing Expenses» account', async () => {
  await Promise.all(Array.from({ length: 8 }, () => getAccounts()));
  assert.equal(await prisma.account.count({ where: { name: 'Marketing Expenses' } }), 1);
  await getAccounts();
  assert.equal(await prisma.account.count({ where: { name: 'Marketing Expenses' } }), 1);

  const accounts = await getAccounts();
  const marketing = accounts.find((a: any) => a.name === 'Marketing Expenses');
  assert.deepEqual([marketing.type, marketing.currency, marketing.balance], ['EXPENSE', 'TOMAN', 0]);
});

test('an existing «Marketing Expenses» account is kept, not joined by a second one', async () => {
  const existing = await prisma.account.create({ data: { name: 'Marketing Expenses', type: 'EXPENSE', currency: 'TOMAN', balance: 0 } });
  await Promise.all([getAccounts(), getAccounts()]);
  assert.deepEqual((await prisma.account.findMany({ where: { name: 'Marketing Expenses' } })).map((a: any) => a.id), [existing.id]);
});
