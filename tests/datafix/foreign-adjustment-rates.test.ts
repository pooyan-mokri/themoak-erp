import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase } from '../helpers/db';
import { balances, reportRows, rowsHash, runTwice } from './sql';

// prisma/sql/datafix-2026-10-01-foreign-adjustment-rates.sql: a foreign transfer leg or balance
// correction stored at rate 1 gets the rate in force on its date.

beforeEach(() => resetDatabase());
after(() => prisma.$disconnect());

test('the rows at rate 1 take the rate of their date; amounts, balances and every other row stay', async () => {
  const usd = await prisma.account.create({ data: { name: 'حساب ذخیره دلاری', type: 'BANK', currency: 'USD', balance: 10_500 } });
  const toman = await prisma.account.create({ data: { name: 'بانک', type: 'BANK', currency: 'TOMAN', balance: 0 } });
  const rate = (rateToToman: number, date: string) =>
    prisma.exchangeRate.create({ data: { currency: 'USD', rateToToman, date: new Date(date) } });
  await rate(100_000, '2026-08-01T00:00:00Z');
  await rate(222_000, '2026-09-20T00:00:00Z');
  await rate(250_000, '2026-09-25T00:00:00Z'); // after both rows: not theirs
  const row = (data: Record<string, unknown>) =>
    prisma.transaction.create({ data: { currency: 'USD', rateSnapshot: 1, accountId: usd.id, ...data } as any });

  const correction = await row({ type: 'ADJUSTMENT', amount: -710, amountInToman: -710, category: 'اصلاح موجودی', date: new Date('2026-09-21T16:49:18Z') });
  const baseline = await row({ type: 'ADJUSTMENT', amount: 9_790, amountInToman: 9_790, category: 'مانده پایه', date: new Date('2026-09-22T12:04:15Z') });
  const leg = await row({ type: 'TRANSFER', amount: 100, amountInToman: 100, category: 'انتقال وجه', description: '[خروج] x', date: new Date('2026-08-05T00:00:00Z') });
  // Left: no rate on or before its date; an expense (not a transfer or correction); a Toman row; one already priced.
  const unpriced = await row({ type: 'ADJUSTMENT', amount: 5, amountInToman: 5, category: 'اصلاح موجودی', date: new Date('2026-07-01T00:00:00Z') });
  const expense = await row({ type: 'EXPENSE', amount: 3, amountInToman: 3, category: 'Other', date: new Date('2026-09-21T00:00:00Z') });
  await prisma.transaction.create({ data: { type: 'ADJUSTMENT', amount: 50, amountInToman: 50, currency: 'TOMAN', accountId: toman.id } });
  await row({ type: 'ADJUSTMENT', amount: 1, amountInToman: 222_000, rateSnapshot: 222_000, date: new Date('2026-09-21T00:00:00Z') });
  const others = await rowsHash('Transaction', [correction.id, baseline.id, leg.id]);
  const accounts = await balances();

  await runTwice('datafix-2026-10-01-foreign-adjustment-rates.sql', ['Transaction']);

  const read = async (id: string) => {
    const t = await prisma.transaction.findUniqueOrThrow({ where: { id } });
    return [Number(t.amount), Number(t.rateSnapshot), Number(t.amountInToman)];
  };
  assert.deepEqual(await read(correction.id), [-710, 222_000, -157_620_000]);
  assert.deepEqual(await read(baseline.id), [9_790, 222_000, 2_173_380_000]);
  assert.deepEqual(await read(leg.id), [100, 100_000, 10_000_000]);
  assert.equal(await rowsHash('Transaction', [correction.id, baseline.id, leg.id]), others);
  assert.deepEqual(await balances(), accounts);
  // The report now lists only the row with no rate to take.
  assert.deepEqual((await reportRows('report-foreign-toman-equivalent.sql')).map((r: any) => r.id), [unpriced.id]);
  assert.ok(expense);
});
