import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { prisma, resetDatabase, form } from '../helpers/db';
import { beforeQuery } from '../helpers/hooks';
import { setTestRole } from '../stubs/auth';
import { createInventoryAudit, freezeInventory, issueAdjustmentDocuments, acceptSystemForUncounted } from '@/actions/inventory-audit';
import { adjustStock, transferStock, transferStockBatch, updateStock } from '@/actions/inventory';
import { giftProduct } from '@/actions/product';
import { receivePurchaseOrderItems } from '@/actions/supplier';
import { repairCancelledOrderStock } from '@/actions/lost-stock';
import { WarehouseUnderAudit, assertNoOpenAudit } from '@/lib/audit-stock-lock';
import { assertStockInvariants, qty, stockSnapshot, stockUp } from '../inventory/stock';

// Pooyan's rule: while a warehouse is being counted (its audit frozen and not yet issued), no stock moves in
// or out of it. src/lib/audit-stock-lock.ts, called by every stock writer.

console.log = () => {};
console.error = () => {};

const UNDER_AUDIT = /^انبار «مرکزی» در حال انبارگردانی است \(AUD-\d{4}-\d{4}\)؛ تا صدور اسناد اصلاحی، موجودی این انبار تغییر نمی‌کند\.$/;
let main: { id: string };
let shop: { id: string };

beforeEach(async () => {
  beforeQuery.fn = null;
  setTestRole('ADMIN');
  await resetDatabase();
  await prisma.user.create({ data: { id: 'test-user', name: 'Owner', email: 'owner@x.test', password: 'x', role: 'ADMIN' } });
  main = await prisma.warehouse.create({ data: { id: 'wh-main', name: 'مرکزی' } });
  shop = await prisma.warehouse.create({ data: { id: 'wh-shop', name: 'فروشگاه' } });
  await prisma.product.create({ data: { id: 'panj', name: 'PANJ', sku: 'PANJ', costPrice: 700_000, sellPrice: 2_000_000 } });
  await stockUp('panj', main.id, 5);
  await stockUp('panj', shop.id, 2);
});
after(() => prisma.$disconnect());

async function audit(warehouseId = main.id, freeze = true) {
  const created = await createInventoryAudit(undefined, form({ warehouseId }));
  assert.equal(created.success, true, created.message);
  if (freeze) assert.equal((await freezeInventory(created.data!.auditId)).success, true);
  return created.data!.auditId;
}

test('every stock action in the ERP refuses a warehouse under audit, in or out, and writes nothing', async () => {
  const supplier = await prisma.supplier.create({ data: { name: 'Mazzucchelli' } });
  const po = await prisma.purchaseOrder.create({
    data: { supplierId: supplier.id, status: 'ARRIVED', totalAmount: 1, totalAmountInToman: 1, items: { create: [{ productId: 'panj', quantity: 3, unitCost: 1, unitCostInToman: 1 }] } },
    include: { items: true },
  });
  const cancelled = await prisma.order.create({
    data: { status: 'CANCELLED', totalAmount: 1, items: { create: [{ productId: 'panj', quantity: 1, price: 1 }] } },
  });
  // The lost line has no warehouse: the configured default, main, is where the repair would put it back.
  await prisma.systemSetting.create({ data: { key: 'woo_settings', value: JSON.stringify({ warehouseId: main.id }) } });
  await prisma.account.create({ data: { name: 'Marketing Expenses', type: 'EXPENSE', currency: 'TOMAN' } });
  // All the stock in main, so a gift has nowhere else to come from.
  await transferStock('panj', shop.id, main.id, 2);
  await audit();
  const before = await stockSnapshot();

  const results: Array<[string, any]> = [
    ['adjust in', await adjustStock('panj', main.id, 1)],
    ['adjust out', await adjustStock('panj', main.id, -1)],
    ['set count', await updateStock('panj', main.id, 9)],
    ['transfer out', await transferStock('panj', main.id, shop.id, 1)],
    ['transfer in', await transferStock('panj', shop.id, main.id, 1)],
    ['batch', await transferStockBatch({ fromWarehouseId: main.id, toWarehouseId: shop.id, items: [{ productId: 'panj', quantity: 1 }] })],
    ['gift', await giftProduct('panj', 1, 'مهمان')],
    ['receive', await receivePurchaseOrderItems(po.id, main.id, [{ itemId: po.items[0].id, receivedQuantity: 3 }])],
  ];
  for (const [label, result] of results) {
    assert.equal(result.success, false, label);
    assert.match(result.error, UNDER_AUDIT, label);
  }
  const repaired = await repairCancelledOrderStock(cancelled.id);
  assert.equal(repaired.success, false);
  assert.match(repaired.message!, UNDER_AUDIT);

  assert.deepEqual(await stockSnapshot(), before);
  assert.equal(await prisma.transaction.count(), 0);
  assert.equal((await prisma.purchaseOrderItem.findUniqueOrThrow({ where: { id: po.items[0].id } })).receivedQuantity, 0);
  assert.equal((await prisma.orderItem.findFirstOrThrow({ where: { orderId: cancelled.id } })).warehouseId, null);
});

