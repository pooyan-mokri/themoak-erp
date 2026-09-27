import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { AccessDenied } from '@/lib/access';
import { applyWebIdSeed, getProductsWithoutWebId, getWebIdSeedPreview, setProductWebId } from '@/actions/web-id';

// The webId actions by role, and the edges of giving one product its webId.

console.error = () => {};

const DENIED = 'شما به این بخش دسترسی ندارید.';

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
  await prisma.product.createMany({
    data: [
      { id: 'b', name: 'YEK - Black', sku: 'YEK/BLK', costPrice: 1, sellPrice: 1_500_000 },
      { id: 'a', name: 'PANJ - Blue', sku: 'PANJ/BLUE', costPrice: 1, sellPrice: 2_000_000 },
      { id: 'c', name: 'بند', sku: 'STRAP', costPrice: 1, sellPrice: 1, productType: 'OTHER' },
      { id: 'd', name: 'دستمال', sku: 'CLOTH', costPrice: 1, sellPrice: 1, productType: 'CONSUMABLE' },
    ],
  });
});
after(() => prisma.$disconnect());

test('the "without webId" list: saleable products only, by name, sell price for sales viewers', async () => {
  assert.deepEqual(await getProductsWithoutWebId(), [
    { id: 'a', name: 'PANJ - Blue', sku: 'PANJ/BLUE', sellPrice: 2_000_000 },
    { id: 'b', name: 'YEK - Black', sku: 'YEK/BLK', sellPrice: 1_500_000 },
  ]);
  for (const role of ['PROJECT_MANAGER', 'USER', null]) {
    setTestRole(role);
    await assert.rejects(getProductsWithoutWebId(), AccessDenied, String(role));
    await assert.rejects(getWebIdSeedPreview(), AccessDenied, String(role));
  }
});

test('setProductWebId: an empty or badly formed id, an unknown product and a product that has one are refused; trimmed ids are saved', async () => {
  assert.deepEqual(await setProductWebId('a', '   '), { success: false, message: 'شناسهٔ سایت را وارد کنید.' });
  assert.equal((await setProductWebId('a', 'moak-panj-blue')).success, false);
  assert.deepEqual(await setProductWebId('missing', 'MOAK-NONE'), {
    success: false,
    message: 'این کالا پیدا نشد یا در این فاصله شناسه گرفته است؛ صفحه را تازه کنید.',
  });
  assert.deepEqual(await setProductWebId('a', ' MOAK-PANJ-BLUE '), { success: true, message: 'شناسهٔ «MOAK-PANJ-BLUE» ثبت شد.' });
  assert.equal((await setProductWebId('a', 'MOAK-PANJ-NAVY')).success, false);
  assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: 'a' } })).webId, 'MOAK-PANJ-BLUE');
  assert.deepEqual((await getProductsWithoutWebId()).map((p) => p.id), ['b']);
});

test('setProductWebId takes stock.manage; the bundled file only an admin applies; nothing is written on a refusal', async () => {
  for (const role of ['AUDITOR', 'ACCOUNTANT', 'SALES', 'PROJECT_MANAGER', 'USER', null]) {
    setTestRole(role);
    assert.deepEqual(await setProductWebId('a', 'MOAK-PANJ-BLUE'), { success: false, error: DENIED, message: DENIED }, String(role));
  }
  for (const role of ['AUDITOR', 'ACCOUNTANT', 'SALES', 'WAREHOUSE', 'PROJECT_MANAGER', 'USER', null]) {
    setTestRole(role);
    const result = await applyWebIdSeed({ total: 91, toSet: 91 });
    assert.deepEqual(result, { success: false, message: 'فقط مدیر سیستم می‌تواند شناسه‌ها را یک‌جا ثبت کند.' }, String(role));
  }
  assert.equal(await prisma.product.count({ where: { webId: { not: null } } }), 0);
  setTestRole('WAREHOUSE');
  assert.equal((await setProductWebId('b', 'MOAK-YEK-BLACK')).success, true);
});
