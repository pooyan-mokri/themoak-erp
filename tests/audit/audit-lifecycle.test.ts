import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import { prisma, resetDatabase, form } from '../helpers/db';
import { beforeQuery } from '../helpers/hooks';
import { setTestRole } from '../stubs/auth';
import {
  addAuditTeamMember,
  calculateDiscrepancies,
  createInventoryAudit,
  freezeInventory,
  generateAuditTags,
  getDiscrepancyReport,
  getInventoryAudits,
  getPerformanceReport,
  issueAdjustmentDocuments,
  recordCount,
  removeAuditTeamMember,
  setFinalQuantity,
} from '@/actions/inventory-audit';
import { transferStock } from '@/actions/inventory';
import { assertStockInvariants, qty, stockUp } from '../inventory/stock';
import { getInventoryAudit } from '@/actions/inventory-audit';

// Stocktaking from start to finish: creating and freezing an audit, the team, counting, discrepancies and
// their reports, and the adjustments it issues keeping stock equal to its movements.

console.log = () => {};
console.error = () => {};

const DENIED = 'شما به این بخش دسترسی ندارید.';
let main: { id: string };
let shop: { id: string };

beforeEach(async () => {
  beforeQuery.fn = null;
  setTestRole('ADMIN');
  await resetDatabase();
  await prisma.user.createMany({
    data: [
      { id: 'test-user', name: 'Owner', email: 'owner@x.test', password: 'x', role: 'ADMIN' },
      { id: 'u2', name: 'شمارنده', email: 'u2@x.test', password: 'x', role: 'WAREHOUSE' },
      { id: 'u3', name: 'ناظر', email: 'u3@x.test', password: 'x', role: 'WAREHOUSE' },
    ],
  });
  main = await prisma.warehouse.create({ data: { id: 'wh-main', name: 'مرکزی' } });
  shop = await prisma.warehouse.create({ data: { id: 'wh-shop', name: 'فروشگاه' } });
  await prisma.product.createMany({
    data: [
      { id: 'panj', name: 'PANJ', sku: 'PANJ', costPrice: 700_000, sellPrice: 2_000_000, barcode: '2900000000017' },
      { id: 'yek', name: 'YEK', sku: 'YEK', costPrice: 400_000, sellPrice: 1_500_000 },
      { id: 'du', name: 'DU', sku: 'DU', costPrice: 100_000, sellPrice: 500_000 },
    ],
  });
  await stockUp('panj', main.id, 5);
  await stockUp('yek', main.id, 3);
  await stockUp('du', shop.id, 7);
});
after(() => prisma.$disconnect());

// The auth stub signs in as 'test-user'; a call run through asUser sends another user's id instead.
const actingAs = new AsyncLocalStorage<string>();
function replaceUser(value: any, userId: string): any {
  if (value === 'test-user') return userId;
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    for (const key of Object.keys(value)) value[key] = replaceUser(value[key], userId);
  }
  return value;
}
async function asUser<T>(userId: string, call: () => Promise<T>) {
  beforeQuery.fn = async (params) => {
    const acting = actingAs.getStore();
    if (acting) replaceUser(params.args, acting);
  };
  try {
    return await actingAs.run(userId, call);
  } finally {
    beforeQuery.fn = null;
  }
}

async function create(warehouseId = main.id, description = '') {
  const created = await createInventoryAudit(undefined, form({ warehouseId, description }));
  assert.equal(created.success, true, created.message);
  return created.data!.auditId;
}
async function started(warehouseId = main.id) {
  const id = await create(warehouseId);
  assert.equal((await freezeInventory(id)).success, true);
  return id;
}
const itemOf = (auditId: string, productId: string) =>
  prisma.inventoryAuditItem.findUniqueOrThrow({ where: { auditId_productId: { auditId, productId } } });

// --- create ---

