import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { prisma, resetDatabase } from '../helpers/db';
import { GET, POST } from '@/app/api/erp/route';

const TOKEN = 'erp-api-test-token';

beforeEach(async () => {
  process.env.ERP_API_SECRET = TOKEN;
  await resetDatabase();
});
after(async () => {
  await prisma.$disconnect();
});

function get(query: string, token: string | null = TOKEN) {
  return GET(
    new NextRequest(`http://localhost/api/erp?${query}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    }),
  );
}

function post(body: string, token = TOKEN) {
  return POST(
    new NextRequest('http://localhost/api/erp', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body,
    }),
  );
}

function product(sku: string, webId: string | null, sellPrice = 1000) {
  return prisma.product.create({ data: { name: `${sku} name`, sku, webId, costPrice: 1, sellPrice } });
}

test('warehouses lists only active, non-consignment warehouses as {id, name}', async () => {
  const mashahir = await prisma.warehouse.create({ data: { name: 'مشاهیر' } });
  const central = await prisma.warehouse.create({ data: { name: 'انبار مرکزی' } });
  await prisma.warehouse.create({ data: { name: 'انبار قدیمی', isArchived: true } });
  await prisma.warehouse.create({ data: { name: 'امانی', isVirtual: true } });

  const res = await get('action=warehouses');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), [
    { id: central.id, name: 'انبار مرکزی' },
    { id: mashahir.id, name: 'مشاهیر' },
  ]);
});

test('stock returns every webId product, counted in the requested warehouse only', async () => {
  const site = await prisma.warehouse.create({ data: { name: 'مشاهیر' } });
  const other = await prisma.warehouse.create({ data: { name: 'انبار مرکزی' } });
  const panj = await product('PANJ/BLUE', 'MOAK-PANJ-BLUE', 15700000);
  const raw = await product('RAW/WHIT', 'MOAK-DAMN-RAW-WHITE', 18500000);
  const short = await product('SHORT', 'MOAK-SHORT', 1999.6);
  const hidden = await product('NO-WEB', null);
  await prisma.inventory.createMany({
    data: [
      { productId: panj.id, warehouseId: site.id, quantity: 7 },
      { productId: panj.id, warehouseId: other.id, quantity: 100 },
      { productId: raw.id, warehouseId: other.id, quantity: 5 },
      { productId: short.id, warehouseId: site.id, quantity: -2 },
      { productId: hidden.id, warehouseId: site.id, quantity: 50 },
    ],
  });

  const res = await get(`action=stock&warehouseId=${site.id}`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), [
    { webId: 'MOAK-DAMN-RAW-WHITE', sku: 'RAW/WHIT', name: 'RAW/WHIT name', quantity: 0, price: 18500000 },
    { webId: 'MOAK-PANJ-BLUE', sku: 'PANJ/BLUE', name: 'PANJ/BLUE name', quantity: 7, price: 15700000 },
    // Its row is -2; for the site that is simply none left.
    { webId: 'MOAK-SHORT', sku: 'SHORT', name: 'SHORT name', quantity: 0, price: 2000 },
  ]);
});

test('stock refuses a missing, unknown, archived or consignment warehouse with 422', async () => {
  const archived = await prisma.warehouse.create({ data: { name: 'انبار قدیمی', isArchived: true } });
  const consignment = await prisma.warehouse.create({ data: { name: 'امانی', isVirtual: true } });

  for (const query of [
    'action=stock',
    'action=stock&warehouseId=nope',
    `action=stock&warehouseId=${archived.id}`,
    `action=stock&warehouseId=${consignment.id}`,
  ]) {
    const res = await get(query);
    assert.equal(res.status, 422, query);
    assert.equal(typeof (await res.json()).error, 'string', query);
  }
});

test('an unknown action is 404 and a bad body is 422, never confused', async () => {
  assert.equal((await get('action=nope')).status, 404);
  assert.equal((await get('')).status, 404);
  assert.equal((await post(JSON.stringify({ action: 'nope' }))).status, 404);

  for (const body of ['{not json', 'null', '[]', '5']) {
    assert.equal((await post(body)).status, 422, body);
  }
});

test('a missing or wrong token is 401, even for a real action', async () => {
  assert.equal((await get('action=warehouses', null)).status, 401);
  assert.equal((await get('action=warehouses', 'wrong')).status, 401);
  assert.equal((await post('{not json', 'wrong')).status, 401, 'the token is checked before the body');

  delete process.env.ERP_API_SECRET;
  assert.equal((await get('action=warehouses', 'undefined')).status, 401, 'an unset secret must refuse everything');
});

test('settlements never lists a website order, even for a consignment partner', async () => {
  const partner = await prisma.customer.create({ data: { name: 'Partner', phone: '09120000000' } });
  await prisma.warehouse.create({ data: { name: 'امانی', isVirtual: true, customerId: partner.id } });
  const consignment = await prisma.order.create({
    data: { customerId: partner.id, totalAmount: 1000, paidAmount: 0, paymentStatus: 'UNPAID' },
  });
  await prisma.order.create({
    data: { customerId: partner.id, totalAmount: 2000, paidAmount: 0, paymentStatus: 'UNPAID', siteReference: 'M-PARTNER' },
  });

  const res = await get('action=settlements');
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).map((row: any) => row.id), [consignment.id]);
});
