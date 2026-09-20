import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { prisma, resetDatabase, form } from '../helpers/db';
import { beforeQuery } from '../helpers/hooks';
import { setTestRole } from '../stubs/auth';
import {
  addAuditTeamMember,
  calculateDiscrepancies,
  createInventoryAudit,
  finalizeAllFromLastCount,
  freezeInventory,
  getDiscrepancyReport,
  getInventoryAudit,
  issueAdjustmentDocuments,
  recordCount,
  removeAuditTeamMember,
  saveAuditCounts,
  setFinalQuantity,
  setZeroForUncounted,
  acceptSystemForUncounted,
} from '@/actions/inventory-audit';

// The audit actions log every step, and every refusal these tests provoke on purpose.
console.log = () => {};
console.error = () => {};

const WH = 'wh-mashahir';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);

beforeEach(async () => {
  beforeQuery.fn = null;
  setTestRole('ADMIN');
  await resetDatabase();
  await prisma.user.createMany({
    data: [
      { id: 'test-user', name: 'Owner', email: 'owner@x.test', password: 'x', role: 'ADMIN' },
      { id: 'u2', name: 'Second', email: 'second@x.test', password: 'x', role: 'WAREHOUSE' },
    ],
  });
  await prisma.warehouse.create({ data: { id: WH, name: 'مشاهیر' } });
});
after(() => prisma.$disconnect());

/** n frames p0..p(n-1) with `quantity` each in the audited warehouse; frame i costs 1000 + 500·i. */
async function seed(n: number, quantity = 2) {
  await prisma.product.createMany({
    data: ids(n).map((id, i) => ({
      id,
      name: `Frame ${String(i).padStart(2, '0')}`,
      sku: `PANJ${i}/BLUE`,
      webId: `MOAK-PANJ${i}-BLUE`,
      barcode: `62600000${String(i).padStart(5, '0')}`,
      costPrice: 1000 + 500 * i,
      sellPrice: 5000,
    })),
  });
  await prisma.inventory.createMany({ data: ids(n).map((productId) => ({ productId, warehouseId: WH, quantity })) });
}

/** Creates and freezes an audit of WH, as the signed-in test user. */
async function startAudit() {
  const created = await createInventoryAudit(undefined, form({ warehouseId: WH }));
  assert.equal(created.success, true, created.message);
  const frozen = await freezeInventory(created.data!.auditId);
  assert.equal(frozen.success, true, frozen.message);
  return created.data!.auditId;
}

const stock = async () =>
  Object.fromEntries(
    (await prisma.inventory.findMany({ where: { warehouseId: WH }, orderBy: { productId: 'asc' } })).map((row: any) => [
      row.productId,
      row.quantity,
    ]),
  );
const auditItem = (auditId: string, productId: string) =>
  prisma.inventoryAuditItem.findUniqueOrThrow({ where: { auditId_productId: { auditId, productId } } });
const auditStatus = async (auditId: string) =>
  (await prisma.inventoryAudit.findUniqueOrThrow({ where: { id: auditId } })).status;
const finals = async (auditId: string) =>
  (await prisma.inventoryAuditItem.findMany({ where: { auditId }, orderBy: { productId: 'asc' } })).map((row: any) => [
    row.productId,
    row.finalQuantity,
    row.discrepancy,
    row.discrepancyValue === null ? null : Number(row.discrepancyValue),
  ]);

function ok(result: Awaited<ReturnType<typeof saveAuditCounts>>) {
  if (!result.success) throw new Error(result.error);
  return result;
}

/** Counts the listed frames in round 1, then finalises them from that count. */
async function countAndFinalize(auditId: string, counts: Record<string, number>) {
  const saves = Object.entries(counts).map(([productId, count]) => ({ productId, count, base: null }));
  assert.equal(ok(await saveAuditCounts(auditId, 1, saves)).saved.length, saves.length);
  const finalized = await finalizeAllFromLastCount(auditId);
  assert.equal(finalized.success, true, finalized.message);
}

// The auth stub always signs in as 'test-user'. A call run through asUser has that id replaced with
// another user's in every query it sends, which is exactly what the same call by that user would send.
const actingAs = new AsyncLocalStorage<string>();
function replaceUser(value: any, userId: string): any {
  if (value === 'test-user') return userId;
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    for (const key of Object.keys(value)) value[key] = replaceUser(value[key], userId);
  }
  return value;
}
function asUser<T>(userId: string, call: () => Promise<T>) {
  beforeQuery.fn = async (params) => {
    const acting = actingAs.getStore();
    if (acting) replaceUser(params.args, acting);
  };
  return actingAs.run(userId, call);
}

// ---------------------------------------------------------------- issueAdjustmentDocuments

