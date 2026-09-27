import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase, form } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { deleteExpense, getExpenseBreakdown, recordExpense, updateExpense } from '@/actions/accounting';
import { createLoan } from '@/actions/loan';
import { exchangeCurrency } from '@/actions/currency-exchange';
import { withdrawShareholderFunds } from '@/actions/shareholder';
import { Currency } from '@/lib/types';
import { assertBooksAddUp, balanceOf, openAccount } from './ledger';

// The actions log every refusal these tests provoke on purpose.
console.error = () => {};

const RATE = 100_000;

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
  await openAccount('bank', 100_000_000);
  await openAccount('saman', 10_000_000);
  await openAccount('usd', 1_000, 'USD');
  await prisma.exchangeRate.create({ data: { currency: 'USD', rateToToman: 90_000, date: new Date('2026-09-01T08:00:00Z') } });
  await prisma.exchangeRate.create({ data: { currency: 'USD', rateToToman: RATE, date: new Date('2026-09-20T08:00:00Z') } });
});
after(() => prisma.$disconnect());

const expense = (fields: Record<string, string>) =>
  recordExpense(undefined, form({ amount: '2000000', currency: 'TOMAN', category: 'اجاره', accountId: 'bank', ...fields }));

const onlyRow = () => prisma.transaction.findFirstOrThrow({ where: { type: 'EXPENSE' }, orderBy: { createdAt: 'desc' } });

test('a Toman expense from a Toman account: one EXPENSE row and the balance down by it', async () => {
  const project = await prisma.project.create({ data: { name: 'غرفه نمایشگاه' } });
  const result = await expense({ description: 'دفتر مهر', date: '2026-09-22T20:30:00.000Z', projectId: project.id, requestId: 'req-expense-0001' });
  assert.equal(result.success, true, result.message);
  const row = await onlyRow();
  assert.deepEqual(
    [Number(row.amount), row.currency, Number(row.rateSnapshot), Number(row.amountInToman), row.accountId, row.employeeId, row.category, row.description, row.date.toISOString(), row.projectId, row.clientRequestId],
    [2_000_000, 'TOMAN', 1, 2_000_000, 'bank', null, 'اجاره', 'اجاره - دفتر مهر', '2026-09-22T20:30:00.000Z', project.id, 'req-expense-0001'],
  );
  assert.equal(await balanceOf('bank'), 98_000_000);
  await assertBooksAddUp();
});

test('a dollar expense paid from a Toman account leaves the account in Toman at the latest rate', async () => {
  assert.equal((await expense({ amount: '10', currency: 'USD' })).success, true);
  const row = await onlyRow();
  assert.deepEqual([Number(row.amount), row.currency, Number(row.amountInToman), Number(row.rateSnapshot)], [1_000_000, 'TOMAN', 1_000_000, 1]);
  assert.equal(await balanceOf('bank'), 99_000_000);
  await assertBooksAddUp();
});

test('a Toman expense paid from a dollar account leaves it in dollars; a fraction of a cent stays exact', async () => {
  assert.equal((await expense({ amount: '500000', accountId: 'usd' })).success, true);
  let row = await onlyRow();
  assert.deepEqual([Number(row.amount), row.currency, Number(row.amountInToman), Number(row.rateSnapshot)], [5, 'USD', 500_000, RATE]);
  assert.equal(await balanceOf('usd'), 995);

  assert.equal((await expense({ amount: '333333', accountId: 'usd' })).success, true);
  row = await onlyRow();
  assert.equal(Number(row.amount), 3.33333);
  assert.equal(await balanceOf('usd'), 991.66667);

  assert.equal((await expense({ amount: '12.5', currency: 'USD', accountId: 'usd' })).success, true);
  assert.equal(Number((await onlyRow()).amount), 12.5);
  assert.equal(await balanceOf('usd'), 979.16667);
  await assertBooksAddUp();
});

test('an expense an employee paid moves no company money and is owed to them', async () => {
  const sara = await prisma.employee.create({ data: { name: 'سارا', salary: 1 } });
  const result = await expense({ accountId: 'none', employeeId: sara.id, description: 'پیک' });
  assert.equal(result.success, true, result.message);
  const row = await onlyRow();
  assert.deepEqual([row.accountId, row.employeeId, row.description], [null, sara.id, 'اجاره - پیک (پرداخت شده توسط: سارا)']);
  assert.equal(await balanceOf('bank'), 100_000_000);
});

test('a very large expense is booked to the toman exactly', async () => {
  await openAccount('big', 5_000_000_000_000);
  assert.equal((await expense({ amount: '1234567890123', accountId: 'big' })).success, true);
  assert.equal(await balanceOf('big'), 5_000_000_000_000 - 1_234_567_890_123);
  await assertBooksAddUp();
});

