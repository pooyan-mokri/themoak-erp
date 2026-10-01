import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase, form } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { getProfitLossReport } from '@/actions/reports';
import { getInternalTransfers, recordInternalTransfer } from '@/actions/accounting';
import { assertBooksAddUp, openAccount } from '../accounting/ledger';
import { balances, changedTables, rowsHash, runFix, runTwice, tableHashes } from './sql';
import { expense, pettyAccount, pettyCashAdvances } from './real-shapes';

// prisma/sql/datafix-2026-10-01-petty-cash.sql, on a fixture: the showroom's petty-cash advances booked as
// expenses become internal transfers to the one petty-cash account, the existing «تنخواه». The BOOOM advance
// is a partner's withdrawal (datafix-2026-10-01-partner-withdrawal.sql) and is left to that fix.

console.error = () => {};

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
});
after(() => prisma.$disconnect());

const FROM = new Date('2026-01-01T00:00:00Z');
const TO = new Date('2026-12-31T23:59:59Z');

/** The columns a transfer leg is made of, without its own id and timestamps. */
const shape = (t: any) => ({
  type: t.type, currency: t.currency, category: t.category, rateSnapshot: Number(t.rateSnapshot),
  tags: t.tags, prefix: (t.description ?? '').split(' ')[0], linked: Boolean(t.transferGroupId), payee: t.payee,
  projectId: t.projectId, employeeId: t.employeeId, customerId: t.customerId, orderId: t.orderId, exchangeGroupId: t.exchangeGroupId,
});

test('the showroom advances become transfers to «تنخواه»; the source balances stay; BOOOM and the rest are left', async () => {
  await openAccount('pasargad', 500_000_000);
  await openAccount('novin', 500_000_000);
  await openAccount('usd', 1_000, 'USD');
  const petty = await pettyAccount();
  const advances = await pettyCashAdvances('pasargad', 'novin');
  // Left: a real expense, the word in another category, a dollar row.
  await expense('novin', 'Other', 'پیک', 1_000_000, '2026-07-23T00:00:00Z');
  await expense('novin', 'Rent', 'تنخواه showroom؟', 2_000_000, '2026-07-23T00:00:00Z');
  await expense('usd', 'Other', 'تنخواه showroom دلاری', 10, '2026-07-23T00:00:00Z', 'USD');
  const converted = [advances.first, advances.second, advances.third, advances.fourth];
  const others = await rowsHash('Transaction', converted.map((r) => r.id));
  const before = await balances();
  const pl = (await getProfitLossReport(FROM, TO)).summary;
  await assertBooksAddUp();

  await runTwice('datafix-2026-10-01-petty-cash.sql', ['Account', 'Transaction']);

  // No new account: «تنخواه» holds the 170M.
  assert.equal(await prisma.account.count({ where: { name: { startsWith: 'تنخواه' } } }), 1);
  assert.deepEqual(await balances(), { ...before, [petty]: before[petty] + 170_000_000 });
  await assertBooksAddUp();
  const inLegs = (await prisma.transaction.findMany({ where: { accountId: petty, type: 'TRANSFER' } })).map((t: any) => t.id);
  assert.equal(await rowsHash('Transaction', [...converted.map((r) => r.id), ...inLegs]), others);
  // BOOOM is still the expense it was, for its own fix.
  assert.equal((await prisma.transaction.findUniqueOrThrow({ where: { id: advances.booom.id } })).category, 'Other');

  for (const [row, from, text] of [
    [advances.first, 'pasargad', 'تنخواه اول SHOWROOM'],
    [advances.second, 'novin', 'تنخواه دوم showroom'],
    [advances.third, 'novin', 'تنخواه سوم showroom'],
    [advances.fourth, 'novin', 'تنخواه چهارم مشاهیر'],
  ] as const) {
    const out = await prisma.transaction.findUniqueOrThrow({ where: { id: row.id } });
    const into = await prisma.transaction.findFirstOrThrow({ where: { transferGroupId: out.transferGroupId, id: { not: out.id } } });
    assert.deepEqual(
      [out.type, out.category, out.description, out.accountId, Number(out.amount), out.date.toISOString()],
      ['TRANSFER', 'انتقال وجه', `[خروج] ${text}`, from, Number(row.amount), row.date.toISOString()],
    );
    assert.deepEqual(
      [into.type, into.category, into.description, into.accountId, Number(into.amount), into.date.toISOString()],
      ['TRANSFER', 'انتقال وجه', `[ورود] ${text}`, petty, Number(row.amount), row.date.toISOString()],
    );
  }

  // Exactly the shape of a transfer made in the app.
  await openAccount('a', 10_000_000);
  await openAccount('b', 0);
  assert.equal((await recordInternalTransfer(undefined as any, form({ amount: '5000000', fromAccountId: 'a', toAccountId: 'b', description: 'x' }))).success, true);
  const made = await prisma.transaction.findMany({ where: { accountId: { in: ['a', 'b'] }, type: 'TRANSFER' }, orderBy: { description: 'desc' } });
  const fixed = await prisma.transaction.findMany({ where: { transferGroupId: (await prisma.transaction.findUniqueOrThrow({ where: { id: advances.second.id } })).transferGroupId }, orderBy: { description: 'desc' } });
  assert.deepEqual(fixed.map(shape), made.map(shape));

  // Transfers now: listed as such, out of profit and loss.
  const transfers = (await getInternalTransfers()).filter((t) => t.toAccountId === petty);
  assert.deepEqual(transfers.map((t) => [t.fromAccountId, t.amount, t.complete]).sort(), [
    ['novin', 20_000_000, true], ['novin', 50_000_000, true], ['novin', 50_000_000, true], ['pasargad', 50_000_000, true],
  ]);
  assert.equal((await getProfitLossReport(FROM, TO)).summary.operatingExpenses, pl.operatingExpenses - 170_000_000);
});

