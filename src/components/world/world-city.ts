/**
 * The business world's city plan (/dashboard/world), in metres: pure geometry
 * from a snapshot (src/lib/world-types.ts), no three.js, so it can be tested.
 * The ground is the x–z plane (x east, z south), y is up.
 *
 * The main island is a grid of blocks between avenues: the port on the west
 * coast, the warehouse block, the centre (headquarters, the bank, the office),
 * the shopping street of the consignment partners and the website's tower in
 * the east, and the homes of the customers along the south. The suppliers are
 * on a second island, «چین», across the water, with a port of their own.
 * Every block is sized to what it holds, so any number of products, partners,
 * suppliers or customers fits; vehicles find their way on the street graph.
 */
import type { WorldData, WorldPlace, WorldProduct } from '@/lib/world-types';

export type DistrictKey = 'hq' | 'treasury' | 'site' | 'consignment' | 'market' | 'customers' | 'suppliers' | 'warehouse' | 'office' | 'port';

export const DISTRICT_LABELS: Record<DistrictKey, string> = {
  hq: 'دفتر مرکزی',
  treasury: 'خزانه',
  site: 'وب‌سایت',
  consignment: 'فروشگاه‌های امانی',
  market: 'فروش',
  customers: 'محلهٔ مشتری‌ها',
  suppliers: 'تأمین‌کننده‌ها (چین)',
  warehouse: 'انبار',
  office: 'دفتر پروژه‌ها',
  port: 'بندر',
};

export type Point = { x: number; z: number };
export type Rect = { x: number; z: number; w: number; d: number };
/** A district: its name and the ground it covers. */
export type District = { key: DistrictKey; label: string; rect: Rect; center: Point };
/** A building's plot: where it stands and which way its front faces (radians about y; 0 faces +z, south). */
export type Plot = Rect & { id: string; facing: number };
export type Pallet = Point & { product: WorldProduct; units: number };
export type Yard = { warehouseId: string; building: Plot; docks: Point[]; pallets: Pallet[]; truckBays: Plot[] };
export type Store = { warehouseId: string; plot: Plot; display: Pallet[] };
export type Road = { a: Point; b: Point; width: number };

export type CityPlan = {
  districts: District[];
  roads: Road[];
  /** The street graph: nodes and, for each, its neighbours. */
  nodes: Point[];
  links: number[][];
  warehouses: Yard[];
  stores: Store[];
  hq: Plot;
  bank: Plot;
  /** A coin stack per account, on the bank's forecourt. */
  accounts: Array<Point & { id: string }>;
  office: Plot;
  tower: Plot;
  homes: { top: Plot[]; crowd: Plot[] };
  port: { quay: Rect; cranes: Point[]; berth: Point; containers: Point[] };
  china: { island: Rect; quay: Rect; berth: Point; cranes: Point[]; factories: Plot[] };
  /** The sea lane between the two berths. */
  lane: Point[];
  trees: Point[];
  lamps: Point[];
  /** Where each event's place is on the map: on the street in front of it. */
  places: Map<WorldPlace, Point>;
  /** The main island's extent. */
  island: Rect;
};

/** Small houses stand for customers up to this many; the count is in the card. */
export const CROWD_MAX = 120;
const ROAD = 12;
const SIDEWALK = 2.5;
const PALLET_STEP = 2.6;
const STORE_W = 14;
const STORE_D = 12;
const HOME_LOT = 11;
const FACTORY_LOT = 24;