test('an expense is refused, booking nothing, for a bad amount, no category or payer, an unknown payer, no rate, or too little money', async () => {
  await openAccount('eur', 100, 'EUR');
  const cases: [Record<string, string>, RegExp][] = [
    [{ amount: '0' }, /فیلدهای الزامی/],
    [{ amount: '-500' }, /فیلدهای الزامی/],
    [{ amount: '۲۰۰۰۰۰۰' }, /فیلدهای الزامی/],
    [{ amount: '2,000,000' }, /فیلدهای الزامی/],
    [{ category: '' }, /فیلدهای الزامی/],
    [{ accountId: 'none' }, /فیلدهای الزامی/],
    [{ currency: 'GBP' }, /فیلدهای الزامی/],
    [{ accountId: 'nowhere' }, /حساب پرداخت یافت نشد/],
    [{ accountId: '', employeeId: 'nobody' }, /کارمند یافت نشد/],
    [{ currency: 'EUR' }, /نرخ تبدیل برای ارز EUR یافت نشد/],
    [{ accountId: 'eur' }, /نرخ تبدیل برای ارز EUR یافت نشد/],
    [{ amount: '10000001', accountId: 'saman' }, /کافی نیست/],
  ];
  for (const [fields, message] of cases) {
    const result = await expense(fields);
    assert.notEqual(result.success, true, JSON.stringify(fields));
    assert.match(result.message!, message, JSON.stringify(fields));
  }
  assert.equal(await prisma.transaction.count({ where: { type: 'EXPENSE' } }), 0);
  assert.deepEqual([await balanceOf('bank'), await balanceOf('saman')], [100_000_000, 10_000_000]);
});

test('an edit reverses the old amount and applies the new one, onto another account or currency too', async () => {
  assert.equal((await expense({})).success, true);
  const { id } = await onlyRow();

  assert.equal((await updateExpense({ id, amount: 3_000_000, currency: Currency.TOMAN, category: 'اجاره', description: 'مهر' })).success, true);
  assert.equal(await balanceOf('bank'), 97_000_000);

  const moved = await updateExpense({ id, amount: 1_000_000, currency: Currency.TOMAN, category: 'اجاره', accountId: 'saman', date: '2026-09-25T20:30:00.000Z' });
  assert.equal(moved.success, true, moved.message);
  assert.deepEqual([await balanceOf('bank'), await balanceOf('saman')], [100_000_000, 9_000_000]);

  assert.equal((await updateExpense({ id, amount: 20, currency: Currency.USD, category: 'اشتراک', accountId: 'usd' })).success, true);
  const row = await onlyRow();
  assert.deepEqual(
    [Number(row.amount), row.currency, Number(row.amountInToman), row.accountId, row.category, row.date.toISOString()],
    [20, 'USD', 2_000_000, 'usd', 'اشتراک', '2026-09-25T20:30:00.000Z'],
  );
  assert.deepEqual([await balanceOf('saman'), await balanceOf('usd')], [10_000_000, 980]);
  await assertBooksAddUp();
});

test('an edit the new account cannot cover, or with a bad amount, changes nothing', async () => {
  assert.equal((await expense({})).success, true);
  const before = await onlyRow();
  assert.match((await updateExpense({ id: before.id, amount: 50_000_000, currency: Currency.TOMAN, category: 'اجاره', accountId: 'saman' })).message!, /کافی نیست/);
  assert.equal((await updateExpense({ id: before.id, amount: 0, currency: Currency.TOMAN, category: 'اجاره' })).success, false);
  assert.match((await updateExpense({ id: 'nothing', amount: 1, currency: Currency.TOMAN, category: 'اجاره' })).message!, /یافت نشد/);
  assert.deepEqual(await onlyRow(), before);
  assert.deepEqual([await balanceOf('bank'), await balanceOf('saman')], [98_000_000, 10_000_000]);
});

test('an employee-paid expense is edited without touching any account', async () => {
  const sara = await prisma.employee.create({ data: { name: 'سارا', salary: 1 } });
  assert.equal((await expense({ accountId: '', employeeId: sara.id })).success, true);
  const { id } = await onlyRow();
  assert.equal((await updateExpense({ id, amount: 5, currency: Currency.USD, category: 'اشتراک' })).success, true);
  const row = await onlyRow();
  assert.deepEqual([row.accountId, Number(row.amount), row.currency, Number(row.amountInToman)], [null, 5, 'USD', 500_000]);
  assert.equal(await balanceOf('bank'), 100_000_000);
});

