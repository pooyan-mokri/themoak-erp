import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { getTransactions } from '@/actions/accounting';
import { JOURNAL_MAX_ROWS } from '@/lib/journal-export';

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
});
after(() => prisma.$disconnect());

async function row(date: string, description: string) {
  await prisma.transaction.create({
    data: { type: 'INCOME', amount: 1, amountInToman: 1, date: new Date(date), description },
  });
}

test('the journal reaches any period, however many newer rows there are', async () => {
  await row('2025-03-01T10:00:00Z', 'پارسال');
  // More newer rows than the old 100-row cap, which hid everything behind them.
  await prisma.transaction.createMany({
    data: Array.from({ length: 150 }, (_, i) => ({
      type: 'INCOME' as const,
      amount: 1,
      amountInToman: 1,
      date: new Date(Date.UTC(2026, 8, 1, 0, i)),
      description: `شهریور ${i}`,
    })),
  });

  const all = await getTransactions();
  assert.equal(all.length, 151);
  assert.ok(all.some((t: any) => t.description === 'پارسال'));

  const lastYear = await getTransactions({ from: '2025-01-01', to: '2025-12-31' });
  assert.deepEqual(lastYear.map((t: any) => t.description), ['پارسال']);

  // «to» includes the whole of that day.
  const firstOfSeptember = await getTransactions({ from: '2026-09-01', to: '2026-09-01' });
  assert.equal(firstOfSeptember.length, 150);
  assert.ok(JOURNAL_MAX_ROWS >= 1000);
});
