import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { getExpenseBreakdown } from '@/actions/accounting';
import { getProfitLossReport } from '@/actions/reports';
import { assertBooksAddUp, openAccount } from '../accounting/ledger';
import { balances, changedTables, rowsHash, runFix, runTwice, tableHashes } from './sql';
import { pettyCashAdvances } from './real-shapes';

// prisma/sql/datafix-2026-10-01-partner-withdrawal.sql: the 20M «تنخواه BOOOM» was a partner's withdrawal.

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
  await openAccount('dehghani', 300_000_000);
});
after(() => prisma.$disconnect());

test('the BOOOM expense becomes «برداشت شریک»: out of profit and loss, the balance where it was', async () => {
  const { booom } = await pettyCashAdvances('dehghani', 'dehghani');
  const others = await rowsHash('Transaction', [booom.id]);
  const accounts = await balances();
  const pl = (await getProfitLossReport(new Date('2026-01-01'), new Date('2026-12-31'))).summary;

  await runTwice('datafix-2026-10-01-partner-withdrawal.sql', ['Transaction']);

  const row = await prisma.transaction.findUniqueOrThrow({ where: { id: booom.id } });
  assert.deepEqual([row.type, row.category, row.description, Number(row.amount), row.accountId, row.shareholderId], ['EXPENSE', 'برداشت شریک', 'Other - تنخواه BOOOM', 20_000_000, 'dehghani', null]);
  assert.equal(await rowsHash('Transaction', [booom.id]), others);
  assert.deepEqual(await balances(), accounts);
  await assertBooksAddUp();
  assert.equal((await getProfitLossReport(new Date('2026-01-01'), new Date('2026-12-31'))).summary.operatingExpenses, pl.operatingExpenses - 20_000_000);
  assert.ok(!(await getExpenseBreakdown()).some((r: any) => r.amount === 20_000_000 && r.category === 'Other'));
});

test('unless exactly that one row is there, it stops and changes nothing', async () => {
  const before = await tableHashes();
  await assert.rejects(runFix('datafix-2026-10-01-partner-withdrawal.sql'), /expected one 20M «تنخواه BOOOM» row of 2026-08-31, found 0/);
  assert.deepEqual(changedTables(before, await tableHashes()), []);
});
