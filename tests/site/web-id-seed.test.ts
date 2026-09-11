import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase } from '../helpers/db';
import { beforeQuery } from '../helpers/hooks';
import { setTestRole } from '../stubs/auth';
import { WEB_ID_SEED } from '@/lib/web-id-seed';
import { planWebIdSeed } from '@/lib/web-id-seed-plan';
import { applyWebIdSeed, getWebIdSeedPreview, setProductWebId, getProductsWithoutWebId } from '@/actions/web-id';

const ALL = { total: 91, toSet: 91 };

beforeEach(async () => {
  setTestRole('ADMIN');
  beforeQuery.fn = null;
  await resetDatabase();
});
after(() => prisma.$disconnect());

// The ERP exactly as the file describes it: every row's product, same id and SKU.
async function productsFromFile() {
  await prisma.product.createMany({
    data: WEB_ID_SEED.map((r) => ({ id: r.erpProductId, name: r.erpName, sku: r.erpSku, costPrice: 1, sellPrice: 1 })),
  });
}

const withWebId = () => prisma.product.count({ where: { webId: { not: null } } });

test('the bundled file is the 91 matched frames, all unique and well formed', () => {
  const plan = planWebIdSeed(
    WEB_ID_SEED,
    WEB_ID_SEED.map((r) => ({ id: r.erpProductId, sku: r.erpSku, name: r.erpName, webId: null })),
  );
  assert.equal(plan.counts.total, 91);
  assert.equal(plan.counts.toSet, 91);
  assert.equal(plan.problems, 0);
  assert.equal(plan.canApply, true);
});

test('the plan blocks on every kind of problem', () => {
  const row = (webId: string, id: string, sku: string) => ({ webId, erpProductId: id, erpSku: sku, erpName: id });
  const plan = planWebIdSeed(
    [
      row('MOAK-A', 'a', 'A'),
      row('MOAK-A', 'b', 'B'), // same webId twice in the file
      row('moak-bad', 'c', 'C'), // bad format
      row('MOAK-D', 'd', 'D'), // already held by product e
      row('MOAK-F', 'f', 'F'), // f already has a different webId
      row('MOAK-G', 'g', 'G'), // no such product
      row('MOAK-H', 'h', 'H'), // SKU changed since the file was made
      row('MOAK-I', 'i', 'I'), // fine
    ],
    [
      { id: 'a', sku: 'A', name: 'a', webId: null },
      { id: 'b', sku: 'B', name: 'b', webId: null },
      { id: 'c', sku: 'C', name: 'c', webId: null },
      { id: 'd', sku: 'D', name: 'd', webId: null },
      { id: 'e', sku: 'E', name: 'e', webId: 'MOAK-D' },
      { id: 'f', sku: 'F', name: 'f', webId: 'MOAK-OTHER' },
      { id: 'h', sku: 'H-CHANGED', name: 'h', webId: null },
      { id: 'i', sku: 'I', name: 'i', webId: null },
    ],
  );
  assert.deepEqual(
    plan.rows.map((r) => r.status),
    ['DUPLICATE_IN_FILE', 'DUPLICATE_IN_FILE', 'BAD_FORMAT', 'WEBID_TAKEN', 'HAS_OTHER_WEBID', 'NOT_FOUND', 'SKU_MISMATCH', 'SET'],
  );
  assert.equal(plan.problems, 7);
  assert.equal(plan.canApply, false);
});

test('preview shows 91 rows, 91 to set, 0 missing, 0 duplicates, and writes nothing', async () => {
  await productsFromFile();
  const plan = await getWebIdSeedPreview();
  assert.deepEqual(
    { total: plan.counts.total, toSet: plan.counts.toSet, notFound: plan.counts.notFound, duplicates: plan.counts.duplicates },
    { total: 91, toSet: 91, notFound: 0, duplicates: 0 },
  );
  assert.equal(await withWebId(), 0);
});

test('apply writes exactly the file, by id, and a second apply changes nothing', async () => {
  await productsFromFile();
  const first = await applyWebIdSeed(ALL);
  assert.equal(first.success, true, first.message);
  assert.equal(first.counts?.toSet, 91);
  for (const row of WEB_ID_SEED) {
    const p = await prisma.product.findUniqueOrThrow({ where: { id: row.erpProductId } });
    assert.equal(p.webId, row.webId);
  }

  const second = await applyWebIdSeed({ total: 91, toSet: 0 });
  assert.equal(second.success, true, second.message);
  assert.equal(second.counts?.toSet, 0);
  assert.equal(second.counts?.alreadySet, 91);
});

