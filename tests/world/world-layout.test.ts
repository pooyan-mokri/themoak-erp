// The business world's map: no district overlaps another however much it holds, every event has a place to go,
// and the cards say only what the snapshot holds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CROWD_MAX, pathPoint, planWorld, type District } from '@/components/world/world-layout';
import { ago, districtCard, eventLine, thingCard } from '@/components/world/world-describe';
import type { WorldData, WorldEvent } from '@/lib/world-types';

const ALL = { stock: true, sales: true, customers: true, suppliers: true, site: true, finance: true, profit: true, cost: true };

/** A snapshot with this many of everything. */
function world(n: { products: number; stores: number; suppliers: number; customers: number; accounts: number }, layers = ALL): WorldData {
  const warehouses = [
    { id: 'main', name: 'مشاهیر', virtual: false, partner: null, units: 0, products: 0 },
    { id: 'second', name: 'انبار دوم', virtual: false, partner: null, units: 0, products: 0 },
    ...Array.from({ length: n.stores }, (_, i) => ({ id: `store${i}`, name: `امانی ${i}`, virtual: true, partner: `فروشگاه ${i}`, units: 0, products: 0 })),
  ];
  const products = Array.from({ length: n.products }, (_, i) => ({
    id: `p${i}`, name: `M${i % 9} - C${i}`, family: `M${i % 9}`, units: i % 7, level: (i % 7 === 0 ? 'OUT' : i % 7 <= 3 ? 'LOW' : 'OK') as any,
    byWarehouse: { main: i % 7, ...(i % 3 === 0 && { second: 2 }), ...(n.stores && { [`store${i % n.stores}`]: 1 }) }, onSite: i % 2 === 0, sold: i % 4,
  }));
  const days = Array.from({ length: 31 }, (_, i) => ({ day: `2026-09-${String((i % 30) + 1).padStart(2, '0')}`, orders: i % 4, total: (i % 4) * 1e6 }));
  const events: WorldEvent[] = [
    { id: 'e1', kind: 'order', at: '2026-10-03T10:00:00Z', from: 'wh:main', to: 'site', label: 'سفارش #۱ · ۱ عدد', amount: 2e6, units: 1 },
    { id: 'e2', kind: 'transfer', at: '2026-10-03T09:00:00Z', from: 'wh:main', to: n.stores ? 'wh:store0' : 'wh:second', label: 'انتقال', units: 3 },
    { id: 'e3', kind: 'purchase', at: '2026-10-02T09:00:00Z', from: n.suppliers ? 'sup:s0' : 'hq', to: 'wh:main', label: 'رسید', units: 4 },
    { id: 'e4', kind: 'income', at: '2026-10-02T08:00:00Z', from: 'customers', to: 'treasury', label: 'واریز', amount: 5e6 },
    { id: 'e5', kind: 'expense', at: '2026-10-01T08:00:00Z', from: 'treasury', to: 'out', label: 'هزینه', amount: 1e6 },
  ];
  return {
    generatedAt: '2026-10-04T10:00:00Z',
    layers,
    stock: { lowMax: 3, warehouses, products, totals: { products: n.products, units: 100, low: 3, out: 2, valueAtCost: 5e8 } },
    sales: {
      since: '2026-09-03T20:30:00Z', today: { orders: 2, total: 3e6 }, window: { orders: 40, total: 9e7 }, previous: { orders: 30, total: 8e7 }, days,
      channels: [{ channel: 'site', orders: 3, total: 9e6 }, { channel: 'shop', orders: 30, total: 7e7 }, { channel: 'consignment', orders: 7, total: 1.1e7 }],
      topProducts: products.slice(0, 10).map((p) => ({ id: p.id, name: p.name, family: p.family, units: 10 - Number(p.id.slice(1)), image: null })),
      recentOrders: [],
    },
    customers: {
      total: n.customers, newInWindow: 4, buyers90: Math.min(n.customers, 50), debtors: 3, receivables: 4e6,
      top: Array.from({ length: Math.min(10, n.customers) }, (_, i) => ({ id: `c${i}`, name: `مشتری ${i}`, orders: 3, spend: (10 - i) * 1e6, debt: i === 0 ? 1e6 : 0 })),
    },
    suppliers: { suppliers: Array.from({ length: n.suppliers }, (_, i) => ({ id: `s${i}`, name: `تأمین‌کننده ${i}`, orders: 2, open: i % 2, lastOrderAt: null, unpaid: i * 1e6 })), payables: 3e6 },
    site: { host: 'themoak.com', stockPush: true, productsOnSite: 91, hook: { lastOkAt: null, failingSince: null, paused: false }, catalogue: { at: null, ok: true, read: 91, updated: 0, notInErp: 0 }, orders: { count: 3, total: 9e6 } },
    finance: {
      total: 3e9,
      accounts: Array.from({ length: n.accounts }, (_, i) => ({ id: `a${i}`, name: `حساب ${i}`, type: 'BANK', currency: i === 1 ? 'USD' : 'TOMAN', balance: i * 1e6, toman: i === 2 ? null : i * 1e6 })),
      receivables: 4e6, payables: 3e6,
      flows: { income: [{ category: 'فروش', amount: 9e7 }], expense: [{ category: 'اجاره', amount: 1e7 }, { category: 'حقوق', amount: 2e7 }] },
    },
    profit: { revenue: 9e7, cogs: 3e7, expenses: 3e7, profit: 3e7 },
    office: { projects: 2, tasks: { open: 5, overdue: 1, done: 3 } },
    events,
  };
}

