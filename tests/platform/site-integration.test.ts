import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { prisma, resetDatabase } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { GET, POST } from '@/app/api/erp/route';
import { balanceEffect } from '@/lib/balance-reconciliation';
import { SITE_CONNECTION_KEY } from '@/lib/site-connection';

console.error = () => {};

const FULL = 'full-key-for-site-integration-tests';
const SITE = 'site-key-for-site-integration-tests';
const USD_RATE = 100_000;
const USD_OPENING = 500;

/** Money rows only: a sale's cost of goods is a COGS row on the order, not money (src/lib/cogs.ts). */
const isMoney = (row: { category?: string | null }) => row.category !== 'COGS';
const moneyRows = async (where: Record<string, unknown> = {}) => (await prisma.transaction.findMany({ where, orderBy: { createdAt: 'asc' } })).filter(isMoney);

let world: { usd: { id: string }; warehouse: { id: string }; frame: { id: string } };

beforeEach(async () => {
  process.env.ERP_API_SECRET = FULL;
  process.env.ERP_SITE_API_SECRET = SITE;
  setTestRole('ADMIN');
  await resetDatabase();
  const usd = await prisma.account.create({ data: { name: 'حساب دلاری', type: 'BANK', currency: 'USD', balance: USD_OPENING } });
  await prisma.exchangeRate.create({ data: { currency: 'USD', rateToToman: USD_RATE, date: new Date('2026-09-01') } });
  const warehouse = await prisma.warehouse.create({ data: { name: 'مشاهیر' } });
  const frame = await prisma.product.create({ data: { name: 'PANJ', sku: 'PANJ/BLUE', webId: 'MOAK-PANJ-BLUE', costPrice: 4_000_000, sellPrice: 10_000_000 } });
  await prisma.inventory.create({ data: { productId: frame.id, warehouseId: warehouse.id, quantity: 10 } });
  // The site's money goes to the dollar account.
  await prisma.systemSetting.create({
    data: { key: SITE_CONNECTION_KEY, value: JSON.stringify({ paymentAccountId: usd.id, warehouseId: warehouse.id }) },
  });
  world = { usd, warehouse, frame };
});
after(() => prisma.$disconnect());

const post = async (key: string, body: Record<string, unknown>) => {
  const res = await POST(
    new NextRequest('http://localhost/api/erp', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: await res.json() };
};
const get = async (query: string, key = FULL) => {
  const res = await GET(new NextRequest(`http://localhost/api/erp?${query}`, { headers: { authorization: `Bearer ${key}` } }));
  return { status: res.status, body: await res.json() };
};

let counter = 0;
function sale(overrides: Record<string, unknown> = {}) {
  counter += 1;
  return {
    action: 'createSale',
    reference: `M-INT${counter}`,
    issuedAt: '2026-09-20T10:00:00.000Z',
    warehouseId: world.warehouse.id,
    customer: { name: 'نیما', mobile: '09120000001' },
    items: [{ webId: 'MOAK-PANJ-BLUE', quantity: 2, unitPrice: 10_000_000 }],
    subtotal: 20_000_000,
    discount: 0,
    total: 20_000_000,
    currency: 'toman',
    payment: { gateway: 'zibal', trackId: `T${counter}`, refNumber: 'R', paidAt: '2026-09-20T10:00:00.000Z', amount: 20_000_000 },
    ...overrides,
  };
}

/** Account.balance equals its opening plus the effect of every transaction on it. */
async function assertLedger(accountId: string, opening: number) {
  const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId }, include: { transactions: true } });
  const derived = opening + account.transactions.reduce((sum: number, t: any) => sum + balanceEffect(t), 0);
  assert.ok(Math.abs(Number(account.balance) - derived) < 1e-9, `balance ${Number(account.balance)} vs ledger ${derived}`);
}

