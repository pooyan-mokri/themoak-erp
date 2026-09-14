import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase, form } from '../helpers/db';
import { beforeQuery } from '../helpers/hooks';
import { createProduct, updateProduct } from '@/actions/product';

const base = { productType: 'SALEABLE', costPrice: '1000', sellPrice: '15700000' };

beforeEach(async () => {
  beforeQuery.fn = null;
  await resetDatabase();
});
after(() => prisma.$disconnect());

test('a duplicate webId that slips past the check on create still gets a readable message, not a database error', async () => {
  beforeQuery.fn = async (params) => {
    if (params.model === 'Product' && params.action === 'create') {
      beforeQuery.fn = null;
      // Another request saves a product with the same webId right now.
      await prisma.product.create({
        data: { name: 'PANJ - Blue', sku: 'PANJ/BLUE', costPrice: 1, sellPrice: 1, webId: 'MOAK-PANJ-BLUE' },
      });
    }
  };
  const { result, product } = await create('PANJ - Blue copy', 'PANJ/BLUE2', 'MOAK-PANJ-BLUE');
  assert.equal(beforeQuery.fn, null, 'the concurrent write must happen between the check and the create');
  assert.equal(product, null);
  assert.notEqual(result.success, true);
  assert.match(String(result.message), /قبلاً به کالای «PANJ - Blue» \(PANJ\/BLUE\) داده شده است/);
  assert.doesNotMatch(String(result.message), /Unique constraint|P2002|prisma/i);
});

test('a duplicate webId that slips past the check on update still gets a readable message, and nothing changes', async () => {
  const { product } = await create('YEK - Black', 'YEK/BLK');
  beforeQuery.fn = async (params) => {
    if (params.model === 'Product' && (params.action === 'update' || params.action === 'updateMany')) {
      beforeQuery.fn = null;
      // Another request gives a different product this webId right now.
      await prisma.product.create({
        data: { name: 'PANJ - Blue', sku: 'PANJ/BLUE', costPrice: 1, sellPrice: 1, webId: 'MOAK-PANJ-BLUE' },
      });
    }
  };
  const { result, product: after } = await update(product!.id, 'YEK - Black', 'YEK/BLK', { webId: 'MOAK-PANJ-BLUE' });
  assert.equal(beforeQuery.fn, null, 'the concurrent write must happen between the check and the write');
  assert.notEqual(result.success, true);
  assert.equal(after.webId, null);
  assert.match(String(result.message), /قبلاً به کالای «PANJ - Blue» \(PANJ\/BLUE\) داده شده است/);
  assert.doesNotMatch(String(result.message), /Unique constraint|P2002|prisma/i);
});

test('a badly formatted webId on update is refused and nothing is saved', async () => {
  const { product } = await create('YEK - Black', 'YEK/BLK');
  const added = await update(product!.id, 'YEK - Black (renamed)', 'YEK/BLK', { webId: 'moak-yek-black' });
  assert.notEqual(added.result.success, true);
  assert.match(String(added.result.message), /MOAK-PANJ-BLUE/);
  assert.equal(added.product.webId, null);
  assert.equal(added.product.name, 'YEK - Black');

  const { product: held } = await create('PANJ - Blue', 'PANJ/BLUE', 'MOAK-PANJ-BLUE');
  const changed = await update(held!.id, 'PANJ - Blue', 'PANJ/BLUE', { webId: 'MOAK-PANJ/GREEN', confirmWebIdChange: '1' });
  assert.notEqual(changed.result.success, true);
  assert.match(String(changed.result.message), /MOAK-PANJ-BLUE/);
  assert.equal(changed.product.webId, 'MOAK-PANJ-BLUE');
});

test('a duplicate webId on update saves none of the other edits either', async () => {
  await create('PANJ - Blue', 'PANJ/BLUE', 'MOAK-PANJ-BLUE');
  const { product: other } = await create('YEK - Black', 'YEK/BLK');
  const { result, product } = await update(other!.id, 'YEK - Black (renamed)', 'YEK/BLK', { webId: 'MOAK-PANJ-BLUE' });
  assert.notEqual(result.success, true);
  assert.equal(product.webId, null);
  assert.equal(product.name, 'YEK - Black');
});

async function create(name: string, sku: string, webId?: string) {
  const result = await createProduct({} as any, form({ ...base, name, sku, ...(webId !== undefined ? { webId } : {}) }));
  return { result, product: await prisma.product.findUnique({ where: { sku } }) };
}

async function update(id: string, name: string, sku: string, extra: Record<string, string> = {}) {
  const result = await updateProduct(id, {} as any, form({ ...base, name, sku, ...extra }));
  return { result, product: await prisma.product.findUniqueOrThrow({ where: { id } }) };
}

test('a duplicate webId on create is refused with a readable message', async () => {
  await create('PANJ - Blue', 'PANJ/BLUE', 'MOAK-PANJ-BLUE');
  const { result, product } = await create('PANJ - Blue copy', 'PANJ/BLUE2', 'MOAK-PANJ-BLUE');
  assert.equal(product, null);
  assert.match(String(result.message), /قبلاً به کالای «PANJ - Blue» \(PANJ\/BLUE\) داده شده است/);
  assert.doesNotMatch(String(result.message), /Unique constraint|P2002|prisma/i);
});

