import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase, form } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { SITE_UNKNOWN_NAME, SITE_UNKNOWN_SKU } from '@/lib/site-sale-data';
import { getProductsWithoutWebId, setProductWebId } from '@/actions/web-id';
import { updateProduct } from '@/actions/product';

const REFUSED = 'کالای ناشناختهٔ سایت شناسهٔ سایت نمی‌گیرد.';

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
});
after(() => prisma.$disconnect());

// The placeholder exactly as a website sale creates it.
const placeholder = () =>
  prisma.product.create({
    data: { sku: SITE_UNKNOWN_SKU, name: SITE_UNKNOWN_NAME, costPrice: 0, sellPrice: 0, productType: 'OTHER' },
  });

const frame = () =>
  prisma.product.create({ data: { sku: 'YEK/BLK', name: 'YEK - Black', costPrice: 1000, sellPrice: 15700000 } });

function edit(product: { id: string; name: string; sku: string; productType: string }, extra: Record<string, string>) {
  return updateProduct(
    product.id,
    {} as any,
    form({ name: product.name, sku: product.sku, productType: product.productType, costPrice: '0', sellPrice: '0', ...extra }),
  );
}

test('the "without webId" list never shows the placeholder, even if someone made it saleable', async () => {
  const unknown = await placeholder();
  await prisma.product.update({ where: { id: unknown.id }, data: { productType: 'SALEABLE' } });
  await frame();

  const listed = await getProductsWithoutWebId();
  assert.deepEqual(listed.map((p) => p.sku), ['YEK/BLK']);
});

test('setProductWebId refuses the placeholder; a normal product still gets its webId', async () => {
  const unknown = await placeholder();
  const refused = await setProductWebId(unknown.id, 'MOAK-YEK-BLACK');
  assert.deepEqual(refused, { success: false, message: REFUSED });
  assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: unknown.id } })).webId, null);

  const normal = await frame();
  const set = await setProductWebId(normal.id, 'MOAK-YEK-BLACK');
  assert.equal(set.success, true, set.message);
  assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: normal.id } })).webId, 'MOAK-YEK-BLACK');
});

test('updateProduct refuses a webId on the placeholder and saves nothing', async () => {
  const unknown = await placeholder();
  const result = await edit({ ...unknown, name: 'renamed' }, { webId: 'MOAK-YEK-BLACK' });
  assert.equal(result.success, undefined);
  assert.equal(result.message, REFUSED);
  assert.deepEqual(result.errors, { webId: [REFUSED] });

  const after = await prisma.product.findUniqueOrThrow({ where: { id: unknown.id } });
  assert.equal(after.webId, null);
  assert.equal(after.name, SITE_UNKNOWN_NAME);
});

test('a product cannot become the placeholder and get a webId in the same save', async () => {
  const normal = await frame();
  const result = await edit({ ...normal, sku: SITE_UNKNOWN_SKU }, { webId: 'MOAK-YEK-BLACK' });
  assert.equal(result.message, REFUSED);

  const after = await prisma.product.findUniqueOrThrow({ where: { id: normal.id } });
  assert.equal(after.sku, 'YEK/BLK');
  assert.equal(after.webId, null);
});

test('the placeholder can still be edited when no webId is set', async () => {
  const unknown = await placeholder();
  const extras: Record<string, string>[] = [{}, { webId: '' }, { webId: '   ' }];
  for (const extra of extras) {
    const result = await edit({ ...unknown, name: 'کالای ناشناخته' }, extra);
    assert.equal(result.success, true, String(result.message));
  }
  const after = await prisma.product.findUniqueOrThrow({ where: { id: unknown.id } });
  assert.equal(after.name, 'کالای ناشناخته');
  assert.equal(after.webId, null);
});

test('a placeholder that already holds a webId can have it cleared, but not replaced', async () => {
  const unknown = await placeholder();
  await prisma.product.update({ where: { id: unknown.id }, data: { webId: 'MOAK-YEK-BLACK' } });

  const replaced = await edit(unknown, { webId: 'MOAK-PANJ-BLUE', confirmWebIdChange: '1' });
  assert.equal(replaced.message, REFUSED);
  assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: unknown.id } })).webId, 'MOAK-YEK-BLACK');

  const cleared = await edit(unknown, { webId: '', confirmWebIdChange: '1' });
  assert.equal(cleared.success, true, String(cleared.message));
  assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: unknown.id } })).webId, null);
});

test('updateProduct still gives a normal product its webId', async () => {
  const normal = await frame();
  const result = await edit(normal, { webId: 'MOAK-YEK-BLACK' });
  assert.equal(result.success, true, String(result.message));
  assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: normal.id } })).webId, 'MOAK-YEK-BLACK');
});
