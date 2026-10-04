/**
 * Where everything stands on the business world's map (/dashboard/world): pure
 * geometry from a snapshot (src/lib/world-types.ts), no three.js, so it can be
 * tested. The ground is the x–z plane; y is up. The headquarters stand at the
 * centre and every district around them, each sized to what it holds and pushed
 * out until none overlaps another, so any number of products, partners,
 * suppliers or customers fits.
 */
import type { WorldData, WorldPlace, WorldProduct } from '@/lib/world-types';

export type DistrictKey = 'hq' | 'treasury' | 'site' | 'consignment' | 'market' | 'customers' | 'suppliers' | 'warehouse' | 'office';

export type Point = { x: number; z: number };

export type District = {
  key: DistrictKey;
  label: string;
  center: Point;
  /** Full width (x) and depth (z) of its ground tile. */
  width: number;
  depth: number;
};

export type Slot = Point & { id: string };

export type Yard = {
  warehouseId: string;
  /** The building. */
  building: Point & { width: number; depth: number };
  /** One crate column per product, in rows in front of the building. */
  columns: Array<Point & { product: WorldProduct; units: number }>;
};

export type WorldPlan = {
  districts: District[];
  /** Roads from the headquarters to every district. */
  roads: Array<{ from: Point; to: Point; key: DistrictKey }>;
  /** Physical warehouses with their yards (the warehouse district). */
  warehouses: Yard[];
  /** Consignment partners' stores (the consignment district). */
  stores: Yard[];
  accounts: Slot[];
  flows: { income: Slot[]; expense: Slot[] };
  /** The kiosks of the three channels, the best sellers' podium and the last days' skyline. */
  market: { channels: Slot[]; podium: Slot[]; days: Slot[] };
  suppliers: Slot[];
  /** The best customers' houses, then the small houses of everyone else. */
  customers: { top: Slot[]; crowd: Point[] };
  site: Point;
  office: Point;
  kpis: Slot[];
  /** Where money spent goes: a drain beside the treasury. */
  out: Point;
  /** Every place an event can travel between. */
  places: Map<WorldPlace, Point>;
  /** Half the ground's extent: the island is 2·halfX by 2·halfZ. */
  halfX: number;
  halfZ: number;
};

/** The small houses stand for customers up to this many; the count is in the label. */
export const CROWD_MAX = 160;
const HQ_RADIUS = 9;
const GAP = 4;
const COLUMN = 1.25;
const STORE_COLUMN = 0.9;

/** Directions from the centre, one per district. */
const DIRECTIONS: Record<Exclude<DistrictKey, 'hq'>, Point> = {
  treasury: { x: 0, z: -1 },
  site: { x: 0.78, z: -0.78 },
  consignment: { x: 1, z: 0 },
  market: { x: 0.78, z: 0.78 },
  customers: { x: 0, z: 1 },
  suppliers: { x: -0.78, z: 0.78 },
  warehouse: { x: -1, z: 0 },
  office: { x: -0.78, z: -0.78 },
};

export const DISTRICT_LABELS: Record<DistrictKey, string> = {
  hq: 'دفتر مرکزی',
  treasury: 'خزانه',
  site: 'وب‌سایت',
  consignment: 'فروشگاه‌های امانی',
  market: 'بازار فروش',
  customers: 'محلهٔ مشتری‌ها',
  suppliers: 'تأمین‌کننده‌ها',
  warehouse: 'انبار',
  office: 'دفتر پروژه‌ها',
};

function grid(count: number, columns: number, spacing: number, origin: Point): Point[] {
  const rows = Math.ceil(count / Math.max(1, columns));
  const width = (Math.max(1, Math.min(count, columns)) - 1) * spacing;
  const depth = (rows - 1) * spacing;
  return Array.from({ length: count }, (_, i) => ({
    x: origin.x - width / 2 + (i % columns) * spacing,
    z: origin.z - depth / 2 + Math.floor(i / columns) * spacing,
  }));
}

function overlaps(a: District, b: District): boolean {
  return (
    Math.abs(a.center.x - b.center.x) * 2 < a.width + b.width + GAP * 2 &&
    Math.abs(a.center.z - b.center.z) * 2 < a.depth + b.depth + GAP * 2
  );
}

