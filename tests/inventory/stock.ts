import assert from 'node:assert/strict';
import { prisma } from '../helpers/db';

// Shared by tests/inventory and tests/purchasing: stock seeded the way the ERP books it, and the stock invariants.

/** Stock that arrived with its movement, like any booked change: an ADJUSTMENT into the warehouse. */
export async function stockUp(productId: string, warehouseId: string, quantity: number) {
  await prisma.inventory.upsert({
    where: { productId_warehouseId: { productId, warehouseId } },
    update: { quantity: { increment: quantity } },
    create: { productId, warehouseId, quantity },
  });
  await prisma.inventoryMovement.create({
    data: { productId, toWarehouseId: warehouseId, quantity, type: 'ADJUSTMENT', note: 'موجودی اولیه' },
  });
}

export async function qty(productId: string, warehouseId: string): Promise<number | null> {
  const row = await prisma.inventory.findUnique({ where: { productId_warehouseId: { productId, warehouseId } } });
  return row ? row.quantity : null;
}

/** Every product × warehouse where the stored quantity differs from the net of its movements (in minus out). */
export async function movementDrift() {
  const [rows, movements] = await Promise.all([prisma.inventory.findMany(), prisma.inventoryMovement.findMany()]);
  const net = new Map<string, number>();
  const add = (productId: string, warehouseId: string | null, delta: number) => {
    if (!warehouseId) return;
    const key = `${productId}|${warehouseId}`;
    net.set(key, (net.get(key) ?? 0) + delta);
  };
  for (const m of movements) {
    add(m.productId, m.toWarehouseId, m.quantity);
    add(m.productId, m.fromWarehouseId, -m.quantity);
  }
  const stored = new Map<string, number>(rows.map((r: any) => [`${r.productId}|${r.warehouseId}`, r.quantity]));
  const drift: Array<{ key: string; stored: number; net: number }> = [];
  for (const key of new Set([...net.keys(), ...stored.keys()])) {
    const s = stored.get(key) ?? 0;
    const n = net.get(key) ?? 0;
    if (s !== n) drift.push({ key, stored: s, net: n });
  }
  return drift;
}

/** Inventory equals its movements everywhere, no row is negative, and no movement moves zero or fewer units. */
export async function assertStockInvariants(label = '') {
  assert.deepEqual(await movementDrift(), [], `${label} stock drifted from its movements`);
  const negative = await prisma.inventory.findMany({ where: { quantity: { lt: 0 } } });
  assert.deepEqual(negative, [], `${label} negative stock`);
  const empty = await prisma.inventoryMovement.findMany({ where: { quantity: { lte: 0 } } });
  assert.deepEqual(empty, [], `${label} movement of zero or fewer units`);
}

/** Every stock row and movement, for "nothing changed" checks. */
export async function stockSnapshot() {
  const [inventory, movements] = await Promise.all([
    prisma.inventory.findMany({ orderBy: [{ productId: 'asc' }, { warehouseId: 'asc' }] }),
    prisma.inventoryMovement.findMany({ orderBy: { id: 'asc' } }),
  ]);
  return { inventory, movements };
}
