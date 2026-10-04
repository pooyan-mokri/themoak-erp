// Personal keys for the ERP API (src/lib/api-keys.ts): a call with one acts as its user — their role decides what it
// may do and see, and what it records carries their name. Pooyan: Pegah's Claude must do sales, payments, returns,
// transfers and money «به اسم خودش».
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { prisma, resetDatabase } from '../helpers/db';
import { setTestRole, auth } from '../stubs/auth';
import { GET, POST } from '@/app/api/erp/route';
import { createApiKey, listApiKeys, revokeApiKey } from '@/actions/api-keys';
import { apiKeyUser, hashApiKey, looksLikeApiKey, newApiKey } from '@/lib/api-keys';
import { openAccount, stockIn, quantityOf, balanceOf, assertInvariants } from '../sales/world';

console.error = () => {};

const OWNER = 'owner-full-key-for-tests';
const TAG = 'Claude · پگاه';

const call = (method: 'GET' | 'POST', key: string, query: string, body?: unknown) => {
  const req = new NextRequest(`http://localhost/api/erp?${query}`, {
    method,
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  return method === 'GET' ? GET(req) : POST(req);
};
const get = async (key: string, query: string) => {
  const res = await call('GET', key, query);
  return { status: res.status, body: await res.json() };
};
const post = async (key: string, body: Record<string, unknown>) => {
  const res = await call('POST', key, '', body);
  return { status: res.status, body: await res.json() };
};

async function person(name: string, email: string, role: string, isActive = true) {
  return prisma.user.create({ data: { name, email, password: 'x', role: role as any, isActive } });
}

async function keyFor(userId: string, label = 'Claude ویندوز') {
  setTestRole('ADMIN');
  const made = await createApiKey(userId, label);
  assert.equal(made.success, true);
  return (made as any).key as string;
}

let pegah: any, sara: any, anbar: any, hesab: any;
let store: any, naqsh: any, frame: any, other: any, bank: any, cash: any;

beforeEach(async () => {
  process.env.ERP_API_SECRET = OWNER;
  setTestRole('ADMIN');
  await resetDatabase();
  await prisma.user.create({ data: { id: 'test-user', name: 'مدیر', email: 'owner@x.test', password: 'x', role: 'ADMIN' } });
  pegah = await person('پگاه', 'pegah@x.test', 'ADMIN');
  sara = await person('سارا', 'sara@x.test', 'SALES');
  anbar = await person('انباردار', 'wh@x.test', 'WAREHOUSE');
  hesab = await person('حسابدار', 'acc@x.test', 'ACCOUNTANT');
  store = await prisma.warehouse.create({ data: { name: 'مشاهیر' } });
  naqsh = await prisma.warehouse.create({ data: { name: 'انبار امانی - نقش', isVirtual: true } });
  frame = await prisma.product.create({ data: { name: 'YEK - Black', sku: 'YEK/BLK', costPrice: 400_000, sellPrice: 1_000_000 } });
  other = await prisma.product.create({ data: { name: 'YEK - Brown', sku: 'YEK/BRN', costPrice: 400_000, sellPrice: 1_200_000 } });
  await stockIn(frame.id, store.id, 10);
  await stockIn(other.id, store.id, 4);
  bank = await openAccount('بانک سامان', { opening: 50_000_000 });
  cash = await openAccount('پول نقد', { type: 'CASH', opening: 5_000_000 });
});
after(() => prisma.$disconnect());

test('a key is tmk_ and 43 random characters; only its hash is kept; the list never shows it', async () => {
  const fresh = newApiKey();
  assert.ok(looksLikeApiKey(fresh.key));
  assert.equal(fresh.hash, hashApiKey(fresh.key));
  assert.equal(fresh.prefix, fresh.key.slice(0, 8));
  assert.notEqual(newApiKey().key, fresh.key);

  const key = await keyFor(pegah.id);
  const rows = await prisma.apiKey.findMany();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].hash, hashApiKey(key));
  assert.ok(!JSON.stringify(rows).includes(key));
  const listed = await listApiKeys(pegah.id);
  assert.equal(listed.success, true);
  assert.deepEqual(Object.keys((listed as any).keys[0]).sort(), ['createdAt', 'id', 'lastUsedAt', 'name', 'prefix', 'revokedAt']);
  assert.ok((await prisma.activityLog.findMany()).some((a: any) => a.action === 'API_KEY_CREATED' && a.details.includes('پگاه')));
});