function overlap(a: District, b: District) {
  return Math.abs(a.center.x - b.center.x) * 2 < a.width + b.width && Math.abs(a.center.z - b.center.z) * 2 < a.depth + b.depth;
}

function assertSound(data: WorldData) {
  const plan = planWorld(data);
  for (let i = 0; i < plan.districts.length; i++) {
    for (let j = i + 1; j < plan.districts.length; j++) {
      assert.ok(!overlap(plan.districts[i], plan.districts[j]), `${plan.districts[i].key} overlaps ${plan.districts[j].key}`);
    }
  }
  for (const e of data.events) {
    assert.ok(plan.places.has(e.from), `no place for ${e.from}`);
    assert.ok(plan.places.has(e.to), `no place for ${e.to}`);
  }
  // Everything stands on the island.
  const inside = (p: { x: number; z: number }) => Math.abs(p.x) <= plan.halfX && Math.abs(p.z) <= plan.halfZ;
  for (const d of plan.districts) assert.ok(inside({ x: d.center.x + Math.sign(d.center.x) * d.width / 2, z: d.center.z + Math.sign(d.center.z) * d.depth / 2 }), d.key);
  for (const y of [...plan.warehouses, ...plan.stores]) for (const c of y.columns) assert.ok(inside(c));
  assert.ok(inside(plan.out));
  // Each crate column stands inside its own district's tile.
  const tile = (key: string) => plan.districts.find((d) => d.key === key)!;
  for (const [key, yards] of [['warehouse', plan.warehouses], ['consignment', plan.stores]] as const) {
    const d = tile(key);
    for (const y of yards) for (const c of y.columns) {
      assert.ok(Math.abs(c.x - d.center.x) <= d.width / 2 && Math.abs(c.z - d.center.z) <= d.depth / 2, `${key} column outside its tile`);
    }
  }
  assert.ok(plan.customers.crowd.length <= CROWD_MAX);
  return plan;
}

test('the business as it is today: every district has room, every event a place', () => {
  const data = world({ products: 95, stores: 6, suppliers: 6, customers: 259, accounts: 12 });
  const plan = assertSound(data);
  assert.deepEqual(plan.districts.map((d) => d.key).sort(), ['consignment', 'customers', 'hq', 'market', 'office', 'site', 'suppliers', 'treasury', 'warehouse']);
  assert.equal(plan.warehouses.length, 2);
  assert.equal(plan.stores.length, 6);
  // The first warehouse shows out-of-stock products as ghosts; every product with stock there has a column.
  const main = plan.warehouses.find((y) => y.warehouseId === 'main')!;
  const expected = data.stock!.products.filter((p) => (p.byWarehouse.main ?? 0) > 0 || p.units <= 0).length;
  assert.equal(main.columns.length, expected);
  assert.equal(plan.accounts.length, 12);
  assert.equal(plan.market.days.length, 31);
  assert.equal(plan.customers.top.length, 10);
  assert.equal(plan.customers.crowd.length, CROWD_MAX);
});

test('a much bigger business still fits without overlaps', () => {
  assertSound(world({ products: 500, stores: 30, suppliers: 40, customers: 2000, accounts: 40 }));
});