test('a duplicate webId on update is refused and nothing changes', async () => {
  await create('PANJ - Blue', 'PANJ/BLUE', 'MOAK-PANJ-BLUE');
  const { product: other } = await create('YEK - Black', 'YEK/BLK');
  const { result, product } = await update(other!.id, 'YEK - Black', 'YEK/BLK', { webId: 'MOAK-PANJ-BLUE' });
  assert.equal(product.webId, null);
  assert.match(String(result.message), /قبلاً به کالای «PANJ - Blue»/);
});

test('a badly formatted webId is refused and nothing is saved', async () => {
  const { result, product } = await create('PANJ - Blue', 'PANJ/BLUE', 'panj-blue');
  assert.equal(product, null);
  assert.match(String(result.message), /MOAK-PANJ-BLUE/);
});

test('once set, the webId cannot be changed or cleared without the explicit confirmation', async () => {
  const { product } = await create('PANJ - Blue', 'PANJ/BLUE', 'MOAK-PANJ-BLUE');

  const changed = await update(product!.id, 'PANJ - Blue', 'PANJ/BLUE', { webId: 'MOAK-PANJ-GREEN' });
  assert.equal(changed.product.webId, 'MOAK-PANJ-BLUE');
  assert.match(String(changed.result.message), /قابل تغییر نیست/);

  const cleared = await update(product!.id, 'PANJ - Blue', 'PANJ/BLUE', { webId: '' });
  assert.equal(cleared.product.webId, 'MOAK-PANJ-BLUE');
});

test('with the confirmation it can be changed, and other edits still save', async () => {
  const { product } = await create('PANJ - Blue', 'PANJ/BLUE', 'MOAK-PANJ-BLUE');
  const { result, product: after } = await update(product!.id, 'PANJ - Blue (renamed)', 'PANJ/BLUE', {
    webId: 'MOAK-PANJ-GREEN',
    confirmWebIdChange: '1',
  });
  assert.equal(result.success, true, String(result.message));
  assert.equal(after.webId, 'MOAK-PANJ-GREEN');
  assert.equal(after.name, 'PANJ - Blue (renamed)');
});

test('saving without a webId field leaves it untouched; resubmitting the same value is fine', async () => {
  const { product } = await create('PANJ - Blue', 'PANJ/BLUE', 'MOAK-PANJ-BLUE');
  const absent = await update(product!.id, 'PANJ - Blue', 'PANJ/BLUE');
  assert.equal(absent.result.success, true, String(absent.result.message));
  assert.equal(absent.product.webId, 'MOAK-PANJ-BLUE');

  const same = await update(product!.id, 'PANJ - Blue v2', 'PANJ/BLUE', { webId: 'MOAK-PANJ-BLUE' });
  assert.equal(same.result.success, true, String(same.result.message));
  assert.equal(same.product.name, 'PANJ - Blue v2');
});

test('a product without a webId can get one without confirmation', async () => {
  const { product } = await create('YEK - Black', 'YEK/BLK');
  assert.equal(product!.webId, null);
  const { result, product: after } = await update(product!.id, 'YEK - Black', 'YEK/BLK', { webId: 'MOAK-YEK-BLACK' });
  assert.equal(result.success, true, String(result.message));
  assert.equal(after.webId, 'MOAK-YEK-BLACK');
});

test('a webId set concurrently between the check and the write is never replaced', async () => {
  const { product } = await create('YEK - Black', 'YEK/BLK');
  beforeQuery.fn = async (params) => {
    if (params.model === 'Product' && (params.action === 'update' || params.action === 'updateMany')) {
      beforeQuery.fn = null;
      // Another request (say, the seed) gives this product its webId right now.
      await prisma.$executeRawUnsafe('UPDATE "Product" SET "webId" = $1 WHERE id = $2', 'MOAK-FROM-SEED', product!.id);
    }
  };
  const { result, product: after } = await update(product!.id, 'YEK - Black', 'YEK/BLK', { webId: 'MOAK-TYPED' });
  assert.notEqual(result.success, true);
  assert.match(String(result.message), /هم‌زمان تغییر کرد/);
  assert.equal(after.webId, 'MOAK-FROM-SEED');
});

test('a stored webId in an old format does not block an unrelated edit', async () => {
  const { product } = await create('PANJ - Blue', 'PANJ/BLUE');
  await prisma.product.update({ where: { id: product!.id }, data: { webId: 'moak-legacy' } });
  const { result, product: after } = await update(product!.id, 'PANJ - Blue', 'PANJ/BLUE', {
    webId: 'moak-legacy',
    sellPrice: '16000000',
  });
  assert.equal(result.success, true, String(result.message));
  assert.equal(Number(after.sellPrice), 16000000);
  assert.equal(after.webId, 'moak-legacy');
});

test('a form opened before the product got its webId cannot clear it, and says to refresh', async () => {
  const { product } = await create('YEK - Black', 'YEK/BLK');
  await prisma.product.update({ where: { id: product!.id }, data: { webId: 'MOAK-YEK-BLACK' } });
  const { result, product: after } = await update(product!.id, 'YEK - Black', 'YEK/BLK', { webId: '' });
  assert.equal(after.webId, 'MOAK-YEK-BLACK');
  assert.match(String(result.message), /صفحه را تازه کنید/);
});