test('issue: a call made while another is writing, one at the same moment and a later one change stock once', async () => {
  await seed(10);
  const a = await startAudit();
  await countAndFinalize(a, Object.fromEntries(ids(10).map((id) => [id, 3])));

  beforeQuery.fn = async (params) => {
    if (params.model === 'Inventory' && params.action === 'upsert') await sleep(40);
  };
  const first = issueAdjustmentDocuments(a);
  await sleep(120); // the first transaction is still writing its 10 upserts
  const second = issueAdjustmentDocuments(a);
  const third = issueAdjustmentDocuments(a);
  const overlapping = await Promise.all([first, second, third]);
  beforeQuery.fn = null;
  const later = await issueAdjustmentDocuments(a);

  assert.deepEqual(overlapping.map((r) => r.success), [true, false, false], JSON.stringify(overlapping));
  assert.deepEqual(overlapping[0].data, { adjustedCount: 10, unitsUp: 10, unitsDown: 0 });
  for (const refused of [overlapping[1], overlapping[2], later]) {
    assert.equal(refused.success, false);
    assert.equal(refused.message, 'اسناد اصلاحی این انبارگردانی قبلاً صادر شده یا انبارگردانی در حال انجام نیست.');
  }
  assert.deepEqual(await stock(), Object.fromEntries(ids(10).map((id) => [id, 3])));
  const moves = await prisma.inventoryMovement.findMany({ where: { type: 'ADJUSTMENT' } });
  assert.equal(moves.length, 10);
  const auditNumber = (await prisma.inventoryAudit.findUniqueOrThrow({ where: { id: a } })).auditNumber;
  for (const move of moves) {
    assert.equal(move.referenceId, a);
    assert.equal(move.note, `انبارگردانی ${auditNumber}`);
    assert.equal(move.toWarehouseId, WH);
    assert.equal(move.quantity, 1);
  }
  assert.equal(await auditStatus(a), 'COMPLETED');
  assert.equal(await prisma.inventoryAuditItem.count({ where: { auditId: a, isAdjusted: true } }), 10);
});

test('issue: refused while an item is counted but not final, or has system stock and neither a count nor a final', async () => {
  await seed(4);
  // Not stocked in the warehouse, so its system quantity is 0: never counting it blocks nothing.
  await prisma.product.create({ data: { id: 'none', name: 'No stock', sku: 'NONE', costPrice: 1, sellPrice: 1 } });
  const a = await startAudit();
  ok(await saveAuditCounts(a, 1, [
    { productId: 'p0', count: 1, base: null },
    { productId: 'p1', count: 2, base: null },
  ]));
  assert.equal((await setFinalQuantity(a, 'p1', 2)).success, true);
  const before = await stock();

  const both = await issueAdjustmentDocuments(a);
  assert.equal(both.success, false);
  assert.match(both.message ?? '', /1 آیتم شمارش شده ولی مقدار نهایی ندارد: «Frame 00»/);
  assert.match(both.message ?? '', /2 آیتم با موجودی سیستمی شمارش نشده است: «Frame 02»، «Frame 03»/);
  assert.equal(await auditStatus(a), 'IN_PROGRESS');
  assert.deepEqual(await stock(), before);
  assert.equal(await prisma.inventoryMovement.count(), 0);

  assert.equal((await finalizeAllFromLastCount(a)).success, true);
  const uncounted = await issueAdjustmentDocuments(a);
  assert.equal(uncounted.success, false);
  assert.doesNotMatch(uncounted.message ?? '', /مقدار نهایی ندارد/);
  assert.match(uncounted.message ?? '', /2 آیتم با موجودی سیستمی شمارش نشده است/);
  assert.equal(await auditStatus(a), 'IN_PROGRESS');
  assert.deepEqual(await stock(), before);
  assert.equal(await prisma.inventoryMovement.count(), 0);

  assert.equal((await setZeroForUncounted(a, ['p2', 'p3'])).success, true);
  const issued = await issueAdjustmentDocuments(a);
  assert.equal(issued.success, true, issued.message);
  assert.deepEqual(issued.data, { adjustedCount: 3, unitsUp: 0, unitsDown: 5 });
  assert.deepEqual(await stock(), { p0: 1, p1: 2, p2: 0, p3: 0 });
});

test('accept system: one frame is corrected while every other keeps its stock', async () => {
  await seed(4);
  const a = await startAudit();
  // Only p1 is counted: the owner wants that one number changed, not a whole count.
  ok(await saveAuditCounts(a, 1, [{ productId: 'p1', count: 5, base: null }]));
  assert.equal((await finalizeAllFromLastCount(a)).success, true);

  const kept = await acceptSystemForUncounted(a, ['p0', 'p1', 'p2', 'p3']);
  assert.equal(kept.success, true, kept.message);
  assert.equal(kept.data!.updatedCount, 3, 'the counted frame keeps the counted number');
  assert.match(kept.message ?? '', /موجودی سیستم برای 3 آیتم/);
  assert.deepEqual(await finals(a), [
    ['p0', 2, 0, 0],
    ['p1', 5, 3, 3 * 1500],
    ['p2', 2, 0, 0],
    ['p3', 2, 0, 0],
  ]);

  const issued = await issueAdjustmentDocuments(a);
  assert.equal(issued.success, true, issued.message);
  assert.deepEqual(issued.data, { adjustedCount: 1, unitsUp: 3, unitsDown: 0 });
  assert.deepEqual(await stock(), { p0: 2, p1: 5, p2: 2, p3: 2 });
  assert.equal(await prisma.inventoryMovement.count(), 1);
});

test('accept system: leaves a counted or already final item alone, and refuses once the audit is over', async () => {
  await seed(3);
  const a = await startAudit();
  ok(await saveAuditCounts(a, 1, [{ productId: 'p0', count: 9, base: null }]));
  assert.equal((await setFinalQuantity(a, 'p1', 7)).success, true);

  const kept = await acceptSystemForUncounted(a, ['p0', 'p1', 'p2']);
  assert.equal(kept.data!.updatedCount, 1);
  const p0 = await auditItem(a, 'p0');
  assert.equal(p0.finalQuantity, null, 'a counted item still needs its final quantity');
  assert.equal((await auditItem(a, 'p1')).finalQuantity, 7, 'an item with a final quantity is not overwritten');
  assert.equal((await auditItem(a, 'p2')).finalQuantity, 2);

  assert.equal((await finalizeAllFromLastCount(a)).success, true);
  assert.equal((await issueAdjustmentDocuments(a)).success, true);
  const afterIssue = await acceptSystemForUncounted(a, ['p0', 'p1', 'p2']);
  assert.equal(afterIssue.success, false);
  assert.equal(afterIssue.message, 'انبارگردانی در حال انجام نیست.');
});

