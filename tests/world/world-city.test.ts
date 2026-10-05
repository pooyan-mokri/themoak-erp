// The business world's city: every block fits what it holds without overlapping another, every place an event
// can go has a street in front of it, and a vehicle can drive from any of them to any other.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CROWD_MAX, along, pathLength, planCity, route, type Rect } from '@/components/world/world-city';
import type { WorldData } from '@/lib/world-types';

const ALL = { stock: true, sales: true, customers: true, suppliers: true, site: true, finance: true, profit: true, cost: true };

function world(n: { products: number; stores: number; suppliers: number; customers: number; accounts: number; halls?: number }, layers = ALL): WorldData {
  const halls = Array.from({ length: n.halls ?? 1 }, (_, i) => ({ id: `hall${i}`, name: `انبار ${i}`, virtual: false, partner: null, units: 0, products: 0 }));
  const stores = Array.from({ length: n.stores }, (_, i) => ({ id: `store${i}`, name: `امانی ${i}`, virtual: true, partner: `فروشگاه ${i}`, units: 0, products: 0 }));
  const products = Array.from({ length: n.products }, (_, i) => ({
    id: `p${i}`, name: `M${i % 9} - C${i}`, family: `M${i % 9}`, units: i % 7, level: (i % 7 === 0 ? 'OUT' : i % 7 <= 3 ? 'LOW' : 'OK') as any,
    byWarehouse: { hall0: i % 7, ...(halls.length > 1 && i % 3 === 0 && { hall1: 2 }), ...(n.stores && { [`store${i % n.stores}`]: 1 }) }, onSite: true,
  }));
  return {
    generatedAt: '2026-10-05T10:00:00Z',
    layers,
    stock: { lowMax: 3, warehouses: [...halls, ...stores], products, totals: { products: n.products, units: 1, low: 0, out: 0 } },
    customers: { total: n.customers, newInWindow: 0, buyers90: 0, debtors: 0, receivables: 0, top: Array.from({ length: Math.min(10, n.customers) }, (_, i) => ({ id: `c${i}`, name: `م${i}`, orders: 1, spend: 1, debt: 0 })) },
    suppliers: { suppliers: Array.from({ length: n.suppliers }, (_, i) => ({ id: `s${i}`, name: `S${i}`, orders: 1, open: 0, lastOrderAt: null })) },
    site: { host: 'themoak.com', stockPush: true, productsOnSite: 1, hook: { lastOkAt: null, failingSince: null, paused: false }, catalogue: { at: null, ok: true, read: 1, updated: 0, notInErp: 0 } },
    finance: { total: 1, accounts: Array.from({ length: n.accounts }, (_, i) => ({ id: `a${i}`, name: `ح${i}`, type: 'BANK', currency: 'TOMAN', balance: 1, toman: 1 })), receivables: 0, payables: 0, flows: { income: [], expense: [] } },
    office: { projects: 0, tasks: { open: 0, overdue: 0, done: 0 } },
    events: [],
  };
}

const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.z < b.z + b.d && b.z < a.z + a.d;
const inside = (inner: Rect, outer: Rect) => inner.x >= outer.x - 1e-6 && inner.z >= outer.z - 1e-6 && inner.x + inner.w <= outer.x + outer.w + 1e-6 && inner.z + inner.d <= outer.z + outer.d + 1e-6;

function assertSound(data: WorldData) {
  const plan = planCity(data);
  // Districts never overlap (the site and the office share a block side by side).
  for (let i = 0; i < plan.districts.length; i++) {
    for (let j = i + 1; j < plan.districts.length; j++) {
      const [a, b] = [plan.districts[i], plan.districts[j]];
      assert.ok(!overlap(a.rect, b.rect), `${a.key} overlaps ${b.key}`);
    }
  }
  const district = (key: string) => plan.districts.find((d) => d.key === key)!;
  // Halls, pallets and stores stand inside their blocks; stores never overlap each other.
  for (const y of plan.warehouses) {
    assert.ok(inside(y.building, district('warehouse').rect), 'hall outside its block');
    for (const p of y.pallets) assert.ok(inside({ x: p.x - 0.6, z: p.z - 0.5, w: 1.2, d: 1 }, district('warehouse').rect), 'pallet outside its block');
  }
  for (let i = 0; i < plan.stores.length; i++) {
    assert.ok(inside(plan.stores[i].plot, district('consignment').rect), 'store outside its block');
    for (let j = i + 1; j < plan.stores.length; j++) assert.ok(!overlap(plan.stores[i].plot, plan.stores[j].plot), 'stores overlap');
  }
  for (const f of plan.china.factories) assert.ok(inside(f, plan.china.island), 'factory off China');
  assert.ok(plan.homes.crowd.length <= CROWD_MAX);
  // The two islands do not touch.
  assert.ok(!overlap(plan.island, plan.china.island));
  // From every place on the main island to every other there is a way along the streets.
  const main = [...plan.places.entries()].filter(([k]) => !k.startsWith('sup:'));
  for (const [ka, a] of main) {
    for (const [kb, b] of main) {
      const path = route(plan, a, b);
      assert.ok(path.length >= 2, `${ka} → ${kb}`);
      assert.deepEqual(path[0], a);
      assert.deepEqual(path[path.length - 1], b);
      // Every step but the ends runs along a road: axis-aligned.
      for (let i = 2; i < path.length - 1; i++) {
        const dx = Math.abs(path[i].x - path[i - 1].x);
        const dz = Math.abs(path[i].z - path[i - 1].z);
        assert.ok(dx < 1e-6 || dz < 1e-6, `${ka} → ${kb} cuts across a block`);
      }
    }
  }
  return plan;
}

test('the business as it is today fits, and every place can be driven to', () => {
  const plan = assertSound(world({ products: 95, stores: 6, suppliers: 6, customers: 259, accounts: 12 }));
  assert.equal(plan.warehouses.length, 1);
  assert.equal(plan.stores.length, 6);
  assert.equal(plan.accounts.length, 12);
  assert.equal(plan.china.factories.length, 6);
  assert.equal(plan.homes.top.length, 10);
  assert.ok(plan.places.has('wh:hall0') && plan.places.has('wh:store3') && plan.places.has('sup:s2'));
});

test('a much bigger business, with a second hall, still fits', () => {
  assertSound(world({ products: 500, stores: 30, suppliers: 40, customers: 2000, accounts: 40, halls: 2 }));
});

test('an empty business and a role that sees little still get a city', () => {
  assertSound(world({ products: 0, stores: 0, suppliers: 0, customers: 0, accounts: 0 }));
  const data = world({ products: 20, stores: 2, suppliers: 2, customers: 5, accounts: 3 });
  const plan = assertSound({ ...data, customers: undefined, finance: undefined, layers: { ...ALL, customers: false, finance: false } });
  assert.ok(!plan.districts.some((d) => d.key === 'treasury' || d.key === 'customers'));
});

test('along a path: the start, the end, and the heading of each leg', () => {
  const path = [{ x: 0, z: 0 }, { x: 0, z: 10 }, { x: 10, z: 10 }];
  assert.equal(pathLength(path), 20);
  assert.deepEqual(along(path, 0).p, { x: 0, z: 0 });
  assert.deepEqual(along(path, 5), { p: { x: 0, z: 5 }, heading: 0 });
  assert.deepEqual(along(path, 15), { p: { x: 5, z: 10 }, heading: Math.PI / 2 });
  assert.deepEqual(along(path, 99).p, { x: 10, z: 10 });
});