/** A seeded random from a string, the same on every visit. */
function seeded(text: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const center = (r: Rect): Point => ({ x: r.x + r.w / 2, z: r.z + r.d / 2 });

/** Cells of a grid, row by row, filling `count`, `columns` wide, `step` apart, starting at (x0, z0). */
function cells(count: number, columns: number, stepX: number, stepZ: number, x0: number, z0: number): Point[] {
  return Array.from({ length: count }, (_, i) => ({ x: x0 + (i % columns) * stepX, z: z0 + Math.floor(i / columns) * stepZ }));
}

/** The pallets of a warehouse: every product with stock there; the first warehouse also shows the out-of-stock ones, empty. */
function palletsOf(data: WorldData, warehouseId: string, ghosts: boolean): Array<{ product: WorldProduct; units: number }> {
  return (data.stock?.products ?? [])
    .filter((p) => (p.byWarehouse[warehouseId] ?? 0) > 0 || (ghosts && p.units <= 0))
    .map((p) => ({ product: p, units: Math.max(0, p.byWarehouse[warehouseId] ?? 0) }));
}

export function planCity(data: WorldData): CityPlan {
  const stock = data.stock;
  const physical = stock?.warehouses.filter((w) => !w.virtual) ?? [];
  const partners = stock?.warehouses.filter((w) => w.virtual) ?? [];
  const accounts = data.finance?.accounts ?? [];
  const suppliers = data.suppliers?.suppliers ?? [];
  const top = data.customers?.top ?? [];
  const crowdCount = Math.min(CROWD_MAX, Math.max(0, (data.customers?.total ?? 0) - top.length));

  // ── Column widths (x) and row depths (z) from what each block holds ───────
  const PORT_W = 50;
  const CENTER_W = 92;
  const STORES_W = Math.max(70, STORE_D * 2 + 14 + 10);
  // The warehouse block: each physical warehouse a section, its hall, its truck yard and its pallets.
  const sections = physical.map((w, i) => {
    const items = palletsOf(data, w.id, i === 0);
    return { w, items };
  });
  const yardColumns = (count: number) => Math.max(8, Math.min(22, Math.ceil(Math.sqrt(count * 2.2))));
  const WAREHOUSE_W = Math.max(104, ...sections.map((s) => yardColumns(s.items.length) * PALLET_STEP + 24));
  const sectionDepth = (count: number, first: boolean) => (first ? 30 : 22) + 6 + 24 + Math.ceil(count / yardColumns(count)) * PALLET_STEP + 10;
  const warehouseDepth = sections.reduce((sum, s, i) => sum + sectionDepth(s.items.length, i === 0), 0);
  const storeRows = Math.ceil(partners.length / 2);
  const storesDepth = storeRows * (STORE_W + 5) + 12;
  const NORTH_D = 56;
  const MID_D = Math.max(124, warehouseDepth + 8, storesDepth);
  const homeColumnsTotal = Math.floor((PORT_W + WAREHOUSE_W + CENTER_W + STORES_W + ROAD * 3 - 12) / HOME_LOT);
  const crowdRows = Math.ceil(crowdCount / Math.max(1, homeColumnsTotal));
  const SOUTH_D = Math.max(40, 8 + 16 + crowdRows * HOME_LOT + 8);

  const width = PORT_W + ROAD + WAREHOUSE_W + ROAD + CENTER_W + ROAD + STORES_W + ROAD;
  const depth = ROAD + NORTH_D + ROAD + MID_D + ROAD + SOUTH_D + ROAD;
  const x0 = -width / 2;
  const z0 = -depth / 2;
  // Column starts.
  const xPort = x0;
  const xW = xPort + PORT_W + ROAD;
  const xC = xW + WAREHOUSE_W + ROAD;
  const xS = xC + CENTER_W + ROAD;
  // Road centre lines.
  const vx = [xW - ROAD / 2, xC - ROAD / 2, xS - ROAD / 2, xS + STORES_W + ROAD / 2];
  const zN = z0 + ROAD;
  const zM = zN + NORTH_D + ROAD;
  const zR = zM + MID_D + ROAD;
  const hz = [z0 + ROAD / 2, zM - ROAD / 2, zR - ROAD / 2, zR + SOUTH_D + ROAD / 2];
  const island: Rect = { x: x0 - 4, z: z0 - 4, w: width + 8, d: depth + 8 };

  // ── Roads ─────────────────────────────────────────────────────────────────
  const roads: Road[] = [];
  for (const x of vx) roads.push({ a: { x, z: hz[0] }, b: { x, z: hz[3] }, width: ROAD });
  for (const z of hz) roads.push({ a: { x: vx[0], z }, b: { x: vx[3], z }, width: ROAD });
  // The shopping street, down the middle of the stores' block.
  const storeStreetX = xS + STORES_W / 2;
  if (partners.length) roads.push({ a: { x: storeStreetX, z: hz[1] }, b: { x: storeStreetX, z: hz[2] }, width: 10 });
  // The port road, from the first avenue to the quay.
  const portRoadZ = zM + MID_D / 2;
  roads.push({ a: { x: xPort + 14, z: portRoadZ }, b: { x: vx[0], z: portRoadZ }, width: ROAD });

  // ── Districts ─────────────────────────────────────────────────────────────
  const districts: District[] = [];
  const add = (key: DistrictKey, rect: Rect) => districts.push({ key, label: DISTRICT_LABELS[key], rect, center: center(rect) });
  add('port', { x: xPort, z: zN, w: PORT_W, d: NORTH_D + ROAD + MID_D + ROAD + SOUTH_D });
  if (stock && physical.length) add('warehouse', { x: xW, z: zM, w: WAREHOUSE_W, d: MID_D });
  add('hq', { x: xC, z: zM, w: CENTER_W, d: MID_D });
  if (data.finance) add('treasury', { x: xC, z: zN, w: CENTER_W, d: NORTH_D });
  if (stock && partners.length) add('consignment', { x: xS, z: zM, w: STORES_W, d: MID_D });
  if (data.site) add('site', { x: xS, z: zN, w: STORES_W * 0.55, d: NORTH_D });
  add('office', { x: xS + STORES_W * 0.55, z: zN, w: STORES_W * 0.45, d: NORTH_D });
  if (data.customers) add('customers', { x: xW, z: zR, w: WAREHOUSE_W + ROAD + CENTER_W + ROAD + STORES_W, d: SOUTH_D });

  // ── The warehouse block: hall, docks, truck bays, pallets ─────────────────
  const warehouses: Yard[] = [];
  let sz = zM + 4;
  sections.forEach((s, i) => {
    const first = i === 0;
    const hallD = first ? 30 : 22;
    const hallW = Math.min(WAREHOUSE_W - 16, first ? 66 : 48);
    const hall: Plot = { id: s.w.id, x: xW + (WAREHOUSE_W - hallW) / 2, z: sz, w: hallW, d: hallD, facing: 0 };
    const doors = Math.max(3, Math.floor(hallW / 11));
    const docks = Array.from({ length: doors }, (_, k) => ({ x: hall.x + (hallW / doors) * (k + 0.5), z: hall.z + hallD }));
    const truckBays: Plot[] = docks.map((p, k) => ({ id: `${s.w.id}:bay${k}`, x: p.x - 2.3, z: p.z + 2, w: 4.6, d: 17, facing: Math.PI }));
    const columns = yardColumns(s.items.length);
    const yardTop = hall.z + hallD + 6 + 24;
    const yardLeft = xW + (WAREHOUSE_W - (columns - 1) * PALLET_STEP) / 2;
    const spots = cells(s.items.length, columns, PALLET_STEP, PALLET_STEP, yardLeft, yardTop);
    warehouses.push({ warehouseId: s.w.id, building: hall, docks, truckBays, pallets: s.items.map((it, k) => ({ ...spots[k], ...it })) });
    sz += sectionDepth(s.items.length, first);
  });

  // ── The shopping street: a partner's store on either side ─────────────────
  const stores: Store[] = partners.map((w, i) => {
    const west = i % 2 === 0;
    const row = Math.floor(i / 2);
    const zTop = zM + 8 + row * (STORE_W + 5);
    const x = west ? storeStreetX - 5 - STORE_D : storeStreetX + 5;
    return { warehouseId: w.id, plot: { id: w.id, x, z: zTop, w: STORE_D, d: STORE_W, facing: west ? Math.PI / 2 : -Math.PI / 2 }, display: [] };
  });

  // ── The centre: the bank and its coin stacks, the headquarters, the office, the tower ──
  const bank: Plot = { id: 'bank', x: xC + CENTER_W / 2 - 18, z: zN + 4, w: 36, d: 16, facing: 0 };
  const perRow = Math.min(8, Math.max(1, accounts.length));
  const coinSpots = cells(accounts.length, perRow, 6, 6, xC + CENTER_W / 2 - ((perRow - 1) * 6) / 2, bank.z + bank.d + 8);
  const hq: Plot = { id: 'hq', x: xC + CENTER_W / 2 - 16, z: zM + 10, w: 32, d: 24, facing: 0 };
  const tower: Plot = { id: 'site', x: xS + STORES_W * 0.275 - 11, z: zN + NORTH_D / 2 - 11, w: 22, d: 22, facing: 0 };
  const office: Plot = { id: 'office', x: xS + STORES_W * 0.775 - 10, z: zN + NORTH_D / 2 - 8, w: 20, d: 16, facing: 0 };

  // ── Homes: the best customers along the avenue, everyone else behind ──────
  const homesLeft = xW + 4;
  const topHomes: Plot[] = top.map((c, i) => ({ id: c.id, x: homesLeft + i * 15, z: zR + 4, w: 12, d: 12, facing: Math.PI }));
  const crowdColumns = Math.max(1, homeColumnsTotal);
  const crowd: Plot[] = cells(crowdCount, crowdColumns, HOME_LOT, HOME_LOT, homesLeft, zR + 24).map((p, i) => ({ id: `home${i}`, x: p.x, z: p.z, w: 8, d: 8, facing: Math.PI }));

  // ── The port: a quay on the west coast, cranes, stacked containers ────────
  const quay: Rect = { x: xPort, z: portRoadZ - 40, w: 12, d: 80 };
  const cranes = [-24, 0, 24].map((dz) => ({ x: xPort + 6, z: portRoadZ + dz }));
  const berth = { x: xPort - 16, z: portRoadZ };
  const containers = cells(24, 4, 3, 7, xPort + 22, portRoadZ - 40);

  // ── China: the suppliers' island across the water ─────────────────────────
  const fColumns = Math.max(1, Math.ceil(Math.sqrt(suppliers.length)));
  const fRows = Math.max(1, Math.ceil(suppliers.length / fColumns));
  const chinaW = Math.max(90, fColumns * FACTORY_LOT + 40);
  const chinaD = Math.max(100, fRows * FACTORY_LOT + 40);
  const chinaX = x0 - 150 - chinaW;
  const chinaIsland: Rect = { x: chinaX, z: portRoadZ - chinaD / 2, w: chinaW, d: chinaD };
  const chinaQuay: Rect = { x: chinaX + chinaW - 12, z: portRoadZ - 30, w: 12, d: 60 };
  const factories: Plot[] = cells(suppliers.length, fColumns, FACTORY_LOT, FACTORY_LOT, chinaX + 20, chinaIsland.z + 20).map((p, i) => ({ id: suppliers[i].id, x: p.x, z: p.z, w: 18, d: 16, facing: Math.PI / 2 }));
  const chinaBerth = { x: chinaX + chinaW + 16, z: portRoadZ };
  const chinaCranes = [-14, 14].map((dz) => ({ x: chinaX + chinaW - 6, z: portRoadZ + dz }));
  if (suppliers.length) add('suppliers', chinaIsland);
  const lane = [chinaBerth, { x: (chinaBerth.x + berth.x) / 2, z: portRoadZ - 26 }, berth];

  // ── Trees and lamps along the avenues ─────────────────────────────────────
  const random = seeded(`${width}x${depth}`);
  const trees: Point[] = [];
  const lamps: Point[] = [];
  for (const road of roads.slice(0, 8)) {
    const length = Math.hypot(road.b.x - road.a.x, road.b.z - road.a.z);
    const ux = (road.b.x - road.a.x) / length;
    const uz = (road.b.z - road.a.z) / length;
    const side = road.width / 2 + SIDEWALK * 0.6;
    for (let t = 14; t < length - 14; t += 18) {
      const near = (dx: number) => vx.some((x) => Math.abs(road.a.x + ux * t - x) < dx) && hz.some((z) => Math.abs(road.a.z + uz * t - z) < dx);
      if (near(14)) continue;
      const px = road.a.x + ux * t;
      const pz = road.a.z + uz * t;
      if (random() < 0.85) trees.push({ x: px - uz * side, z: pz + ux * side });
      if (Math.round(t / 18) % 2 === 0) lamps.push({ x: px + uz * side, z: pz - ux * side });
    }
  }
  // A few in the plazas.
  for (let i = 0; i < 6; i++) trees.push({ x: xC + 8 + random() * (CENTER_W - 16), z: zM + MID_D - 8 - random() * 30 });

  // ── The street graph ──────────────────────────────────────────────────────
  const graph = buildGraph(roads);

  // ── Where events go: the street in front of each place ────────────────────
  const places = new Map<WorldPlace, Point>();
  const onStreet = (p: Point) => graph.attach(p);
  places.set('hq', onStreet({ x: hq.x + hq.w / 2, z: zR - ROAD / 2 }));
  for (const y of warehouses) places.set(`wh:${y.warehouseId}`, onStreet({ x: vx[1], z: y.docks[0].z + 12 }));
  for (const s of stores) places.set(`wh:${s.warehouseId}`, onStreet({ x: storeStreetX, z: s.plot.z + s.plot.d / 2 }));
  places.set('site', onStreet({ x: tower.x + tower.w / 2, z: hz[1] }));
  places.set('customers', onStreet({ x: xW + (WAREHOUSE_W + CENTER_W) / 2, z: hz[2] }));
  places.set('treasury', onStreet({ x: bank.x + bank.w / 2, z: hz[1] }));
  places.set('out', onStreet({ x: vx[3], z: hz[3] }));
  places.set('port', onStreet({ x: xPort + 14, z: portRoadZ }));
  for (const f of factories) places.set(`sup:${f.id}`, { x: f.x + f.w / 2, z: f.z + f.d / 2 });

  return {
    districts,
    roads,
    nodes: graph.nodes,
    links: graph.links,
    warehouses,
    stores,
    hq,
    bank,
    accounts: coinSpots.map((p, i) => ({ ...p, id: accounts[i].id })),
    office,
    tower,
    homes: { top: topHomes, crowd },
    port: { quay, cranes, berth, containers },
    china: { island: chinaIsland, quay: chinaQuay, berth: chinaBerth, cranes: chinaCranes, factories },
    lane,
    trees,
    lamps,
    places,
    island,
  };
}

/**
 * The street graph: a node wherever two roads cross or a road ends, links along
 * each road between its consecutive nodes. attach() adds a node on the nearest
 * road for a place and returns its point.
 */
function buildGraph(roads: Road[]) {
  const nodes: Point[] = [];
  const links: number[][] = [];
  const key = (p: Point) => `${p.x.toFixed(2)},${p.z.toFixed(2)}`;
  const index = new Map<string, number>();
  const node = (p: Point) => {
    const k = key(p);
    let i = index.get(k);
    if (i === undefined) {
      i = nodes.length;
      nodes.push({ x: p.x, z: p.z });
      links.push([]);
      index.set(k, i);
    }
    return i;
  };
  const link = (a: number, b: number) => {
    if (a === b) return;
    if (!links[a].includes(b)) links[a].push(b);
    if (!links[b].includes(a)) links[b].push(a);
  };
  // Each road's points: its ends and where it meets every other road.
  const pointsOn = roads.map((r) => [r.a, r.b]);
  for (let i = 0; i < roads.length; i++) {
    for (let j = i + 1; j < roads.length; j++) {
      const hit = crossing(roads[i], roads[j]);
      if (hit) {
        pointsOn[i].push(hit);
        pointsOn[j].push(hit);
      }
    }
  }
  const segments: Array<[number, number]> = [];
  roads.forEach((r, i) => {
    const along = (p: Point) => (p.x - r.a.x) * (r.b.x - r.a.x) + (p.z - r.a.z) * (r.b.z - r.a.z);
    const ids = [...new Map(pointsOn[i].map((p) => [key(p), p])).values()].sort((p, q) => along(p) - along(q)).map(node);
    for (let k = 1; k < ids.length; k++) {
      link(ids[k - 1], ids[k]);
      segments.push([ids[k - 1], ids[k]]);
    }
  });
  const attach = (p: Point): Point => {
    let best: { s: [number, number]; q: Point; d: number } | null = null;
    for (const s of segments) {
      const q = nearestOnSegment(p, nodes[s[0]], nodes[s[1]]);
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (!best || d < best.d) best = { s, q, d };
    }
    if (!best) return p;
    const i = node(best.q);
    link(i, best.s[0]);
    link(i, best.s[1]);
    return nodes[i];
  };
  return { nodes, links, attach };
}

/** Where two axis-aligned roads cross, or null. */
function crossing(r: Road, s: Road): Point | null {
  const rv = Math.abs(r.a.x - r.b.x) < 1e-6;
  const sv = Math.abs(s.a.x - s.b.x) < 1e-6;
  if (rv === sv) return null;
  const v = rv ? r : s;
  const h = rv ? s : r;
  const x = v.a.x;
  const z = h.a.z;
  const within = (a: number, b: number, t: number) => t >= Math.min(a, b) - 1e-6 && t <= Math.max(a, b) + 1e-6;
  return within(h.a.x, h.b.x, x) && within(v.a.z, v.b.z, z) ? { x, z } : null;
}

function nearestOnSegment(p: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len));
  return { x: a.x + dx * t, z: a.z + dz * t };
}