test('only an admin makes, lists or revokes keys; an inactive user gets none', async () => {
  for (const role of ['SALES', 'ACCOUNTANT', 'WAREHOUSE', 'AUDITOR', null]) {
    setTestRole(role);
    assert.equal((await createApiKey(pegah.id, 'x')).success, false, String(role));
    assert.equal((await listApiKeys(pegah.id)).success, false, String(role));
  }
  const off = await person('رفته', 'gone@x.test', 'SALES', false);
  setTestRole('ADMIN');
  assert.equal((await createApiKey(off.id, 'x')).success, false);
  assert.equal(await prisma.apiKey.count(), 0);
});

test('whoami names the key\'s user and what they may do; a wrong, revoked or ended key is 401', async () => {
  const key = await keyFor(sara.id);
  const me = await get(key, 'action=whoami');
  assert.equal(me.status, 200);
  assert.equal(me.body.name, 'سارا');
  assert.equal(me.body.role, 'SALES');
  assert.ok(me.body.actions.includes('createOrder'));
  assert.ok(!me.body.actions.includes('deposit'));

  assert.equal((await get('tmk_' + 'x'.repeat(43), 'action=whoami')).status, 401);
  assert.equal((await get('not-a-key', 'action=whoami')).status, 401);

  const row = await prisma.apiKey.findFirstOrThrow();
  setTestRole('ADMIN');
  assert.equal((await revokeApiKey(row.id)).success, true);
  assert.equal((await get(key, 'action=whoami')).status, 401);

  const second = await keyFor(sara.id);
  await prisma.user.update({ where: { id: sara.id }, data: { isActive: false } });
  assert.equal((await get(second, 'action=whoami')).status, 401, 'a deactivated user\'s key ends');
  const third = await keyFor(pegah.id);
  await prisma.user.delete({ where: { id: pegah.id } });
  assert.equal((await get(third, 'action=whoami')).status, 401, 'a deleted user\'s key ends with them');
});

test('lastUsedAt is kept, but not written on every call', async () => {
  const key = await keyFor(pegah.id);
  const t0 = new Date('2026-10-04T10:00:00Z');
  await apiKeyUser(prisma, key, t0);
  assert.deepEqual((await prisma.apiKey.findFirstOrThrow()).lastUsedAt, t0);
  await apiKeyUser(prisma, key, new Date(t0.getTime() + 60_000));
  assert.deepEqual((await prisma.apiKey.findFirstOrThrow()).lastUsedAt, t0);
  const later = new Date(t0.getTime() + 10 * 60_000);
  await apiKeyUser(prisma, key, later);
  assert.deepEqual((await prisma.apiKey.findFirstOrThrow()).lastUsedAt, later);
});

test('the role decides: sales cannot read the books or move money; the warehouse cannot sell; the site\'s actions are not a person\'s', async () => {
  const sales = await keyFor(sara.id);
  const wh = await keyFor(anbar.id);
  assert.equal((await get(sales, 'action=summary')).status, 403);
  assert.equal((await get(sales, 'action=transactions')).status, 403);
  assert.equal((await get(sales, 'action=orders')).status, 200);
  assert.equal((await post(sales, { action: 'deposit', accountId: bank.id, amount: 1, description: 'x' })).status, 403);
  assert.equal((await post(wh, { action: 'createOrder', items: [{ sku: 'YEK/BLK', quantity: 1 }], account: 'پول نقد' })).status, 403);
  assert.equal((await post(sales, { action: 'transferStock', sku: 'YEK/BLK', from: 'مشاهیر', to: 'نقش', quantity: 1 })).status, 403);
  assert.equal((await post(sales, { action: 'createSale', siteReference: 'S-1' })).status, 403);
  assert.equal((await get(sales, 'action=nothing')).status, 404);
  assert.equal((await post(sales, { action: 'nothing' })).status, 404);
  assert.equal(await prisma.order.count(), 0);
});

test('what a role may not see is taken out of the answer', async () => {
  const accountant = await keyFor(hesab.id);
  const summary = await get(accountant, 'action=summary');
  assert.equal(summary.status, 200);
  assert.ok('totalBalanceToman' in summary.body);
  assert.ok(!('last30Days' in summary.body), 'no profit without profit.view');

  const sales = await keyFor(sara.id);
  const accounts = await get(sales, 'action=accounts');
  assert.equal(accounts.status, 200);
  assert.ok(accounts.body.length > 0 && accounts.body.every((a: any) => !('balance' in a)), 'pickers get no balance');

  const wh = await keyFor(anbar.id);
  const inventory = await get(wh, 'action=inventory');
  assert.equal(inventory.status, 200);
  assert.ok(!('valueAtCost' in inventory.body.totals));
  assert.ok(inventory.body.products.every((p: any) => !('costPrice' in p) && !('sellPrice' in p)));

  const admin = await keyFor(pegah.id);
  const full = await get(admin, 'action=inventory');
  assert.ok('valueAtCost' in full.body.totals && 'costPrice' in full.body.products[0]);
});

