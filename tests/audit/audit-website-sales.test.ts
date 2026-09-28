import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { prisma, resetDatabase, form } from '../helpers/db';
import { beforeQuery } from '../helpers/hooks';
import { setTestRole } from '../stubs/auth';
import { POST } from '@/app/api/erp/route';
import {
  acceptSystemForUncounted,
  calculateDiscrepancies,
  createInventoryAudit,
  finalizeAllFromLastCount,
  freezeInventory,
  getDiscrepancyReport,
  issueAdjustmentDocuments,
  saveAuditCounts,
  setFinalQuantity,
  setZeroForUncounted,
} from '@/actions/inventory-audit';
import { assertStockInvariants, qty, stockUp } from '../inventory/stock';

// Pooyan's decision: the website keeps selling from a warehouse being counted, and issuing the audit accounts
// for it. A sale before the count is off the shelf and out of the record alike; one after the count is out of
// the record and leaves the shelf after the counter saw it. Either way, no false discrepancy.

console.log = () => {};
console.error = () => {};

const TOKEN = 'audit-website-token';
let main: { id: string };

beforeEach(async () => {
  process.env.ERP_API_SECRET = TOKEN;
  beforeQuery.fn = null;
  setTestRole('ADMIN');
  await resetDatabase();
  await prisma.user.create({ data: { id: 'test-user', name: 'Owner', email: 'owner@x.test', password: 'x', role: 'ADMIN' } });
  await prisma.account.create({ data: { name: 'بانک سامان', type: 'BANK', currency: 'TOMAN', balance: 0 } });
  main = await prisma.warehouse.create({ data: { name: 'مشاهیر' } });
  await prisma.product.createMany({
    data: [
      { id: 'panj', name: 'PANJ', sku: 'PANJ', webId: 'MOAK-PANJ-BLUE', costPrice: 700_000, sellPrice: 2_000_000 },
      { id: 'yek', name: 'YEK', sku: 'YEK', webId: 'MOAK-YEK-BLACK', costPrice: 400_000, sellPrice: 1_500_000 },
    ],
  });
  await stockUp('panj', main.id, 5);
  await stockUp('yek', main.id, 4);
});
after(() => prisma.$disconnect());

let counter = 0;
/** The website sells `quantity` of a frame from the audited warehouse, through the ERP API. */
async function websiteSells(webId: string, quantity: number) {
  counter += 1;
  const res = await POST(
    new NextRequest('http://localhost/api/erp', {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'createSale',
        reference: `M-AUDIT${counter}`,
        issuedAt: '2026-09-27T10:00:00.000Z',
        tag: 'website',
        warehouseId: main.id,
        customer: { name: 'سارا', mobile: '09123456789', email: null, siteId: 'site-user-1', ordersBefore: 0 },
        shipTo: { province: 'تهران', city: 'تهران', address: 'ولیعصر', postal: '1234567890', note: null },
        shipping: { zone: 'tehran', carrier: 'تیپاکس', freight: 0, free: true, trackingCode: null },
        items: [{ webId, erpId: webId, sku: null, productId: 'p', name: webId, quantity, unitPrice: 2_000_000, lineTotal: 2_000_000 * quantity }],
        subtotal: 2_000_000 * quantity,
        discount: 0,
        coupon: null,
        total: 2_000_000 * quantity,
        currency: 'toman',
        payment: { gateway: 'zibal', trackId: `T${counter}`, refNumber: `R${counter}`, paidAt: '2026-09-27T10:00:00.000Z', amount: 2_000_000 * quantity },
      }),
    }),
  );
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
}

async function startAudit() {
  const created = await createInventoryAudit(undefined, form({ warehouseId: main.id }));
  assert.equal((await freezeInventory(created.data!.auditId)).success, true);
  return created.data!.auditId;
}

const count = (auditId: string, productId: string, n: number) =>
  saveAuditCounts(auditId, 1, [{ productId, count: n, base: null }]);
