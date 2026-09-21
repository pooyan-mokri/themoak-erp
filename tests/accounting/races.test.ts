import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { prisma, resetDatabase, form } from '../helpers/db';
import { beforeQuery } from '../helpers/hooks';
import { setTestRole } from '../stubs/auth';
import { deleteExpense, recordExpense, updateExpense } from '@/actions/accounting';
import {
  deleteCurrencyExchange,
  exchangeCurrency,
  getCurrencyExchangeHistory,
  updateCurrencyExchange,
} from '@/actions/currency-exchange';
import { balanceOf, driftOf, openAccount } from './ledger';

// The actions log every refusal these tests provoke on purpose.
console.error = () => {};

beforeEach(async () => {
  setTestRole('ADMIN');
  beforeQuery.fn = null;
  await resetDatabase();
  await openAccount('toman', 100_000_000);
  await openAccount('usd', 100, 'USD');
});
after(() => prisma.$disconnect());

/**
 * Runs `first`, and starts `second` just before `first` makes its first
 * Account update (after it has read what it is about to reverse), giving
 * `second` the chance to run to the end first.
 */
async function overlapping<T>(first: () => Promise<T>, second: () => Promise<T>): Promise<[T, T]> {
  let started: Promise<T> | null = null;
  beforeQuery.fn = async (params) => {
    if (params.model !== 'Account' || params.action !== 'update') return;
    beforeQuery.fn = null;
    started = second();
    await Promise.race([started, sleep(500)]);
  };
  const a = await first();
  beforeQuery.fn = null;
  assert.ok(started, 'the second call was started');
  return [a, await started!];
}

async function buyUsd() {
  const bought = await exchangeCurrency(
    undefined,
    form({
      sourceAccountId: 'toman', targetAccountId: 'usd', sourceAmount: '10000000', targetAmount: '100',
      sourceCurrency: 'TOMAN', targetCurrency: 'USD', exchangeRate: '100000', date: '2026-09-20', description: '',
    }),
  );
  assert.equal(bought.success, true, bought.message);
  return (await getCurrencyExchangeHistory())[0];
}

async function assertLedgersAddUp() {
  for (const id of ['toman', 'usd']) assert.equal(await driftOf(id), 0, `${id} drifted`);
}

test('two deletes of the same exchange at once: one succeeds, the other reverses nothing', async () => {
  const recorded = await buyUsd();

  const [first, second] = await overlapping(
    () => deleteCurrencyExchange(recorded.id),
    () => deleteCurrencyExchange(recorded.id),
  );
  assert.deepEqual([first.success, second.success].sort(), [false, true]);
  assert.equal(await balanceOf('toman'), 100_000_000, 'the Toman came back once');
  assert.equal(await balanceOf('usd'), 100, 'the dollars were taken back once');
  assert.equal(await prisma.transaction.count({ where: { category: 'Currency Exchange' } }), 0);
  await assertLedgersAddUp();
});

test('an edit and a delete of the same exchange at once leave a consistent ledger', async () => {
  const recorded = await buyUsd();

  const [edited, deleted] = await overlapping(
    () =>
      updateCurrencyExchange({
        id: recorded.id,
        sourceAccountId: 'toman',
        targetAccountId: 'usd',
        sourceAmount: 8_000_000,
        targetAmount: 80,
        sourceCurrency: 'TOMAN' as any,
        targetCurrency: 'USD' as any,
        exchangeRate: 100_000,
      }),
    () => deleteCurrencyExchange(recorded.id),
  );
  assert.equal(edited.success, true, edited.message);
  // The delete waited for the edit and reversed the edited amounts, not the old ones.
  assert.equal(deleted.success, true, deleted.message);
  assert.equal(await balanceOf('toman'), 100_000_000);
  assert.equal(await balanceOf('usd'), 100);
  await assertLedgersAddUp();
});

test('two edits of the same expense at once: the second reverses what the first wrote', async () => {
  const booked = await recordExpense(
    undefined,
    form({ amount: '1000000', currency: 'TOMAN', category: 'Office', accountId: 'toman', description: 'لوازم' }),
  );
  assert.equal(booked.success, true, booked.message);
  const expense = await prisma.transaction.findFirstOrThrow({ where: { type: 'EXPENSE' } });
  const edit = (amount: number) =>
    updateExpense({ id: expense.id, amount, currency: 'TOMAN' as any, category: 'Office', description: 'لوازم' });

  const [first, second] = await overlapping(() => edit(3_000_000), () => edit(5_000_000));
  assert.equal(first.success, true, first.message);
  assert.equal(second.success, true, second.message);

  const stored = await prisma.transaction.findUniqueOrThrow({ where: { id: expense.id } });
  // Whichever edit landed last, the balance holds exactly that one expense.
  assert.equal(await balanceOf('toman'), 100_000_000 - Number(stored.amount));
  await assertLedgersAddUp();
});

test('an edit that lands while a delete of the same expense is under way: the delete reverses what the row holds', async () => {
  const booked = await recordExpense(
    undefined,
    form({ amount: '1000000', currency: 'TOMAN', category: 'Other', accountId: 'toman', description: 'ناهار' }),
  );
  assert.equal(booked.success, true, booked.message);
  const expense = await prisma.transaction.findFirstOrThrow({ where: { type: 'EXPENSE' } });

  // The edit (1,000,000 → 3,000,000) starts after the delete has read the expense.
  const [deleted] = await overlapping(
    () => deleteExpense(expense.id),
    () => updateExpense({ id: expense.id, amount: 3_000_000, currency: 'TOMAN' as any, category: 'Other', description: 'ناهار' }),
  );
  assert.equal(deleted.success, true, deleted.message);

  const left = await prisma.transaction.findUnique({ where: { id: expense.id } });
  // Whatever is left in the books is what the balance shows: the delete never gives back 1,000,000 for a 3,000,000 row.
  assert.equal(await balanceOf('toman'), 100_000_000 - Number(left?.amount ?? 0));
  await assertLedgersAddUp();
});
