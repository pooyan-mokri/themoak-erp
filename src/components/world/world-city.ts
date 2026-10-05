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
/** A partner's store: its plot (building and forecourt), the building, and a crate column per product in front. */
export type Size = 'large' | 'medium' | 'small';
export type Store = { warehouseId: string; plot: Plot; building: Plot; display: Pallet[]; size: Size };
export type HomeKind = 'mansion' | 'villa' | 'house' | 'terrace' | 'apartment';
/** A home's lot; a terrace or an apartment block houses several customers. */
export type Home = Plot & { kind: HomeKind; residents: string[]; tier: number };
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
  /** The headquarters' plaza: the fountain, a bar per day of sales, the best sellers' podium. */
  plaza: { fountain: Point; days: Array<Point & { id: string }>; podium: Array<Point & { id: string }>; billboard: Point };
  /** Beside the bank: a bar per category of revenue (west) and of expense (east). */
  flows: { income: Array<Point & { id: string }>; expense: Array<Point & { id: string }> };
  /** A coin stack per account, on the bank's forecourt. */
  accounts: Array<Point & { id: string }>;
  office: Plot;
  tower: Plot;
  /** Where the customers live, by tier: mansions, villas, houses, terraced rows, apartment blocks in the town. */
  homes: Home[];
  /** The residential quarters, for their signs. */
  quarters: Array<{ label: string; rect: Rect }>;
  port: { quay: Rect; cranes: Point[]; berth: Point; containers: Point[] };
  china: { island: Rect; quay: Rect; berth: Point; cranes: Point[]; factories: Array<Plot & { size: Size }> };
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
const ROAD = 12;
const SIDEWALK = 2.5;
const PALLET_STEP = 2.6;
const STORE_W = 14;
const STORE_D = 12;
/** In front of each store: its stock on show, a column per product. */
const FORECOURT = 8;
const SHOW_STEP = 0.9;
const SHOW_ROWS = 6;
/** Each kind of home's lot (width along the street, depth) and how many customers it houses. */
const LOTS: Record<HomeKind, { w: number; d: number; holds: number }> = {
  mansion: { w: 34, d: 30, holds: 1 },
  villa: { w: 24, d: 22, holds: 1 },
  house: { w: 15, d: 15, holds: 1 },
  terrace: { w: 44, d: 14, holds: 6 },
  apartment: { w: 20, d: 18, holds: 24 },
};
const FACTORY: Record<Size, { lot: number; w: number; d: number }> = {
  large: { lot: 34, w: 28, d: 22 },
  medium: { lot: 26, w: 20, d: 16 },
  small: { lot: 19, w: 14, d: 12 },
};
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

type Quarter = 'villas' | 'terraces' | 'town';
const quarterOf = (kind: HomeKind): Quarter => (kind === 'terrace' ? 'terraces' : kind === 'apartment' ? 'town' : 'villas');
const QUARTER_LABELS: Record<Quarter, string> = { villas: 'ویلاها', terraces: 'خانه‌های شهری', town: 'شهرک' };

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

/** The best third by `measure` large, the next third medium, the rest small (ties keep their order). */
export function sizesBy<T>(items: T[], measure: (t: T) => number): Map<T, Size> {
  const ranked = [...items].sort((a, b) => measure(b) - measure(a));
  const third = Math.max(1, Math.ceil(items.length / 3));
  return new Map(ranked.map((t, i) => [t, i < third ? 'large' : i < third * 2 ? 'medium' : 'small']));
}

/** Lays rectangles out left to right in rows `width` wide, a new row also wherever `breakBefore` says. */
function flow<T extends { w: number; d: number }>(items: T[], width: number, gap: number, breakBefore: (t: T, i: number) => boolean = () => false) {
  const placed: Array<T & { x: number; z: number }> = [];
  let x = 0;
  let z = 0;
  let row = 0;
  items.forEach((it, i) => {
    if (i > 0 && (x + it.w > width || breakBefore(it, i))) {
      z += row + gap;
      x = 0;
      row = 0;
    }
    placed.push({ ...it, x, z });
    x += it.w + gap;
    row = Math.max(row, it.d);
  });
  return { placed, depth: items.length ? z + row : 0 };
}