test('create: a PLANNED audit numbered AUD-<year>-NNNN by its creator; a second active one for the warehouse is refused', async () => {
  const id = await create(main.id, 'انبارگردانی پاییز');
  const audit = await prisma.inventoryAudit.findUniqueOrThrow({ where: { id } });
  assert.match(audit.auditNumber, new RegExp(`^AUD-${new Date().getFullYear()}-\\d{4}$`));
  assert.deepEqual([audit.status, audit.createdBy, audit.description, audit.isFrozen], ['PLANNED', 'test-user', 'انبارگردانی پاییز', false]);

  const again = await createInventoryAudit(undefined, form({ warehouseId: main.id }));
  assert.deepEqual(again, { success: false, message: `یک انبارگردانی فعال برای این انبار وجود دارد: ${audit.auditNumber}` });
  await freezeInventory(id);
  assert.equal((await createInventoryAudit(undefined, form({ warehouseId: main.id }))).success, false, 'IN_PROGRESS is active too');
  assert.equal((await createInventoryAudit(undefined, form({ warehouseId: shop.id }))).success, true, 'another warehouse is fine');

  assert.deepEqual(await createInventoryAudit(undefined, form({ warehouseId: '' })), { success: false, message: 'لطفاً انبار را انتخاب کنید.' });
  assert.deepEqual(await createInventoryAudit(undefined, form({ warehouseId: 'nowhere' })), { success: false, message: 'انبار یافت نشد.' });
  assert.equal(await prisma.inventoryAudit.count(), 2);
});

test('create: a number an earlier audit already has is drawn again, instead of failing with a database error', async () => {
  const random = Math.random;
  const draws = [0.1234, 0.1234, 0.5678];
  Math.random = () => draws.shift() ?? random();
  try {
    await create(main.id);
    const second = await createInventoryAudit(undefined, form({ warehouseId: shop.id }));
    assert.equal(second.success, true, second.message);
  } finally {
    Math.random = random;
  }
  const numbers = (await prisma.inventoryAudit.findMany({ orderBy: { createdAt: 'asc' } })).map((a: any) => a.auditNumber.slice(-4));
  assert.deepEqual(numbers, ['1234', '5678']);
});

test('create: two creates for the same warehouse at once start one audit', async () => {
  let started: Promise<any> | null = null;
  beforeQuery.fn = async (params) => {
    if (params.model !== 'InventoryAudit' || params.action !== 'create') return;
    beforeQuery.fn = null;
    started = createInventoryAudit(undefined, form({ warehouseId: main.id }));
    await Promise.race([started, sleep(500)]);
  };
  const first = await createInventoryAudit(undefined, form({ warehouseId: main.id }));
  beforeQuery.fn = null;
  const second = await started!;
  assert.deepEqual([first.success, second.success].sort(), [false, true]);
  assert.equal(await prisma.inventoryAudit.count({ where: { warehouseId: main.id } }), 1);
});

// --- freeze ---

test('freeze: snapshots the warehouse\'s rows at cost, makes every product an item at its system quantity, and starts the audit', async () => {
  const id = await create();
  const frozen = await freezeInventory(id);
  assert.deepEqual(frozen, { success: true, message: 'موجودی با موفقیت فریز شد.', data: { snapshotCount: 2 } });
  const snapshots = await prisma.inventoryAuditSnapshot.findMany({ where: { auditId: id }, orderBy: { productId: 'asc' } });
  assert.deepEqual(snapshots.map((s: any) => [s.productId, s.warehouseId, s.quantity, Number(s.costPrice)]), [
    ['panj', main.id, 5, 700_000],
    ['yek', main.id, 3, 400_000],
  ]);
  const items = await prisma.inventoryAuditItem.findMany({ where: { auditId: id }, orderBy: { productId: 'asc' } });
  assert.deepEqual(items.map((i: any) => [i.productId, i.systemQuantity, i.finalQuantity]), [['du', 0, null], ['panj', 5, null], ['yek', 3, null]]);
  const audit = await prisma.inventoryAudit.findUniqueOrThrow({ where: { id } });
  assert.deepEqual([audit.status, audit.isFrozen, !!audit.frozenAt, !!audit.startDate], ['IN_PROGRESS', true, true, true]);

  assert.deepEqual(await freezeInventory(id), { success: false, message: 'موجودی قبلاً فریز شده است.' });
  assert.deepEqual(await freezeInventory('missing'), { success: false, message: 'انبارگردانی یافت نشد.' });
  assert.equal(await prisma.inventoryAuditSnapshot.count(), 2);
});

test('freeze: a product created after the freeze is not an item and cannot be counted', async () => {
  const id = await started();
  await prisma.product.create({ data: { id: 'new', name: 'NEW', sku: 'NEW', costPrice: 1, sellPrice: 1 } });
  assert.deepEqual(await recordCount(id, 'new', 1), { success: false, message: 'آیتم انبارگردانی یافت نشد.' });
});

