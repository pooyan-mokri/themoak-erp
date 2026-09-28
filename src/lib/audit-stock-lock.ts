/**
 * No stock moves in a warehouse while it is being counted.
 *
 * An audit's system quantities are frozen when it starts (freezeInventory) and its adjustments are the counted
 * number minus that frozen number, applied when it is issued. Any stock change in the warehouse in between
 * would be corrected twice, so every writer of Inventory calls assertNoOpenAudit for the warehouses it touches,
 * inside its own transaction and before the write.
 *
 * The website is the exception (Pooyan's decision): its sales and restocks are accepted during a count, and
 * issuing accounts for them from their movements (inventory-audit.ts, correctionFor). A website writer calls
 * holdOpenAudits instead, which refuses nothing but orders its write against a freeze.
 *
 * "Open" is IN_PROGRESS: frozen and not yet issued. A PLANNED audit has frozen nothing yet (and there is no way
 * to close one except starting it), so it blocks nothing; its row is still held FOR SHARE, so a freeze that
 * starts meanwhile waits for this write to commit and then snapshots it.
 *
 * Deliberately NOT a 'use server' file: it runs inside the caller's transaction.
 */

/** Thrown inside the caller's transaction so it rolls back; the message is safe to show as it is. */
export class WarehouseUnderAudit extends Error {}

async function lockAudits(tx: any, ids: string[]): Promise<Array<{ auditNumber: string; status: string; name: string }>> {
  return tx.$queryRaw`
    SELECT a."auditNumber", a."status", w."name"
      FROM "InventoryAudit" a JOIN "Warehouse" w ON w."id" = a."warehouseId"
     WHERE a."warehouseId" = ANY(${ids}) AND a."status" IN ('PLANNED', 'IN_PROGRESS')
     ORDER BY a."auditNumber"
       FOR SHARE OF a`;
}

const idsOf = (warehouseIds: Array<string | null | undefined>) => [...new Set(warehouseIds.filter((id): id is string => !!id))];

/**
 * For a writer allowed during a count (the website): holds these warehouses' audits FOR SHARE, refusing
 * nothing, so a freeze that starts meanwhile waits for the write and snapshots it, and a write that comes after
 * the freeze is a movement after it.
 */
export async function holdOpenAudits(tx: any, warehouseIds: Array<string | null | undefined>): Promise<void> {
  const ids = idsOf(warehouseIds);
  if (ids.length > 0) await lockAudits(tx, ids);
}

/**
 * Throws WarehouseUnderAudit when any of these warehouses has an open audit. `tx` is the caller's interactive
 * transaction (a plain client works too, without the freeze coordination). Missing ids are ignored.
 */
export async function assertNoOpenAudit(tx: any, warehouseIds: Array<string | null | undefined>): Promise<void> {
  const ids = idsOf(warehouseIds);
  if (ids.length === 0) return;
  const audits = await lockAudits(tx, ids);
  const open = audits.find((audit) => audit.status === 'IN_PROGRESS');
  if (open) {
    throw new WarehouseUnderAudit(
      `انبار «${open.name}» در حال انبارگردانی است (${open.auditNumber})؛ تا صدور اسناد اصلاحی، موجودی این انبار تغییر نمی‌کند.`,
    );
  }
}