/** Inventory.quantity equals the opening plus the movements into it minus those out of it. */
async function assertStockMatchesMovements(opening: number) {
  const row = await prisma.inventory.findUniqueOrThrow({
    where: { productId_warehouseId: { productId: world.frame.id, warehouseId: world.warehouse.id } },
  });
  const moves = await prisma.inventoryMovement.findMany({ where: { productId: world.frame.id } });
  const moved = moves.reduce(
    (sum: number, m: any) => sum + (m.toWarehouseId === world.warehouse.id ? m.quantity : 0) - (m.fromWarehouseId === world.warehouse.id ? m.quantity : 0),
    0,
  );
  assert.equal(row.quantity, opening + moved);
  return row.quantity;
}

test('a website sale paid into a dollar account books dollars at the latest rate, and its refund takes dollars back', async () => {
  const sold = await post(SITE, sale({ reference: 'M-USD1' }));
  assert.equal(sold.status, 200, JSON.stringify(sold.body));
  const order = await prisma.order.findUniqueOrThrow({ where: { siteReference: 'M-USD1' }, include: { transaction: true } });
  assert.deepEqual(
    [order.transaction!.type, Number(order.transaction!.amount), order.transaction!.currency, Number(order.transaction!.amountInToman), Number(order.transaction!.rateSnapshot)],
    ['INCOME', 200, 'USD', 20_000_000, USD_RATE],
  );
  assert.equal(Number((await prisma.account.findUniqueOrThrow({ where: { id: world.usd.id } })).balance), USD_OPENING + 200);
  assert.deepEqual([Number(order.paidAmount), order.paymentStatus], [20_000_000, 'PAID']);

  const refunded = await post(SITE, { action: 'setSaleStatus', reference: 'M-USD1', status: 'refunded', amount: 5_000_000, refundId: 'rf-1', at: '2026-09-21T10:00:00.000Z' });
  assert.equal(refunded.status, 200, JSON.stringify(refunded.body));
  const refund = (await moneyRows({ orderId: order.id, type: 'EXPENSE' }))[0];
  assert.deepEqual([Number(refund.amount), refund.currency, Number(refund.amountInToman)], [50, 'USD', 5_000_000]);
  assert.equal(Number((await prisma.account.findUniqueOrThrow({ where: { id: world.usd.id } })).balance), USD_OPENING + 150);

  // The retry of the same refund books nothing more.
  assert.equal((await post(SITE, { action: 'setSaleStatus', reference: 'M-USD1', status: 'refunded', amount: 5_000_000, refundId: 'rf-1', at: '2026-09-21T10:00:00.000Z' })).status, 200);
  assert.equal((await moneyRows({ orderId: order.id, type: 'EXPENSE' })).length, 1);

  const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  // What the order says was paid is what its money rows say.
  const rows = await moneyRows({ orderId: order.id });
  const net = rows.reduce((sum: number, t: any) => sum + (t.type === 'INCOME' ? 1 : -1) * Number(t.amountInToman), 0);
  assert.equal(Number(after.paidAmount), net);
  assert.equal(Number(after.paidAmount), 15_000_000);
  await assertLedger(world.usd.id, USD_OPENING);
});

test('a website sale and its restock move stock only through movements, once', async () => {
  const sold = await post(SITE, sale({ reference: 'M-STOCK1' }));
  assert.equal(sold.status, 200);
  assert.equal(await assertStockMatchesMovements(10), 8);
  for (let i = 0; i < 2; i++) {
    const back = await post(SITE, { action: 'setSaleStatus', reference: 'M-STOCK1', status: 'returned', restock: true, at: '2026-09-22T10:00:00.000Z' });
    assert.equal(back.status, 200);
  }
  assert.equal(await assertStockMatchesMovements(10), 10);
  // The same sale sent again changes nothing.
  assert.equal((await post(SITE, sale({ reference: 'M-STOCK1' }))).status, 200);
  assert.equal(await assertStockMatchesMovements(10), 10);
  assert.equal(await prisma.order.count(), 1);
});