// --- team ---

test('team: a COUNTER counts, an AUDITOR approves, a SUPERVISOR does both; a member is added once and can be removed', async () => {
  const id = await started();
  assert.deepEqual(await addAuditTeamMember(id, 'u2', 'COUNTER'), { success: true, message: 'عضو تیم با موفقیت اضافه شد.' });
  assert.equal((await addAuditTeamMember(id, 'u3', 'AUDITOR')).success, true);
  assert.deepEqual(await addAuditTeamMember(id, 'u2', 'SUPERVISOR'), { success: false, message: 'این کاربر قبلاً به تیم اضافه شده است.' });
  const team = await prisma.inventoryAuditTeam.findMany({ orderBy: { userId: 'asc' } });
  assert.deepEqual(team.map((m: any) => [m.userId, m.role, m.canCount, m.canApprove, m.assignedBy]), [
    ['u2', 'COUNTER', true, false, 'test-user'],
    ['u3', 'AUDITOR', false, true, 'test-user'],
  ]);

  setTestRole('WAREHOUSE');
  // Someone else created the audit, so the team decides: u2 counts; u3 may not count, but may approve a final.
  await prisma.user.create({ data: { id: 'u4', name: 'سازنده', email: 'u4@x.test', password: 'x', role: 'WAREHOUSE' } });
  await prisma.inventoryAudit.update({ where: { id }, data: { createdBy: 'u4' } });
  assert.equal((await asUser('u2', () => recordCount(id, 'panj', 4, 1, 'پشت قفسه'))).success, true);
  const refused = await asUser('u3', () => recordCount(id, 'panj', 9, 2));
  assert.equal(refused.success, false);
  assert.match(refused.message!, /مجوز شمارش ندارید/);
  assert.equal((await asUser('u2', () => setFinalQuantity(id, 'panj', 4))).success, false);
  assert.equal((await asUser('u3', () => setFinalQuantity(id, 'panj', 4))).success, true);
  const item = await itemOf(id, 'panj');
  assert.deepEqual([item.countedQuantity1, item.countedBy1, item.notes, item.countedQuantity2, item.finalQuantity], [4, 'u2', 'پشت قفسه', null, 4]);

  setTestRole('ADMIN');
  assert.deepEqual(await removeAuditTeamMember(id, 'u2'), { success: true, message: 'عضو تیم با موفقیت حذف شد.' });
  assert.equal((await removeAuditTeamMember(id, 'u2')).success, false);
  assert.equal((await addAuditTeamMember('missing', 'u2')).message, 'انبارگردانی یافت نشد.');
  setTestRole('WAREHOUSE');
  assert.equal((await asUser('u2', () => recordCount(id, 'panj', 1, 3))).success, false, 'removed members count no more');
});

test('counting is refused before the freeze and after the audit is issued', async () => {
  const planned = await create();
  assert.deepEqual(await recordCount(planned, 'panj', 1), { success: false, message: 'انبارگردانی در حال انجام نیست.' });
  await freezeInventory(planned);
  assert.equal((await recordCount(planned, 'panj', 5, 1)).success, true);
  assert.equal((await recordCount(planned, 'yek', 3, 1)).success, true);
  assert.equal((await recordCount(planned, 'du', 0, 1)).success, true);
  for (const productId of ['panj', 'yek', 'du']) {
    const item = await itemOf(planned, productId);
    assert.equal((await setFinalQuantity(planned, productId, item.countedQuantity1!)).success, true);
  }
  assert.equal((await issueAdjustmentDocuments(planned)).success, true);
  assert.deepEqual(await recordCount(planned, 'panj', 1, 2), { success: false, message: 'انبارگردانی در حال انجام نیست.' });
});

// --- discrepancies, reports, issue ---

async function countedAudit() {
  const id = await started();
  // PANJ: 5 on record, 3 found (short 2). YEK: 3 on record, 4 found (1 extra). DU: none here, none found.
  await recordCount(id, 'panj', 3, 1);
  await recordCount(id, 'panj', 3, 2);
  await recordCount(id, 'yek', 5, 1);
  await recordCount(id, 'yek', 4, 2);
  await setFinalQuantity(id, 'panj', 3);
  await setFinalQuantity(id, 'yek', 4);
  await setFinalQuantity(id, 'du', 0);
  return id;
}

