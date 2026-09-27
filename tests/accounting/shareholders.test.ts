import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase, form } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import {
  createShareholder,
  deleteShareholder,
  depositShareholderFunds,
  getShareholderBalance,
  getShareholderById,
  getShareholders,
  getShareholdersWithBalance,
  updateShareholder,
  withdrawShareholderFunds,
} from '@/actions/shareholder';
import { withdrawShareholderProfit } from '@/actions/shareholder-profit';
import { assertBooksAddUp, balanceOf, openAccount } from './ledger';

// The actions log every refusal these tests provoke on purpose.
console.error = () => {};

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
  await openAccount('bank', 100_000_000);
  await openAccount('usd', 1_000, 'USD');
  await prisma.exchangeRate.create({ data: { currency: 'USD', rateToToman: 103_456.7, date: new Date('2026-09-20T08:00:00Z') } });
});
after(() => prisma.$disconnect());

const shareholderForm = (fields: Record<string, string> = {}) =>
  form({ name: 'علی', percentage: '60', phone: '0912', email: 'ali@example.com', address: '', notes: '', ...fields });

async function ali() {
  const created = await createShareholder(undefined, shareholderForm());
  assert.equal(created.success, true, created.message);
  return prisma.shareholder.findFirstOrThrow({ where: { name: 'علی' } });
}

const money = (shareholderId: string, fields: Record<string, string>) =>
  form({ shareholderId, accountId: 'bank', amount: '10000000', currency: 'TOMAN', description: '', date: '', ...fields });

test('shares add up to at most 100%, counting everyone but the one being edited', async () => {
  const a = await ali();
  assert.deepEqual([Number(a.percentage), a.phone, a.email], [60, '0912', 'ali@example.com']);
  assert.match((await createShareholder(undefined, shareholderForm({ name: 'رضا', percentage: '40.01' }))).message!, /نمی‌تواند بیشتر از 100/);
  assert.equal((await createShareholder(undefined, shareholderForm({ name: 'رضا', percentage: '40', email: '' }))).success, true);
  const reza = await prisma.shareholder.findFirstOrThrow({ where: { name: 'رضا' } });

  assert.match((await updateShareholder(a.id, undefined, shareholderForm({ percentage: '61' }))).message!, /نمی‌تواند بیشتر از 100/);
  assert.equal((await updateShareholder(a.id, undefined, shareholderForm({ percentage: '60', name: 'علی رضایی' }))).success, true);
  assert.equal((await updateShareholder(reza.id, undefined, shareholderForm({ name: 'رضا', percentage: '20', email: '' }))).success, true);
  assert.equal((await createShareholder(undefined, shareholderForm({ name: 'مینا', percentage: '20', email: '' }))).success, true);
  assert.equal((await getShareholders()).reduce((sum: number, s: any) => sum + s.percentage, 0), 100);

  for (const fields of [{ percentage: '101' }, { percentage: '-1' }, { name: '' }, { email: 'not-an-email' }] as Record<string, string>[]) {
    assert.match((await createShareholder(undefined, shareholderForm({ name: 'X', ...fields }))).message!, /فیلدهای الزامی/, JSON.stringify(fields));
  }
  assert.match((await updateShareholder('nobody', undefined, shareholderForm({ percentage: '1' }))).message!, /یافت نشد/);
  assert.equal(await prisma.shareholder.count(), 3);
});

test('capital paid in and out moves the account and the shareholder\'s balance, in Toman', async () => {
  const a = await ali();
  assert.equal((await depositShareholderFunds(undefined, money(a.id, { date: '2026-09-22T20:30:00.000Z' }))).success, true);
  assert.equal((await depositShareholderFunds(undefined, money(a.id, { accountId: 'usd', amount: '250.5', currency: 'USD' }))).success, true);
  assert.equal((await withdrawShareholderFunds(undefined, money(a.id, { amount: '4000000', description: 'برداشت شخصی' }))).success, true);

  const rows = await prisma.transaction.findMany({ where: { shareholderId: a.id }, orderBy: { createdAt: 'asc' } });
  assert.deepEqual(
    rows.map((r: any) => [r.type, r.category, r.accountId, r.amount.toString(), r.currency, Number(r.amountInToman)]),
    [
      ['INCOME', 'Shareholder Deposit', 'bank', '10000000', 'TOMAN', 10_000_000],
      ['INCOME', 'Shareholder Deposit', 'usd', '250.5', 'USD', 250.5 * 103_456.7],
      ['EXPENSE', 'Shareholder Withdrawal', 'bank', '4000000', 'TOMAN', 4_000_000],
    ],
  );
  assert.equal(rows[0].date.toISOString(), '2026-09-22T20:30:00.000Z');
  assert.equal(rows[2].description, 'برداشت شخصی');
  assert.deepEqual([await balanceOf('bank'), await balanceOf('usd')], [106_000_000, 1_250.5]);

  const balance = 10_000_000 + 250.5 * 103_456.7 - 4_000_000;
  assert.equal(await getShareholderBalance(a.id), balance);
  assert.equal((await getShareholdersWithBalance())[0].balance, balance);
  assert.equal((await getShareholderById(a.id))!._count.transactions, 3);
  await assertBooksAddUp();
});

