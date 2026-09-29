import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase, form } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { recordDeposit, recordWithdrawal } from '@/actions/accounting';
import { assertBooksAddUp, balanceOf, openAccount } from './ledger';

// The actions log every refusal these tests provoke on purpose.
console.error = () => {};

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
  await openAccount('bank', 10_000_000);
  await openAccount('usd', 100, 'USD');
  await prisma.exchangeRate.create({ data: { currency: 'USD', rateToToman: 100_000, date: new Date('2026-09-20T08:00:00Z') } });
});
after(() => prisma.$disconnect());

const deposit = (fields: Record<string, string>) =>
  recordDeposit(undefined, form({ amount: '3000000', currency: 'TOMAN', accountId: 'bank', description: 'فروش حضوری', ...fields }));
const payment = (fields: Record<string, string>) =>
  recordWithdrawal(undefined, form({ amount: '2000000', currency: 'TOMAN', accountId: 'bank', payee: 'علی رضایی', ...fields }));
const lastRow = () => prisma.transaction.findFirstOrThrow({ where: { NOT: { category: 'موجودی اولیه' } }, orderBy: { createdAt: 'desc' } });

test('a deposit is one INCOME row and the balance up by it; category, tags and date as given', async () => {
  const result = await deposit({ category: 'فروش', tags: ' مهر ,  نقدی,, ', date: '2026-09-22T20:30:00.000Z' });
  assert.equal(result.success, true, result.message);
  const row = await lastRow();
  assert.deepEqual(
    [row.type, Number(row.amount), row.currency, Number(row.amountInToman), row.category, row.description, row.tags, row.date.toISOString()],
    ['INCOME', 3_000_000, 'TOMAN', 3_000_000, 'فروش', 'فروش حضوری', ['مهر', 'نقدی'], '2026-09-22T20:30:00.000Z'],
  );
  assert.equal(await balanceOf('bank'), 13_000_000);
  assert.equal((await deposit({})).success, true);
  assert.equal((await lastRow()).category, 'واریز', 'no category: «واریز»');
  await assertBooksAddUp();
});

test('a deposit lands in the account\'s own currency, at the latest rate', async () => {
  assert.equal((await deposit({ amount: '25', currency: 'USD' })).success, true, 'dollars into a Toman account');
  let row = await lastRow();
  assert.deepEqual([Number(row.amount), row.currency, Number(row.amountInToman)], [2_500_000, 'TOMAN', 2_500_000]);
  assert.equal((await deposit({ amount: '1500000', accountId: 'usd' })).success, true, 'Toman into a dollar account');
  row = await lastRow();
  assert.deepEqual([Number(row.amount), row.currency, Number(row.rateSnapshot), Number(row.amountInToman)], [15, 'USD', 100_000, 1_500_000]);
  assert.equal((await deposit({ amount: '0.01', currency: 'USD', accountId: 'usd' })).success, true, 'a cent');
  assert.deepEqual([await balanceOf('bank'), await balanceOf('usd')], [12_500_000, 115.01]);
  await assertBooksAddUp();
});

test('a deposit is refused, booking nothing, without a description or account, with a bad amount, or with no rate', async () => {
  await openAccount('eur', 0, 'EUR');
  const cases: [Record<string, string>, RegExp][] = [
    [{ description: '' }, /فیلدهای الزامی/],
    [{ accountId: '' }, /فیلدهای الزامی/],
    [{ amount: '0' }, /فیلدهای الزامی/],
    [{ amount: '-10' }, /فیلدهای الزامی/],
    [{ amount: '۳۰۰۰' }, /فیلدهای الزامی/],
    [{ accountId: 'nowhere' }, /حساب یافت نشد/],
    [{ currency: 'EUR' }, /نرخ تبدیل برای ارز EUR یافت نشد/],
    [{ accountId: 'eur' }, /نرخ تبدیل برای ارز EUR یافت نشد/],
  ];
  for (const [fields, message] of cases) {
    const result = await deposit(fields);
    assert.equal(result.success, false, JSON.stringify(fields));
    assert.match(result.message!, message, JSON.stringify(fields));
  }
  assert.equal(await prisma.transaction.count({ where: { type: 'INCOME' } }), 0);
  assert.equal(await balanceOf('bank'), 10_000_000);
});

test('a payment is one EXPENSE row to its payee and the balance down by it', async () => {
  const result = await payment({ tags: 'اجاره', date: '2026-09-22T20:30:00.000Z' });
  assert.equal(result.success, true, result.message);
  const row = await lastRow();
  assert.deepEqual(
    [row.type, Number(row.amount), row.payee, row.category, row.description, row.tags],
    ['EXPENSE', 2_000_000, 'علی رضایی', 'برداشت/پرداخت', 'پرداخت به: علی رضایی', ['اجاره']],
  );
  assert.equal(await balanceOf('bank'), 8_000_000);

  assert.equal((await payment({ amount: '1500000', accountId: 'usd', category: 'اشتراک', description: 'سرور' })).success, true);
  const dollars = await lastRow();
  assert.deepEqual([Number(dollars.amount), dollars.currency, Number(dollars.amountInToman), dollars.category, dollars.description], [15, 'USD', 1_500_000, 'اشتراک', 'سرور']);
  assert.equal(await balanceOf('usd'), 85);
  await assertBooksAddUp();
});

test('a payment is refused, moving nothing, without a payee, above the balance, or with a bad amount or rate', async () => {
  await openAccount('eur', 10, 'EUR');
  const cases: [Record<string, string>, RegExp][] = [
    [{ payee: '' }, /فیلدهای الزامی/],
    [{ amount: '0' }, /فیلدهای الزامی/],
    [{ amount: '10000001' }, /کافی نیست/],
    [{ amount: '101', currency: 'USD', accountId: 'usd' }, /کافی نیست/],
    [{ accountId: 'nowhere' }, /حساب یافت نشد/],
    [{ accountId: 'eur' }, /نرخ تبدیل/],
  ];
  for (const [fields, message] of cases) {
    const result = await payment(fields);
    assert.equal(result.success, false, JSON.stringify(fields));
    assert.match(result.message!, message, JSON.stringify(fields));
  }
  assert.equal(await prisma.transaction.count({ where: { type: 'EXPENSE' } }), 0);
  assert.deepEqual([await balanceOf('bank'), await balanceOf('usd')], [10_000_000, 100]);
});

test('dollars into or out of a dollar account are booked exactly as typed, whatever the rate', async () => {
  // 250.5 × 103,456.7 ÷ 103,456.7 is 250.49999999999997 in floating point.
  await prisma.exchangeRate.create({ data: { currency: 'USD', rateToToman: 103_456.7, date: new Date('2026-09-25T08:00:00Z') } });
  assert.equal((await deposit({ amount: '250.5', currency: 'USD', accountId: 'usd' })).success, true);
  assert.equal((await lastRow()).amount.toString(), '250.5');
  assert.equal((await payment({ amount: '99.99', currency: 'USD', accountId: 'usd' })).success, true);
  assert.equal((await lastRow()).amount.toString(), '99.99');
  assert.equal((await balanceOf('usd')), 250.51);
  assert.equal((await prisma.account.findUniqueOrThrow({ where: { id: 'usd' } })).balance.toString(), '250.51');
  await assertBooksAddUp();
});