test('discrepancy report: only items that differ, their value at cost, and the shortage and excess counts', async () => {
  const id = await countedAudit();
  const report = (await getDiscrepancyReport(id))!;
  assert.deepEqual(
    report.audit.items.map((i: any) => [i.productId, i.systemQuantity, i.finalQuantity, i.discrepancy, Number(i.discrepancyValue)]),
    [['yek', 3, 4, 1, 400_000], ['panj', 5, 3, -2, -1_400_000]],
  );
  assert.deepEqual([report.totalDiscrepancyValue, report.shortageCount, report.excessCount, report.totalItems], [-1_000_000, 1, 1, 2]);

  setTestRole('WAREHOUSE');
  const blind = (await getDiscrepancyReport(id))!;
  assert.equal(blind.totalDiscrepancyValue, null);
  assert.ok(blind.audit.items.every((i: any) => !('discrepancyValue' in i) && !('costPrice' in i.product)));
  setTestRole('USER');
  assert.equal(await getDiscrepancyReport(id), undefined);
});

test('calculateDiscrepancies prices every final item at today\'s cost; items without a final stay untouched', async () => {
  const id = await started();
  await setFinalQuantity(id, 'panj', 2);
  await prisma.product.update({ where: { id: 'panj' }, data: { costPrice: 800_000 } });
  assert.deepEqual(await calculateDiscrepancies(id), { success: true, message: 'مغایرت‌ها با موفقیت محاسبه شدند.' });
  const panj = await itemOf(id, 'panj');
  assert.deepEqual([panj.discrepancy, Number(panj.discrepancyValue)], [-3, -2_400_000]);
  const yek = await itemOf(id, 'yek');
  assert.deepEqual([yek.discrepancy, yek.discrepancyValue], [null, null]);
  assert.equal((await calculateDiscrepancies('missing')).success, false);
});

test('performance report: counted and differing items, accuracy, and counts per counter', async () => {
  const id = await countedAudit();
  const report = (await getPerformanceReport(id))!;
  assert.deepEqual(report.statistics, { totalItems: 3, countedItems: 3, itemsWithDiscrepancy: 2, accuracy: (1 / 3) * 100 });
  assert.deepEqual(report.countByUser, [{ name: 'Owner', count: 4 }]);
  setTestRole('WAREHOUSE');
  assert.ok((await getPerformanceReport(id))!.audit.items.every((i: any) => !('discrepancyValue' in i)));
  setTestRole(null);
  assert.equal(await getPerformanceReport(id), undefined);
});

test('issuing: stock moves by each discrepancy with an ADJUSTMENT movement, and stays equal to its movements', async () => {
  const id = await countedAudit();
  const issued = await issueAdjustmentDocuments(id);
  assert.deepEqual(issued, {
    success: true,
    message: 'اسناد اصلاحی برای 2 آیتم صادر شد (1 عدد افزایش، 2 عدد کاهش).',
    data: { adjustedCount: 2, unitsUp: 1, unitsDown: 2 },
  });
  assert.deepEqual([await qty('panj', main.id), await qty('yek', main.id), await qty('du', main.id), await qty('du', shop.id)], [3, 4, null, 7]);
  const audit = await prisma.inventoryAudit.findUniqueOrThrow({ where: { id } });
  const movements = await prisma.inventoryMovement.findMany({ where: { referenceId: id }, orderBy: { productId: 'asc' } });
  assert.deepEqual(movements.map((m: any) => [m.productId, m.type, m.fromWarehouseId, m.toWarehouseId, m.quantity, m.note]), [
    ['panj', 'ADJUSTMENT', main.id, null, 2, `انبارگردانی ${audit.auditNumber}`],
    ['yek', 'ADJUSTMENT', null, main.id, 1, `انبارگردانی ${audit.auditNumber}`],
  ]);
  const adjusted = await prisma.inventoryAuditItem.findMany({ where: { auditId: id, isAdjusted: true }, orderBy: { productId: 'asc' } });
  assert.deepEqual(adjusted.map((i: any) => i.adjustmentDocId), [`ADJ-${id}-panj`, `ADJ-${id}-yek`]);
  assert.equal(audit.status, 'COMPLETED');
  await assertStockInvariants();
});