test('accept system: refused for a role that may not change stock', async () => {
  await seed(2);
  const a = await startAudit();
  for (const role of ['AUDITOR', 'SALES', 'ACCOUNTANT', null]) {
    setTestRole(role);
    const refused = await acceptSystemForUncounted(a, ['p0', 'p1']);
    assert.equal(refused.success, false, String(role));
  }
  setTestRole('ADMIN');
  assert.deepEqual(
    (await finals(a)).map((row: any[]) => row[1]),
    [null, null],
  );
});

test('issue: a failure part-way rolls everything back, and a retry applies each item once', async () => {
  await seed(8);
  const a = await startAudit();
  await countAndFinalize(a, Object.fromEntries(ids(8).map((id, i) => [id, i % 2 === 0 ? 5 : 0])));

  let upserts = 0;
  beforeQuery.fn = async (params) => {
    if (params.model === 'Inventory' && params.action === 'upsert' && ++upserts === 5) throw new Error('connection lost');
  };
  const failed = await issueAdjustmentDocuments(a);
  beforeQuery.fn = null;

  assert.equal(failed.success, false);
  assert.match(failed.message ?? '', /خطا در صدور اسناد اصلاحی/);
  assert.equal(upserts, 5);
  assert.equal(await auditStatus(a), 'IN_PROGRESS');
  assert.deepEqual(await stock(), Object.fromEntries(ids(8).map((id) => [id, 2])));
  assert.equal(await prisma.inventoryMovement.count(), 0);
  assert.equal(await prisma.inventoryAuditItem.count({ where: { isAdjusted: true } }), 0);

  const retry = await issueAdjustmentDocuments(a);
  assert.equal(retry.success, true, retry.message);
  assert.deepEqual(retry.data, { adjustedCount: 8, unitsUp: 12, unitsDown: 8 });
  assert.deepEqual(await stock(), Object.fromEntries(ids(8).map((id, i) => [id, i % 2 === 0 ? 5 : 0])));
  const moves = await prisma.inventoryMovement.groupBy({ by: ['productId'], _count: true });
  assert.equal(moves.length, 8);
  assert.ok(moves.every((m: any) => m._count === 1), JSON.stringify(moves));
});

test('issue: refused for USER, SALES and WAREHOUSE, even for the creator; allowed for ADMIN', async () => {
  await seed(2);
  const a = await startAudit(); // created by test-user
  await countAndFinalize(a, { p0: 1, p1: 3 });

  for (const role of ['USER', 'SALES', 'WAREHOUSE']) {
    setTestRole(role);
    const refused = await issueAdjustmentDocuments(a);
    assert.equal(refused.success, false, role);
    assert.match(refused.message ?? '', /فقط مدیر سیستم/, role);
  }
  assert.equal(await auditStatus(a), 'IN_PROGRESS');
  assert.deepEqual(await stock(), { p0: 2, p1: 2 });

  setTestRole('ADMIN');
  const issued = await issueAdjustmentDocuments(a);
  assert.equal(issued.success, true, issued.message);
  assert.deepEqual(issued.data, { adjustedCount: 2, unitsUp: 1, unitsDown: 1 });
  assert.deepEqual(await stock(), { p0: 1, p1: 3 });
});

/** Polls, for up to 5 s, until `n` queries on this database wait on a lock; returns how many do. */
async function lockWaiters(n: number) {
  const waiting = async () =>
    ((await prisma.$queryRaw`SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'`) as Array<{ n: number }>)[0].n;
  for (let i = 0; i < 250 && (await waiting()) < n; i++) await sleep(20);
  return waiting();
}

test('issue: counts and finals sent while issuing wait for it, then are refused without writing', async () => {
  await seed(3);
  // Not stocked, so leaving it uncounted blocks nothing; a count slipped in after the issue read its items would.
  await prisma.product.create({ data: { id: 'z', name: 'Zero', sku: 'Z', costPrice: 1, sellPrice: 1 } });
  const a = await startAudit();
  await countAndFinalize(a, { p0: 3, p1: 3, p2: 3 });

  let writers: Array<Promise<any>> = [];
  let waiting = 0;
  let issueReturned = false;
  const settledEarly: number[] = [];
  beforeQuery.fn = async (params) => {
    if (params.model !== 'Inventory' || params.action !== 'upsert') return;
    beforeQuery.fn = null;
    // Inside the issue transaction, after its claim and its read of the items.
    writers = [
      setFinalQuantity(a, 'p2', 7),
      saveAuditCounts(a, 1, [{ productId: 'z', count: 4, base: null }]),
      finalizeAllFromLastCount(a),
      setZeroForUncounted(a, ['z']),
      recordCount(a, 'z', 4, 1),
    ].map((writer: Promise<any>, i) => writer.finally(() => issueReturned || settledEarly.push(i)));
    waiting = await lockWaiters(5);
  };
  const issued = await issueAdjustmentDocuments(a);
  issueReturned = true;
  beforeQuery.fn = null;
  assert.equal(issued.success, true, issued.message);

  const [final, count, finalizeAll, zero, recorded] = await Promise.all(writers);
  assert.equal(waiting, 5, 'every writer waited on the claimed audit row');
  assert.deepEqual(settledEarly, [], 'no writer finished before the issue committed');
  for (const refused of [final, finalizeAll, zero, recorded]) {
    assert.equal(refused.success, false, JSON.stringify(refused));
    assert.match(refused.message ?? '', /در حال انجام نیست/);
  }
  assert.deepEqual(count, {
    success: true,
    saved: [],
    conflicts: [],
    refused: [{ productId: 'z', reason: 'انبارگردانی در حال انجام نیست.' }],
  });
  assert.equal(await auditStatus(a), 'COMPLETED');
  assert.deepEqual(await stock(), { p0: 3, p1: 3, p2: 3 });
  const [p2, z] = [await auditItem(a, 'p2'), await auditItem(a, 'z')];
  assert.deepEqual([p2.finalQuantity, p2.isAdjusted], [3, true]);
  assert.deepEqual([z.countedQuantity1, z.finalQuantity, z.isAdjusted], [null, null, false]);
});

