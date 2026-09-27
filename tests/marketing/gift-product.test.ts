import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase } from '../helpers/db';
import { beforeQuery } from '../helpers/hooks';
import { setTestRole } from '../stubs/auth';
import { giftProduct } from '@/actions/product';
import { DENIED, assertInvariants, balanceOf, quantityOf, sleep, snapshot, stockIn } from '../sales/world';

// The actions log every refusal these tests provoke on purpose.
console.error = () => {};

const COST = 4_000_000;

beforeEach(async () => {
  beforeQuery.fn = null;
  setTestRole('ADMIN');
  await resetDatabase();
});
after(() => prisma.$disconnect());

/**
 * A frame held by a partner (created first), an archived warehouse and the
 * shop, so a pick of «the first warehouse with enough» would land on the partner.
 */
async function world() {
  const frame = await prisma.product.create({ data: { name: 'PANJ', sku: 'PANJ', costPrice: COST, sellPrice: 10_000_000 } });
  const partner = await prisma.customer.create({ data: { name: 'همکار' } });
  const atPartner = await prisma.warehouse.create({ data: { name: 'انبار امانی - همکار', isVirtual: true, customerId: partner.id } });
  const archived = await prisma.warehouse.create({ data: { name: 'انبار قدیمی', isArchived: true } });
  const store = await prisma.warehouse.create({ data: { name: 'مشاهیر' } });
  await stockIn(frame.id, atPartner.id, 5);
  await stockIn(frame.id, archived.id, 5);
  await stockIn(frame.id, store.id, 2);
  return { frame, atPartner, archived, store };
}

test('a gift with no warehouse chosen comes from our own live stock, at cost, with its movement', async () => {
  const w = await world();
  const result = await giftProduct(w.frame.id, 2, 'اینفلوئنسر', 'کمپین پاییز');
  assert.deepEqual(result, { success: true, message: 'هدیه با موفقیت ثبت شد.' });

  assert.deepEqual(
    [await quantityOf(w.frame.id, w.store.id), await quantityOf(w.frame.id, w.atPartner.id), await quantityOf(w.frame.id, w.archived.id)],
    [0, 5, 5],
  );
  const expense = await prisma.transaction.findFirstOrThrow({ where: { category: 'Marketing/Gift' } });
  const account = await prisma.account.findUniqueOrThrow({ where: { id: expense.accountId! } });
  assert.deepEqual(
    [expense.type, Number(expense.amount), Number(expense.amountInToman), expense.description, account.name, account.type],
    ['EXPENSE', 2 * COST, 2 * COST, 'هدیه به اینفلوئنسر: کمپین پاییز', 'Marketing Expenses', 'EXPENSE'],
  );
  assert.equal(await balanceOf(account.id), -2 * COST);
  const movement = await prisma.inventoryMovement.findFirstOrThrow({ where: { type: 'ADJUSTMENT' } });
  assert.deepEqual(
    [movement.fromWarehouseId, movement.toWarehouseId, movement.quantity, movement.referenceId, movement.note],
    [w.store.id, null, 2, expense.id, 'هدیه به اینفلوئنسر'],
  );
  await assertInvariants();
});

test('a warehouse the caller chooses is used, even a partner one; not enough there is refused in Persian', async () => {
  const w = await world();
  assert.equal((await giftProduct(w.frame.id, 1, 'مشتری', undefined, w.atPartner.id)).success, true);
  assert.deepEqual([await quantityOf(w.frame.id, w.atPartner.id), await quantityOf(w.frame.id, w.store.id)], [4, 2]);

  const before = await snapshot();
  assert.deepEqual(await giftProduct(w.frame.id, 3, 'مشتری', undefined, w.store.id), {
    success: false,
    error: 'موجودی کافی برای هدیهٔ «PANJ» وجود ندارد.',
  });
  // Nothing in our live warehouses covers 3, however much the partner holds.
  assert.deepEqual(await giftProduct(w.frame.id, 3, 'مشتری'), { success: false, error: 'موجودی کافی برای هدیهٔ «PANJ» وجود ندارد.' });
  assert.deepEqual(await giftProduct('no-such-product', 1, 'مشتری'), { success: false, error: 'کالا یافت نشد.' });
  for (const quantity of [0, -1, 1.5, Number.NaN]) {
    assert.deepEqual(
      await giftProduct(w.frame.id, quantity, 'مشتری'),
      { success: false, error: 'تعداد هدیه باید عددی صحیح و بیشتر از صفر باشد.' },
      String(quantity),
    );
  }
  assert.deepEqual(await snapshot(), before);
  await assertInvariants();
});

test('two gifts of the last frame at the same time: one goes through, stock stays at 0', async () => {
  const w = await world();
  await prisma.inventory.update({ where: { productId_warehouseId: { productId: w.frame.id, warehouseId: w.store.id } }, data: { quantity: 1 } });
  await prisma.inventoryMovement.create({ data: { productId: w.frame.id, fromWarehouseId: w.store.id, quantity: 1, type: 'ADJUSTMENT' } });
  beforeQuery.fn = async (params) => {
    if (params.model === 'Inventory' && params.action === 'updateMany') await sleep(150);
  };
  const results = await Promise.all([giftProduct(w.frame.id, 1, 'الف', undefined, w.store.id), giftProduct(w.frame.id, 1, 'ب', undefined, w.store.id)]);
  beforeQuery.fn = null;
  assert.deepEqual(results.map((r) => r.success).sort(), [false, true]);
  assert.equal(await quantityOf(w.frame.id, w.store.id), 0);
  assert.equal(await prisma.transaction.count({ where: { category: 'Marketing/Gift' } }), 1);
  await assertInvariants();
});

test('a gift takes stock and books an expense: only a role holding both stock.manage and finance.manage', async () => {
  const w = await world();
  const before = await snapshot();
  for (const role of ['AUDITOR', 'ACCOUNTANT', 'SALES', 'WAREHOUSE', 'PROJECT_MANAGER', 'USER', null]) {
    setTestRole(role);
    assert.deepEqual(await giftProduct(w.frame.id, 1, 'مشتری'), { success: false, error: DENIED, message: DENIED }, String(role));
  }
  assert.deepEqual(await snapshot(), before);
});
