import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { prisma, resetDatabase } from '../helpers/db';
import { GET, POST } from '@/app/api/erp/route';

const TOKEN = 'erp-api-test-token';
const SITE_TOKEN = 'erp-site-api-test-token';

beforeEach(async () => {
  process.env.ERP_API_SECRET = TOKEN;
  process.env.ERP_SITE_API_SECRET = SITE_TOKEN;
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

function post(body: string, token = TOKEN, query = '') {
  return POST(
    new NextRequest(`http://localhost/api/erp${query ? `?${query}` : ''}`, {
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
  const body = await res.json();
  // `at` is when the ERP read the counts; the site orders its readings by it.
  assert.ok(!Number.isNaN(Date.parse(body.at)), String(body.at));
  assert.deepEqual(body.items, [
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
  // Input a real action would refuse with 422 must not make an unknown action look real.
  assert.equal((await get('action=nope&warehouseId=nope')).status, 404);
  assert.equal((await post(JSON.stringify({ action: 'nope', reference: null, items: 'x' }))).status, 404);

  for (const body of ['{not json', 'null', '[]', '5']) {
    assert.equal((await post(body)).status, 422, body);
  }
});

test('a POST may name its action in the address instead of the body, and the body wins when both do', async () => {
  // Named only in the address, a real action is that action: a bad body for it is 422, not 404.
  assert.equal((await post('{}', TOKEN, 'action=setSaleStatus')).status, 422);
  assert.equal((await post('{not json', TOKEN, 'action=createSale')).status, 422);
  // An action the ERP does not have stays 404, whatever body comes with it.
  assert.equal((await post('{}', TOKEN, 'action=nope')).status, 404);
  assert.equal((await post('{not json', TOKEN, 'action=nope')).status, 404);
  // The body's action wins over the address.
  assert.equal((await post(JSON.stringify({ action: 'setSaleStatus' }), TOKEN, 'action=nope')).status, 422);
  assert.equal((await post(JSON.stringify({ action: 'nope' }), TOKEN, 'action=setSaleStatus')).status, 404);
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

// ── Two keys: ERP_API_SECRET is full, ERP_SITE_API_SECRET reaches only what the website calls ──

const FORBIDDEN = { error: 'Forbidden for this key' };

test('the site key reads warehouses and stock', async () => {
  const site = await prisma.warehouse.create({ data: { name: 'مشاهیر' } });
  assert.equal((await get('action=warehouses', SITE_TOKEN)).status, 200);
  assert.equal((await get(`action=stock&warehouseId=${site.id}`, SITE_TOKEN)).status, 200);
});

test('the site key reaches createSale and setSaleStatus: a malformed body is 422, not 403', async () => {
  for (const action of ['createSale', 'setSaleStatus']) {
    assert.equal((await post(JSON.stringify({ action }), SITE_TOKEN)).status, 422, action);
    // Named only in the address, with a readable body or not.
    assert.equal((await post('{}', SITE_TOKEN, `action=${action}`)).status, 422, action);
    assert.equal((await post('{not json', SITE_TOKEN, `action=${action}`)).status, 422, action);
    // The body's action wins over a forbidden one in the address.
    assert.equal((await post(JSON.stringify({ action }), SITE_TOKEN, 'action=deposit')).status, 422, action);
  }
});

test('the site key is 403 on every other real action, and writes nothing', async () => {
  const bank = await prisma.account.create({ data: { name: 'بانک', type: 'BANK', currency: 'TOMAN', balance: 1000 } });
  const cash = await prisma.account.create({ data: { name: 'صندوق', type: 'CASH', currency: 'TOMAN', balance: 0 } });

  for (const query of [
    'action=summary',
    'action=accounts',
    'action=transactions',
    'action=orders',
    'action=settlements',
    'action=loans',
    'action=search&q=bank',
  ]) {
    const res = await get(query, SITE_TOKEN);
    assert.equal(res.status, 403, query);
    assert.deepEqual(await res.json(), FORBIDDEN, query);
  }

  // Bodies the full key would carry out.
  const writes: Record<string, unknown>[] = [
    { action: 'deposit', accountId: bank.id, amount: 500, description: 'x' },
    { action: 'expense', accountId: bank.id, amount: 500, description: 'x' },
    { action: 'transfer', fromAccountId: bank.id, toAccountId: cash.id, amount: 500 },
  ];
  for (const { action, ...fields } of writes) {
    const res = await post(JSON.stringify({ action, ...fields }), SITE_TOKEN);
    assert.equal(res.status, 403, String(action));
    assert.deepEqual(await res.json(), FORBIDDEN, String(action));
    // Named only in the address, with a readable body or not.
    assert.equal((await post(JSON.stringify(fields), SITE_TOKEN, `action=${action}`)).status, 403, String(action));
    assert.equal((await post('{not json', SITE_TOKEN, `action=${action}`)).status, 403, String(action));
    // The body's action wins over an allowed one in the address.
    assert.equal((await post(JSON.stringify({ action, ...fields }), SITE_TOKEN, 'action=createSale')).status, 403, String(action));
  }

  assert.equal(await prisma.transaction.count(), 0);
  assert.equal(Number((await prisma.account.findUniqueOrThrow({ where: { id: bank.id } })).balance), 1000);
  assert.equal(Number((await prisma.account.findUniqueOrThrow({ where: { id: cash.id } })).balance), 0);
});

test('an unknown action is still 404 with the site key', async () => {
  assert.equal((await get('action=nope', SITE_TOKEN)).status, 404);
  assert.equal((await get('', SITE_TOKEN)).status, 404);
  assert.equal((await post(JSON.stringify({ action: 'nope' }), SITE_TOKEN)).status, 404);
  assert.equal((await post('{}', SITE_TOKEN, 'action=nope')).status, 404);
  assert.equal((await post('{not json', SITE_TOKEN, 'action=nope')).status, 404);
  // A real action under the other method is unknown there, as with the full key.
  assert.equal((await get('action=createSale', SITE_TOKEN)).status, 404);
  assert.equal((await post(JSON.stringify({ action: 'stock' }), SITE_TOKEN)).status, 404);
});

test('the full key still reads summary and accounts', async () => {
  assert.equal((await get('action=summary')).status, 200);
  assert.equal((await get('action=accounts')).status, 200);
});

test('a wrong key is 401, near misses of the site key included', async () => {
  assert.equal((await get('action=warehouses', 'wrong')).status, 401);
  assert.equal((await get('action=warehouses', `${SITE_TOKEN}x`)).status, 401, 'longer');
  assert.equal((await get('action=warehouses', SITE_TOKEN.slice(0, -1))).status, 401, 'shorter');
  assert.equal((await post('{not json', 'wrong', 'action=createSale')).status, 401, 'the token is checked before the body');
});

test('with ERP_SITE_API_SECRET unset or empty, the site key is 401', async () => {
  delete process.env.ERP_SITE_API_SECRET;
  assert.equal((await get('action=warehouses', SITE_TOKEN)).status, 401);
  assert.equal((await post('{}', SITE_TOKEN, 'action=createSale')).status, 401);
  assert.equal((await get('action=warehouses', 'undefined')).status, 401);
  assert.equal((await get('action=accounts')).status, 200, 'the full key does not need it');

  process.env.ERP_SITE_API_SECRET = '';
  const res = await GET(
    new NextRequest('http://localhost/api/erp?action=warehouses', { headers: { authorization: 'Bearer ' } }),
  );
  assert.equal(res.status, 401);
});

test('both secrets set to the same value is the full key', async () => {
  process.env.ERP_SITE_API_SECRET = TOKEN;
  assert.equal((await get('action=accounts')).status, 200);
  // Past the key check: deposit refuses its missing fields itself.
  assert.equal((await post(JSON.stringify({ action: 'deposit' }))).status, 400);
});
