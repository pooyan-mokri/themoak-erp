import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { getBalanceSheet, getProfitLossReport } from '@/actions/reports';
import { openAccount } from '../accounting/ledger';
import { balances, rowsHash, runFix, runTwice, tableHashes, changedTables } from './sql';
import { showroomDeposit } from './real-shapes';

// prisma/sql/datafix-2026-10-01-partner-loan.sql: of the showroom deposit, the partner's 1,034M share was a
// loan, and «دریافت مبلغ ودیعه مشاهیر» its repayment.

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
  await openAccount('novin', 3_000_000_000);
});
after(() => prisma.$disconnect());

const FROM = new Date('2026-01-01T00:00:00Z');
const TO = new Date('2026-12-31T23:59:59Z');

test('the three payments become a loan to the partner and the 1,034M income its repayment; the deposit is 505M', async () => {
  const { lent, own, repaid } = await showroomDeposit('novin');
  const changed = [...lent, repaid].map((r) => r.id);
  const others = await rowsHash('Transaction', changed);
  const accounts = await balances();
  const before = (await getProfitLossReport(FROM, TO)).summary;

  await runTwice('datafix-2026-10-01-partner-loan.sql', ['Transaction']);
  await runFix('datafix-2026-10-01-rent-deposits.sql');

  const category = async (id: string) => (await prisma.transaction.findUniqueOrThrow({ where: { id } })).category;
  assert.deepEqual(await Promise.all(lent.map((r) => category(r.id))), ['قرض به شریک', 'قرض به شریک', 'قرض به شریک']);
  assert.equal(await category(repaid.id), 'بازپرداخت قرض شریک');
  assert.deepEqual(await Promise.all(own.map((r) => category(r.id))), ['ودیعه اجاره', 'ودیعه اجاره', 'ودیعه اجاره']);
  assert.deepEqual(await balances(), accounts);

  // No longer revenue nor expense; the deposit held is the company's own 505M; the partner owes nothing.
  const pl = (await getProfitLossReport(FROM, TO)).summary;
  assert.equal(pl.income, before.income - 1_034_000_000);
  assert.equal(pl.operatingExpenses, before.operatingExpenses - 1_539_000_000);
  const sheet = await getBalanceSheet(new Date());
  assert.deepEqual([sheet.assets.rentDeposits, sheet.assets.partnerLoans], [505_000_000, 0]);
  assert.ok(others);
});

test('it finds the payments after the rent-deposit fix as well, and changes nothing more on a second run', async () => {
  const { lent } = await showroomDeposit('novin');
  await runFix('datafix-2026-10-01-rent-deposits.sql');
  await runTwice('datafix-2026-10-01-partner-loan.sql', ['Transaction']);
  for (const row of lent) assert.equal((await prisma.transaction.findUniqueOrThrow({ where: { id: row.id } })).category, 'قرض به شریک');
});

test('unless exactly those rows are there, it stops and changes nothing', async () => {
  const { lent } = await showroomDeposit('novin');
  // One more 34M payment on the same day: no longer exactly the three Pooyan named.
  await prisma.transaction.create({
    data: { type: 'EXPENSE', category: 'Rent', description: 'Rent - بخشی از ودیعه showroom', amount: 34_000_000, amountInToman: 34_000_000, accountId: 'novin', date: new Date('2026-07-27T20:30:00Z') },
  });
  const before = await tableHashes();
  await assert.rejects(runFix('datafix-2026-10-01-partner-loan.sql'), /partner-loan: expected the two 500M payments/);
  assert.deepEqual(changedTables(before, await tableHashes()), []);

  await resetDatabase();
  await openAccount('novin', 3_000_000_000);
  await showroomDeposit('novin');
  await prisma.transaction.deleteMany({ where: { description: 'دریافت مبلغ ودیعه مشاهیر' } });
  await assert.rejects(runFix('datafix-2026-10-01-partner-loan.sql'), /expected one 1,034M/);
  assert.ok(lent);
});