/** Starts `write` and stops it inside its transaction, holding the audit row FOR SHARE, right before its `action` on an audit item. */
async function holdWriter<T>(action: string, write: () => Promise<T>) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let held!: () => void;
  const isHeld = new Promise<void>((resolve) => (held = resolve));
  beforeQuery.fn = async (params) => {
    if (params.model !== 'InventoryAuditItem' || params.action !== action) return;
    beforeQuery.fn = null;
    held();
    await gate;
  };
  const result = write();
  await isHeld;
  return { result, release };
}

test('issue: started while a writer holds the audit, it waits for the writer and sees what it wrote', async () => {
  await seed(2);
  // Not stocked, so leaving it uncounted blocks nothing; a count of it the issue sees makes it refuse.
  await prisma.product.create({ data: { id: 'z', name: 'Zero', sku: 'Z', costPrice: 1, sellPrice: 1 } });
  const a = await startAudit();
  await countAndFinalize(a, { p0: 3, p1: 3 });

  const counts: Array<[string, () => Promise<{ success?: boolean }>, 1 | 2]> = [
    ['updateMany', () => saveAuditCounts(a, 1, [{ productId: 'z', count: 4, base: null }]), 1],
    ['update', () => recordCount(a, 'z', 4, 2), 2],
  ];
  for (const [action, write, round] of counts) {
    const writer = await holdWriter(action, write);
    const issue = issueAdjustmentDocuments(a);
    const waiting = await lockWaiters(1);
    writer.release();
    const [written, issued] = await Promise.all([writer.result, issue]);
    assert.equal(waiting, 1, `the issue waited for the ${action}`);
    assert.equal(written.success, true, JSON.stringify(written));
    assert.equal(issued.success, false);
    assert.match(issued.message ?? '', /1 آیتم شمارش شده ولی مقدار نهایی ندارد: «Zero»/);
    assert.equal(await auditStatus(a), 'IN_PROGRESS');
    assert.deepEqual(await stock(), { p0: 2, p1: 2 });
    // Back to not counted, so the next writer's count is the only one.
    assert.deepEqual(ok(await saveAuditCounts(a, round, [{ productId: 'z', count: null, base: 4 }])).saved, [
      { productId: 'z', count: null },
    ]);
  }

  // A final: the issue waits for it and adjusts stock to it.
  const final = await holdWriter('update', () => setFinalQuantity(a, 'p1', 7));
  const issue = issueAdjustmentDocuments(a);
  const waiting = await lockWaiters(1);
  final.release();
  const [finalSet, issued] = await Promise.all([final.result, issue]);
  assert.equal(waiting, 1, 'the issue waited for the final');
  assert.equal(finalSet.success, true, finalSet.message);
  assert.equal(issued.success, true, issued.message);
  assert.deepEqual(issued.data, { adjustedCount: 2, unitsUp: 6, unitsDown: 0 });
  assert.deepEqual(await stock(), { p0: 3, p1: 7 });
});

test('team changes need the creator or ADMIN; calculating and reading discrepancies need a session', async () => {
  await seed(1);
  const a = await startAudit();
  await prisma.inventoryAudit.update({ where: { id: a }, data: { createdBy: 'u2' } });
  await prisma.inventoryAuditTeam.create({ data: { auditId: a, userId: 'u2', role: 'COUNTER' } });

  setTestRole('WAREHOUSE');
  assert.equal((await addAuditTeamMember(a, 'test-user', 'SUPERVISOR')).success, false);
  assert.equal((await removeAuditTeamMember(a, 'u2')).success, false);
  assert.deepEqual((await prisma.inventoryAuditTeam.findMany()).map((m: any) => m.userId), ['u2']);

  await prisma.inventoryAudit.update({ where: { id: a }, data: { createdBy: 'test-user' } });
  assert.equal((await addAuditTeamMember(a, 'test-user', 'SUPERVISOR')).success, true);
  setTestRole('ADMIN');
  await prisma.inventoryAudit.update({ where: { id: a }, data: { createdBy: 'u2' } });
  assert.equal((await removeAuditTeamMember(a, 'u2')).success, true);
  assert.deepEqual((await prisma.inventoryAuditTeam.findMany()).map((m: any) => m.userId), ['test-user']);

  setTestRole(null);
  assert.equal((await calculateDiscrepancies(a)).success, false);
  assert.equal(await getDiscrepancyReport(a), undefined);
  setTestRole('ADMIN');
  assert.equal((await calculateDiscrepancies(a)).success, true);
  assert.notEqual(await getDiscrepancyReport(a), undefined);
});