test('other warehouses move freely; a gift is taken from a warehouse that is not being counted', async () => {
  await stockUp('panj', shop.id, 3);
  await audit();
  assert.equal((await adjustStock('panj', shop.id, 1)).success, true);
  // The shop holds 6, main (under audit) 5: the gift comes from the shop.
  assert.equal((await giftProduct('panj', 2, 'مهمان')).success, true);
  assert.deepEqual([await qty('panj', main.id), await qty('panj', shop.id)], [5, 4]);
  // More than the shop holds: main would have it, but it is being counted.
  const refused = await giftProduct('panj', 5, 'مهمان');
  assert.match((refused as any).error, UNDER_AUDIT);
  await assertStockInvariants();
});

test('a planned audit blocks nothing; issuing (or keeping every system number) opens the warehouse again', async () => {
  const id = await audit(main.id, false);
  assert.equal((await adjustStock('panj', main.id, 1)).success, true, 'planned, not yet frozen');
  assert.equal((await freezeInventory(id)).success, true);
  assert.equal((await adjustStock('panj', main.id, 1)).success, false);
  // Nobody counted: keep the system number for everything, then issue — nothing changes, and stock moves again.
  const items = await prisma.inventoryAuditItem.findMany({ where: { auditId: id } });
  assert.equal((await acceptSystemForUncounted(id, items.map((i: any) => i.productId))).success, true);
  assert.equal((await issueAdjustmentDocuments(id)).success, true);
  assert.equal(await qty('panj', main.id), 6);
  assert.equal((await adjustStock('panj', main.id, 1)).success, true);
  await assertStockInvariants();
});

test('a freeze that starts during a stock move waits for it and counts it; a move after the freeze is refused', async () => {
  const id = await audit(main.id, false);
  let freezing: Promise<any> | null = null;
  beforeQuery.fn = async (params) => {
    if (params.model !== 'Inventory' || params.action !== 'updateMany') return;
    beforeQuery.fn = null;
    freezing = freezeInventory(id);
    await Promise.race([freezing, sleep(500)]);
  };
  const moved = await transferStock('panj', main.id, shop.id, 2);
  beforeQuery.fn = null;
  assert.equal(moved.success, true);
  assert.equal((await freezing!).success, true);
  // The snapshot and the system quantity include the move: 5 − 2.
  const snapshot = await prisma.inventoryAuditSnapshot.findFirstOrThrow({ where: { auditId: id, productId: 'panj' } });
  assert.equal(snapshot.quantity, 3);
  assert.equal((await prisma.inventoryAuditItem.findFirstOrThrow({ where: { auditId: id, productId: 'panj' } })).systemQuantity, 3);
  assert.match(((await transferStock('panj', main.id, shop.id, 1)) as any).error, UNDER_AUDIT);
  await assertStockInvariants();
});

test('two freezes at once start the audit once', async () => {
  const id = await audit(main.id, false);
  const [a, b] = await Promise.all([freezeInventory(id), freezeInventory(id)]);
  assert.deepEqual([a.success, b.success].sort(), [false, true]);
  assert.equal(await prisma.inventoryAuditSnapshot.count({ where: { auditId: id } }), 1);
});

test('the helper: ignores missing ids and unknown warehouses, and throws its Persian refusal for an open audit', async () => {
  await assertNoOpenAudit(prisma, [null, undefined, 'nowhere', shop.id]);
  await audit();
  await assert.rejects(assertNoOpenAudit(prisma, [shop.id, main.id]), (error: unknown) => {
    assert.ok(error instanceof WarehouseUnderAudit);
    assert.match((error as Error).message, UNDER_AUDIT);
    return true;
  });
});