test('a deposit, an expense and a transfer made with a person\'s key carry their name; the owner\'s key is as before', async () => {
  const key = await keyFor(pegah.id);
  const dep = await post(key, { action: 'deposit', accountId: bank.id, amount: 2_000_000, description: 'فروش حضوری' });
  assert.equal(dep.status, 200);
  const exp = await post(key, { action: 'expense', accountId: cash.id, amount: 300_000, description: 'پیک' });
  assert.equal(exp.status, 200);
  const tr = await post(key, { action: 'transfer', fromAccountId: bank.id, toAccountId: cash.id, amount: 1_000_000, description: 'تنخواه' });
  assert.equal(tr.status, 200);
  const rows = await prisma.transaction.findMany({ where: { category: { not: 'موجودی اولیه' } } });
  assert.equal(rows.length, 4);
  assert.ok(rows.every((r: any) => r.tags.includes(TAG)));
  const logs = await prisma.activityLog.findMany({ where: { action: { startsWith: 'API_' }, NOT: { action: { startsWith: 'API_KEY_' } } } });
  assert.deepEqual(logs.map((l: any) => l.action).sort(), ['API_DEPOSIT', 'API_EXPENSE', 'API_TRANSFER']);
  assert.ok(logs.every((l: any) => l.userId === pegah.id && l.details.startsWith(TAG)));

  const owner = await post(OWNER, { action: 'deposit', accountId: bank.id, amount: 1_000, description: 'مالک' });
  assert.equal(owner.status, 200);
  const ownerRow = await prisma.transaction.findFirstOrThrow({ where: { description: 'مالک' } });
  assert.deepEqual(ownerRow.tags, []);
  assert.equal(await prisma.activityLog.count({ where: { action: { startsWith: 'API_' }, NOT: { action: { startsWith: 'API_KEY_' } } } }), 3);
  assert.equal(await balanceOf(bank.id), 50_000_000 + 2_000_000 - 1_000_000 + 1_000);
  await assertInvariants();
});

test('a sale by SKU and account name: stock leaves, money arrives, the order is tagged and logged as the person; the same request twice is one sale', async () => {
  const key = await keyFor(sara.id);
  const customer = await post(key, { action: 'createCustomer', name: 'مریم کاظمی', phone: '09121234567' });
  assert.equal(customer.status, 200);
  assert.equal(customer.body.customer.name, 'مریم کاظمی');

  const body = { action: 'createOrder', customerPhone: '09121234567', items: [{ sku: 'YEK/BLK', quantity: 2 }, { sku: 'yek/brn', quantity: 1, price: 1_100_000 }], account: 'پول نقد', discount: 100_000, requestId: 'req-sale-0001' };
  const sale = await post(key, body);
  assert.equal(sale.status, 200, JSON.stringify(sale.body));
  assert.equal(sale.body.order.total, 2 * 1_000_000 + 1_100_000);
  assert.equal(sale.body.order.paid, 3_000_000);
  assert.equal(sale.body.customer, 'مریم کاظمی');
  assert.equal(sale.body.warehouse, 'مشاهیر');
  assert.equal(await quantityOf(frame.id, store.id), 8);
  assert.equal(await quantityOf(other.id, store.id), 3);
  assert.equal(await balanceOf(cash.id), 5_000_000 + 3_000_000);
  const order = await prisma.order.findFirstOrThrow();
  assert.ok(order.tags.includes('Claude · سارا'));

  const again = await post(key, body);
  assert.equal(again.status, 200);
  assert.equal(await prisma.order.count(), 1, 'one sale');
  assert.equal(await quantityOf(frame.id, store.id), 8);
  const logs = await prisma.activityLog.findMany({ where: { action: { startsWith: 'API_' }, NOT: { action: { startsWith: 'API_KEY_' } } }, orderBy: { createdAt: 'asc' } });
  assert.deepEqual(logs.map((l: any) => l.action), ['API_CREATE_CUSTOMER', 'API_CREATE_ORDER']);
  assert.ok(logs.every((l: any) => l.userId === sara.id));
  await assertInvariants();
});