// ---------------------------------------------------------------- saveAuditCounts

test('saveAuditCounts: the same batch sent twice leaves the same values', async () => {
  await seed(3);
  const a = await startAudit();
  const batch = [
    { productId: 'p0', count: 3, base: null },
    { productId: 'p1', count: 0, base: null },
  ];
  const first = await saveAuditCounts(a, 1, batch);
  const again = await saveAuditCounts(a, 1, batch);

  assert.deepEqual(first, {
    success: true,
    saved: [
      { productId: 'p0', count: 3 },
      { productId: 'p1', count: 0 },
    ],
    conflicts: [],
    refused: [],
  });
  // Sent again from the old base, it meets the numbers it wrote itself. The queue takes such a conflict as saved only
  // for a total it sent in an earlier call with no answer: the same number may have come from another counter.
  assert.deepEqual(again, {
    success: true,
    saved: [],
    conflicts: [
      { productId: 'p0', theirCount: 3, theirName: 'Owner' },
      { productId: 'p1', theirCount: 0, theirName: 'Owner' },
    ],
    refused: [],
  });
  const rows = await prisma.inventoryAuditItem.findMany({ where: { auditId: a }, orderBy: { productId: 'asc' } });
  assert.deepEqual(
    rows.map((r: any) => [r.productId, r.countedQuantity1, r.countedBy1, r.countedQuantity2, r.finalQuantity]),
    [
      ['p0', 3, 'test-user', null, null],
      ['p1', 0, 'test-user', null, null],
      ['p2', null, null, null, null],
    ],
  );
});

test('saveAuditCounts: refuses non-items, fractions, negatives, counts over 100000, closed audits and users without permission', async () => {
  await seed(2);
  const a = await startAudit();
  await prisma.product.create({ data: { id: 'late', name: 'Late', sku: 'LATE', costPrice: 1, sellPrice: 1 } });
  const items = await prisma.inventoryAuditItem.count();

  const mixed = ok(
    await saveAuditCounts(a, 1, [
      { productId: 'late', count: 1, base: null },
      { productId: 'missing', count: 1, base: null },
      { productId: 'p0', count: 1.5, base: null },
      { productId: 'p0', count: -1, base: null },
      { productId: 'p0', count: 100001, base: null },
      { productId: 'p1', count: 100000, base: null },
    ]),
  );
  assert.deepEqual(mixed.saved, [{ productId: 'p1', count: 100000 }]);
  assert.deepEqual(mixed.conflicts, []);
  assert.deepEqual(mixed.refused.map((r) => r.productId), ['late', 'missing', 'p0', 'p0', 'p0']);
  for (const r of mixed.refused.slice(0, 2)) assert.match(r.reason, /جزو اقلام این انبارگردانی نیست/);
  for (const r of mixed.refused.slice(2)) assert.match(r.reason, /عدد صحیح/);
  assert.equal((await auditItem(a, 'p0')).countedQuantity1, null);

  const badRound = await saveAuditCounts(a, 4 as 1, [{ productId: 'p0', count: 1, base: null }]);
  assert.equal(badRound.success, false);

  await prisma.inventoryAudit.update({ where: { id: a }, data: { status: 'COMPLETED' } });
  const closed = ok(await saveAuditCounts(a, 1, [{ productId: 'p0', count: 1, base: null }]));
  assert.deepEqual(closed.saved, []);
  assert.deepEqual(closed.refused.map((r) => r.productId), ['p0']);
  assert.match(closed.refused[0].reason, /در حال انجام نیست/);
  assert.equal((await auditItem(a, 'p0')).countedQuantity1, null);

  // Neither ADMIN nor the creator: only a team member who may count.
  await prisma.inventoryAudit.update({ where: { id: a }, data: { status: 'IN_PROGRESS', createdBy: 'u2' } });
  setTestRole('WAREHOUSE');
  const outsider = await saveAuditCounts(a, 1, [{ productId: 'p0', count: 1, base: null }]);
  assert.equal(outsider.success, false);
  assert.match((outsider as { error: string }).error, /مجوز شمارش ندارید/);
  await prisma.inventoryAuditTeam.create({
    data: { auditId: a, userId: 'test-user', role: 'AUDITOR', canCount: false, canApprove: true },
  });
  assert.equal((await saveAuditCounts(a, 1, [{ productId: 'p0', count: 1, base: null }])).success, false);
  assert.equal((await auditItem(a, 'p0')).countedQuantity1, null);
  await prisma.inventoryAuditTeam.update({
    where: { auditId_userId: { auditId: a, userId: 'test-user' } },
    data: { canCount: true },
  });
  assert.deepEqual(ok(await saveAuditCounts(a, 1, [{ productId: 'p0', count: 1, base: null }])).saved, [
    { productId: 'p0', count: 1 },
  ]);

  assert.equal(await prisma.inventoryAuditItem.count(), items, 'no item was created');
});