test('stock cannot move during the audit, so issuing corrects exactly what was counted', async () => {
  const id = await started();
  // After the freeze, 2 PANJ cannot leave for the shop: the audit is open (tests/audit/audit-stock-lock.test.ts).
  const refused = await transferStock('panj', main.id, shop.id, 2);
  assert.equal(refused.success, false);
  assert.match((refused as any).error, /در حال انبارگردانی است/);
  await setFinalQuantity(id, 'panj', 5);
  await setFinalQuantity(id, 'yek', 3);
  await setFinalQuantity(id, 'du', 0);
  assert.equal((await issueAdjustmentDocuments(id)).success, true);
  assert.equal(await qty('panj', main.id), 5);
  // Issued: the warehouse moves again.
  assert.equal((await transferStock('panj', main.id, shop.id, 2)).success, true);
  await assertStockInvariants();
});

test('audit list: every audit newest first with its counts, or one warehouse\'s', async () => {
  const a = await started(main.id);
  const b = await create(shop.id);
  await addAuditTeamMember(a, 'u2', 'COUNTER');
  const all = await getInventoryAudits();
  assert.deepEqual(all.map((x: any) => [x.id, x._count.items, x._count.teams, x.warehouse.name]), [[b, 0, 0, 'فروشگاه'], [a, 3, 1, 'مرکزی']]);
  assert.deepEqual((await getInventoryAudits(shop.id)).map((x: any) => x.id), [b]);
});

test('tags: one per item, carrying the product barcode or a generated code', async () => {
  const id = await started();
  const result = await generateAuditTags(id);
  assert.deepEqual(result, { success: true, message: '3 تگ با موفقیت ایجاد شد.', data: { tagCount: 3 } });
  const tags = await prisma.inventoryAuditTag.findMany({ where: { auditId: id }, orderBy: { productId: 'asc' } });
  assert.equal(tags.find((t: any) => t.productId === 'panj')!.barcode, '2900000000017');
  assert.ok(tags.filter((t: any) => t.productId !== 'panj').every((t: any) => t.barcode.startsWith(`TAG-${id.substring(0, 8)}-`)));
});

test('audit writes refuse every role without stock.manage and write nothing', async () => {
  const id = await started();
  const before = await prisma.inventoryAuditItem.findMany({ orderBy: { id: 'asc' } });
  for (const role of ['AUDITOR', 'ACCOUNTANT', 'SALES', 'PROJECT_MANAGER', 'USER', null]) {
    setTestRole(role);
    for (const result of [
      await createInventoryAudit(undefined, form({ warehouseId: shop.id })),
      await freezeInventory(id),
      await addAuditTeamMember(id, 'u2'),
      await recordCount(id, 'panj', 1),
      await setFinalQuantity(id, 'panj', 1),
      await calculateDiscrepancies(id),
    ]) {
      assert.equal(result.message, DENIED, String(role));
    }
  }
  assert.deepEqual(await prisma.inventoryAuditItem.findMany({ orderBy: { id: 'asc' } }), before);
  assert.equal(await prisma.inventoryAudit.count(), 1);
});

test('staff in audit reads carry their id and name only, never an email or role', async () => {
  const id = await started();
  await addAuditTeamMember(id, 'u2', 'COUNTER');
  await recordCount(id, 'panj', 5, 1);
  await setFinalQuantity(id, 'panj', 5);
  setTestRole('WAREHOUSE');
  const reads: unknown[] = [await getInventoryAudit(id), await getInventoryAudits(), await getPerformanceReport(id)];
  const people: any[] = [];
  const walk = (node: unknown, key = '') => {
    if (!node || typeof node !== 'object' || node instanceof Date) return;
    if (['user', 'createdByUser', 'countedBy1User', 'countedBy2User', 'countedBy3User', 'assignedByUser'].includes(key) && !Array.isArray(node)) people.push(node);
    for (const [k, child] of Object.entries(node)) walk(child, k);
  };
  reads.forEach((read) => walk(read));
  assert.ok(people.length >= 4, `found ${people.length} staff objects`);
  for (const person of people) assert.deepEqual(Object.keys(person).sort(), person.id ? ['id', 'name'] : ['name']);
  assert.doesNotMatch(JSON.stringify(reads), /@x\.test/);
});