test('if the numbers changed since the admin looked, nothing is written', async () => {
  await productsFromFile();
  const preview = await getWebIdSeedPreview();
  await setProductWebId(WEB_ID_SEED[0].erpProductId, WEB_ID_SEED[0].webId); // someone fills one in meanwhile
  const result = await applyWebIdSeed({ total: preview.counts.total, toSet: preview.counts.toSet });
  assert.equal(result.success, false);
  assert.match(result.message, /تغییر کرده‌اند/);
  assert.equal(await withWebId(), 1);
});

test('a failure halfway through the writes rolls back every one of them', async () => {
  await productsFromFile();
  let writes = 0;
  beforeQuery.fn = async (params) => {
    if (params.model === 'Product' && params.action === 'updateMany' && ++writes === 50) {
      throw new Error('simulated failure on write 50');
    }
  };
  const result = await applyWebIdSeed(ALL);
  beforeQuery.fn = null;
  assert.equal(writes, 50, 'the failure must happen mid-way, inside the transaction');
  assert.equal(result.success, false);
  assert.equal(await withWebId(), 0);
});

test('one missing product blocks the whole file and nothing is written', async () => {
  await productsFromFile();
  await prisma.product.delete({ where: { id: WEB_ID_SEED[0].erpProductId } });
  const result = await applyWebIdSeed(ALL);
  assert.equal(result.success, false);
  assert.equal(result.counts?.notFound, 1);
  assert.equal(await withWebId(), 0);
});

test('a SKU that drifted since the file was made blocks the file', async () => {
  await productsFromFile();
  await prisma.product.update({ where: { id: WEB_ID_SEED[5].erpProductId }, data: { sku: 'CHANGED/SKU' } });
  const result = await applyWebIdSeed(ALL);
  assert.equal(result.success, false);
  assert.equal(result.counts?.skuMismatch, 1);
  assert.equal(await withWebId(), 0);
});

test('an existing different webId is never overwritten, and blocks the file', async () => {
  await productsFromFile();
  await prisma.product.update({ where: { id: WEB_ID_SEED[2].erpProductId }, data: { webId: 'MOAK-SOMETHING-ELSE' } });
  const result = await applyWebIdSeed(ALL);
  assert.equal(result.success, false);
  assert.equal(result.counts?.conflicts, 1);
  const p = await prisma.product.findUniqueOrThrow({ where: { id: WEB_ID_SEED[2].erpProductId } });
  assert.equal(p.webId, 'MOAK-SOMETHING-ELSE');
  assert.equal(await withWebId(), 1);
});

test('only an admin can apply the file', async () => {
  await productsFromFile();
  setTestRole('USER');
  const result = await applyWebIdSeed(ALL);
  assert.equal(result.success, false);
  assert.equal(await withWebId(), 0);
});

test('a signed-out caller cannot set a webId or read the preview', async () => {
  await prisma.product.create({ data: { id: 'a', name: 'PANJ - Blue', sku: 'PANJ/BLUE', costPrice: 1, sellPrice: 1 } });
  setTestRole(null);
  assert.equal((await setProductWebId('a', 'MOAK-PANJ-BLUE')).success, false);
  await assert.rejects(() => getWebIdSeedPreview());
  assert.equal(await withWebId(), 0);
});

test('the "without webId" list fills one empty slot at a time and never overwrites', async () => {
  await prisma.product.createMany({
    data: [
      { id: 'a', name: 'PANJ - Blue', sku: 'PANJ/BLUE', costPrice: 1, sellPrice: 1 },
      { id: 'b', name: 'YEK - Black', sku: 'YEK/BLK', costPrice: 1, sellPrice: 1, webId: 'MOAK-YEK-BLACK' },
      { id: 'c', name: 'Camera', sku: 'CAM-1', costPrice: 1, sellPrice: 1, productType: 'FIXED_ASSET' },
    ],
  });
  const missing = await getProductsWithoutWebId();
  assert.deepEqual(missing.map((p) => p.id), ['a']);

  assert.equal((await setProductWebId('a', 'bad id')).success, false);
  const taken = await setProductWebId('a', 'MOAK-YEK-BLACK');
  assert.equal(taken.success, false);
  assert.match(taken.message, /YEK - Black/);
  assert.equal((await setProductWebId('a', 'MOAK-PANJ-BLUE')).success, true);
  assert.equal((await setProductWebId('b', 'MOAK-OTHER')).success, false);
  assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: 'b' } })).webId, 'MOAK-YEK-BLACK');
});