const item = (auditId: string, productId: string) =>
  prisma.inventoryAuditItem.findUniqueOrThrow({ where: { auditId_productId: { auditId, productId } } });

test('a website sale during the count is accepted, and the sale before the count makes no discrepancy', async () => {
  const id = await startAudit();
  await websiteSells('MOAK-PANJ-BLUE', 2);
  assert.equal(await qty('panj', main.id), 3, 'the website sale went through');
  // The counter then finds the 3 that are left.
  await count(id, 'panj', 3);
  await count(id, 'yek', 4);
  assert.equal((await finalizeAllFromLastCount(id)).success, true);
  assert.deepEqual([(await item(id, 'panj')).discrepancy, (await item(id, 'yek')).discrepancy], [0, 0]);
  assert.equal((await getDiscrepancyReport(id))!.totalItems, 0);

  const issued = await issueAdjustmentDocuments(id);
  assert.equal(issued.success, true, issued.message);
  assert.deepEqual(issued.data, { adjustedCount: 0, unitsUp: 0, unitsDown: 0 });
  assert.equal(await qty('panj', main.id), 3);
  await assertStockInvariants();
});

test('a website sale after the count makes no discrepancy either: the counter saw the frame, then it shipped', async () => {
  const id = await startAudit();
  await count(id, 'panj', 5);
  await count(id, 'yek', 4);
  await new Promise((resolve) => setTimeout(resolve, 5));
  await websiteSells('MOAK-PANJ-BLUE', 2);
  assert.equal((await finalizeAllFromLastCount(id)).success, true);
  assert.equal((await item(id, 'panj')).discrepancy, 0);
  assert.equal((await issueAdjustmentDocuments(id)).success, true);
  assert.equal(await qty('panj', main.id), 3);
  await assertStockInvariants();
});

test('a real shortage next to a website sale is corrected by the shortage alone', async () => {
  const id = await startAudit();
  await websiteSells('MOAK-PANJ-BLUE', 2);
  // 3 should be on the shelf; 2 are.
  await count(id, 'panj', 2);
  assert.equal((await setFinalQuantity(id, 'panj', 2)).success, true);
  const panj = await item(id, 'panj');
  assert.deepEqual([panj.discrepancy, Number(panj.discrepancyValue)], [-1, -700_000]);
  await count(id, 'yek', 5);
  await finalizeAllFromLastCount(id);
  assert.equal((await item(id, 'yek')).discrepancy, 1);
  const issued = await issueAdjustmentDocuments(id);
  assert.deepEqual(issued.data, { adjustedCount: 2, unitsUp: 1, unitsDown: 1 });
  assert.deepEqual([await qty('panj', main.id), await qty('yek', main.id)], [2, 5]);
  await assertStockInvariants();
});

test('items nobody counted: kept at the system number stay as the website left them; set to 0 become 0', async () => {
  const id = await startAudit();
  await websiteSells('MOAK-PANJ-BLUE', 2);
  await websiteSells('MOAK-YEK-BLACK', 1);
  assert.equal((await acceptSystemForUncounted(id, ['panj'])).success, true);
  assert.equal((await setZeroForUncounted(id, ['yek'])).success, true);
  assert.deepEqual([(await item(id, 'panj')).discrepancy, (await item(id, 'yek')).discrepancy], [0, -3]);
  // Another sale after the zero was set: issuing still leaves 0 on the shelf and on record.
  await websiteSells('MOAK-PANJ-BLUE', 1);
  assert.equal((await calculateDiscrepancies(id)).success, true);
  assert.equal(await qty('yek', main.id), 3);
  const issued = await issueAdjustmentDocuments(id);
  assert.deepEqual(issued.data, { adjustedCount: 1, unitsUp: 0, unitsDown: 3 });
  assert.deepEqual([await qty('panj', main.id), await qty('yek', main.id)], [2, 0]);
  await assertStockInvariants();
});
