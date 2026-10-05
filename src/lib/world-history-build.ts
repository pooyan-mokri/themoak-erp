/**
 * The time machine's history, built on the server (src/lib/world-history.ts says
 * what it is): the window's stock movements and money rows, each only for a role
 * that may see it.
 */
import { balanceEffect } from '@/lib/balance-reconciliation';
import { addDays, tehranDay, tehranDayEnd, tehranDayStart } from '@/lib/tehran-day';
import { worldLayers } from '@/lib/world-data';
import { HISTORY_DAYS, type HistoryChange, type WorldHistory } from '@/lib/world-history';

/** Builds the history for a role. `client` is a Prisma client; `now` is for tests. */
export async function buildWorldHistory(client: any, role: string | null | undefined, now: Date = new Date()): Promise<WorldHistory> {
  const layers = worldLayers(role);
  const today = tehranDay(now);
  const first = addDays(today, -(HISTORY_DAYS - 1));
  const since = tehranDayStart(first);
  const days: string[] = [];
  for (let d = first; d <= today; d = addDays(d, 1)) days.push(d);
  const history: WorldHistory = {
    generatedAt: now.toISOString(),
    days,
    ends: days.map((d) => new Date(tehranDayEnd(d).getTime() + 1).toISOString()),
  };
  if (layers.stock) {
    const moves = await client.inventoryMovement.findMany({
      where: { createdAt: { gte: since } },
      select: { productId: true, fromWarehouseId: true, toWarehouseId: true, quantity: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    history.moves = moves.map((m: any) => ({ p: m.productId, f: m.fromWarehouseId, t: m.toWarehouseId, q: m.quantity, at: m.createdAt.toISOString() }));
  }
  if (layers.finance) {
    const rows = await client.transaction.findMany({
      where: { date: { gte: since }, accountId: { not: null }, account: { type: { not: 'EXPENSE' } } },
      select: { accountId: true, type: true, amount: true, description: true, date: true },
      orderBy: { date: 'asc' },
    });
    history.changes = rows
      .map((r: any) => ({ a: r.accountId, d: balanceEffect(r), at: r.date.toISOString() }))
      .filter((c: HistoryChange) => c.d !== 0);
  }
  return history;
}