test('the largest amount the ERP stores is taken; one above it is a 422 and nothing is written', async () => {
  const big = 1e15;
  const ok = await post(SITE, sale({ reference: 'M-BIG', items: [{ webId: 'MOAK-PANJ-BLUE', quantity: 1, unitPrice: big }], subtotal: big, total: big, payment: { gateway: 'zibal', trackId: 'TB', paidAt: null, amount: big } }));
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const order = await prisma.order.findUniqueOrThrow({ where: { siteReference: 'M-BIG' }, include: { transaction: true } });
  assert.equal(Number(order.totalAmount), big);
  assert.equal(Number(order.transaction!.amountInToman), big);
  assert.equal(Number(order.transaction!.amount), big / USD_RATE);

  const before = (await moneyRows()).length;
  for (const amount of [big + 1, -1, Number.NaN]) {
    const refused = await post(SITE, sale({ items: [{ webId: 'MOAK-PANJ-BLUE', quantity: 1, unitPrice: 1 }], subtotal: 1, total: amount, payment: { gateway: 'zibal', trackId: 'TX', paidAt: null, amount: 1 } }));
    assert.equal(refused.status, 422, String(amount));
  }
  assert.equal((await moneyRows()).length, before);
  assert.equal(await prisma.order.count(), 1);
});

test('the summary totals a dollar balance in toman at the latest rate, and names a currency with no rate', async () => {
  await prisma.account.create({ data: { name: 'بانک', type: 'BANK', currency: 'TOMAN', balance: 3_000_000 } });
  await prisma.account.create({ data: { name: 'هزینه بازاریابی', type: 'EXPENSE', currency: 'TOMAN', balance: -9_000_000 } });
  await prisma.exchangeRate.create({ data: { currency: 'USD', rateToToman: 110_000, date: new Date('2026-09-10') } });
  const summary = await get('action=summary');
  assert.equal(summary.status, 200);
  assert.equal(summary.body.totalBalanceToman, 3_000_000 + USD_OPENING * 110_000);
  assert.equal('missingRates' in summary.body, false);

  await prisma.account.create({ data: { name: 'یوآن', type: 'BANK', currency: 'CNY', balance: 1_000 } });
  const withYuan = await get('action=summary');
  assert.equal(withYuan.body.totalBalanceToman, 3_000_000 + USD_OPENING * 110_000);
  assert.deepEqual(withYuan.body.missingRates, ['CNY']);
  assert.equal((await get('action=summary', SITE)).status, 403);
});

test('a list size that is not a whole number falls back instead of failing, and an unknown type is 422', async () => {
  for (let i = 0; i < 3; i++) {
    await prisma.transaction.create({ data: { type: 'INCOME', amount: 1, amountInToman: 1, currency: 'TOMAN', accountId: world.usd.id } });
  }
  for (const limit of ['abc', '-5', '0', '2.5', '']) {
    const listed = await get(`action=transactions&limit=${limit}`);
    assert.equal(listed.status, 200, limit);
    assert.equal(listed.body.transactions.length, 3, limit);
    assert.equal((await get(`action=orders&limit=${limit}`)).status, 200, limit);
  }
  assert.equal((await get('action=transactions&limit=2')).body.transactions.length, 2);
  assert.equal((await get('action=transactions&limit=100000')).body.transactions.length, 3);
  assert.equal((await get('action=transactions&type=INCOME')).body.transactions.length, 3);
  assert.equal((await get('action=transactions&type=income')).status, 422);
});

test('the orders list carries the discount, so debt is totalAmount - discount - paid', async () => {
  const sold = await post(SITE, sale({ reference: 'M-DISC', subtotal: 20_000_000, discount: 2_000_000, total: 18_000_000, payment: { gateway: 'zibal', trackId: 'TD', paidAt: null, amount: 18_000_000 } }));
  assert.equal(sold.status, 200);
  const [order] = (await get('action=orders')).body.orders;
  assert.deepEqual([order.totalAmount, order.discount, order.paidAmount, order.paymentStatus], [20_000_000, 2_000_000, 18_000_000, 'PAID']);
  assert.equal(order.totalAmount - order.discount - order.paidAmount, 0);
});