test('deleting an expense gives the account back exactly what the row took, in its own currency', async () => {
  assert.equal((await expense({})).success, true);
  assert.equal((await expense({ amount: '333333', accountId: 'usd' })).success, true);
  for (const row of await prisma.transaction.findMany({ where: { type: 'EXPENSE' } })) {
    const deleted = await deleteExpense(row.id);
    assert.equal(deleted.success, true, deleted.message);
  }
  assert.deepEqual([await balanceOf('bank'), await balanceOf('usd')], [100_000_000, 1_000]);
  assert.equal(await prisma.transaction.count({ where: { type: 'EXPENSE' } }), 0);
  await assertBooksAddUp();
  assert.match((await deleteExpense('nothing')).message!, /یافت نشد/);
  const opening = await prisma.transaction.findFirstOrThrow({ where: { accountId: 'bank' } });
  assert.match((await deleteExpense(opening.id)).message!, /یافت نشد/, 'only an EXPENSE row is deleted here');
});

test('an expense that another module booked is edited or deleted only there; the list refuses it', async () => {
  const sara = await prisma.employee.create({ data: { name: 'سارا', salary: 1 } });
  const shareholder = await prisma.shareholder.create({ data: { name: 'علی', percentage: 100 } });
  assert.equal((await createLoan(undefined, form({ borrowerId: sara.id, amount: '3000000', accountId: 'bank' }))).success, true);
  assert.equal((await exchangeCurrency(undefined, form({
    sourceAccountId: 'bank', targetAccountId: 'usd', sourceAmount: '1000000', targetAmount: '10',
    sourceCurrency: 'TOMAN', targetCurrency: 'USD', exchangeRate: '100000', date: '2026-09-21', description: '',
  }))).success, true);
  const cogs = await prisma.transaction.create({ data: { type: 'EXPENSE', amount: 1, amountInToman: 1, category: 'COGS', accountId: 'bank' } });
  const commission = await prisma.transaction.create({ data: { type: 'EXPENSE', amount: 1, amountInToman: 1, category: 'CONSIGNMENT_COMMISSION', accountId: 'bank' } });
  const order = await prisma.order.create({ data: { totalAmount: 1 } });
  const refund = await prisma.transaction.create({ data: { type: 'EXPENSE', amount: 1, amountInToman: 1, category: 'Return', accountId: 'bank', orderId: order.id } });
  await prisma.account.update({ where: { id: 'bank' }, data: { balance: { decrement: 3 } } });

  const owned = await prisma.transaction.findMany({ where: { type: 'EXPENSE' } });
  assert.equal(owned.length, 5);
  const balances = [await balanceOf('bank'), await balanceOf('usd')];
  for (const row of owned) {
    const deleted = await deleteExpense(row.id);
    assert.equal(deleted.success, false, row.category!);
    assert.match(deleted.message!, /به‌صورت خودکار توسط/);
    const edited = await updateExpense({ id: row.id, amount: 1, currency: Currency.TOMAN, category: 'اداری' });
    assert.match(edited.message!, /به‌صورت خودکار توسط/, row.category!);
  }
  assert.match((await deleteExpense(owned.find((r: any) => r.category === 'قرض به کارمند')!.id)).message!, /«قرض به کارمند»/);
  assert.equal(await prisma.transaction.count({ where: { type: 'EXPENSE' } }), 5);
  assert.deepEqual([await balanceOf('bank'), await balanceOf('usd')], balances);
  assert.ok([cogs, commission, refund, shareholder]);
  await assertBooksAddUp();
});

test('the expense breakdown groups real costs and leaves out loans, capital and currency bought', async () => {
  const sara = await prisma.employee.create({ data: { name: 'سارا', salary: 1 } });
  const shareholder = await prisma.shareholder.create({ data: { name: 'علی', percentage: 100 } });
  assert.equal((await expense({ description: 'دفتر' })).success, true);
  assert.equal((await expense({ amount: '500000', description: 'انبار' })).success, true);
  assert.equal((await expense({ amount: '300000', category: 'پیک' })).success, true);
  await prisma.transaction.create({ data: { type: 'EXPENSE', amount: 100_000, amountInToman: 100_000 } });
  // None of these is a cost.
  assert.equal((await createLoan(undefined, form({ borrowerId: sara.id, amount: '3000000', accountId: 'bank' }))).success, true);
  assert.equal((await withdrawShareholderFunds(undefined, form({ shareholderId: shareholder.id, accountId: 'bank', amount: '4000000', currency: 'TOMAN' }))).success, true);
  assert.equal((await exchangeCurrency(undefined, form({
    sourceAccountId: 'bank', targetAccountId: 'usd', sourceAmount: '1000000', targetAmount: '10',
    sourceCurrency: 'TOMAN', targetCurrency: 'USD', exchangeRate: '100000', date: '2026-09-21', description: '',
  }))).success, true);

  assert.deepEqual(await getExpenseBreakdown(), [
    { category: 'اجاره', amount: 2_500_000 },
    { category: 'پیک', amount: 300_000 },
    { category: 'سایر', amount: 100_000 },
  ]);
});
