import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase, form } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { AccessDenied } from '@/lib/access';
import {
  addAuditTeamMember,
  calculateDiscrepancies,
  createInventoryAudit,
  finalizeAllFromLastCount,
  freezeInventory,
  generateAuditTags,
  getDiscrepancyReport,
  getInventoryAudit,
  getInventoryAudits,
  getPerformanceReport,
  issueAdjustmentDocuments,
  recordCount,
  removeAuditTeamMember,
  saveAuditCounts,
  setFinalQuantity,
  setZeroForUncounted,
} from '@/actions/inventory-audit';
import { DENIED, exposed } from './stock-helpers';

// The audit actions log every step.
console.log = () => {};
console.error = () => {};

const WH = 'wh-audit';
const MONEY = ['costPrice', 'discrepancyValue', 'totalDiscrepancyValue'];

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
  await prisma.user.createMany({
    data: [
      { id: 'test-user', name: 'Counter', email: 'counter@x.test', password: 'x', role: 'WAREHOUSE' },
      { id: 'u2', name: 'Second', email: 'second@x.test', password: 'x', role: 'WAREHOUSE' },
    ],
  });
  await prisma.warehouse.createMany({ data: [{ id: WH, name: 'مشاهیر' }, { id: 'wh-other', name: 'دیگر' }] });
  await prisma.product.createMany({
    data: [
      { id: 'p0', name: 'Frame 0', sku: 'PANJ0/BLUE', barcode: '6260000000000', costPrice: 1000, sellPrice: 5000 },
      { id: 'p1', name: 'Frame 1', sku: 'PANJ1/BLUE', barcode: '6260000000001', costPrice: 3000, sellPrice: 9000 },
    ],
  });
  await prisma.inventory.createMany({
    data: [
      { productId: 'p0', warehouseId: WH, quantity: 2 },
      { productId: 'p1', warehouseId: WH, quantity: 2 },
    ],
  });
});
after(() => prisma.$disconnect());

/** An audit of WH created and frozen by the signed-in test user, as ADMIN. */
async function startAudit() {
  const created = await createInventoryAudit(undefined, form({ warehouseId: WH }));
  assert.equal(created.success, true, created.message);
  const frozen = await freezeInventory(created.data!.auditId);
  assert.equal(frozen.success, true, frozen.message);
  return created.data!.auditId;
}

/** p0 counted 1 (shortage of 1), p1 counted 3 (excess of 1), both final. */
async function countedAudit() {
  const auditId = await startAudit();
  const saved = await saveAuditCounts(auditId, 1, [
    { productId: 'p0', count: 1, base: null },
    { productId: 'p1', count: 3, base: null },
  ]);
  assert.equal(saved.success, true);
  assert.equal((await finalizeAllFromLastCount(auditId)).success, true);
  return auditId;
}

test('WAREHOUSE and SALES see counts and quantity differences but no money; AUDITOR and ADMIN see the values', async () => {
  const auditId = await countedAudit();

  for (const role of ['WAREHOUSE', 'SALES']) {
    setTestRole(role);
    const audit = (await getInventoryAudit(auditId))!;
    assert.deepEqual(exposed(audit, MONEY), [], role);
    const p1 = audit.items.find((item: any) => item.productId === 'p1');
    assert.deepEqual(
      [p1.systemQuantity, p1.countedQuantity1, p1.finalQuantity, p1.discrepancy, p1.product.sku, p1.product.barcode],
      [2, 3, 3, 1, 'PANJ1/BLUE', '6260000000001'],
      role,
    );
    assert.equal('sellPrice' in p1.product, role === 'SALES', role);

    const report = (await getDiscrepancyReport(auditId))!;
    assert.deepEqual(exposed(report, MONEY), [], role);
    assert.deepEqual([report.shortageCount, report.excessCount, report.totalItems], [1, 1, 2], role);

    const performance = (await getPerformanceReport(auditId))!;
    assert.deepEqual(exposed(performance, MONEY), [], role);
    assert.equal(performance.statistics.itemsWithDiscrepancy, 2, role);

    assert.equal((await getInventoryAudits()).length, 1, role);
  }

  for (const role of ['AUDITOR', 'ADMIN']) {
    setTestRole(role);
    const audit = (await getInventoryAudit(auditId))!;
    const p1 = audit.items.find((item: any) => item.productId === 'p1');
    assert.deepEqual([Number(p1.product.costPrice), p1.discrepancyValue], [3000, 3000], role);
    const report = (await getDiscrepancyReport(auditId))!;
    assert.equal(report.totalDiscrepancyValue, 3000 - 1000, role);
    const performance = (await getPerformanceReport(auditId))!;
    assert.ok(exposed(performance, ['discrepancyValue', 'costPrice']).length > 0, role);
  }

  for (const role of ['PROJECT_MANAGER', null]) {
    setTestRole(role);
    await assert.rejects(getInventoryAudit(auditId), AccessDenied, String(role));
    await assert.rejects(getInventoryAudits(), AccessDenied, String(role));
    assert.equal(await getDiscrepancyReport(auditId), undefined, String(role));
    assert.equal(await getPerformanceReport(auditId), undefined, String(role));
  }
});