test('a Toman amount paid into a dollar account is booked in dollars at the latest rate', async () => {
  const a = await ali();
  assert.equal((await depositShareholderFunds(undefined, money(a.id, { accountId: 'usd', amount: '10345670' }))).success, true);
  const row = await prisma.transaction.findFirstOrThrow({ where: { shareholderId: a.id } });
  assert.deepEqual([Number(row.amount), row.currency, Number(row.amountInToman)], [100, 'USD', 10_345_670]);
  await assertBooksAddUp();
});

test('capital moves are refused, moving nothing, for an unknown shareholder or account, too little money, no rate or a bad amount', async () => {
  const a = await ali();
  await openAccount('eur', 10, 'EUR');
  const cases: [typeof depositShareholderFunds, Record<string, string>, RegExp][] = [
    [depositShareholderFunds, { shareholderId: 'nobody' }, /صاحب سهام یافت نشد/],
    [depositShareholderFunds, { accountId: 'nowhere' }, /حساب یافت نشد/],
    [depositShareholderFunds, { currency: 'EUR' }, /نرخ ارز برای EUR یافت نشد/],
    [depositShareholderFunds, { accountId: 'eur' }, /نرخ تبدیل برای ارز EUR یافت نشد/],
    [depositShareholderFunds, { amount: '0' }, /فیلدهای الزامی/],
    [withdrawShareholderFunds, { amount: '100000001' }, /کافی نیست/],
    [withdrawShareholderFunds, { amount: '1001', currency: 'USD', accountId: 'usd' }, /کافی نیست/],
    [withdrawShareholderFunds, { shareholderId: 'nobody' }, /صاحب سهام یافت نشد/],
  ];
  for (const [action, fields, message] of cases) {
    const result = await action(undefined, money(fields.shareholderId ?? a.id, fields));
    assert.equal(result.success, false, JSON.stringify(fields));
    assert.match(result.message!, message, JSON.stringify(fields));
  }
  assert.equal(await prisma.transaction.count({ where: { NOT: { category: 'موجودی اولیه' } } }), 0);
  assert.deepEqual([await balanceOf('bank'), await balanceOf('usd')], [100_000_000, 1_000]);
});

test('a shareholder with capital rows or calculated profits is not deleted; one without is', async () => {
  const a = await ali();
  const withProfit = (await prisma.shareholder.create({ data: { name: 'رضا', percentage: 10 } })).id;
  const free = (await prisma.shareholder.create({ data: { name: 'مینا', percentage: 10 } })).id;
  assert.equal((await depositShareholderFunds(undefined, money(a.id, {}))).success, true);
  const profit = await prisma.shareholderProfit.create({
    data: { shareholderId: withProfit, amount: 1_000_000, periodStart: new Date('2026-01-01'), periodEnd: new Date('2026-01-31') },
  });
  assert.equal((await withdrawShareholderProfit(undefined, form({ profitId: profit.id, amount: '1000000', accountId: 'bank' }))).success, true);

  assert.match((await deleteShareholder(a.id)).message!, /تراکنش مرتبط دارد/);
  assert.match((await deleteShareholder(withProfit)).message!, /سود محاسبه‌شده دارد/);
  assert.equal((await deleteShareholder(free)).success, true);
  assert.equal(await prisma.shareholder.count(), 2);
  assert.equal(await prisma.shareholderWithdrawal.count(), 1, 'the payout record is kept');
});
