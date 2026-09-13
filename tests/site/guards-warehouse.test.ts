import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { DEFAULT_SITE_WAREHOUSE_NAME, SITE_CONNECTION_KEY } from '@/lib/site-connection';
import { archiveWarehouse, deleteWarehouse } from '@/actions/warehouse';

const NON_ZERO = /موجودی غیرصفر \(مثبت یا منفی\)/;
const SITE_WAREHOUSE = /انبار فروش سایت است/;

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
});
after(() => prisma.$disconnect());

function warehouse(name: string) {
  return prisma.warehouse.create({ data: { name } });
}

function product(sku: string) {
  return prisma.product.create({ data: { name: sku, sku, costPrice: 1000, sellPrice: 2000 } });
}

async function saveSiteWarehouse(warehouseId: string) {
  const value = JSON.stringify({ siteUrl: 'https://api.themoak.com', webhookSecret: 'secret', paymentAccountId: null, warehouseId });
  await prisma.systemSetting.create({ data: { key: SITE_CONNECTION_KEY, value } });
}

/** A website sale of 4 BLUE drove it to -4 while RED sits at +4: the rows sum to 0. Returns the sold line. */
async function websiteSaleLeavingPlusFourMinusFour(warehouseId: string) {
  const red = await product('PANJ/RED');
  const blue = await product('PANJ/BLUE');
  await prisma.inventory.createMany({
    data: [
      { productId: red.id, warehouseId, quantity: 4 },
      { productId: blue.id, warehouseId, quantity: -4 },
    ],
  });
  const customer = await prisma.customer.create({ data: { name: 'مشتری سایت', phone: '09120000000' } });
  const account = await prisma.account.create({ data: { name: 'بانک سامان', type: 'BANK', currency: 'TOMAN' } });
  const income = await prisma.transaction.create({
    data: { amount: 8000, amountInToman: 8000, type: 'INCOME', category: 'Sales', accountId: account.id, customerId: customer.id },
  });
  const order = await prisma.order.create({
    data: {
      customerId: customer.id,
      totalAmount: 8000,
      paidAmount: 8000,
      transactionId: income.id,
      siteReference: 'SITE-1001',
      siteData: { total: 8000, discount: 0, payment: { amount: 8000 }, unknownLines: [], history: [], review: [] },
      items: { create: [{ productId: blue.id, warehouseId, quantity: 4, price: 2000 }] },
    },
    include: { items: true },
  });
  return order.items[0];
}

test('+4 of one product and -4 of another blocks archive and delete, and nothing is erased', async () => {
  const central = await warehouse('انبار مرکزی');
  const line = await websiteSaleLeavingPlusFourMinusFour(central.id);

  const archived = await archiveWarehouse(central.id);
  assert.equal(archived.success, false);
  assert.match(archived.message, NON_ZERO);

  const deleted = await deleteWarehouse(central.id);
  assert.equal(deleted.success, false);
  assert.match(deleted.message, NON_ZERO);

  assert.equal((await prisma.warehouse.findUniqueOrThrow({ where: { id: central.id } })).isArchived, false);
  assert.equal(await prisma.inventory.count({ where: { warehouseId: central.id } }), 2);
  assert.equal((await prisma.orderItem.findUniqueOrThrow({ where: { id: line.id } })).warehouseId, central.id);
});

test('the warehouse saved in the site connection settings is refused', async () => {
  const central = await warehouse('انبار مرکزی');
  const mashahir = await warehouse(DEFAULT_SITE_WAREHOUSE_NAME);
  await saveSiteWarehouse(central.id);

  for (const action of [archiveWarehouse, deleteWarehouse]) {
    const result = await action(central.id);
    assert.equal(result.success, false);
    assert.match(result.message, SITE_WAREHOUSE);
  }
  assert.equal((await prisma.warehouse.findUniqueOrThrow({ where: { id: central.id } })).isArchived, false);

  // The saved choice wins over the default name, so «مشاهیر» is an ordinary empty warehouse here.
  const archived = await archiveWarehouse(mashahir.id);
  assert.equal(archived.success, true, archived.message);
});

test('without a saved choice, the warehouse carrying the default name is refused', async () => {
  const mashahir = await warehouse(DEFAULT_SITE_WAREHOUSE_NAME);
  await warehouse('انبار مرکزی');

  for (const action of [archiveWarehouse, deleteWarehouse]) {
    const result = await action(mashahir.id);
    assert.equal(result.success, false);
    assert.match(result.message, SITE_WAREHOUSE);
  }
  assert.equal((await prisma.warehouse.findUniqueOrThrow({ where: { id: mashahir.id } })).isArchived, false);
});

test('an empty warehouse the website does not sell from can still be archived and deleted', async () => {
  await warehouse(DEFAULT_SITE_WAREHOUSE_NAME);
  const old = await warehouse('انبار قدیمی');
  const temp = await warehouse('انبار موقت');
  // A leftover zero row is not stock.
  await prisma.inventory.create({ data: { productId: (await product('YEK/BLK')).id, warehouseId: temp.id, quantity: 0 } });

  const archived = await archiveWarehouse(old.id);
  assert.equal(archived.success, true, archived.message);
  assert.equal((await prisma.warehouse.findUniqueOrThrow({ where: { id: old.id } })).isArchived, true);

  const deleted = await deleteWarehouse(temp.id);
  assert.equal(deleted.success, true, deleted.message);
  assert.equal(await prisma.warehouse.findUnique({ where: { id: temp.id } }), null);
  assert.equal(await prisma.inventory.count({ where: { warehouseId: temp.id } }), 0);
});
