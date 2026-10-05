/**
 * The business world's time machine (/dashboard/world): the last 30 days, day
 * by day. Rather than a snapshot per day, the server sends what changed since
 * the window began — each stock movement and each money row — and the client
 * walks back from today's snapshot (src/lib/world-types.ts) to the end of any
 * day: a stock row is what its movements brought in less what they took out
 * (as tests/sales/world.ts checks), an account's balance is the sum of its
 * rows' effects (balanceEffect, src/lib/balance-reconciliation.ts).
 *
 * Each part only for a role that may see it: movements with stock.view, money
 * with finance.view (src/lib/world-data.ts's layers). Pure: the page walks back
 * with it in the browser; the server builds the history in world-history-build.ts.
 */

export const HISTORY_DAYS = 30;

/** A stock movement: product, from warehouse, to warehouse, units, when. */
export type HistoryMove = { p: string; f: string | null; t: string | null; q: number; at: string };
/** A money row's effect on its account, in the account's currency, on its date. */
export type HistoryChange = { a: string; d: number; at: string };

export type WorldHistory = {
  generatedAt: string;
  /** Tehran days, oldest first, today last. */
  days: string[];
  /** The end of each day (exclusive), as an instant, in the same order. */
  ends: string[];
  moves?: HistoryMove[];
  changes?: HistoryChange[];
};

/**
 * Units by product and warehouse at an instant: today's rows less every movement
 * after it. `today` is the snapshot's byWarehouse per product.
 */
export function stockAt(today: Array<{ id: string; byWarehouse: Record<string, number> }>, moves: HistoryMove[], at: string): Map<string, Record<string, number>> {
  const out = new Map<string, Record<string, number>>(today.map((p) => [p.id, { ...p.byWarehouse }]));
  for (const m of moves) {
    if (m.at < at) continue;
    const row = out.get(m.p) ?? {};
    if (m.t) row[m.t] = (row[m.t] ?? 0) - m.q;
    if (m.f) row[m.f] = (row[m.f] ?? 0) + m.q;
    out.set(m.p, row);
  }
  for (const row of out.values()) for (const [w, q] of Object.entries(row)) if (q === 0) delete row[w];
  return out;
}

/** Each account's balance at an instant: today's balance less the effect of every row dated after it. */
export function balancesAt(today: Array<{ id: string; balance: number }>, changes: HistoryChange[], at: string): Map<string, number> {
  const out = new Map(today.map((a) => [a.id, a.balance]));
  for (const c of changes) {
    if (c.at < at || !out.has(c.a)) continue;
    out.set(c.a, (out.get(c.a) ?? 0) - c.d);
  }
  return out;
}
