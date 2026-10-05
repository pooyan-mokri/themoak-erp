// The business world's time machine and presence: walking back from today gives each past day's stock and balances
// exactly; each role gets only its parts; presence shows everyone else, briefly, and never trusts the client's name.
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { prisma, resetDatabase } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { buildWorld } from '@/lib/world-data';
import { balancesAt, HISTORY_DAYS, stockAt } from '@/lib/world-history';
import { buildWorldHistory } from '@/lib/world-history-build';
import { PresenceBoard, PRESENCE_TTL_MS, presenceBoard } from '@/lib/world-presence';
import { tehranDay, tehranDayStart, addDays } from '@/lib/tehran-day';
import { GET as historyRoute } from '@/app/api/world/history/route';
import { POST as presencePost, DELETE as presenceDelete } from '@/app/api/world/presence/route';

console.error = () => {};

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
});
after(() => prisma.$disconnect());

const NOW = new Date();
const today = tehranDay(NOW);
/** Noon (Tehran) of the day `n` days ago. */
const noon = (n: number) => new Date(tehranDayStart(addDays(today, -n)).getTime() + 12 * 3_600_000);

async function seed() {
  const a = await prisma.warehouse.create({ data: { name: 'مشاهیر' } });
  const b = await prisma.warehouse.create({ data: { name: 'امانی', isVirtual: true } });
  const p = await prisma.product.create({ data: { name: 'YEK - Black', sku: 'YEK', costPrice: 1, sellPrice: 2 } });
  await prisma.inventoryMovement.createMany({
    data: [
      { productId: p.id, toWarehouseId: a.id, quantity: 10, type: 'PURCHASE', createdAt: noon(10) },
      { productId: p.id, fromWarehouseId: a.id, toWarehouseId: b.id, quantity: 3, type: 'TRANSFER', createdAt: noon(5) },
      { productId: p.id, fromWarehouseId: a.id, quantity: 2, type: 'SALE', createdAt: noon(2) },
    ],
  });
  await prisma.inventory.createMany({ data: [{ productId: p.id, warehouseId: a.id, quantity: 5 }, { productId: p.id, warehouseId: b.id, quantity: 3 }] });

  const bank = await prisma.account.create({ data: { name: 'بانک', type: 'BANK', currency: 'TOMAN', balance: 1_000 } });
  await prisma.account.create({ data: { name: 'هزینه', type: 'EXPENSE', currency: 'TOMAN', balance: 0 } });
  await prisma.transaction.createMany({
    data: [
      { accountId: bank.id, type: 'ADJUSTMENT', amount: 800, amountInToman: 800, date: noon(40) },
      { accountId: bank.id, type: 'INCOME', amount: 500, amountInToman: 500, date: noon(8) },
      { accountId: bank.id, type: 'EXPENSE', amount: 200, amountInToman: 200, date: noon(3) },
      { accountId: bank.id, type: 'TRANSFER', amount: 100, amountInToman: 100, description: 'انتقال به صندوق', date: noon(1) },
    ],
  });
  return { a, b, p, bank };
}

test('the window is the last 30 Tehran days, today last, each day\'s end the next day\'s start', async () => {
  const h = await buildWorldHistory(prisma, 'ADMIN', NOW);
  assert.equal(h.days.length, HISTORY_DAYS);
  assert.equal(h.days.at(-1), today);
  assert.equal(h.days[0], addDays(today, -(HISTORY_DAYS - 1)));
  for (let i = 0; i < h.days.length; i++) {
    assert.equal(h.ends[i], tehranDayStart(addDays(h.days[i], 1)).toISOString());
  }
});

test('stock walked back from today is each day\'s stock', async () => {
  const s = await seed();
  const world = await buildWorld(prisma, 'ADMIN', NOW);
  const h = await buildWorldHistory(prisma, 'ADMIN', NOW);
  const at = (n: number) => stockAt(world.stock!.products, h.moves!, h.ends[h.days.indexOf(addDays(today, -n))]).get(s.p.id);
  assert.deepEqual(at(11), {});
  assert.deepEqual(at(10), { [s.a.id]: 10 });
  assert.deepEqual(at(6), { [s.a.id]: 10 });
  assert.deepEqual(at(5), { [s.a.id]: 7, [s.b.id]: 3 });
  assert.deepEqual(at(2), { [s.a.id]: 5, [s.b.id]: 3 });
  assert.deepEqual(at(0), { [s.a.id]: 5, [s.b.id]: 3 });
});