test('a name that fits several things, or none, is refused with the choices', async () => {
  const key = await keyFor(pegah.id);
  const vague = await post(key, { action: 'createOrder', items: [{ sku: 'YEK', quantity: 1 }], account: 'پول نقد' });
  assert.equal(vague.status, 422);
  assert.deepEqual(vague.body.options.map((o: any) => o.sku).sort(), ['YEK/BLK', 'YEK/BRN']);
  const none = await post(key, { action: 'createOrder', items: [{ sku: 'NOPE', quantity: 1 }], account: 'پول نقد' });
  assert.equal(none.status, 422);
  const noAccount = await post(key, { action: 'createOrder', items: [{ sku: 'YEK/BLK', quantity: 1 }], account: 'بانک ملت' });
  assert.equal(noAccount.status, 422);
  const tooMany = await post(key, { action: 'createOrder', items: [{ sku: 'YEK/BRN', quantity: 99 }], account: 'پول نقد' });
  assert.equal(tooMany.status, 422, 'the app\'s own rules still hold');
  assert.equal(await prisma.order.count(), 0);
});

test('a payment on an order by its number, a return, and a stock transfer, each as the person', async () => {
  const key = await keyFor(pegah.id);
  const sale = await post(key, { action: 'createOrder', items: [{ sku: 'YEK/BLK', quantity: 2 }], account: 'بانک سامان', paidAmount: 500_000 });
  assert.equal(sale.status, 200, JSON.stringify(sale.body));
  const number = sale.body.order.number;

  const pay = await post(key, { action: 'recordOrderPayment', orderNumber: number, account: 'پول نقد', amount: 1_500_000 });
  assert.equal(pay.status, 200, JSON.stringify(pay.body));
  assert.equal((await prisma.order.findFirstOrThrow()).paymentStatus, 'PAID');

  const back = await post(key, { action: 'returnOrderItem', orderNumber: number, sku: 'YEK/BLK', quantity: 1, account: 'پول نقد', reason: 'خراب' });
  assert.equal(back.status, 200, JSON.stringify(back.body));
  assert.equal(await quantityOf(frame.id, store.id), 9);

  const move = await post(key, { action: 'transferStock', sku: 'YEK/BRN', from: 'مشاهیر', to: 'نقش', quantity: 2 });
  assert.equal(move.status, 200, JSON.stringify(move.body));
  assert.equal(await quantityOf(other.id, naqsh.id), 2);
  const movement = await prisma.inventoryMovement.findFirstOrThrow({ where: { type: 'TRANSFER' } });
  assert.ok(movement.tags.includes(TAG));

  const logs = await prisma.activityLog.findMany({ where: { action: { startsWith: 'API_' }, NOT: { action: { startsWith: 'API_KEY_' } } } });
  assert.deepEqual(logs.map((l: any) => l.action).sort(), ['API_CREATE_ORDER', 'API_ORDER_PAYMENT', 'API_RETURN', 'API_TRANSFER_STOCK']);
  assert.ok(logs.every((l: any) => l.userId === pegah.id));
  await assertInvariants();
});

test('the owner\'s key cannot do what only a person may: there is no one to record it as', async () => {
  const res = await post(OWNER, { action: 'createOrder', items: [{ sku: 'YEK/BLK', quantity: 1 }], account: 'پول نقد' });
  assert.equal(res.status, 403);
  assert.equal(await prisma.order.count(), 0);
});

test('two people at once: each call acts only as its own key\'s user, and outside a call auth() is the session', async () => {
  const a = await keyFor(pegah.id);
  const b = await keyFor(sara.id);
  const [x, y] = await Promise.all([
    post(a, { action: 'createOrder', items: [{ sku: 'YEK/BLK', quantity: 1 }], account: 'پول نقد', requestId: 'req-pegah-01' }),
    post(b, { action: 'createOrder', items: [{ sku: 'YEK/BRN', quantity: 1 }], account: 'پول نقد', requestId: 'req-sara-001' }),
  ]);
  assert.equal(x.status, 200);
  assert.equal(y.status, 200);
  const orders = await prisma.order.findMany({ include: { items: true } });
  const byTag = (tag: string) => orders.find((o: any) => o.tags.includes(tag))!;
  assert.equal(byTag('Claude · پگاه').items[0].productId, frame.id);
  assert.equal(byTag('Claude · سارا').items[0].productId, other.id);
  const logs = await prisma.activityLog.findMany({ where: { action: 'API_CREATE_ORDER' } });
  assert.deepEqual(logs.map((l: any) => l.userId).sort(), [pegah.id, sara.id].sort());
  setTestRole('WAREHOUSE');
  assert.deepEqual(await auth(), { user: { id: 'test-user', role: 'WAREHOUSE' } });
});
