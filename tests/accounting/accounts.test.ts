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

test('a new account starts with its opening balance as a row, so its ledger adds up', async () => {
  const created = await createAccount(undefined, accountForm({ initialBalance: '5000000', cardNumber: '6104337712345678', sheba: 'IR120120000000001234567890' }));
  assert.equal(created.success, true, created.message);
  const account = await prisma.account.findFirstOrThrow({ where: { name: 'بانک ملت' } });
  assert.deepEqual(
    [account.type, account.currency, Number(account.balance), account.cardNumber, account.sheba],
    ['BANK', 'TOMAN', 5_000_000, '6104337712345678', 'IR120120000000001234567890'],
  );
  const opening = await prisma.transaction.findFirstOrThrow({ where: { accountId: account.id } });
  assert.deepEqual([opening.type, Number(opening.amount), opening.category], ['ADJUSTMENT', 5_000_000, 'موجودی اولیه']);

  // No opening balance, or 0: no row.
  assert.equal((await createAccount(undefined, accountForm({ name: 'صندوق', type: 'CASH', initialBalance: '0' }))).success, true);
  assert.equal((await createAccount(undefined, accountForm({ name: 'تنخواه', type: 'CASH' }))).success, true);
  assert.equal(await prisma.transaction.count(), 1);
  await assertBooksAddUp();
});

test('an account needs a name, a type and a known currency', async () => {
  for (const fields of [{ name: '' }, { type: '' }, { currency: 'GBP' }, { currency: '' }, { initialBalance: 'abc' }]) {
    const result = await createAccount(undefined, accountForm(fields));
    assert.notEqual(result.success, true, JSON.stringify(fields));
    assert.match(result.message!, /فیلدهای الزامی/);
  }
  assert.equal(await prisma.account.count(), 0);
});

test('editing an account changes its name, type and card but never its balance', async () => {
  await openAccount('bank', 5_000_000);
  const edited = await updateAccount('bank', undefined, accountForm({ name: 'ملت مرکزی', type: 'CASH', cardNumber: '6104', initialBalance: '99' }));
  assert.equal(edited.success, true, edited.message);
  const account = await prisma.account.findUniqueOrThrow({ where: { id: 'bank' } });
  assert.deepEqual([account.name, account.type, account.cardNumber, account.sheba, Number(account.balance)], ['ملت مرکزی', 'CASH', '6104', null, 5_000_000]);
  await assertBooksAddUp();
});

test('an account cannot become a P&L bucket or stop being one, and «Marketing Expenses» keeps its name', async () => {
  await openAccount('bank', 1_000);
  const cogs = await prisma.account.create({ data: { name: 'COGS', type: 'EXPENSE', currency: 'TOMAN', balance: 0 } });
  const marketing = await prisma.account.create({ data: { name: 'Marketing Expenses', type: 'EXPENSE', currency: 'TOMAN', balance: 0 } });

  assert.match((await updateAccount('bank', undefined, accountForm({ type: 'EXPENSE' }))).message!, /نمی‌توان حساب را به حساب هزینه‌ای تبدیل کرد/);
  assert.match((await updateAccount(cogs.id, undefined, accountForm({ name: 'COGS', type: 'BANK' }))).message!, /قابل تغییر نیست/);
  assert.match((await updateAccount(marketing.id, undefined, accountForm({ name: 'هزینه بازاریابی', type: 'EXPENSE' }))).message!, /قابل تغییر نیست/);
  assert.equal((await updateAccount(marketing.id, undefined, accountForm({ name: 'Marketing Expenses', type: 'EXPENSE', cardNumber: '1' }))).success, true);

  const after = await prisma.account.findMany({ orderBy: { name: 'asc' } });
  assert.deepEqual(after.map((a: any) => [a.name, a.type]), [['COGS', 'EXPENSE'], ['Marketing Expenses', 'EXPENSE'], ['حساب bank', 'BANK']]);
});

test('an account is deleted only while it has no rows; «Marketing Expenses» never', async () => {
  await openAccount('used', 1_000);
  const empty = await prisma.account.create({ data: { name: 'خالی', type: 'BANK', currency: 'TOMAN', balance: 0 } });
  const marketing = await prisma.account.create({ data: { name: 'Marketing Expenses', type: 'EXPENSE', currency: 'TOMAN', balance: 0 } });

  assert.match((await deleteAccount('used')).message!, /دارای تراکنش است/);
  assert.match((await deleteAccount(marketing.id)).message!, /حساب سیستم است/);
  assert.equal((await deleteAccount('nowhere')).success, false);
  assert.equal((await deleteAccount(empty.id)).success, true);
  assert.deepEqual((await prisma.account.findMany({ orderBy: { name: 'asc' } })).map((a: any) => a.name), ['Marketing Expenses', 'حساب used']);
});

test('a rate is recorded with today\'s date and the newest comes first; a bad rate is refused', async () => {
  const set = (currency: string, rateToToman: string) => setExchangeRate(undefined, form({ currency, rateToToman }));
  assert.match((await set('USD', '98000')).message!, /موفقیت/);
  assert.match((await set('USD', '101500.5')).message!, /موفقیت/);
  for (const [currency, rate] of [['USD', '0'], ['USD', '-5'], ['USD', '۱۰۰۰۰۰'], ['GBP', '1000'], ['USD', '']]) {
    assert.match((await set(currency, rate)).message!, /فیلدهای الزامی/, `${currency} ${rate}`);
  }
  const rates = await getLatestExchangeRates();
  assert.deepEqual(rates.map((r: any) => [r.currency, r.rateToToman]), [['USD', 101_500.5], ['USD', 98_000]]);
  assert.ok(Date.now() - new Date(rates[0].date).getTime() < 60_000);
});

test('an account picker gets every account without its balance; it needs accounts.pick', async () => {
  await openAccount('bank', 77_123_457, 'TOMAN', { cardNumber: '6104337712345678' });
  for (const role of ['ADMIN', 'ACCOUNTANT', 'AUDITOR', 'SALES']) {
    setTestRole(role);
    const options = await getAccountOptions();
    assert.deepEqual(Object.keys(options[0]).sort(), ['cardNumber', 'currency', 'id', 'name', 'sheba', 'type'], role);
    assert.equal(JSON.stringify(options).includes('77123457'), false, role);
  }
  for (const role of ['WAREHOUSE', 'PROJECT_MANAGER', 'USER', null]) {
    setTestRole(role);
    await assert.rejects(getAccountOptions(), (error: unknown) => error instanceof AccessDenied, String(role));
  }
  assert.equal(await balanceOf('bank'), 77_123_457);
});