test('counting needs stock.manage: AUDITOR, SALES and ACCOUNTANT are refused even as the creator, and nothing is written', async () => {
  const auditId = await startAudit(); // created by test-user
  const other = await createInventoryAudit(undefined, form({ warehouseId: 'wh-other' }));
  const state = async () => ({
    audits: await prisma.inventoryAudit.findMany({ orderBy: { id: 'asc' } }),
    items: await prisma.inventoryAuditItem.findMany({ orderBy: { id: 'asc' } }),
    teams: await prisma.inventoryAuditTeam.count(),
    tags: await prisma.inventoryAuditTag.count(),
    stock: await prisma.inventory.findMany({ orderBy: { productId: 'asc' } }),
  });
  const before = await state();

  for (const role of ['AUDITOR', 'SALES', 'ACCOUNTANT']) {
    setTestRole(role);
    const results = [
      await createInventoryAudit(undefined, form({ warehouseId: 'wh-other' })),
      await freezeInventory(other.data!.auditId),
      await generateAuditTags(auditId),
      await addAuditTeamMember(auditId, 'u2', 'COUNTER'),
      await removeAuditTeamMember(auditId, 'test-user'),
      await recordCount(auditId, 'p0', 1, 1),
      await setFinalQuantity(auditId, 'p0', 1),
      await finalizeAllFromLastCount(auditId),
      await setZeroForUncounted(auditId, ['p0', 'p1']),
      await calculateDiscrepancies(auditId),
    ];
    for (const result of results) assert.equal(result.message, DENIED, role);
    const save = await saveAuditCounts(auditId, 1, [{ productId: 'p0', count: 1, base: null }]);
    assert.deepEqual(save, { success: false, error: DENIED, message: DENIED }, role);
    const issued = await issueAdjustmentDocuments(auditId);
    assert.equal(issued.success, false, role);
    assert.deepEqual(await state(), before, role);
  }

  // WAREHOUSE, the creator, counts with the scanner's save and finalises.
  setTestRole('WAREHOUSE');
  const saved = await saveAuditCounts(auditId, 1, [{ productId: 'p0', count: 1, base: null }]);
  assert.equal(saved.success, true);
  assert.deepEqual((saved as any).saved, [{ productId: 'p0', count: 1 }]);
  assert.equal((await finalizeAllFromLastCount(auditId)).success, true);
  assert.equal((await setZeroForUncounted(auditId, ['p1'])).success, true);
  assert.equal((await addAuditTeamMember(auditId, 'u2', 'COUNTER')).success, true);
  assert.equal((await freezeInventory(other.data!.auditId)).success, true);
  const items = await prisma.inventoryAuditItem.findMany({ where: { auditId }, orderBy: { productId: 'asc' } });
  assert.deepEqual(items.map((item: any) => [item.productId, item.finalQuantity, item.discrepancy]), [['p0', 1, -1], ['p1', 0, -2]]);
});