/** The shortest way along the streets from one point to another (each snapped to its nearest node), as points. */
export function route(plan: Pick<CityPlan, 'nodes' | 'links'>, from: Point, to: Point): Point[] {
  const nearest = (p: Point) => {
    let best = 0;
    let d = Infinity;
    plan.nodes.forEach((n, i) => {
      const e = Math.hypot(n.x - p.x, n.z - p.z);
      if (e < d) {
        d = e;
        best = i;
      }
    });
    return best;
  };
  const start = nearest(from);
  const goal = nearest(to);
  const dist = new Array(plan.nodes.length).fill(Infinity);
  const prev = new Array<number>(plan.nodes.length).fill(-1);
  const done = new Array<boolean>(plan.nodes.length).fill(false);
  dist[start] = 0;
  for (let round = 0; round < plan.nodes.length; round++) {
    let u = -1;
    for (let i = 0; i < dist.length; i++) if (!done[i] && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0 || dist[u] === Infinity) break;
    if (u === goal) break;
    done[u] = true;
    for (const v of plan.links[u]) {
      const w = dist[u] + Math.hypot(plan.nodes[u].x - plan.nodes[v].x, plan.nodes[u].z - plan.nodes[v].z);
      if (w < dist[v]) {
        dist[v] = w;
        prev[v] = u;
      }
    }
  }
  if (dist[goal] === Infinity) return [from, to];
  const path: Point[] = [];
  for (let at = goal; at >= 0; at = prev[at]) path.unshift(plan.nodes[at]);
  const way = [from, ...path, to].filter((p, i, all) => i === 0 || Math.hypot(p.x - all[i - 1].x, p.z - all[i - 1].z) > 0.01);
  // Somewhere to itself: stay put.
  return way.length > 1 ? way : [from, to];
}

/** A point at distance `s` along a path (clamped), and the heading there (radians about y, 0 = +z). */
export function along(path: Point[], s: number): { p: Point; heading: number } {
  let left = Math.max(0, s);
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (left <= len || i === path.length - 1) {
      const t = len ? Math.min(1, left / len) : 1;
      return { p: { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }, heading: Math.atan2(b.x - a.x, b.z - a.z) };
    }
    left -= len;
  }
  return { p: path[path.length - 1] ?? { x: 0, z: 0 }, heading: 0 };
}

export function pathLength(path: Point[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
  return total;
}