test('saveAuditCounts: a stale base after another user saved is a conflict with their total and name, and keeps it', async () => {
  await seed(2);
  const a = await startAudit();

  const theirs = ok(await asUser('u2', () => saveAuditCounts(a, 1, [{ productId: 'p0', count: 5, base: null }])));
  assert.deepEqual(theirs.saved, [{ productId: 'p0', count: 5 }]);
  const stale = ok(await saveAuditCounts(a, 1, [{ productId: 'p0', count: 2, base: null }]));
  assert.deepEqual(stale, {
    success: true,
    saved: [],
    conflicts: [{ productId: 'p0', theirCount: 5, theirName: 'Second' }],
    refused: [],
  });
  let row = await auditItem(a, 'p0');
  assert.deepEqual([row.countedQuantity1, row.countedBy1], [5, 'u2']);

  // The agreed total, sent from the value now stored, goes through.
  assert.deepEqual(ok(await saveAuditCounts(a, 1, [{ productId: 'p0', count: 7, base: 5 }])).saved, [
    { productId: 'p0', count: 7 },
  ]);
  const staleNumber = ok(await asUser('u2', () => saveAuditCounts(a, 1, [{ productId: 'p0', count: 6, base: 5 }])));
  assert.deepEqual(staleNumber.conflicts, [{ productId: 'p0', theirCount: 7, theirName: 'Owner' }]);
  row = await auditItem(a, 'p0');
  assert.deepEqual([row.countedQuantity1, row.countedBy1], [7, 'test-user']);
});

test('saveAuditCounts: two users saving from the same base at the same moment, exactly one saves', async () => {
  await seed(1);
  const a = await startAudit();

  // Hold the item's row so both saves wait on it, then let them go together.
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let locked!: () => void;
  const isLocked = new Promise<void>((resolve) => (locked = resolve));
  const holder = prisma.$transaction(
    async (tx: any) => {
      await tx.$queryRaw`SELECT 1 FROM "InventoryAuditItem" WHERE "auditId" = ${a} AND "productId" = 'p0' FOR UPDATE`;
      locked();
      await gate;
    },
    { timeout: 20_000 },
  );
  await isLocked;
  const both = Promise.all([
    saveAuditCounts(a, 1, [{ productId: 'p0', count: 4, base: null }]),
    asUser('u2', () => saveAuditCounts(a, 1, [{ productId: 'p0', count: 6, base: null }])),
  ]);
  const waiting = async () =>
    ((await prisma.$queryRaw`SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'`) as Array<{ n: number }>)[0].n;
  for (let i = 0; i < 250 && (await waiting()) < 2; i++) await sleep(20);
  assert.equal(await waiting(), 2, 'both saves are waiting on the row');
  release();
  await holder;
  const [mine, theirs] = (await both).map(ok);

  assert.equal(mine.saved.length + theirs.saved.length, 1, JSON.stringify([mine, theirs]));
  const winner = mine.saved.length === 1 ? { count: 4, by: 'test-user', name: 'Owner' } : { count: 6, by: 'u2', name: 'Second' };
  assert.deepEqual([...mine.conflicts, ...theirs.conflicts], [
    { productId: 'p0', theirCount: winner.count, theirName: winner.name },
  ]);
  const row = await auditItem(a, 'p0');
  assert.deepEqual([row.countedQuantity1, row.countedBy1], [winner.count, winner.by]);
});

test('saveAuditCounts: the same user saving from a stale base, in a second tab or device, gets a conflict and the newer count stays', async () => {
  await seed(1);
  const a = await startAudit();
  ok(await saveAuditCounts(a, 1, [{ productId: 'p0', count: 3, base: null }])); // tab A
  const tabB = ok(await saveAuditCounts(a, 1, [{ productId: 'p0', count: 2, base: null }])); // loaded before tab A saved
  assert.deepEqual(tabB, {
    success: true,
    saved: [],
    conflicts: [{ productId: 'p0', theirCount: 3, theirName: 'Owner' }],
    refused: [],
  });
  assert.equal((await auditItem(a, 'p0')).countedQuantity1, 3);

  // Tab A counts on to 5; tab B, still on 3, sends 4 from that base.
  ok(await saveAuditCounts(a, 1, [{ productId: 'p0', count: 5, base: 3 }]));
  const staleNumber = ok(await saveAuditCounts(a, 1, [{ productId: 'p0', count: 4, base: 3 }]));
  assert.deepEqual(staleNumber, {
    success: true,
    saved: [],
    conflicts: [{ productId: 'p0', theirCount: 5, theirName: 'Owner' }],
    refused: [],
  });
  const row = await auditItem(a, 'p0');
  assert.deepEqual([row.countedQuantity1, row.countedBy1], [5, 'test-user']);
});

test('saveAuditCounts: a count whose counter was deleted is still overwritten only from its base', async () => {
  await seed(1);
  const a = await startAudit();
  ok(await asUser('u2', () => saveAuditCounts(a, 1, [{ productId: 'p0', count: 5, base: null }])));
  await prisma.user.delete({ where: { id: 'u2' } }); // sets countedBy1 to null, the count stays
  let row = await auditItem(a, 'p0');
  assert.deepEqual([row.countedQuantity1, row.countedBy1], [5, null]);

  const stale = ok(await saveAuditCounts(a, 1, [{ productId: 'p0', count: 2, base: null }]));
  assert.deepEqual(stale.conflicts, [{ productId: 'p0', theirCount: 5, theirName: null }]);
  assert.equal((await auditItem(a, 'p0')).countedQuantity1, 5);

  assert.deepEqual(ok(await saveAuditCounts(a, 1, [{ productId: 'p0', count: 2, base: 5 }])).saved, [
    { productId: 'p0', count: 2 },
  ]);
  row = await auditItem(a, 'p0');
  assert.deepEqual([row.countedQuantity1, row.countedBy1], [2, 'test-user']);
});