test('balances walked back from today are each day\'s balances; a P&L bucket is not money', async () => {
  const s = await seed();
  const world = await buildWorld(prisma, 'ADMIN', NOW);
  const h = await buildWorldHistory(prisma, 'ADMIN', NOW);
  const at = (n: number) => balancesAt(world.finance!.accounts, h.changes!, h.ends[h.days.indexOf(addDays(today, -n))]).get(s.bank.id);
  assert.equal(at(9), 800);
  assert.equal(at(8), 1_300);
  assert.equal(at(3), 1_100);
  assert.equal(at(1), 1_000);
  assert.equal(at(0), 1_000);
  assert.ok(h.changes!.every((c) => c.a === s.bank.id), 'only accounts that hold money');
});

test('each role gets only its parts of the past', async () => {
  await seed();
  const keys = async (role: string) => Object.keys(await buildWorldHistory(prisma, role, NOW)).sort();
  assert.deepEqual(await keys('ADMIN'), ['changes', 'days', 'ends', 'generatedAt', 'moves']);
  assert.deepEqual(await keys('WAREHOUSE'), ['days', 'ends', 'generatedAt', 'moves']);
  assert.deepEqual(await keys('SALES'), ['days', 'ends', 'generatedAt', 'moves']);
  assert.deepEqual(await keys('ACCOUNTANT'), ['changes', 'days', 'ends', 'generatedAt', 'moves']);
  assert.deepEqual(await keys('PROJECT_MANAGER'), ['days', 'ends', 'generatedAt']);
});

test('/api/world/history: 401 for a stranger, 403 for an unknown role, never cached', async () => {
  setTestRole(null);
  assert.equal((await historyRoute()).status, 401);
  setTestRole('NOBODY');
  assert.equal((await historyRoute()).status, 403);
  setTestRole('WAREHOUSE');
  const res = await historyRoute();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('presence: a sane report is kept, an insane one refused; everyone else is listed, freshest first; 20 s later they are gone', () => {
  const board = new PresenceBoard();
  const pegah = { id: 'u1', name: 'پگاه', role: 'ADMIN' };
  const sara = { id: 'u2', name: 'سارا', role: 'SALES' };
  const t = 1_000_000;
  assert.equal(board.report(pegah, { x: 'a', z: 1 }, t), null);
  assert.equal(board.report(pegah, { x: 9999, z: 1 }, t), null);
  assert.ok(board.report(pegah, { x: 1, z: 2, yaw: 0.5, district: 'warehouse' }, t));
  assert.ok(board.report(sara, { x: -3, z: 4, district: 'BAD DISTRICT!' }, t + 500));
  assert.deepEqual(board.others('u1', t + 600).map((p) => [p.name, p.x, p.district]), [['سارا', -3, null]]);
  assert.deepEqual(board.others('u2', t + 600).map((p) => [p.name, p.district]), [['پگاه', 'warehouse']]);
  // Reports closer than a second are one.
  board.report(pegah, { x: 50, z: 50 }, t + 300);
  assert.equal(board.others('u2', t + 600)[0].x, 1);
  assert.deepEqual(board.others('u1', t + 500 + PRESENCE_TTL_MS + 1), []);
  board.leave('u1');
  assert.deepEqual(board.others('u2', t + 600), []);
});

test('/api/world/presence: a stranger or a deactivated user gets 401; names come from the database', async () => {
  await prisma.user.create({ data: { id: 'test-user', name: 'پگاه', email: 'p@x.test', password: 'x', role: 'ADMIN' } });
  const req = (body: unknown) => new NextRequest('http://localhost/api/world/presence', { method: 'POST', body: JSON.stringify(body) });
  setTestRole(null);
  assert.equal((await presencePost(req({ x: 1, z: 1 }))).status, 401);
  setTestRole('ADMIN');
  presenceBoard.report({ id: 'other', name: 'سارا', role: 'SALES' }, { x: 2, z: 3, district: 'market' });
  const res = await presencePost(req({ x: 1, z: 1, name: 'جعلی' }));
  assert.equal(res.status, 200);
  const { others } = await res.json();
  assert.ok(others.some((p: any) => p.name === 'سارا' && p.district === 'market'));
  assert.ok(!others.some((p: any) => p.userId === 'test-user'));
  assert.equal((await presencePost(req({ x: 'no' }))).status, 422);
  await prisma.user.update({ where: { id: 'test-user' }, data: { isActive: false } });
  assert.equal((await presencePost(req({ x: 1, z: 1 }))).status, 401);
  await prisma.user.update({ where: { id: 'test-user' }, data: { isActive: true } });
  assert.equal((await presenceDelete()).status, 200);
  presenceBoard.leave('other');
});
