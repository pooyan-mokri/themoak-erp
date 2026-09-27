import { balanceEffect } from '@/lib/balance-reconciliation';

/**
 * An account's balance at the end of each of the last weeks, rebuilt from its
 * own journal rows by walking back from the balance it holds now: the balance
 * at a moment is today's balance minus the effect of every row dated after it.
 *
 * Server-side only (balance-reconciliation brings Prisma's Decimal with it).
 * Returns null when the rows cannot rebuild it honestly: a row whose amount was
 * withheld from this role (a cost row), or rows cut off by the journal's cap.
 */

/** «مانده پایه» documents a historical difference and moved no money (recordBalanceBaseline). */
const BASELINE_CATEGORY = 'مانده پایه';

export type HistoryRow = {
  accountId?: string | null;
  type: string;
  amount: number | null;
  description?: string | null;
  category?: string | null;
  date: Date | string;
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** The first moment the rows must reach back to for `weeks` weeks of history. */
export function historyStart(now: Date, weeks: number): Date {
  return new Date(now.getTime() - weeks * WEEK_MS);
}

/**
 * weeks + 1 points, oldest first: the balance `weeks` weeks ago, then at the end
 * of each week after it; the last point is the balance held now.
 * `rows` must hold every row of the account dated after historyStart(now, weeks).
 */
export function weeklyBalances(
  current: number,
  rows: HistoryRow[],
  now: Date,
  weeks = 8,
): number[] | null {
  if (rows.some((row) => row.amount === null)) return null;
  const moved = rows
    .filter((row) => row.category !== BASELINE_CATEGORY)
    .map((row) => ({ at: new Date(row.date).getTime(), effect: balanceEffect(row) }));
  const points: number[] = [];
  for (let week = weeks; week > 0; week--) {
    const at = now.getTime() - week * WEEK_MS;
    const after = moved.reduce((sum, row) => (row.at > at ? sum + row.effect : sum), 0);
    points.push(current - after);
  }
  points.push(current);
  return points;
}