test('saveAuditCounts: null takes a count back to not counted, from its base only, and issuing then refuses the item', async () => {
  await seed(2);
  const a = await startAudit();
  ok(await saveAuditCounts(a, 1, [
    { productId: 'p0', count: 2, base: null },
    { productId: 'p1', count: 1, base: null }, // a mistaken scan
  ]));

  const stale = ok(await saveAuditCounts(a, 1, [{ productId: 'p1', count: null, base: 3 }]));
  assert.deepEqual(stale.conflicts, [{ productId: 'p1', theirCount: 1, theirName: 'Owner' }]);
  const fromUncounted = ok(await saveAuditCounts(a, 1, [{ productId: 'p1', count: null, base: null }]));
  assert.deepEqual(fromUncounted.conflicts, [{ productId: 'p1', theirCount: 1, theirName: 'Owner' }]);
  assert.equal((await auditItem(a, 'p1')).countedQuantity1, 1);
  const undone = ok(await saveAuditCounts(a, 1, [{ productId: 'p1', count: null, base: 1 }])); // «برگشت»
  assert.deepEqual(undone.saved, [{ productId: 'p1', count: null }]);
  const row = await auditItem(a, 'p1');
  assert.deepEqual([row.countedQuantity1, row.countedBy1, row.countedAt1], [null, null, null]);

  assert.equal((await finalizeAllFromLastCount(a)).success, true);
  const before = await stock();
  const refused = await issueAdjustmentDocuments(a);
  assert.equal(refused.success, false);
  assert.match(refused.message ?? '', /1 آیتم با موجودی سیستمی شمارش نشده است: «Frame 01»/);
  assert.deepEqual(await stock(), before);
  assert.equal(await auditStatus(a), 'IN_PROGRESS');

  // Counted again, it starts from not counted.
  assert.deepEqual(ok(await saveAuditCounts(a, 1, [{ productId: 'p1', count: 2, base: null }])).saved, [
    { productId: 'p1', count: 2 },
  ]);
});

// ---------------------------------------------------------------- finalising

test('finalizeAllFromLastCount: the latest counted round wins, finals stay, values use the cost price, only while IN_PROGRESS', async () => {
  await seed(5);
  const a = await startAudit();
  ok(await saveAuditCounts(a, 1, [
    { productId: 'p0', count: 0, base: null },
    { productId: 'p1', count: 5, base: null },
    { productId: 'p2', count: 1, base: null },
    { productId: 'p3', count: 9, base: null },
  ]));
  ok(await saveAuditCounts(a, 2, [{ productId: 'p1', count: 4, base: null }]));
  ok(await saveAuditCounts(a, 3, [{ productId: 'p2', count: 3, base: null }]));
  assert.equal((await setFinalQuantity(a, 'p3', 7)).success, true);

  await prisma.inventoryAudit.update({ where: { id: a }, data: { status: 'COMPLETED' } });
  const closed = await finalizeAllFromLastCount(a);
  assert.equal(closed.success, false);
  assert.match(closed.message ?? '', /در حال انجام نیست/);
  assert.equal((await auditItem(a, 'p0')).finalQuantity, null);

  await prisma.inventoryAudit.update({ where: { id: a }, data: { status: 'IN_PROGRESS' } });
  const done = await finalizeAllFromLastCount(a);
  assert.equal(done.success, true, done.message);
  assert.deepEqual(done.data, { finalizedCount: 3 });
  assert.deepEqual(await finals(a), [
    ['p0', 0, -2, -2000], // cost 1000
    ['p1', 4, 2, 3000], // round 2 over round 1, cost 1500
    ['p2', 3, 1, 2000], // round 3 over round 1, cost 2000
    ['p3', 7, 5, 12500], // already final (round 1 said 9), cost 2500
    ['p4', null, null, null], // never counted
  ]);
  assert.deepEqual((await finalizeAllFromLastCount(a)).data, { finalizedCount: 0 });
});

test('setZeroForUncounted: only the listed items with no count and no final become 0', async () => {
  await seed(4);
  const a = await startAudit();
  ok(await saveAuditCounts(a, 1, [{ productId: 'p1', count: 3, base: null }]));
  assert.equal((await setFinalQuantity(a, 'p2', 1)).success, true);

  const result = await setZeroForUncounted(a, ['p0', 'p1', 'p2', 'missing']);
  assert.equal(result.success, true, result.message);
  assert.deepEqual(result.data, { updatedCount: 1 });
  assert.deepEqual(await finals(a), [
    ['p0', 0, -2, -2000], // listed, never counted
    ['p1', null, null, null], // listed, but counted
    ['p2', 1, -1, -2000], // listed, but already final
    ['p3', null, null, null], // not listed
  ]);
  assert.equal((await auditItem(a, 'p1')).countedQuantity1, 3);
  assert.deepEqual((await setZeroForUncounted(a, [])).data, { updatedCount: 0 });

  await prisma.inventoryAudit.update({ where: { id: a }, data: { status: 'COMPLETED' } });
  assert.equal((await setZeroForUncounted(a, ['p3'])).success, false);
  assert.equal((await auditItem(a, 'p3')).finalQuantity, null);
});