export function planCity(data: WorldData): CityPlan {
  const stock = data.stock;
  const physical = stock?.warehouses.filter((w) => !w.virtual) ?? [];
  const partners = stock?.warehouses.filter((w) => w.virtual) ?? [];
  const accounts = data.finance?.accounts ?? [];
  const suppliers = data.suppliers?.suppliers ?? [];

  // ── Column widths (x) and row depths (z) from what each block holds ───────
  const PORT_W = 50;
  const CENTER_W = 92;
  // A partner's store is as big as it matters to us: its sales of 90 days, else the stock it holds.
  const storeSize = sizesBy(partners, (w) => w.sales90 ?? w.units);
  const STORE: Record<Size, { depth: number; front: number }> = { large: { depth: 15, front: 22 }, medium: { depth: STORE_D, front: STORE_W + 2 }, small: { depth: 9, front: 11 } };
  const STORES_W = Math.max(70, (STORE.large.depth + FORECOURT) * 2 + 14);
  // Each store's frontage: its size's, or wider when it needs room for a column per product in its forecourt.
  const showing = (id: string) => (stock?.products ?? []).filter((p) => (p.byWarehouse[id] ?? 0) > 0);
  const sizeOf = (id: string): Size => storeSize.get(partners.find((w) => w.id === id)!) ?? 'medium';
  const frontage = (id: string) => Math.max(STORE[sizeOf(id)].front, Math.ceil(showing(id).length / SHOW_ROWS) * SHOW_STEP + 3);
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
  const rowDepth = (row: number) => Math.max(...partners.slice(row * 2, row * 2 + 2).map((w) => frontage(w.id)), STORE_W) + 5;
  const storesDepth = Array.from({ length: storeRows }, (_, r) => rowDepth(r)).reduce((a, b) => a + b, 0) + 12;
  const NORTH_D = 56;
  const MID_D = Math.max(124, warehouseDepth + 8, storesDepth);
  // The homes: by tier, the best alone on big lots, the rest together in terraces and apartment blocks.
  const people = data.customers?.people ?? [];
  const homeItems: Array<{ w: number; d: number; kind: HomeKind; residents: string[]; tier: number }> = [];
  const alone = (tier: number, kind: HomeKind) => {
    for (const c of people.filter((p) => p.tier === tier)) homeItems.push({ ...LOTS[kind], kind, residents: [c.id], tier });
  };
  const together = (tiers: number[], kind: HomeKind) => {
    const group = people.filter((p) => tiers.includes(p.tier));
    for (let i = 0; i < group.length; i += LOTS[kind].holds) {
      const residents = group.slice(i, i + LOTS[kind].holds);
      homeItems.push({ ...LOTS[kind], kind, residents: residents.map((c) => c.id), tier: Math.min(...residents.map((c) => c.tier)) });
    }
  };
  alone(1, 'mansion');
  alone(2, 'villa');
  alone(3, 'house');
  together([4], 'terrace');
  together([5, 6], 'apartment');
  const homesWidth = WAREHOUSE_W + ROAD + CENTER_W + ROAD + STORES_W - 16;
  const homeFlow = flow(homeItems, homesWidth, 4, (it, i) => i > 0 && quarterOf(homeItems[i - 1].kind) !== quarterOf(it.kind));
  // A quarter's sign row between quarters.
  const quarterBreaks = homeFlow.placed.filter((h, i) => i > 0 && quarterOf(homeFlow.placed[i - 1].kind) !== quarterOf(h.kind)).length;
  const SOUTH_D = Math.max(40, 10 + homeFlow.depth + quarterBreaks * 8 + 10);

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
  const rowTops: number[] = [];
  for (let r = 0, z = zM + 8; r < storeRows; r++) {
    rowTops.push(z);
    z += rowDepth(r);
  }
  const stores: Store[] = partners.map((w, i) => {
    const west = i % 2 === 0;
    const row = Math.floor(i / 2);
    const zTop = rowTops[row];
    const size = sizeOf(w.id);
    const width = frontage(w.id);
    const deep = STORE[size].depth;
    const depth = deep + FORECOURT;
    const x = west ? storeStreetX - 5 - depth : storeStreetX + 5;
    const facing = west ? Math.PI / 2 : -Math.PI / 2;
    const building: Plot = { id: w.id, x: west ? x : x + FORECOURT, z: zTop, w: deep, d: width, facing };
    // The forecourt's columns: rows outward from the shop window, along the frontage.
    const items = showing(w.id);
    const perRow = Math.max(1, Math.floor((width - 3) / SHOW_STEP));
    const display = items.map((p, k) => {
      const out = 1.3 + Math.floor(k / perRow) * SHOW_STEP;
      return {
        x: west ? x + deep + out : x + FORECOURT - out,
        z: zTop + 1.5 + (k % perRow) * SHOW_STEP + SHOW_STEP / 2,
        product: p,
        units: p.byWarehouse[w.id] ?? 0,
      };
    });
    return { warehouseId: w.id, plot: { id: w.id, x, z: zTop, w: depth, d: width, facing }, building, display, size };
  });

  // ── The centre: the bank and its coin stacks, the headquarters, the office, the tower ──
  const bank: Plot = { id: 'bank', x: xC + CENTER_W / 2 - 18, z: zN + 4, w: 36, d: 16, facing: 0 };
  const perRow = Math.min(8, Math.max(1, accounts.length));
  const coinSpots = cells(accounts.length, perRow, 6, 6, xC + CENTER_W / 2 - ((perRow - 1) * 6) / 2, bank.z + bank.d + 8);
  const hq: Plot = { id: 'hq', x: xC + CENTER_W / 2 - 16, z: zM + 10, w: 32, d: 24, facing: 0 };
  // The plaza south of the headquarters: the fountain, the best sellers' podium, a bar per day of sales.
  const days = data.sales?.days ?? [];
  const tops = data.sales?.topProducts ?? [];
  const midX = xC + CENTER_W / 2;
  const plaza = {
    fountain: { x: midX, z: zM + 46 },
    podium: tops.map((t, i) => ({ id: t.id, x: midX - ((tops.length - 1) * 5.4) / 2 + i * 5.4, z: zM + 66 })),
    days: days.map((d, i) => ({ id: d.day, x: midX - ((days.length - 1) * 2.2) / 2 + i * 2.2, z: zM + MID_D - 16 })),
    billboard: { x: hq.x + hq.w + 12, z: hq.z + hq.d / 2 },
  };
  const incomes = data.finance?.flows.income ?? [];
  const expenses = data.finance?.flows.expense ?? [];
  const flowAt = (k: number, side: -1 | 1) => ({ x: midX + side * (22 + (k % 4) * 4), z: zN + 12 + Math.floor(k / 4) * 6 });
  const flows = {
    income: incomes.map((f, k) => ({ id: f.category, ...flowAt(k, -1) })),
    expense: expenses.map((f, k) => ({ id: f.category, ...flowAt(k, 1) })),
  };
  const tower: Plot = { id: 'site', x: xS + STORES_W * 0.275 - 11, z: zN + NORTH_D / 2 - 11, w: 22, d: 22, facing: 0 };
  const office: Plot = { id: 'office', x: xS + STORES_W * 0.775 - 10, z: zN + NORTH_D / 2 - 8, w: 20, d: 16, facing: 0 };

  // ── Homes: the best customers along the avenue, everyone else behind ──────
  const homesLeft = xW + 8;
  const homes: Home[] = [];
  const quarters: Array<{ label: string; rect: Rect }> = [];
  let shift = 0;
  homeFlow.placed.forEach((h, i) => {
    const quarter = quarterOf(h.kind);
    if (i === 0 || quarterOf(homeFlow.placed[i - 1].kind) !== quarter) {
      if (i > 0) shift += 8;
      quarters.push({ label: QUARTER_LABELS[quarter], rect: { x: homesLeft, z: zR + 10 + h.z + shift - 7, w: homesWidth, d: 6 } });
    }
    const id = h.residents.length === 1 && (h.kind === 'mansion' || h.kind === 'villa' || h.kind === 'house') ? h.residents[0] : `${h.kind}:${i}`;
    homes.push({ id, x: homesLeft + h.x, z: zR + 10 + h.z + shift, w: h.w, d: h.d, facing: Math.PI, kind: h.kind, residents: h.residents, tier: h.tier });
  });

  // ── The port: a quay on the west coast, cranes, stacked containers ────────
  const quay: Rect = { x: xPort, z: portRoadZ - 40, w: 12, d: 80 };
  const cranes = [-24, 0, 24].map((dz) => ({ x: xPort + 6, z: portRoadZ + dz }));
  const berth = { x: xPort - 16, z: portRoadZ };
  const containers = cells(24, 4, 3, 7, xPort + 22, portRoadZ - 40);

  // ── China: the suppliers' island across the water ─────────────────────────
  const factorySize = sizesBy(suppliers, (s) => s.volume ?? s.orders);
  const factoryRow = Math.max(70, Math.ceil(Math.sqrt(suppliers.length)) * FACTORY.large.lot);
  const factoryFlow = flow(suppliers.map((s) => ({ id: s.id, size: factorySize.get(s)!, w: FACTORY[factorySize.get(s)!].lot, d: FACTORY[factorySize.get(s)!].lot })), factoryRow, 4);
  const chinaW = Math.max(90, factoryRow + 40);
  const chinaD = Math.max(100, factoryFlow.depth + 40);
  const chinaX = x0 - 150 - chinaW;
  const chinaIsland: Rect = { x: chinaX, z: portRoadZ - chinaD / 2, w: chinaW, d: chinaD };
  const chinaQuay: Rect = { x: chinaX + chinaW - 12, z: portRoadZ - 30, w: 12, d: 60 };
  const factories: Array<Plot & { size: Size }> = factoryFlow.placed.map((f) => {
    const dims = FACTORY[f.size];
    return { id: f.id, size: f.size, x: chinaX + 20 + f.x + (f.w - dims.w) / 2, z: chinaIsland.z + 20 + f.z + (f.d - dims.d) / 2, w: dims.w, d: dims.d, facing: Math.PI / 2 };
  });
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
  // A few along the plaza's edges, clear of its bars and podium.
  for (let i = 0; i < 8; i++) trees.push({ x: i % 2 ? xC + 4 : xC + CENTER_W - 4, z: zM + 44 + random() * (MID_D - 64) });

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
    plaza,
    flows,
    accounts: coinSpots.map((p, i) => ({ ...p, id: accounts[i].id })),
    office,
    tower,
    homes,
    quarters,
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