test('an empty business, and a role that sees little, still get a world', () => {
  const empty = world({ products: 0, stores: 0, suppliers: 0, customers: 0, accounts: 0 });
  empty.events = [];
  assertSound(empty);
  const data = world({ products: 20, stores: 2, suppliers: 2, customers: 5, accounts: 3 });
  const warehouseOnly: WorldData = { ...data, layers: { ...ALL, sales: false, customers: false, finance: false, profit: false, cost: false }, sales: undefined, customers: undefined, finance: undefined, profit: undefined, events: data.events.filter((e) => e.kind !== 'income' && e.kind !== 'expense' && e.kind !== 'order') };
  const plan = assertSound(warehouseOnly);
  assert.deepEqual(plan.districts.map((d) => d.key).sort(), ['consignment', 'hq', 'office', 'site', 'suppliers', 'warehouse']);
  assert.deepEqual(plan.kpis.map((k) => k.id), ['stock']);
});

test('the way between two places goes through the headquarters\' plaza', () => {
  const a = { x: -20, z: 0 };
  const b = { x: 0, z: 30 };
  assert.deepEqual(pathPoint(a, b, 0), a);
  assert.deepEqual(pathPoint(a, b, 1), b);
  const mid = pathPoint(a, b, 20 / 50);
  assert.ok(Math.abs(mid.x) < 1e-9 && Math.abs(mid.z) < 1e-9, 'at the plaza after the first leg');
  assert.deepEqual(pathPoint(a, a, 0.5), a);
});

test('cards: amounts in Toman with Persian digits; a foreign account without a rate says so; a part the role may not see has no card', () => {
  const data = world({ products: 10, stores: 1, suppliers: 1, customers: 3, accounts: 3 });
  const usd = thingCard('account:a1', data)!;
  assert.equal(usd.title, 'حساب 1');
  assert.deepEqual(usd.rows[0], ['موجودی', `${(1e6).toLocaleString('fa-IR', { maximumFractionDigits: 2 })} USD`]);
  assert.deepEqual(usd.rows[1], ['به تومان', `${(1e6).toLocaleString('fa-IR')} تومان`]);
  const noRate = { ...data, finance: { ...data.finance!, accounts: [{ ...data.finance!.accounts[2], currency: 'EUR' }] } };
  assert.deepEqual(thingCard('account:a2', noRate)!.rows[1], ['به تومان', 'نرخی ثبت نشده']);

  const product = thingCard('product:main:p4', data)!;
  assert.equal(product.title, 'M4 - C4');
  assert.ok(product.rows.some(([k]) => k === 'فروش ۳۰ روز'));
  const noSales = { ...data, stock: { ...data.stock!, products: data.stock!.products.map(({ sold, ...p }) => p) } };
  assert.ok(!thingCard('product:main:p4', noSales)!.rows.some(([k]) => k === 'فروش ۳۰ روز'));

  const blind = { ...data, finance: undefined, customers: undefined, sales: undefined, profit: undefined };
  for (const id of ['account:a0', 'flow:income:فروش', 'customer:c0', 'crowd', 'channel:shop', 'top:p0', 'kpi:profit', 'kpi:balance', 'out']) {
    assert.equal(thingCard(id, blind), null, id);
  }
  assert.equal(thingCard('product:main:nope', data), null);

  const hq = districtCard('hq', blind);
  assert.ok(!hq.rows.some(([k]) => ['فروش امروز', 'سود ۳۰ روز', 'موجودی کل'].includes(k)));
  assert.ok(hq.rows.some(([k]) => k === 'موجودی کالا'));
});

test('time is told in Persian, and an event line carries its amount when the role may see it', () => {
  const now = Date.parse('2026-10-04T10:00:00Z');
  assert.equal(ago('2026-10-04T09:59:40Z', now), 'همین الان');
  assert.equal(ago('2026-10-04T09:55:00Z', now), '۵ دقیقه پیش');
  assert.equal(ago('2026-10-04T07:00:00Z', now), '۳ ساعت پیش');
  assert.equal(ago('2026-10-01T10:00:00Z', now), '۳ روز پیش');
  assert.equal(eventLine({ id: 'x', kind: 'order', at: '', from: 'a', to: 'b', label: 'سفارش #۱', amount: 2_500_000 }), 'سفارش #۱ · ۲٫۵ میلیون');
  assert.equal(eventLine({ id: 'y', kind: 'sale', at: '', from: 'a', to: 'b', label: 'فروش ۱ عدد' }), 'فروش ۱ عدد');
});