test('finalizeAllFromLastCount and setZeroForUncounted: ADMIN, the creator, or a team member who may approve', async () => {
  await seed(2);
  const a = await startAudit();
  ok(await saveAuditCounts(a, 1, [{ productId: 'p0', count: 1, base: null }]));
  await prisma.inventoryAudit.update({ where: { id: a }, data: { createdBy: 'u2' } });

  setTestRole('WAREHOUSE');
  assert.match((await finalizeAllFromLastCount(a)).message ?? '', /مجوز تأیید ندارید/);
  assert.match((await setZeroForUncounted(a, ['p1'])).message ?? '', /مجوز تأیید ندارید/);
  await prisma.inventoryAuditTeam.create({
    data: { auditId: a, userId: 'test-user', role: 'COUNTER', canCount: true, canApprove: false },
  });
  assert.equal((await finalizeAllFromLastCount(a)).success, false);
  assert.deepEqual(await finals(a), [
    ['p0', null, null, null],
    ['p1', null, null, null],
  ]);

  await prisma.inventoryAuditTeam.update({
    where: { auditId_userId: { auditId: a, userId: 'test-user' } },
    data: { canApprove: true },
  });
  assert.deepEqual((await finalizeAllFromLastCount(a)).data, { finalizedCount: 1 });
  assert.deepEqual((await setZeroForUncounted(a, ['p1'])).data, { updatedCount: 1 });

  await prisma.inventoryAuditTeam.deleteMany();
  await prisma.inventoryAudit.update({ where: { id: a }, data: { createdBy: 'test-user' } });
  assert.equal((await finalizeAllFromLastCount(a)).success, true, 'the creator needs no team row');
});

test('setFinalQuantity: allowed for ADMIN outside the team; others need a team row that may approve', async () => {
  await seed(1);
  const a = await startAudit();
  await prisma.inventoryAudit.update({ where: { id: a }, data: { createdBy: 'u2' } });

  // ADMIN, neither the creator nor on the team.
  const admin = await setFinalQuantity(a, 'p0', 3);
  assert.equal(admin.success, true, admin.message);
  assert.deepEqual(await finals(a), [['p0', 3, 1, 1000]]);

  setTestRole('WAREHOUSE');
  assert.match((await setFinalQuantity(a, 'p0', 4)).message ?? '', /مجوز تأیید ندارید/);
  await prisma.inventoryAuditTeam.create({
    data: { auditId: a, userId: 'test-user', role: 'COUNTER', canCount: true, canApprove: false },
  });
  assert.match((await setFinalQuantity(a, 'p0', 4)).message ?? '', /مجوز تأیید ندارید/);
  assert.deepEqual(await finals(a), [['p0', 3, 1, 1000]]);

  await prisma.inventoryAuditTeam.update({
    where: { auditId_userId: { auditId: a, userId: 'test-user' } },
    data: { canApprove: true },
  });
  const approver = await setFinalQuantity(a, 'p0', 4);
  assert.equal(approver.success, true, approver.message);
  assert.deepEqual(await finals(a), [['p0', 4, 2, 2000]]);
});

test('setFinalQuantity and calculateDiscrepancies refuse after COMPLETED', async () => {
  await seed(2);
  const a = await startAudit();
  await countAndFinalize(a, { p0: 1, p1: 2 });
  assert.equal((await issueAdjustmentDocuments(a)).success, true);

  const late = await setFinalQuantity(a, 'p0', 5);
  assert.equal(late.success, false);
  assert.match(late.message ?? '', /در حال انجام نیست/);
  const calc = await calculateDiscrepancies(a);
  assert.equal(calc.success, false);
  assert.match(calc.message ?? '', /در حال انجام نیست/);
  assert.deepEqual(await finals(a), [
    ['p0', 1, -1, -1000],
    ['p1', 2, 0, 0],
  ]);
});

test('recordCount and setFinalQuantity refuse products that are not items, and bad numbers', async () => {
  await seed(1);
  const a = await startAudit();
  await prisma.product.create({ data: { id: 'late', name: 'Late', sku: 'LATE', costPrice: 1, sellPrice: 1 } });
  await prisma.inventory.create({ data: { productId: 'late', warehouseId: WH, quantity: 3 } });
  const items = await prisma.inventoryAuditItem.count();

  for (const [productId, count] of [['late', 3], ['p0', 1.5], ['p0', -1]] as const) {
    assert.equal((await recordCount(a, productId, count, 1)).success, false, `recordCount ${productId} ${count}`);
    assert.equal((await setFinalQuantity(a, productId, count)).success, false, `setFinalQuantity ${productId} ${count}`);
  }
  assert.equal(await prisma.inventoryAuditItem.count(), items, 'no item was created');
  assert.deepEqual(await finals(a), [['p0', null, null, null]]);
  assert.equal((await auditItem(a, 'p0')).countedQuantity1, null);

  assert.equal((await recordCount(a, 'p0', 4, 1)).success, true);
  assert.equal((await auditItem(a, 'p0')).countedQuantity1, 4);
  assert.equal((await setFinalQuantity(a, 'p0', 4)).success, true);
  assert.deepEqual(await finals(a), [['p0', 4, 2, 2000]]);
});

test('getInventoryAudit: counts snapshots without loading them or tags, and gives items their product id, name, sku, webId, barcode and cost price', async () => {
  await seed(2);
  await prisma.product.create({ data: { id: 'none', name: 'No stock', sku: 'NONE', costPrice: 1, sellPrice: 1 } });
  const a = await startAudit();
  const audit = await getInventoryAudit(a);
  assert.equal(audit?._count.snapshots, 2);
  assert.deepEqual([audit && 'snapshots' in audit, audit && 'tags' in audit], [false, false]);
  assert.equal(audit?.items.length, 3);
  const product = audit?.items.find((item: any) => item.productId === 'p1')?.product;
  assert.deepEqual(
    [product?.id, product?.name, product?.sku, product?.webId, product?.barcode, Number(product?.costPrice)],
    ['p1', 'Frame 01', 'PANJ1/BLUE', 'MOAK-PANJ1-BLUE', '6260000000001', 1500],
  );
});
