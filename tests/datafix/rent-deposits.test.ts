import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { getBalanceSheet, getProfitLossReport } from '@/actions/reports';
import { getExpenseBreakdown } from '@/actions/accounting';
import { balances, rowsHash, runTwice } from './sql';

// prisma/sql/datafix-2026-10-01-rent-deposits.sql: the showroom deposit booked as Rent becomes «ودیعه اجاره».

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
});
after(() => prisma.$disconnect());

const FROM = new Date('2026-01-01T00:00:00Z');
const TO = new Date('2026-12-31T23:59:59Z');

test('Rent rows that are a deposit move to «ودیعه اجاره» and onto the balance sheet; nothing else changes', async () => {
  const bank = await prisma.account.create({ data: { name: 'اقتصاد نوین', type: 'BANK', currency: 'TOMAN', balance: 1_000_000_000 } });
  const row = (type: string, category: string, description: string, amount: number) =>
    prisma.transaction.create({
      data: { type: type as any, category, description, amount, amountInToman: amount, accountId: bank.id, date: new Date('2026-07-20T00:00:00Z') },
    });
  const d1 = await row('EXPENSE', 'Rent', 'Rent - بخشی از ودیعه showroom', 500_000_000);
  const d2 = await row('EXPENSE', 'Rent', 'Rent - بخشی از ودیعه showroom', 34_000_000);
  // Left as they are: rent itself, a deposit word outside Rent, and money received.
  await row('EXPENSE', 'Rent', 'Rent - اجاره تیر', 50_000_000);
  await row('EXPENSE', 'Other', 'Other - ودیعه کنتور', 1_000_000);
  await row('INCOME', 'واریز بانکی', 'دریافت مبلغ ودیعه', 7_000_000);
  const others = await rowsHash('Transaction', [d1.id, d2.id]);
  const accounts = await balances();

  const plBefore = (await getProfitLossReport(FROM, TO)).summary;
  await runTwice('datafix-2026-10-01-rent-deposits.sql', ['Transaction']);

  for (const [id, amount] of [[d1.id, 500_000_000], [d2.id, 34_000_000]] as const) {
    const t = await prisma.transaction.findUniqueOrThrow({ where: { id } });
    assert.deepEqual([t.category, t.type, Number(t.amount), t.description, t.accountId], ['ودیعه اجاره', 'EXPENSE', amount, 'Rent - بخشی از ودیعه showroom', bank.id]);
  }
  assert.equal(await rowsHash('Transaction', [d1.id, d2.id]), others);
  assert.deepEqual(await balances(), accounts);

  // Profit rises by the deposit, the breakdown drops it, the balance sheet holds it.
  const pl = (await getProfitLossReport(FROM, TO)).summary;
  assert.equal(pl.operatingExpenses, plBefore.operatingExpenses - 534_000_000);
  assert.equal(pl.netProfit, plBefore.netProfit + 534_000_000);
  assert.deepEqual(
    (await getExpenseBreakdown()).map((r: any) => [r.category, r.amount]),
    [['Rent', 50_000_000], ['Other', 1_000_000]],
  );
  assert.equal((await getBalanceSheet(new Date())).assets.rentDeposits, 534_000_000);
});
