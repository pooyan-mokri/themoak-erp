import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase, form } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { getProfitLossReport } from '@/actions/reports';
import { getInternalTransfers, recordInternalTransfer } from '@/actions/accounting';
import { assertBooksAddUp, openAccount } from '../accounting/ledger';
import { balances, rowsHash, runTwice } from './sql';

// prisma/sql/datafix-2026-10-01-petty-cash.sql, on a fixture: the petty-cash advances booked as
// expenses become internal transfers to «تنخواه showroom».

console.error = () => {};

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
});
after(() => prisma.$disconnect());

const FROM = new Date('2026-01-01T00:00:00Z');
const TO = new Date('2026-12-31T23:59:59Z');

/** An expense as the expense form books it: «<category> - <text>», the account's balance taken down. */
async function expense(accountId: string, category: string, text: string, amount: number, date: string, currency = 'TOMAN') {
  const row = await prisma.transaction.create({
    data: {
      type: 'EXPENSE', currency: currency as any, amount, amountInToman: amount, accountId, category,
      description: `${category} - ${text}`, date: new Date(date),
    },
  });
  await prisma.account.update({ where: { id: accountId }, data: { balance: { decrement: amount } } });
  return row;
}

/** The columns a transfer leg is made of, without its own id and timestamps. */
const shape = (t: any) => ({
  type: t.type, currency: t.currency, category: t.category, rateSnapshot: Number(t.rateSnapshot),
  amountInToman: Number(t.amountInToman), tags: t.tags, prefix: (t.description ?? '').split(' ')[0],
  linked: Boolean(t.transferGroupId), payee: t.payee, projectId: t.projectId, employeeId: t.employeeId,
  customerId: t.customerId, orderId: t.orderId, exchangeGroupId: t.exchangeGroupId,
});

test('each advance becomes a transfer to «تنخواه showroom»; the source balances stay and the petty cash holds them', async () => {
  await openAccount('pasargad', 500_000_000);
  await openAccount('novin', 500_000_000);
  await openAccount('usd', 1_000, 'USD');
  const first = await expense('pasargad', 'Other', 'تنخواه اول SHOWROOM', 50_000_000, '2026-07-14T20:30:00Z');
  const second = await expense('novin', 'Other', 'تنخواه دوم showroom', 50_000_000, '2026-07-22T20:30:00Z');
  const fourth = await expense('novin', 'Other', 'تنخواه چهارم مشاهیر', 20_000_000, '2026-08-11T11:22:21Z');
  // Left: a real expense, the word in another category, a dollar row (no Toman transfer can carry it).
  await expense('novin', 'Other', 'پیک', 1_000_000, '2026-07-23T00:00:00Z');
  await expense('novin', 'Rent', 'تنخواه؟', 2_000_000, '2026-07-23T00:00:00Z');
  await expense('usd', 'Other', 'تنخواه دلاری', 10, '2026-07-23T00:00:00Z', 'USD');
  const others = await rowsHash('Transaction', [first.id, second.id, fourth.id]);
  const before = await balances();
  const pl = (await getProfitLossReport(FROM, TO)).summary;
  await assertBooksAddUp();

  await runTwice('datafix-2026-10-01-petty-cash.sql', ['Account', 'Transaction']);

  const petty = await prisma.account.findFirstOrThrow({ where: { name: 'تنخواه showroom' } });
  assert.deepEqual([petty.type, petty.currency, Number(petty.balance)], ['CASH', 'TOMAN', 120_000_000]);
  // Every other balance is where it was: the money had left those accounts.
  assert.deepEqual({ ...(await balances()), [petty.id]: undefined }, { ...before, [petty.id]: undefined });
  await assertBooksAddUp();
  assert.equal(await rowsHash('Transaction', [first.id, second.id, fourth.id, ...(await prisma.transaction.findMany({ where: { accountId: petty.id } })).map((t: any) => t.id)]), others);

  for (const [row, from, text, amount] of [
    [first, 'pasargad', 'تنخواه اول SHOWROOM', 50_000_000],
    [second, 'novin', 'تنخواه دوم showroom', 50_000_000],
    [fourth, 'novin', 'تنخواه چهارم مشاهیر', 20_000_000],
  ] as const) {
    const out = await prisma.transaction.findUniqueOrThrow({ where: { id: row.id } });
    const into = await prisma.transaction.findFirstOrThrow({ where: { transferGroupId: out.transferGroupId, id: { not: out.id } } });
    assert.deepEqual(
      [out.type, out.category, out.description, out.accountId, Number(out.amount), out.date.toISOString()],
      ['TRANSFER', 'انتقال وجه', `[خروج] ${text}`, from, amount, row.date.toISOString()],
    );
    assert.deepEqual(
      [into.type, into.category, into.description, into.accountId, Number(into.amount), into.date.toISOString()],
      ['TRANSFER', 'انتقال وجه', `[ورود] ${text}`, petty.id, amount, row.date.toISOString()],
    );
  }

  // Exactly the shape of a transfer made in the app.
  await openAccount('a', 10_000_000);
  await openAccount('b', 0);
  assert.equal((await recordInternalTransfer(undefined as any, form({ amount: '5000000', fromAccountId: 'a', toAccountId: 'b', description: 'x' }))).success, true);
  const made = await prisma.transaction.findMany({ where: { accountId: { in: ['a', 'b'] }, type: 'TRANSFER' }, orderBy: { description: 'desc' } });
  const fixed = await prisma.transaction.findMany({ where: { transferGroupId: (await prisma.transaction.findUniqueOrThrow({ where: { id: second.id } })).transferGroupId }, orderBy: { description: 'desc' } });
  assert.deepEqual(
    fixed.map((t: any) => ({ ...shape(t), amountInToman: 0 })),
    made.map((t: any) => ({ ...shape(t), amountInToman: 0 })),
  );

  // They are transfers now: listed as transfers, out of profit and loss.
  const transfers = (await getInternalTransfers()).filter((t) => t.toAccountId === petty.id);
  assert.deepEqual(transfers.map((t) => [t.fromAccountId, t.amount, t.complete]).sort(), [
    ['novin', 20_000_000, true], ['novin', 50_000_000, true], ['pasargad', 50_000_000, true],
  ]);
  const plAfter = (await getProfitLossReport(FROM, TO)).summary;
  assert.equal(plAfter.operatingExpenses, pl.operatingExpenses - 120_000_000);
});

test('an account already named «تنخواه showroom» is the one used', async () => {
  await openAccount('bank', 100_000_000);
  await openAccount('petty', 3_000_000, 'TOMAN', { name: 'تنخواه showroom', type: 'CASH' });
  await expense('bank', 'Other', 'تنخواه اول SHOWROOM', 50_000_000, '2026-07-14T20:30:00Z');

  await runTwice('datafix-2026-10-01-petty-cash.sql', ['Account', 'Transaction']);

  assert.equal(await prisma.account.count({ where: { name: 'تنخواه showroom' } }), 1);
  assert.equal(Number((await prisma.account.findUniqueOrThrow({ where: { id: 'petty' } })).balance), 53_000_000);
  await assertBooksAddUp();
});
