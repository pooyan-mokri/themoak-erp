import assert from 'node:assert/strict';
import { prisma } from '../helpers/db';
import { driftOf, openAccount } from '../accounting/ledger';
import { createPurchaseOrder } from '@/actions/supplier';
import { stockUp } from '../inventory/stock';

// Shared by tests/purchasing: a supplier, products of every type, warehouses, paying accounts and rates.

export const USD_RATE = 100_000; // Toman per USD
export const EUR_RATE = 110_000;
export const OPENING = { toman: 500_000_000, usd: 10_000, eur: 5_000 };

export async function purchasingWorld() {
  await openAccount('toman', OPENING.toman);
  await openAccount('usd', OPENING.usd, 'USD');
  await openAccount('eur', OPENING.eur, 'EUR');
  await prisma.exchangeRate.create({ data: { currency: 'USD', rateToToman: USD_RATE, date: new Date('2026-09-01') } });
  await prisma.exchangeRate.create({ data: { currency: 'EUR', rateToToman: EUR_RATE, date: new Date('2026-09-01') } });
  const supplier = await prisma.supplier.create({ data: { name: 'Mazzucchelli' } });
  const customer = await prisma.customer.create({ data: { name: 'شریک امانی' } });
  const main = await prisma.warehouse.create({ data: { name: 'مرکزی' } });
  const shop = await prisma.warehouse.create({ data: { name: 'فروشگاه' } });
  const archived = await prisma.warehouse.create({ data: { name: 'قدیمی', isArchived: true, archivedAt: new Date() } });
  const partner = await prisma.warehouse.create({ data: { name: 'امانی', isVirtual: true, customerId: customer.id } });
  const product = (name: string, sku: string, costPrice: number, productType = 'SALEABLE') =>
    prisma.product.create({ data: { name, sku, costPrice, sellPrice: 2_000_000, productType: productType as any } });
  const panj = await product('PANJ - Blue', 'PANJ/BLUE', 300_000);
  const yek = await product('YEK - Black', 'YEK/BLK', 0);
  const other = await product('بند عینک', 'STRAP', 50_000, 'OTHER');
  const cloth = await product('دستمال', 'CLOTH', 0, 'CONSUMABLE');
  const lathe = await product('دستگاه تراش', 'LATHE', 0, 'FIXED_ASSET');
  await stockUp(panj.id, main.id, 5);
  return { supplier, main, shop, archived, partner, panj, yek, other, cloth, lathe };
}

export type World = Awaited<ReturnType<typeof purchasingWorld>>;

type Line = { productId: string; quantity: number; unitCost: number; currency?: 'TOMAN' | 'USD' | 'EUR' | 'CNY' };
type Extra = { title: string; amount: number; currency: 'TOMAN' | 'USD' | 'EUR' | 'CNY' };

/** A purchase order made the way the form makes it, then moved to `status` directly. */
export async function order(w: World, lines: Line[], extras: Extra[] = [], status = 'DRAFT') {
  const before = await prisma.purchaseOrder.findMany({ select: { id: true } });
  const created = await createPurchaseOrder({
    supplierId: w.supplier.id,
    items: lines.map((l) => ({ currency: 'TOMAN' as const, ...l })),
    additionalCosts: extras,
  });
  assert.equal(created.success, true, created.error);
  const row = await prisma.purchaseOrder.findFirstOrThrow({
    where: { id: { notIn: before.map((o: any) => o.id) } },
    include: { items: { orderBy: { id: 'asc' } } },
  });
  if (status !== 'DRAFT') await prisma.purchaseOrder.update({ where: { id: row.id }, data: { status } });
  // Lines in the order they were given.
  const items = lines.map((l, i) => row.items.filter((it: any) => it.productId === l.productId)[lines.slice(0, i).filter((x) => x.productId === l.productId).length]);
  return { ...row, status, items };
}

/**
 * What must hold for every purchase order after any scenario: its Toman total is its lines plus its
 * order-level costs, exactly once; what was paid is the sum of its payments, never above the total, each
 * with its own expense row for the same Toman figure; and every paying account's ledger adds up.
 */
export async function assertPurchaseInvariants() {
  const orders = await prisma.purchaseOrder.findMany({ include: { items: true, additionalCosts: true, payments: { include: { transaction: true } } } });
  for (const po of orders) {
    const lines = po.items.reduce((s: number, i: any) => s + i.quantity * Number(i.unitCostInToman ?? i.unitCost), 0);
    const extras = po.additionalCosts.reduce((s: number, c: any) => s + Number(c.amountInToman ?? c.amount), 0);
    assert.ok(Math.abs(Number(po.totalAmountInToman) - (lines + extras)) < 1e-6, `order #${po.number} total ${po.totalAmountInToman} vs ${lines + extras}`);
    const paid = po.payments.reduce((s: number, p: any) => s + Number(p.amount), 0);
    assert.ok(paid <= Number(po.totalAmountInToman) + 1, `order #${po.number} paid ${paid} over its total`);
    for (const p of po.payments.filter((p: any) => p.accountId)) {
      assert.ok(p.transaction, `payment ${p.id} has its expense row`);
      assert.equal(Number(p.transaction.amountInToman), Number(p.amount));
      assert.equal(p.transaction.accountId, p.accountId);
      assert.equal(p.transaction.type, 'EXPENSE');
    }
    // A payment from the supplier's credit moves no account, and the credit shows it spent on this order.
    const fromCredit = po.payments.filter((p: any) => !p.accountId);
    assert.ok(fromCredit.every((p: any) => p.transactionId === null), `order #${po.number} credit payment with a transaction`);
    const creditRows = await prisma.supplierCredit.findMany({ where: { purchaseOrderId: po.id } });
    const used = -creditRows.filter((c: any) => Number(c.amount) < 0).reduce((s: number, c: any) => s + Number(c.amount), 0);
    assert.ok(Math.abs(used - fromCredit.reduce((s: number, p: any) => s + Number(p.amount), 0)) < 1e-6, `order #${po.number} credit used ${used}`);
    // A cancelled order's payments went to the credit, exactly once; no other order credits anything.
    const credited = creditRows.filter((c: any) => Number(c.amount) > 0).reduce((s: number, c: any) => s + Number(c.amount), 0);
    assert.ok(Math.abs(credited - (po.status === 'CANCELLED' ? paid : 0)) < 1e-6, `order #${po.number} credited ${credited}`);
    for (const item of po.items) assert.ok(item.receivedQuantity >= 0 && item.receivedQuantity <= item.quantity, `line ${item.id} received ${item.receivedQuantity}`);
  }
  for (const id of ['toman', 'usd', 'eur']) assert.equal(await driftOf(id), 0, `${id} ledger drifted`);
  // No supplier ever owes back less than nothing.
  const balances = await prisma.supplierCredit.groupBy({ by: ['supplierId'], _sum: { amount: true } });
  for (const b of balances) assert.ok(Number(b._sum.amount) >= -1e-6, `supplier ${b.supplierId} credit ${b._sum.amount}`);
}