test('on a copy where the first version ran, «تنخواه showroom»\'s legs move to «تنخواه» and the account goes', async () => {
  await openAccount('novin', 500_000_000);
  const petty = await pettyAccount();
  const advances = await pettyCashAdvances('novin', 'novin');
  // What the first version left: «تنخواه showroom» holding the incoming legs of all five advances.
  await prisma.account.create({ data: { id: 'petty-cash-showroom', name: 'تنخواه showroom', type: 'CASH', currency: 'TOMAN', balance: 190_000_000 } });
  for (const row of Object.values(advances)) {
    const group = `group-${row.id}`;
    const text = row.description!.replace(/^Other - /, '');
    await prisma.transaction.update({ where: { id: row.id }, data: { type: 'TRANSFER', category: 'انتقال وجه', description: `[خروج] ${text}`, transferGroupId: group, tags: [] } });
    await prisma.transaction.create({
      data: { id: `petty-cash-in-${row.id}`, type: 'TRANSFER', category: 'انتقال وجه', description: `[ورود] ${text}`, amount: row.amount, amountInToman: row.amount, accountId: 'petty-cash-showroom', date: row.date, transferGroupId: group, tags: [] },
    });
  }
  await assertBooksAddUp();

  await runTwice('datafix-2026-10-01-petty-cash.sql', ['Account', 'Transaction']);
  assert.equal(await prisma.account.count({ where: { name: 'تنخواه showroom' } }), 0);
  assert.equal(Number((await prisma.account.findUniqueOrThrow({ where: { id: petty } })).balance), 437_346 + 190_000_000);
  assert.equal(await prisma.transaction.count({ where: { accountId: petty, description: { startsWith: '[ورود] تنخواه' } } }), 5);
  await assertBooksAddUp();

  // The BOOOM fix then takes its 20M back out of «تنخواه».
  await runTwice('datafix-2026-10-01-partner-withdrawal.sql', ['Account', 'Transaction']);
  assert.equal(Number((await prisma.account.findUniqueOrThrow({ where: { id: petty } })).balance), 437_346 + 170_000_000);
  await assertBooksAddUp();
});

test('without exactly one account named «تنخواه» it stops and changes nothing', async () => {
  await openAccount('novin', 500_000_000);
  await pettyCashAdvances('novin', 'novin');
  const before = await tableHashes();
  await assert.rejects(runFix('datafix-2026-10-01-petty-cash.sql'), /expected one account named «تنخواه», found 0/);
  assert.deepEqual(changedTables(before, await tableHashes()), []);
});