/** A yard: the building behind, the crate columns in rows in front (toward +z). */
function yard(warehouseId: string, items: Array<{ product: WorldProduct; units: number }>, spacing: number, buildingSize: number): { yard: Yard; width: number; depth: number } {
  const columns = Math.max(1, Math.ceil(Math.sqrt(items.length * 1.4)));
  const rows = Math.ceil(items.length / columns);
  const yardWidth = Math.max(buildingSize, columns * spacing);
  const yardDepth = rows * spacing;
  const depth = buildingSize + 1.5 + yardDepth;
  const top = -depth / 2;
  const cells = grid(items.length, columns, spacing, { x: 0, z: top + buildingSize + 1.5 + yardDepth / 2 });
  return {
    yard: {
      warehouseId,
      building: { x: 0, z: top + buildingSize / 2, width: buildingSize * 1.4, depth: buildingSize },
      columns: items.map((item, i) => ({ ...cells[i], ...item })),
    },
    width: yardWidth + 2,
    depth: depth + 2,
  };
}

function shift<T extends Point>(p: T, by: Point): T {
  return { ...p, x: p.x + by.x, z: p.z + by.z };
}

export function planWorld(data: WorldData): WorldPlan {
  const sizes = new Map<DistrictKey, { width: number; depth: number }>();
  sizes.set('hq', { width: HQ_RADIUS * 2, depth: HQ_RADIUS * 2 });

  // Warehouses: physical ones side by side in the warehouse district, each partner's store in the consignment one.
  const stock = data.stock;
  const physical = stock?.warehouses.filter((w) => !w.virtual) ?? [];
  const virtual = stock?.warehouses.filter((w) => w.virtual) ?? [];
  const productsAt = (id: string, ghosts: boolean) =>
    (stock?.products ?? [])
      .filter((p) => (p.byWarehouse[id] ?? 0) > 0 || (ghosts && p.units <= 0))
      .map((p) => ({ product: p, units: Math.max(0, p.byWarehouse[id] ?? 0) }));

  const physicalYards = physical.map((w, i) => yard(w.id, productsAt(w.id, i === 0), COLUMN, 6));
  const storeYards = virtual.map((w) => yard(w.id, productsAt(w.id, false), STORE_COLUMN, 3.2));
  const rowOf = <T extends { width: number; depth: number }>(items: T[], perRow: number) => {
    const rows: T[][] = [];
    items.forEach((item, i) => (rows[Math.floor(i / perRow)] ??= []).push(item));
    return rows;
  };
  const block = (yards: Array<{ width: number; depth: number }>, perRow: number) => {
    const rows = rowOf(yards, perRow);
    const width = Math.max(0, ...rows.map((r) => r.reduce((s, y) => s + y.width, 0)));
    const depth = rows.reduce((s, r) => s + Math.max(...r.map((y) => y.depth)), 0);
    return { rows, width, depth };
  };
  const warehouseBlock = block(physicalYards, 2);
  const storeBlock = block(storeYards, Math.max(1, Math.ceil(Math.sqrt(storeYards.length))));
  if (stock && physicalYards.length) sizes.set('warehouse', { width: warehouseBlock.width + 2, depth: warehouseBlock.depth + 2 });
  if (stock && storeYards.length) sizes.set('consignment', { width: storeBlock.width + 2, depth: storeBlock.depth + 2 });

  const accounts = data.finance?.accounts ?? [];
  const flowCount = Math.max(data.finance?.flows.income.length ?? 0, data.finance?.flows.expense.length ?? 0);
  if (data.finance) {
    const accountRow = Math.min(8, Math.max(1, accounts.length));
    sizes.set('treasury', {
      width: Math.max(accountRow * 3.2, flowCount * 2.2) + 4,
      depth: Math.ceil(Math.max(1, accounts.length) / 8) * 3.6 + 9,
    });
  }
  if (data.site) sizes.set('site', { width: 12, depth: 12 });
  if (data.sales) sizes.set('market', { width: Math.max(26, (data.sales.days.length + 2) * 0.75), depth: 18 });
  if (data.customers) {
    const crowd = Math.min(CROWD_MAX, Math.max(0, data.customers.total - data.customers.top.length));
    const crowdColumns = Math.max(6, Math.ceil(Math.sqrt(crowd * 2)));
    sizes.set('customers', { width: Math.max(5 * 3.2, crowdColumns * 1.4) + 4, depth: 7 + Math.ceil(crowd / crowdColumns) * 1.4 + 3 });
  }
  const supplierList = data.suppliers?.suppliers ?? [];
  if (data.suppliers) {
    const perRow = Math.max(1, Math.ceil(Math.sqrt(supplierList.length)));
    sizes.set('suppliers', { width: Math.max(1, perRow) * 6 + 3, depth: Math.max(1, Math.ceil(supplierList.length / perRow)) * 6 + 3 });
  }
  sizes.set('office', { width: 10, depth: 10 });

  // Place each district along its direction, then push the later ones out until none overlaps.
  const order: DistrictKey[] = ['treasury', 'warehouse', 'consignment', 'customers', 'site', 'market', 'suppliers', 'office'];
  const districts: District[] = [{ key: 'hq', label: DISTRICT_LABELS.hq, center: { x: 0, z: 0 }, ...sizes.get('hq')! }];
  for (const key of order) {
    const size = sizes.get(key);
    if (!size) continue;
    const dir = DIRECTIONS[key as Exclude<DistrictKey, 'hq'>];
    const length = Math.hypot(dir.x, dir.z);
    const unit = { x: dir.x / length, z: dir.z / length };
    // Out far enough that its edge clears the headquarters' plaza.
    const reach = Math.abs(unit.x) * size.width / 2 + Math.abs(unit.z) * size.depth / 2;
    let radius = HQ_RADIUS + GAP + reach;
    const district: District = { key, label: DISTRICT_LABELS[key], center: { x: unit.x * radius, z: unit.z * radius }, ...size };
    for (let guard = 0; guard < 400 && districts.some((d) => overlaps(d, district)); guard++) {
      radius += 1;
      district.center = { x: unit.x * radius, z: unit.z * radius };
    }
    districts.push(district);
  }
  const at = (key: DistrictKey) => districts.find((d) => d.key === key);

  // Warehouses and stores, laid out row by row inside their districts.
  const placeBlock = (key: DistrictKey, built: ReturnType<typeof block>, yards: Array<ReturnType<typeof yard>>) => {
    const d = at(key);
    if (!d) return [] as Yard[];
    const out: Yard[] = [];
    let z = d.center.z - built.depth / 2;
    let index = 0;
    for (const row of built.rows) {
      const rowWidth = row.reduce((s, y) => s + y.width, 0);
      const rowDepth = Math.max(...row.map((y) => y.depth));
      let x = d.center.x - rowWidth / 2;
      for (const item of row) {
        const offset = { x: x + item.width / 2, z: z + rowDepth / 2 };
        const y = yards[index++].yard;
        out.push({
          warehouseId: y.warehouseId,
          building: shift(y.building, offset),
          columns: y.columns.map((c) => shift(c, offset)),
        });
        x += item.width;
      }
      z += rowDepth;
    }
    return out;
  };
  const warehouses = placeBlock('warehouse', warehouseBlock, physicalYards);
  const stores = placeBlock('consignment', storeBlock, storeYards);

  const treasury = at('treasury');
  const accountSlots: Slot[] = treasury
    ? grid(accounts.length, 8, 3.2, { x: treasury.center.x, z: treasury.center.z - treasury.depth / 2 + 2.5 + (Math.ceil(accounts.length / 8) - 1) * 1.8 }).map((p, i) => ({ ...p, id: accounts[i].id }))
    : [];
  const flowRow = (items: Array<{ category: string }>, z: number) =>
    treasury ? grid(items.length, Math.max(1, items.length), 2.2, { x: treasury.center.x, z }).map((p, i) => ({ ...p, id: items[i].category })) : [];
  const flows = {
    income: flowRow(data.finance?.flows.income ?? [], treasury ? treasury.center.z + treasury.depth / 2 - 5 : 0),
    expense: flowRow(data.finance?.flows.expense ?? [], treasury ? treasury.center.z + treasury.depth / 2 - 2.2 : 0),
  };

  const market = at('market');
  const marketPlan = { channels: [] as Slot[], podium: [] as Slot[], days: [] as Slot[] };
  if (market && data.sales) {
    marketPlan.channels = grid(data.sales.channels.length, 3, 6, { x: market.center.x, z: market.center.z - 5 }).map((p, i) => ({ ...p, id: data.sales!.channels[i].channel }));
    marketPlan.podium = grid(data.sales.topProducts.length, Math.max(1, data.sales.topProducts.length), 1.8, { x: market.center.x, z: market.center.z + 1 }).map((p, i) => ({ ...p, id: data.sales!.topProducts[i].id }));
    marketPlan.days = grid(data.sales.days.length, Math.max(1, data.sales.days.length), 0.75, { x: market.center.x, z: market.center.z + 6 }).map((p, i) => ({ ...p, id: data.sales!.days[i].day }));
  }

  const supplierDistrict = at('suppliers');
  const supplierSlots: Slot[] = supplierDistrict
    ? grid(supplierList.length, Math.max(1, Math.ceil(Math.sqrt(supplierList.length))), 6, supplierDistrict.center).map((p, i) => ({ ...p, id: supplierList[i].id }))
    : [];

  const customerDistrict = at('customers');
  const customers = { top: [] as Slot[], crowd: [] as Point[] };
  if (customerDistrict && data.customers) {
    const top = data.customers.top;
    customers.top = grid(top.length, 5, 3.2, { x: customerDistrict.center.x, z: customerDistrict.center.z - customerDistrict.depth / 2 + 3.5 + (Math.ceil(top.length / 5) - 1) * 1.6 }).map((p, i) => ({ ...p, id: top[i].id }));
    const crowd = Math.min(CROWD_MAX, Math.max(0, data.customers.total - top.length));
    const crowdColumns = Math.max(6, Math.ceil(Math.sqrt(crowd * 2)));
    const rows = Math.ceil(crowd / crowdColumns);
    customers.crowd = grid(crowd, crowdColumns, 1.4, { x: customerDistrict.center.x, z: customerDistrict.center.z + customerDistrict.depth / 2 - 1.5 - (rows * 1.4) / 2 });
  }

  const siteDistrict = at('site');
  const officeDistrict = at('office')!;
  const site = siteDistrict ? siteDistrict.center : { x: 0, z: 0 };
  const office = officeDistrict.center;
  const out = treasury ? { x: treasury.center.x + treasury.width / 2 + 3, z: treasury.center.z } : { x: 0, z: -HQ_RADIUS - 6 };

  const kpis: Slot[] = [];
  const kpiIds = [data.sales && 'today', data.profit && 'profit', data.finance && 'balance', data.stock && 'stock'].filter(Boolean) as string[];
  kpiIds.forEach((id, i) => {
    const angle = Math.PI * 0.75 + (i / Math.max(1, kpiIds.length)) * Math.PI * 2;
    kpis.push({ id, x: Math.cos(angle) * 5.6, z: Math.sin(angle) * 5.6 });
  });

  const places = new Map<WorldPlace, Point>();
  places.set('hq', { x: 0, z: 0 });
  for (const y of [...warehouses, ...stores]) places.set(`wh:${y.warehouseId}`, { x: y.building.x, z: y.building.z + y.building.depth / 2 + 0.8 });
  for (const s of supplierSlots) places.set(`sup:${s.id}`, { x: s.x, z: s.z + 2.5 });
  places.set('site', siteDistrict ? { x: site.x, z: site.z + 3 } : { x: 0, z: 0 });
  places.set('customers', customerDistrict ? { x: customerDistrict.center.x, z: customerDistrict.center.z - customerDistrict.depth / 2 + 1 } : { x: 0, z: 0 });
  places.set('treasury', treasury ? { x: treasury.center.x, z: treasury.center.z + treasury.depth / 2 - 0.8 } : { x: 0, z: 0 });
  places.set('out', out);

  const roads = districts.filter((d) => d.key !== 'hq').map((d) => ({ from: { x: 0, z: 0 }, to: d.center, key: d.key }));
  const halfX = Math.max(...districts.map((d) => Math.abs(d.center.x) + d.width / 2), Math.abs(out.x) + 2) + 6;
  const halfZ = Math.max(...districts.map((d) => Math.abs(d.center.z) + d.depth / 2)) + 6;

  return { districts, roads, warehouses, stores, accounts: accountSlots, flows, market: marketPlan, suppliers: supplierSlots, customers, site, office, kpis, out, places, halfX, halfZ };
}

/** The point on the way from one place to another, through the headquarters' plaza, at t in [0, 1]. */
export function pathPoint(from: Point, to: Point, t: number): Point {
  if (from.x === to.x && from.z === to.z) return from;
  const legA = Math.hypot(from.x, from.z);
  const legB = Math.hypot(to.x, to.z);
  const total = legA + legB || 1;
  const d = Math.min(1, Math.max(0, t)) * total;
  if (d <= legA) {
    const k = legA ? 1 - d / legA : 0;
    return { x: from.x * k, z: from.z * k };
  }
  const k = legB ? (d - legA) / legB : 1;
  return { x: to.x * k, z: to.z * k };
}
