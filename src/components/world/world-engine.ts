/**
 * The business world's 3D engine: a minimal isometric island drawn from a
 * snapshot (src/lib/world-types.ts) and its plan (world-layout.ts), with a small
 * figure in sunglasses to walk around it. Imperative three.js, client only;
 * world-client.tsx owns it and draws the panels around it.
 *
 * Every thing that can be picked carries an id (world-describe.ts reads it):
 * district:<key>, warehouse:<id>, product:<warehouseId>:<productId>,
 * account:<id>, flow:<income|expense>:<category>, channel:<c>, top:<productId>,
 * day:<yyyy-mm-dd>, supplier:<id>, customer:<id>, crowd, site, office, out,
 * kpi:<today|profit|balance|stock>.
 */
import * as THREE from 'three';
import { pathPoint, planWorld, type DistrictKey, type Point, type WorldPlan } from '@/components/world/world-layout';
import type { WorldData, WorldEvent } from '@/lib/world-types';

type Palette = {
  sky: number; sea: number; island: number; islandSide: number; road: number; plaza: number;
  tiles: Record<DistrictKey, number>;
  wall: number; roof: number; door: number; glass: number; text: string; labelBg: string;
  gold: number; usd: number; eur: number; income: number; expense: number; ghost: number;
  site: number; shop: number; consignment: number; factory: number; house: number; roofWarm: number; roofDebt: number;
  crowdOn: number; crowdOff: number; skin: number; brand: number; window: number; light: number; hemiSky: number; hemiGround: number;
};

const DAY: Palette = {
  sky: 0xdfe8ee, sea: 0xc9d8e2, island: 0xf1ece3, islandSide: 0xcfc6b8, road: 0xd9d2c6, plaza: 0xfaf7f1,
  tiles: { hq: 0xfaf7f1, treasury: 0xe6efe9, site: 0xe4ebf6, consignment: 0xf3e6ee, market: 0xf6eddf, customers: 0xeaf0e2, suppliers: 0xece6dd, warehouse: 0xe9e5f2, office: 0xeeeeea },
  wall: 0xffffff, roof: 0x9aa3ad, door: 0x5b6470, glass: 0x1f2328, text: '#1f2328', labelBg: 'rgba(255,255,255,0.92)',
  gold: 0xe7c35a, usd: 0x5fb59a, eur: 0x8f86d6, income: 0x63b97f, expense: 0xe07a6a, ghost: 0xb9b2a6,
  site: 0x5b8def, shop: 0xf0a14a, consignment: 0xe57aa8, factory: 0xc9b8a3, house: 0xfdfbf7, roofWarm: 0xd98b5f, roofDebt: 0xd2554a,
  crowdOn: 0xf3d9a8, crowdOff: 0xd9d4cc, skin: 0xf2d3b3, brand: 0x2e3440, window: 0x9fb6c9, light: 0xffffff, hemiSky: 0xffffff, hemiGround: 0xcfc6b8,
};

const NIGHT: Palette = {
  ...DAY,
  sky: 0x151a24, sea: 0x10151e, island: 0x2a303c, islandSide: 0x1d222b, road: 0x363d4a, plaza: 0x323946,
  tiles: { hq: 0x323946, treasury: 0x2c3a35, site: 0x2b3446, consignment: 0x3a2e37, market: 0x3a342b, customers: 0x2f3829, suppliers: 0x37322c, warehouse: 0x322f3d, office: 0x33353a },
  wall: 0x4a5160, roof: 0x5a6371, door: 0x23272e, glass: 0x0d0f12, text: '#e8eaf0', labelBg: 'rgba(28,32,42,0.9)',
  house: 0x4a5160, crowdOff: 0x3a3f4a, window: 0xffd27a, light: 0xb8c6ff, hemiSky: 0x8090c0, hemiGround: 0x20242c,
};

const FAMILY_COLORS = [0x2e3440, 0xb4846c, 0x6f9a8d, 0xd9a441, 0x7c8fb3, 0xc06c84, 0x8aa05b, 0x5aa5c4, 0xa77bca, 0xd7745a, 0x4f8a8b, 0x9c8b6e];
const TILE = 0.12;
const CRATE_MAX = 12;
const SPEED = 9;

export type EngineCallbacks = {
  onHover: (id: string | null) => void;
  onSelect: (id: string | null) => void;
  onDistrict: (key: DistrictKey | null) => void;
  /** The figure's place and the view's angle, about ten times a second (the minimap). */
  onAvatar: (p: Point, yaw: number) => void;
};

type Pick = { id: string; base: Point; radius: number };
type Traveler = { mesh: THREE.Mesh; label: HTMLDivElement | null; from: Point; to: Point; t: number; duration: number; fresh: boolean };
type Label = { el: HTMLDivElement; pos: THREE.Vector3; kind: 'district' | 'thing'; id?: string };

function familyColor(family: string): number {
  let h = 0;
  for (let i = 0; i < family.length; i++) h = (h * 31 + family.charCodeAt(i)) >>> 0;
  return FAMILY_COLORS[h % FAMILY_COLORS.length];
}

export class WorldEngine {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.OrthographicCamera;
  private world = new THREE.Group();
  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private sea: THREE.Mesh;
  private palette: Palette;
  private box = new THREE.BoxGeometry(1, 1, 1);
  private cylinder = new THREE.CylinderGeometry(0.5, 0.5, 1, 24);
  private cone4 = new THREE.ConeGeometry(0.75, 1, 4);
  private materials = new Map<string, THREE.Material>();
  private owned: Array<{ dispose: () => void }> = [];
  private pickables: THREE.Object3D[] = [];
  private labels: Label[] = [];
  private travelers: Traveler[] = [];
  private animated: Array<(t: number, dt: number) => void> = [];
  private avatar = new THREE.Group();
  private legs: THREE.Mesh[] = [];
  private hoverRing: THREE.Mesh;
  private selectRing: THREE.Mesh;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private pointerMoved = false;
  private pointerInside = false;
  private keys = new Set<string>();
  private walkTo: Point | null = null;
  private target = new THREE.Vector3();
  private follow = true;
  private yaw = Math.PI / 4;
  private yawGoal = Math.PI / 4;
  private zoom = 1;
  private viewHeight = 42;
  private plan: WorldPlan | null = null;
  private data: WorldData | null = null;
  private hovered: string | null = null;
  private selected: string | null = null;
  private district: DistrictKey | null = null;
  private frame = 0;
  private clock = new THREE.Clock();
  private elapsed = 0;
  private lastAvatarReport = 0;
  private drag: { x: number; y: number; moved: boolean; pinch?: number; targetStart: THREE.Vector3 } | null = null;
  private touches = new Map<number, { x: number; y: number }>();
  private resizeObserver: ResizeObserver;
  private disposed = false;

  constructor(private container: HTMLElement, private labelLayer: HTMLElement, private callbacks: EngineCallbacks, dark: boolean) {
    this.palette = dark ? NIGHT : DAY;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.touchAction = 'none';
    this.renderer.domElement.setAttribute('aria-label', 'نقشهٔ سه‌بعدی کسب‌وکار');
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -500, 1000);
    this.hemi = new THREE.HemisphereLight(this.palette.hemiSky, this.palette.hemiGround, 1.6);
    this.sun = new THREE.DirectionalLight(this.palette.light, dark ? 0.9 : 2.2);
    this.sun.castShadow = true;
    const small = Math.min(window.innerWidth, window.innerHeight) < 700;
    this.sun.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048);
    Object.assign(this.sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 200 });
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.hemi, this.sun, this.sun.target, this.world);

    this.sea = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), new THREE.MeshLambertMaterial({ color: this.palette.sea }));
    this.sea.rotation.x = -Math.PI / 2;
    this.sea.position.y = -2.4;
    this.scene.add(this.sea);

    this.hoverRing = this.ring(0x5b8def, 0.55);
    this.selectRing = this.ring(0xf0a14a, 0.9);
    this.scene.add(this.hoverRing, this.selectRing);
    this.buildAvatar();
    this.applyPalette();

    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('pointercancel', this.onPointerUp);
    el.addEventListener('pointerleave', this.onPointerLeave);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.loop();
  }

  // ── Public ────────────────────────────────────────────────────────────────

  setData(data: WorldData) {
    const first = !this.data;
    this.data = data;
    this.plan = planWorld(data);
    this.rebuild();
    if (first) {
      this.avatar.position.set(0, TILE, 4.5);
      // Open on the whole island; the figure takes the view when it walks.
      this.target.set(0, 0, 0);
      this.follow = false;
      this.zoom = this.fitZoom();
      this.resize();
    }
    // A picked thing that is gone is no longer picked.
    if (this.selected && !this.findPick(this.selected)) this.select(null);
  }

  setDark(dark: boolean) {
    const next = dark ? NIGHT : DAY;
    if (next === this.palette) return;
    this.palette = next;
    for (const material of this.materials.values()) material.dispose();
    this.materials.clear();
    this.applyPalette();
    this.buildAvatar();
    if (this.data) this.rebuild();
  }

  /** Walks the figure to a district or to a thing, and picks the thing. */
  goTo(id: string) {
    if (!this.plan) return;
    if (id.startsWith('district:')) {
      const d = this.plan.districts.find((x) => `district:${x.key}` === id);
      if (!d) return;
      const front = { x: d.center.x * 0.94, z: d.center.z + d.depth / 2 - 1.2 };
      this.walkTo = d.key === 'hq' ? { x: 0, z: 4.5 } : front;
      this.follow = true;
      this.select(id);
      return;
    }
    const pick = this.findPick(id);
    if (!pick) return;
    this.walkTo = { x: pick.base.x, z: pick.base.z + pick.radius + 1.2 };
    this.follow = true;
    this.select(id);
  }

  /** Puts the figure in a district at once. */
  jump(key: DistrictKey) {
    const d = this.plan?.districts.find((x) => x.key === key);
    if (!d) return;
    const p = key === 'hq' ? { x: 0, z: 4.5 } : { x: d.center.x, z: d.center.z + d.depth / 2 + 1 };
    this.avatar.position.set(p.x, TILE, p.z);
    this.walkTo = null;
    this.follow = true;
    this.select(`district:${key}`);
  }

  rotate(dir: 1 | -1) {
    this.yawGoal += (dir * Math.PI) / 2;
  }

  zoomBy(factor: number) {
    this.zoom = Math.min(3.2, Math.max(Math.min(0.4, this.fitZoom() * 0.8), this.zoom * factor));
    this.resize();
  }

  /** Shows the whole island again. */
  overview() {
    this.target.set(0, 0, 0);
    this.follow = false;
    this.zoom = this.fitZoom();
    this.resize();
  }

  /** The zoom at which the whole island fits the view, seen from the current angle. */
  private fitZoom(): number {
    if (!this.plan) return 1;
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    const { halfX, halfZ } = this.plan;
    const c = Math.abs(Math.cos(this.yawGoal));
    const s2 = Math.abs(Math.sin(this.yawGoal));
    // A ground rectangle seen from above at 35.26°: its screen width and height in world units.
    const screenW = 2 * (halfX * c + halfZ * s2);
    const screenH = 2 * (halfX * s2 + halfZ * c) * Math.sin(Math.atan(1 / Math.SQRT2)) + 4;
    const zoom = Math.min(this.viewHeight / (screenH * 1.08), (this.viewHeight * (w / h)) / (screenW * 1.08));
    return Math.max(0.12, Math.min(1.5, zoom));
  }

  select(id: string | null) {
    this.selected = id;
    this.placeRing(this.selectRing, id);
    this.callbacks.onSelect(id);
  }

  /** Sends one event across the map; a fresh one is larger, glows and keeps its label. */
  spawn(event: WorldEvent, fresh = false) {
    if (!this.plan || this.disposed) return;
    const from = this.plan.places.get(event.from);
    const to = this.plan.places.get(event.to);
    if (!from || !to) return;
    if (this.travelers.length > (fresh ? 14 : 8)) return;
    const color = { order: 0x5b8def, transfer: 0xf0a14a, purchase: 0xa5835b, return: 0x9b7ad8, adjust: 0x9aa3ad, sale: 0x5b8def, income: 0x63b97f, expense: 0xe07a6a }[event.kind];
    const size = fresh ? 0.75 : 0.45;
    const geometry = event.kind === 'income' || event.kind === 'expense' ? this.cylinder : this.box;
    const mesh = new THREE.Mesh(geometry, this.mat(color, { emissive: fresh ? color : undefined }));
    mesh.scale.set(size, event.kind === 'income' || event.kind === 'expense' ? size * 0.35 : size, size);
    mesh.castShadow = true;
    this.scene.add(mesh);
    let label: HTMLDivElement | null = null;
    if (fresh || this.zoom > 1.3) {
      label = this.labelEl(event.label, fresh ? 'event-fresh' : 'event');
      this.labelLayer.appendChild(label);
    }
    const length = Math.hypot(from.x, from.z) + Math.hypot(to.x, to.z);
    const same = from.x === to.x && from.z === to.z;
    this.travelers.push({ mesh, label, from, to, t: 0, duration: same ? 2.4 : Math.max(2.2, length / 13), fresh });
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerup', this.onPointerUp);
    el.removeEventListener('pointercancel', this.onPointerUp);
    el.removeEventListener('pointerleave', this.onPointerLeave);
    el.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.clearWorld();
    for (const t of this.travelers) t.label?.remove();
    for (const m of this.materials.values()) m.dispose();
    this.box.dispose();
    this.cylinder.dispose();
    this.cone4.dispose();
    this.renderer.dispose();
    el.remove();
  }

  // ── Building ──────────────────────────────────────────────────────────────

  private mat(color: number, opts: { emissive?: number; transparent?: number } = {}): THREE.Material {
    const key = `${color}|${opts.emissive ?? ''}|${opts.transparent ?? ''}`;
    let m = this.materials.get(key);
    if (!m) {
      m = new THREE.MeshLambertMaterial({
        color,
        flatShading: true,
        ...(opts.emissive !== undefined && { emissive: opts.emissive, emissiveIntensity: 0.55 }),
        ...(opts.transparent !== undefined && { transparent: true, opacity: opts.transparent, depthWrite: false }),
      });
      this.materials.set(key, m);
    }
    return m;
  }

  private add(geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, parent: THREE.Object3D = this.world) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  /** A box standing on y with its footprint centred at x, z. */
  private block(color: number, x: number, z: number, w: number, h: number, d: number, y = TILE, opts?: { emissive?: number; transparent?: number }) {
    return this.add(this.box, this.mat(color, opts), x, y + h / 2, z, w, h, d);
  }

  private pickable(object: THREE.Object3D, id: string, base: Point, radius: number) {
    object.userData.pick = { id, base, radius } satisfies Pick;
    object.traverse((child) => {
      child.userData.pick = { id, base, radius } satisfies Pick;
    });
    this.pickables.push(object);
  }

  private ring(color: number, opacity: number) {
    const mesh = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.visible = false;
    mesh.renderOrder = 2;
    return mesh;
  }

  private labelEl(text: string, kind: 'district' | 'thing' | 'event' | 'event-fresh') {
    const el = document.createElement('div');
    el.textContent = text;
    el.dir = 'rtl';
    const base = 'pointer-events-none absolute left-0 top-0 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] leading-5 shadow-sm will-change-transform';
    const tone = {
      district: 'text-[13px] font-bold px-2.5 py-1 rounded-full',
      thing: 'font-medium',
      event: 'text-[10px] opacity-90',
      'event-fresh': 'font-bold ring-2 ring-amber-400',
    }[kind];
    el.className = `${base} ${tone}`;
    el.style.background = this.palette.labelBg;
    el.style.color = this.palette.text;
    return el;
  }

  private label(text: string, x: number, y: number, z: number, kind: 'district' | 'thing', id?: string) {
    const el = this.labelEl(text, kind);
    this.labelLayer.appendChild(el);
    this.labels.push({ el, pos: new THREE.Vector3(x, y, z), kind, id });
  }

  private clearWorld() {
    for (const o of this.owned) o.dispose();
    this.owned = [];
    this.world.clear();
    this.pickables = [];
    this.animated = [];
    for (const l of this.labels) l.el.remove();
    this.labels = [];
  }

  private applyPalette() {
    const p = this.palette;
    this.scene.background = new THREE.Color(p.sky);
    (this.sea.material as THREE.MeshLambertMaterial).color.set(p.sea);
    this.hemi.color.set(p.hemiSky);
    this.hemi.groundColor.set(p.hemiGround);
    this.sun.color.set(p.light);
    this.sun.intensity = p === NIGHT ? 0.9 : 2.2;
  }

  private buildAvatar() {
    this.avatar.clear();
    this.legs = [];
    const p = this.palette;
    const body = this.add(this.box, this.mat(p.brand), 0, 1.05, 0, 0.8, 0.9, 0.5, this.avatar);
    body.castShadow = true;
    this.add(this.box, this.mat(p.skin), 0, 1.85, 0, 0.7, 0.62, 0.62, this.avatar);
    // The sunglasses.
    const glasses = this.mat(0x111317);
    this.add(this.box, glasses, -0.17, 1.92, 0.32, 0.28, 0.17, 0.06, this.avatar);
    this.add(this.box, glasses, 0.17, 1.92, 0.32, 0.28, 0.17, 0.06, this.avatar);
    this.add(this.box, glasses, 0, 1.96, 0.32, 0.62, 0.05, 0.05, this.avatar);
    for (const x of [-0.2, 0.2]) {
      const leg = this.add(this.box, this.mat(0x3b4252), x, 0.3, 0, 0.26, 0.6, 0.3, this.avatar);
      this.legs.push(leg);
    }
    if (!this.avatar.parent) this.scene.add(this.avatar);
  }

  private rebuild() {
    const plan = this.plan!;
    const data = this.data!;
    const p = this.palette;
    this.clearWorld();

    // The island.
    const hx = plan.halfX;
    const hz = plan.halfZ;
    const r = 6;
    const shape = new THREE.Shape();
    shape.moveTo(-hx + r, -hz);
    shape.lineTo(hx - r, -hz);
    shape.quadraticCurveTo(hx, -hz, hx, -hz + r);
    shape.lineTo(hx, hz - r);
    shape.quadraticCurveTo(hx, hz, hx - r, hz);
    shape.lineTo(-hx + r, hz);
    shape.quadraticCurveTo(-hx, hz, -hx, hz - r);
    shape.lineTo(-hx, -hz + r);
    shape.quadraticCurveTo(-hx, -hz, -hx + r, -hz);
    const islandGeometry = new THREE.ExtrudeGeometry(shape, { depth: 2, bevelEnabled: true, bevelSize: 0.6, bevelThickness: 0.4, bevelSegments: 2, curveSegments: 10 });
    this.owned.push(islandGeometry);
    const island = new THREE.Mesh(islandGeometry, [this.mat(p.island), this.mat(p.islandSide)]);
    island.rotation.x = Math.PI / 2;
    island.position.y = -0.4;
    island.receiveShadow = true;
    this.world.add(island);
    // The click target for walking: the island's top.
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(hx * 2, hz * 2), new THREE.MeshBasicMaterial({ visible: false }));
    this.owned.push(floor.geometry, floor.material as THREE.Material);
    floor.rotation.x = -Math.PI / 2;
    floor.userData.floor = true;
    this.world.add(floor);
    this.pickables.push(floor);

    // Roads from the plaza to each district.
    for (const road of plan.roads) {
      const length = Math.hypot(road.to.x, road.to.z);
      const mesh = this.add(this.box, this.mat(p.road), road.to.x / 2, 0.03, road.to.z / 2, 1.6, 0.06, length);
      mesh.rotation.y = Math.atan2(road.to.x, road.to.z);
      mesh.castShadow = false;
    }

    // District tiles and their names.
    for (const d of plan.districts) {
      if (d.key === 'hq') continue;
      const tile = this.block(p.tiles[d.key], d.center.x, d.center.z, d.width, TILE, d.depth, 0);
      tile.castShadow = false;
      this.pickable(tile, `district:${d.key}`, d.center, Math.max(d.width, d.depth) / 2);
      this.label(d.label, d.center.x, 1.2, d.center.z - d.depth / 2 + 0.6, 'district');
    }

    this.buildHq(data, plan);
    this.buildWarehouses(data, plan);
    this.buildTreasury(data, plan);
    this.buildMarket(data, plan);
    this.buildSuppliers(data, plan);
    this.buildCustomers(data, plan);
    this.buildSite(data, plan);
    this.buildOffice(data, plan);
    this.placeRing(this.selectRing, this.selected);
  }

  private buildHq(data: WorldData, plan: WorldPlan) {
    const p = this.palette;
    const plaza = this.add(this.cylinder, this.mat(p.plaza), 0, 0.06, 0, 17, 0.12, 17);
    plaza.castShadow = false;
    const hq = new THREE.Group();
    this.add(this.box, this.mat(p.wall), 0, TILE + 1.6, -1.2, 5.6, 3.2, 3.6, hq);
    // Its windows are a pair of sunglasses.
    const lens = this.mat(p.glass, p === NIGHT ? { emissive: 0x2a3450 } : {});
    for (const x of [-1.25, 1.25]) {
      const l = this.add(this.cylinder, lens, x, TILE + 2, 0.62, 1.9, 0.12, 1.25, hq);
      l.rotation.x = Math.PI / 2;
    }
    this.add(this.box, lens, 0, TILE + 2.25, 0.62, 0.9, 0.16, 0.12, hq);
    this.add(this.box, this.mat(p.door), 0, TILE + 0.55, 0.62, 1.1, 1.1, 0.1, hq);
    this.world.add(hq);
    this.pickable(hq, 'district:hq', { x: 0, z: -1.2 }, 3.4);
    this.label('دفتر مرکزی', 0, 4.3, -1.2, 'district');

    const values: Record<string, number> = {
      today: data.sales?.today.total ?? 0,
      profit: data.profit?.profit ?? 0,
      balance: data.finance?.total ?? 0,
      stock: data.stock?.totals.units ?? 0,
    };
    const colors: Record<string, number> = { today: p.site, profit: p.income, balance: p.gold, stock: 0x9b7ad8 };
    for (const k of plan.kpis) {
      const v = values[k.id];
      const h = k.id === 'stock' ? 0.6 + Math.min(4, v / 250) : 0.6 + Math.min(4, Math.log10(1 + Math.abs(v) / 1e6) * 1.2);
      const pillar = this.add(this.cylinder, this.mat(v < 0 ? p.expense : colors[k.id]), k.x, TILE + h / 2, k.z, 1.1, h, 1.1);
      this.pickable(pillar, `kpi:${k.id}`, k, 0.8);
    }
  }

  private buildWarehouses(data: WorldData, plan: WorldPlan) {
    const p = this.palette;
    const stock = data.stock;
    if (!stock) return;
    const crate = new THREE.BoxGeometry(0.86, 0.3, 0.86);
    this.owned.push(crate);
    for (const yard of [...plan.warehouses, ...plan.stores]) {
      const w = stock.warehouses.find((x) => x.id === yard.warehouseId);
      if (!w) continue;
      const b = yard.building;
      const group = new THREE.Group();
      if (w.virtual) {
        // A partner's store: walls, a striped awning, a door.
        this.add(this.box, this.mat(p.wall), b.x, TILE + 1, b.z, b.width, 2, b.depth, group);
        const awning = this.add(this.box, this.mat(p.consignment), b.x, TILE + 1.75, b.z + b.depth / 2 + 0.35, b.width + 0.2, 0.12, 0.9, group);
        awning.rotation.x = 0.35;
        this.add(this.box, this.mat(p.door), b.x, TILE + 0.6, b.z + b.depth / 2 + 0.02, 0.8, 1.2, 0.06, group);
        this.add(this.box, this.mat(p.window, p === NIGHT ? { emissive: p.window } : {}), b.x - b.width * 0.28, TILE + 1.05, b.z + b.depth / 2 + 0.02, 0.6, 0.5, 0.05, group);
      } else {
        // A warehouse: a long hall with a pitched roof and a big door.
        this.add(this.box, this.mat(p.wall), b.x, TILE + 1.5, b.z, b.width, 3, b.depth, group);
        for (const side of [-1, 1]) {
          const half = this.add(this.box, this.mat(p.roof), b.x + side * b.width * 0.25, TILE + 3.35, b.z, b.width * 0.56, 0.18, b.depth + 0.4, group);
          half.rotation.z = side * -0.32;
        }
        this.add(this.box, this.mat(p.door), b.x, TILE + 1.1, b.z + b.depth / 2 + 0.02, b.width * 0.36, 2.2, 0.08, group);
      }
      this.world.add(group);
      this.pickable(group, `warehouse:${w.id}`, { x: b.x, z: b.z }, Math.max(b.width, b.depth) / 2);
      this.label(`${w.partner ?? w.name} · ${w.units.toLocaleString('fa-IR')} عدد`, b.x, w.virtual ? 3 : 4.4, b.z, 'thing', `warehouse:${w.id}`);

      // The crates: one column per product, one crate per unit up to CRATE_MAX.
      const count = yard.columns.reduce((n, c) => n + Math.min(CRATE_MAX, c.units), 0);
      if (count > 0) {
        const mesh = new THREE.InstancedMesh(crate, this.mat(0xffffff) as THREE.MeshLambertMaterial, count);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        const ids: string[] = [];
        const bases: Pick[] = [];
        const m = new THREE.Matrix4();
        const c = new THREE.Color();
        const scale = w.virtual ? 0.7 : 1;
        let i = 0;
        for (const col of yard.columns) {
          const pick: Pick = { id: `product:${w.id}:${col.product.id}`, base: col, radius: 0.6 * scale };
          c.set(familyColor(col.product.family));
          for (let k = 0; k < Math.min(CRATE_MAX, col.units); k++) {
            m.makeScale(scale, scale, scale).setPosition(col.x, TILE + (0.15 + k * 0.32) * scale, col.z);
            mesh.setMatrixAt(i, m);
            mesh.setColorAt(i, c);
            ids.push(pick.id);
            bases.push(pick);
            i++;
          }
        }
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.userData.instancePicks = bases;
        this.world.add(mesh);
        this.pickables.push(mesh);
        this.owned.push({ dispose: () => mesh.dispose() });
      }
      // Out of stock: a ghost pad. Low: a red beacon that pulses.
      for (const col of yard.columns) {
        const id = `product:${w.id}:${col.product.id}`;
        if (col.units <= 0) {
          const pad = this.block(p.ghost, col.x, col.z, 0.86, 0.04, 0.86, TILE, { transparent: 0.45 });
          pad.castShadow = false;
          this.pickable(pad, id, col, 0.6);
        }
        if (!w.virtual && col.product.level !== 'OK') {
          const top = TILE + Math.min(CRATE_MAX, col.units) * 0.32 + 0.45;
          const beacon = this.add(this.cone4, this.mat(col.product.level === 'OUT' ? 0xd2554a : 0xe9a23b, { emissive: col.product.level === 'OUT' ? 0xd2554a : 0xe9a23b }), col.x, top, col.z, 0.32, 0.4, 0.32);
          beacon.rotation.x = Math.PI;
          this.pickable(beacon, id, col, 0.6);
          const phase = (col.x + col.z) % 3;
          this.animated.push((t) => {
            beacon.position.y = top + Math.sin(t * 3 + phase) * 0.12;
          });
        }
      }
    }
  }

  private buildTreasury(data: WorldData, plan: WorldPlan) {
    const p = this.palette;
    const finance = data.finance;
    if (!finance) return;
    const max = Math.max(1, ...finance.accounts.map((a) => Math.abs(a.toman ?? 0)));
    finance.accounts.forEach((a, i) => {
      const slot = plan.accounts[i];
      if (!slot) return;
      const value = a.toman ?? 0;
      const h = a.toman === null ? 0.25 : value <= 0 ? 0.12 : 0.3 + 4.2 * (Math.log10(1 + value / 1e5) / Math.log10(1 + max / 1e5));
      const color = value < 0 ? p.expense : a.toman === null ? p.ghost : a.currency === 'USD' ? p.usd : a.currency === 'EUR' ? p.eur : p.gold;
      const stack = new THREE.Group();
      // A stack of coins: discs a little apart, so it reads as money.
      const discs = Math.max(1, Math.round(h / 0.34));
      for (let k = 0; k < discs; k++) this.add(this.cylinder, this.mat(color), slot.x, TILE + 0.15 + k * (h / discs), slot.z, 1.8, Math.max(0.1, h / discs - 0.04), 1.8, stack);
      this.world.add(stack);
      this.pickable(stack, `account:${a.id}`, slot, 1);
      this.label(a.name, slot.x, TILE + h + 0.9, slot.z, 'thing', `account:${a.id}`);
    });
    const flowMax = Math.max(1, ...finance.flows.income.map((f) => f.amount), ...finance.flows.expense.map((f) => f.amount));
    for (const [kind, rows, slots] of [
      ['income', finance.flows.income, plan.flows.income],
      ['expense', finance.flows.expense, plan.flows.expense],
    ] as const) {
      rows.forEach((row, i) => {
        const slot = slots[i];
        if (!slot) return;
        const h = 0.2 + 4 * (row.amount / flowMax);
        const bar = this.block(kind === 'income' ? p.income : p.expense, slot.x, slot.z, 1.5, h, 0.9);
        this.pickable(bar, `flow:${kind}:${row.category}`, slot, 0.9);
      });
    }
    // The drain where money spent goes.
    const drain = this.add(this.cylinder, this.mat(0x2b2f36), plan.out.x, 0.08, plan.out.z, 2.4, 0.16, 2.4);
    drain.castShadow = false;
    this.add(this.cylinder, this.mat(p.expense), plan.out.x, 0.12, plan.out.z, 2.9, 0.06, 2.9).castShadow = false;
    this.pickable(drain, 'out', plan.out, 1.3);
  }

  private buildMarket(data: WorldData, plan: WorldPlan) {
    const p = this.palette;
    const sales = data.sales;
    if (!sales) return;
    const channelMax = Math.max(1, ...sales.channels.map((c) => c.total));
    sales.channels.forEach((c, i) => {
      const slot = plan.market.channels[i];
      const color = { site: p.site, shop: p.shop, consignment: p.consignment }[c.channel];
      const h = 1 + 3 * (c.total / channelMax);
      const kiosk = new THREE.Group();
      this.add(this.box, this.mat(p.wall), slot.x, TILE + h / 2, slot.z, 3, h, 2.4, kiosk);
      const roof = this.add(this.cone4, this.mat(color), slot.x, TILE + h + 0.55, slot.z, 2.6, 1.1, 2.2, kiosk);
      roof.rotation.y = Math.PI / 4;
      this.add(this.box, this.mat(color), slot.x, TILE + 0.5, slot.z + 1.25, 2.6, 0.9, 0.12, kiosk);
      this.world.add(kiosk);
      this.pickable(kiosk, `channel:${c.channel}`, slot, 1.6);
      this.label({ site: 'فروش سایت', shop: 'فروش حضوری', consignment: 'فروش امانی' }[c.channel], slot.x, TILE + h + 1.6, slot.z, 'thing', `channel:${c.channel}`);
    });
    const topMax = Math.max(1, ...sales.topProducts.map((t) => t.units));
    sales.topProducts.forEach((t, i) => {
      const slot = plan.market.podium[i];
      const h = 0.3 + 2.4 * (t.units / topMax);
      const group = new THREE.Group();
      this.add(this.box, this.mat(p.wall), slot.x, TILE + h / 2, slot.z, 1.3, h, 1.3, group);
      this.add(this.box, this.mat(familyColor(t.family)), slot.x, TILE + h + 0.25, slot.z, 0.8, 0.5, 0.8, group);
      this.world.add(group);
      this.pickable(group, `top:${t.id}`, slot, 0.8);
    });
    const dayMax = Math.max(1, ...sales.days.map((d) => d.total));
    sales.days.forEach((d, i) => {
      const slot = plan.market.days[i];
      const h = 0.06 + 3.4 * (d.total / dayMax);
      const today = i === sales.days.length - 1;
      const bar = this.block(today ? p.shop : p.site, slot.x, slot.z, 0.55, h, 0.55, TILE, today ? { emissive: p.shop } : {});
      this.pickable(bar, `day:${d.day}`, slot, 0.4);
    });
  }

  private buildSuppliers(data: WorldData, plan: WorldPlan) {
    const p = this.palette;
    const list = data.suppliers?.suppliers ?? [];
    list.forEach((s, i) => {
      const slot = plan.suppliers[i];
      const group = new THREE.Group();
      this.add(this.box, this.mat(p.factory), slot.x, TILE + 1.1, slot.z, 3.6, 2.2, 3, group);
      for (const dx of [-0.9, 0.9]) {
        const tooth = this.add(this.box, this.mat(p.roof), slot.x + dx, TILE + 2.45, slot.z, 1.5, 0.12, 3.1, group);
        tooth.rotation.z = 0.5;
      }
      this.add(this.cylinder, this.mat(0x8a7f72), slot.x + 1.3, TILE + 2.6, slot.z - 0.9, 0.5, 2.2, 0.5, group);
      this.add(this.box, this.mat(p.door), slot.x, TILE + 0.7, slot.z + 1.52, 1.2, 1.4, 0.06, group);
      if (s.unpaid) this.add(this.box, this.mat(0xe9a23b, { emissive: 0xe9a23b }), slot.x - 1.5, TILE + 2.9, slot.z + 1.2, 0.5, 0.35, 0.05, group);
      this.world.add(group);
      this.pickable(group, `supplier:${s.id}`, slot, 2);
      this.label(s.name, slot.x, TILE + 4.4, slot.z, 'thing', `supplier:${s.id}`);
      // Smoke while a purchase order is open.
      if (s.open > 0) {
        const puffs = Array.from({ length: 3 }, (_, k) => {
          const puff = this.add(this.box, this.mat(0xd9d4cc, { transparent: 0.7 }), slot.x + 1.3, TILE + 3.8, slot.z - 0.9, 0.4, 0.4, 0.4);
          puff.castShadow = false;
          return { puff, phase: k / 3 };
        });
        this.animated.push((t) => {
          for (const { puff, phase } of puffs) {
            const f = (t * 0.35 + phase) % 1;
            puff.position.y = TILE + 3.8 + f * 2.2;
            puff.position.x = slot.x + 1.3 + f * 0.6;
            const s2 = 0.3 + f * 0.6;
            puff.scale.set(s2, s2, s2);
          }
        });
      }
    });
  }

  private buildCustomers(data: WorldData, plan: WorldPlan) {
    const p = this.palette;
    const c = data.customers;
    if (!c) return;
    const spendMax = Math.max(1, ...c.top.map((x) => x.spend));
    c.top.forEach((x, i) => {
      const slot = plan.customers.top[i];
      const h = 1 + 1.8 * (x.spend / spendMax);
      const group = new THREE.Group();
      this.add(this.box, this.mat(p.house), slot.x, TILE + h / 2, slot.z, 2, h, 2, group);
      const roof = this.add(this.cone4, this.mat(x.debt ? p.roofDebt : p.roofWarm), slot.x, TILE + h + 0.5, slot.z, 2, 1, 2, group);
      roof.rotation.y = Math.PI / 4;
      this.add(this.box, this.mat(p.window, p === NIGHT ? { emissive: p.window } : {}), slot.x, TILE + h * 0.55, slot.z + 1.01, 0.6, 0.5, 0.04, group);
      this.world.add(group);
      this.pickable(group, `customer:${x.id}`, slot, 1.3);
      this.label(x.name, slot.x, TILE + h + 1.5, slot.z, 'thing', `customer:${x.id}`);
    });
    // Everyone else: a small house each, lit for those who bought in 90 days.
    const crowd = plan.customers.crowd;
    if (crowd.length) {
      const walls = new THREE.InstancedMesh(this.box, this.mat(0xffffff) as THREE.MeshLambertMaterial, crowd.length);
      const roofs = new THREE.InstancedMesh(this.cone4, this.mat(p.roof) as THREE.MeshLambertMaterial, crowd.length);
      const lit = Math.max(0, c.buyers90 - c.top.length);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 4);
      const color = new THREE.Color();
      crowd.forEach((pt, i) => {
        m.compose(new THREE.Vector3(pt.x, TILE + 0.35, pt.z), new THREE.Quaternion(), new THREE.Vector3(0.8, 0.7, 0.8));
        walls.setMatrixAt(i, m);
        walls.setColorAt(i, color.set(i < lit ? p.crowdOn : p.crowdOff));
        m.compose(new THREE.Vector3(pt.x, TILE + 0.95, pt.z), q, new THREE.Vector3(0.82, 0.5, 0.82));
        roofs.setMatrixAt(i, m);
      });
      for (const mesh of [walls, roofs]) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.instanceMatrix.needsUpdate = true;
        mesh.userData.instancePicks = crowd.map((pt) => ({ id: 'crowd', base: pt, radius: 0.6 }));
        this.world.add(mesh);
        this.pickables.push(mesh);
        this.owned.push({ dispose: () => mesh.dispose() });
      }
      if (walls.instanceColor) walls.instanceColor.needsUpdate = true;
    }
  }

  private buildSite(data: WorldData, plan: WorldPlan) {
    const p = this.palette;
    const s = data.site;
    if (!s) return;
    const failing = s.hook.paused || !!s.hook.failingSince;
    const status = !s.host ? p.ghost : failing ? 0xd2554a : s.stockPush ? 0x4fbf7a : 0xe9a23b;
    const { x, z } = plan.site;
    const group = new THREE.Group();
    this.add(this.cylinder, this.mat(p.wall), x, TILE + 0.5, z, 4, 1, 4, group);
    this.add(this.cylinder, this.mat(p.site), x, TILE + 3, z, 0.9, 4.2, 0.9, group);
    this.add(this.box, this.mat(p.glass, p === NIGHT ? { emissive: 0x24304a } : {}), x, TILE + 2.2, z + 0.5, 2.4, 1.5, 0.12, group);
    const bulb = this.add(new THREE.SphereGeometry(0.5, 16, 12), this.mat(status, { emissive: status }), x, TILE + 5.6, z, 1, 1, 1, group);
    this.owned.push(bulb.geometry);
    this.world.add(group);
    this.pickable(group, 'site', { x, z }, 2);
    this.label(s.host ?? 'وب‌سایت', x, TILE + 6.8, z, 'thing', 'site');
    // The products on the site circle it.
    const count = Math.min(120, s.productsOnSite);
    if (count > 0) {
      const ring = new THREE.InstancedMesh(this.box, this.mat(p.site) as THREE.MeshLambertMaterial, count);
      const m = new THREE.Matrix4();
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2;
        m.compose(new THREE.Vector3(Math.cos(a) * 3.4, 0, Math.sin(a) * 3.4), new THREE.Quaternion(), new THREE.Vector3(0.22, 0.22, 0.22));
        ring.setMatrixAt(i, m);
      }
      ring.instanceMatrix.needsUpdate = true;
      const holder = new THREE.Group();
      holder.position.set(x, TILE + 3.6, z);
      holder.add(ring);
      this.world.add(holder);
      this.owned.push({ dispose: () => ring.dispose() });
      this.animated.push((_, dt) => {
        holder.rotation.y += dt * 0.35;
      });
    }
    const pulse = bulb;
    this.animated.push((t) => {
      const k = 1 + Math.sin(t * (failing ? 7 : 2)) * 0.12;
      pulse.scale.set(k, k, k);
    });
  }

  private buildOffice(data: WorldData, plan: WorldPlan) {
    const p = this.palette;
    const { x, z } = plan.office;
    const group = new THREE.Group();
    this.add(this.box, this.mat(p.wall), x, TILE + 1.4, z - 1, 4.4, 2.8, 3, group);
    for (const dx of [-1.3, 0, 1.3]) this.add(this.box, this.mat(p.window, p === NIGHT ? { emissive: p.window } : {}), x + dx, TILE + 1.8, z + 0.52, 0.7, 0.8, 0.04, group);
    this.add(this.box, this.mat(p.door), x, TILE + 0.6, z + 0.52, 0.8, 1.2, 0.05, group);
    // The task board: a note per open task, red when overdue.
    const board = this.add(this.box, this.mat(0x8a7f72), x, TILE + 1.1, z + 2.4, 3.6, 1.8, 0.12, group);
    board.castShadow = true;
    const open = Math.min(24, data.office.tasks.open);
    for (let i = 0; i < open; i++) {
      const overdue = i < data.office.tasks.overdue;
      this.add(this.box, this.mat(overdue ? 0xd2554a : 0xf6d36b), x - 1.45 + (i % 8) * 0.41, TILE + 1.7 - Math.floor(i / 8) * 0.5, z + 2.48, 0.32, 0.32, 0.04, group);
    }
    this.world.add(group);
    this.pickable(group, 'office', { x, z }, 2.4);
  }

  // ── Interaction ───────────────────────────────────────────────────────────

  private findPick(id: string): Pick | null {
    for (const object of this.pickables) {
      const instances = object.userData.instancePicks as Pick[] | undefined;
      if (instances) {
        const hit = instances.find((x) => x.id === id);
        if (hit) return hit;
      } else if ((object.userData.pick as Pick | undefined)?.id === id) {
        return object.userData.pick as Pick;
      }
    }
    if (id.startsWith('district:') && this.plan) {
      const d = this.plan.districts.find((x) => `district:${x.key}` === id);
      if (d) return { id, base: d.center, radius: Math.max(d.width, d.depth) / 2 };
    }
    return null;
  }

  private placeRing(ring: THREE.Mesh, id: string | null) {
    const pick = id ? this.findPick(id) : null;
    if (!pick || id?.startsWith('district:')) {
      ring.visible = false;
      return;
    }
    ring.visible = true;
    ring.position.set(pick.base.x, TILE + 0.03, pick.base.z);
    const s = pick.radius + 0.35;
    ring.scale.set(s, s, s);
  }

  private raycast(clientX: number, clientY: number): { pick: Pick | null; floor: THREE.Vector3 | null } {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.pickables, true);
    let floor: THREE.Vector3 | null = null;
    for (const hit of hits) {
      if (hit.object.userData.floor) {
        floor ??= hit.point.clone();
        continue;
      }
      const instances = hit.object.userData.instancePicks as Pick[] | undefined;
      if (instances && hit.instanceId !== undefined) return { pick: instances[hit.instanceId] ?? null, floor: hit.point.clone() };
      const pick = hit.object.userData.pick as Pick | undefined;
      if (pick && !pick.id.startsWith('district:')) return { pick, floor: hit.point.clone() };
      if (pick) return { pick, floor: hit.point.clone() };
    }
    return { pick: null, floor };
  }

  private onPointerDown = (e: PointerEvent) => {
    this.renderer.domElement.setPointerCapture(e.pointerId);
    this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.touches.size === 2) {
      const [a, b] = [...this.touches.values()];
      this.drag = { x: e.clientX, y: e.clientY, moved: true, pinch: Math.hypot(a.x - b.x, a.y - b.y), targetStart: this.target.clone() };
      return;
    }
    this.drag = { x: e.clientX, y: e.clientY, moved: false, targetStart: this.target.clone() };
  };

  private onPointerMove = (e: PointerEvent) => {
    this.pointerInside = true;
    if (this.touches.has(e.pointerId)) this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.drag?.pinch && this.touches.size === 2) {
      const [a, b] = [...this.touches.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      this.zoomBy(d / this.drag.pinch);
      this.drag.pinch = d;
      return;
    }
    if (this.drag) {
      const dx = e.clientX - this.drag.x;
      const dy = e.clientY - this.drag.y;
      if (!this.drag.moved && Math.hypot(dx, dy) > 6) this.drag.moved = true;
      if (this.drag.moved) {
        // Drag the map: move the view, not the figure, until it walks again.
        this.follow = false;
        const unitsPerPixel = this.viewHeight / this.zoom / this.renderer.domElement.clientHeight;
        const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
        const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
        this.target
          .copy(this.drag.targetStart)
          .addScaledVector(right, -dx * unitsPerPixel)
          .addScaledVector(forward, (dy * unitsPerPixel) / Math.sin(Math.atan(1 / Math.SQRT2)));
      }
      return;
    }
    this.pointer.set(e.clientX, e.clientY);
    this.pointerMoved = true;
  };

  private onPointerUp = (e: PointerEvent) => {
    this.touches.delete(e.pointerId);
    const drag = this.drag;
    if (this.touches.size === 0) this.drag = null;
    if (!drag || drag.moved || drag.pinch) return;
    const { pick, floor } = this.raycast(e.clientX, e.clientY);
    if (pick && !pick.id.startsWith('district:')) {
      this.goTo(pick.id);
    } else if (floor) {
      this.walkTo = { x: floor.x, z: floor.z };
      this.follow = true;
      this.select(pick?.id ?? null);
    }
  };

  private onPointerLeave = () => {
    this.pointerInside = false;
    if (this.hovered) {
      this.hovered = null;
      this.hoverRing.visible = false;
      this.callbacks.onHover(null);
    }
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.zoomBy(Math.pow(1.0015, -e.deltaY));
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const target = e.target;
    if (target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return;
    const code = e.code;
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight'].includes(code)) {
      this.keys.add(code);
      if (code.startsWith('Arrow')) e.preventDefault();
      this.walkTo = null;
      this.follow = true;
    } else if (code === 'KeyQ') this.rotate(-1);
    else if (code === 'KeyE') this.rotate(1);
    else if (code === 'Equal' || code === 'NumpadAdd') this.zoomBy(1.15);
    else if (code === 'Minus' || code === 'NumpadSubtract') this.zoomBy(1 / 1.15);
    else if (code === 'Escape') this.select(null);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private onBlur = () => this.keys.clear();

  // ── Loop ──────────────────────────────────────────────────────────────────

  private resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = `${w}px`;
    this.renderer.domElement.style.height = `${h}px`;
    const viewH = this.viewHeight / this.zoom;
    const viewW = viewH * (w / h);
    Object.assign(this.camera, { left: -viewW / 2, right: viewW / 2, top: viewH / 2, bottom: -viewH / 2 });
    this.camera.updateProjectionMatrix();
  }

  private moveAvatar(dt: number) {
    let dx = 0;
    let dz = 0;
    const k = this.keys;
    const forward = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const right = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    if (forward || right) {
      // Up the screen is away from the camera.
      const fx = -Math.sin(this.yaw);
      const fz = -Math.cos(this.yaw);
      dx = fx * forward + Math.cos(this.yaw) * right;
      dz = fz * forward - Math.sin(this.yaw) * right;
    } else if (this.walkTo) {
      dx = this.walkTo.x - this.avatar.position.x;
      dz = this.walkTo.z - this.avatar.position.z;
      if (Math.hypot(dx, dz) < 0.15) {
        this.walkTo = null;
        dx = dz = 0;
      }
    }
    const length = Math.hypot(dx, dz);
    const walking = length > 0;
    if (walking) {
      const speed = SPEED * (k.has('ShiftLeft') || k.has('ShiftRight') ? 2 : this.walkTo && length > 25 ? 2.2 : 1);
      const step = Math.min(length, speed * dt);
      const pos = this.avatar.position;
      const limitX = (this.plan?.halfX ?? 40) - 1;
      const limitZ = (this.plan?.halfZ ?? 40) - 1;
      pos.x = Math.max(-limitX, Math.min(limitX, pos.x + (dx / length) * step));
      pos.z = Math.max(-limitZ, Math.min(limitZ, pos.z + (dz / length) * step));
      const heading = Math.atan2(dx, dz);
      let turn = heading - this.avatar.rotation.y;
      turn = Math.atan2(Math.sin(turn), Math.cos(turn));
      this.avatar.rotation.y += turn * Math.min(1, dt * 12);
    }
    const swing = walking ? Math.sin(this.elapsed * 14) * 0.5 : 0;
    if (this.legs[0]) this.legs[0].rotation.x = swing;
    if (this.legs[1]) this.legs[1].rotation.x = -swing;
    this.avatar.position.y = TILE + (walking ? Math.abs(Math.sin(this.elapsed * 14)) * 0.08 : 0);
    if (walking) this.follow = true;
  }

  private updateDistrict() {
    if (!this.plan) return;
    const { x, z } = this.avatar.position;
    let found: DistrictKey | null = null;
    for (const d of this.plan.districts) {
      const margin = d.key === 'hq' ? 0 : 1.5;
      if (Math.abs(x - d.center.x) <= d.width / 2 + margin && Math.abs(z - d.center.z) <= d.depth / 2 + margin) found = d.key;
    }
    if (found !== this.district) {
      this.district = found;
      this.callbacks.onDistrict(found);
    }
  }

  private updateLabels() {
    const w = this.renderer.domElement.clientWidth;
    const h = this.renderer.domElement.clientHeight;
    const v = new THREE.Vector3();
    const ax = this.avatar.position.x;
    const az = this.avatar.position.z;
    // Which labels may show, then the most important first: what is picked or under the pointer, the districts,
    // then things nearest the figure. A label that would cover one already placed waits.
    const wanted: Array<{ label: Label; x: number; y: number; rank: number }> = [];
    for (const label of this.labels) {
      let show = label.kind === 'district';
      const focus = label.id !== undefined && (label.id === this.hovered || label.id === this.selected);
      const distance = Math.hypot(label.pos.x - ax, label.pos.z - az);
      if (label.kind === 'thing') {
        const near = distance < 11 / Math.max(0.6, Math.min(1.4, this.zoom));
        show = focus || (this.zoom >= 1.35 && near) || this.zoom >= 2.2;
      }
      if (show) {
        v.copy(label.pos).project(this.camera);
        show = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      }
      if (!show) {
        if (label.el.style.display !== 'none') label.el.style.display = 'none';
        continue;
      }
      wanted.push({ label, x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h, rank: focus ? -1 : label.kind === 'district' ? 0 : 1 + distance });
    }
    wanted.sort((a, b) => a.rank - b.rank);
    const placed: Array<[number, number, number, number]> = [];
    for (const { label, x, y } of wanted) {
      if (label.el.style.display === 'none') label.el.style.display = '';
      const lw = label.el.offsetWidth || 60;
      const lh = label.el.offsetHeight || 20;
      const box: [number, number, number, number] = [x - lw / 2, y - lh, x + lw / 2, y];
      const covers = placed.some((p) => box[0] < p[2] + 2 && box[2] > p[0] - 2 && box[1] < p[3] + 2 && box[3] > p[1] - 2);
      if (covers) {
        label.el.style.display = 'none';
        continue;
      }
      placed.push(box);
      label.el.style.transform = `translate(-50%, -100%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    }
    for (const t of this.travelers) {
      if (!t.label) continue;
      v.copy(t.mesh.position).setY(t.mesh.position.y + 0.9).project(this.camera);
      t.label.style.transform = `translate(-50%, -100%) translate(${(((v.x + 1) / 2) * w).toFixed(1)}px, ${(((1 - v.y) / 2) * h).toFixed(1)}px)`;
    }
  }

  private updateTravelers(dt: number) {
    for (let i = this.travelers.length - 1; i >= 0; i--) {
      const t = this.travelers[i];
      t.t += dt / t.duration;
      if (t.t >= 1) {
        this.scene.remove(t.mesh);
        t.label?.remove();
        this.travelers.splice(i, 1);
        continue;
      }
      const same = t.from.x === t.to.x && t.from.z === t.to.z;
      const p = same ? t.from : pathPoint(t.from, t.to, t.t);
      const arc = same ? Math.abs(Math.sin(t.t * Math.PI * 3)) * 0.8 : Math.sin(t.t * Math.PI) * 1.6;
      t.mesh.position.set(p.x, TILE + 0.6 + arc, p.z);
      t.mesh.rotation.y += dt * 2;
    }
  }

  private loop = () => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, this.clock.getDelta());
    this.elapsed += dt;

    this.moveAvatar(dt);
    this.yaw += (this.yawGoal - this.yaw) * Math.min(1, dt * 8);
    if (this.follow) this.target.lerp(this.avatar.position, Math.min(1, dt * 5));
    const elevation = Math.atan(1 / Math.SQRT2);
    const distance = 120;
    this.camera.position.set(
      this.target.x + Math.sin(this.yaw) * Math.cos(elevation) * distance,
      this.target.y + Math.sin(elevation) * distance,
      this.target.z + Math.cos(this.yaw) * Math.cos(elevation) * distance,
    );
    this.camera.lookAt(this.target);
    this.sun.position.set(this.target.x + 22, 46, this.target.z + 14);
    this.sun.target.position.copy(this.target);

    for (const fn of this.animated) fn(this.elapsed, dt);
    this.updateTravelers(dt);

    if (this.pointerMoved && this.pointerInside && !this.drag) {
      this.pointerMoved = false;
      const { pick } = this.raycast(this.pointer.x, this.pointer.y);
      const id = pick && !pick.id.startsWith('district:') ? pick.id : null;
      if (id !== this.hovered) {
        this.hovered = id;
        this.placeRing(this.hoverRing, id);
        this.renderer.domElement.style.cursor = id ? 'pointer' : 'default';
        this.callbacks.onHover(id);
      }
    }
    if (this.selectRing.visible) this.selectRing.rotation.z += dt;

    this.updateDistrict();
    this.updateLabels();
    if (this.elapsed - this.lastAvatarReport > 0.1) {
      this.lastAvatarReport = this.elapsed;
      this.callbacks.onAvatar({ x: this.avatar.position.x, z: this.avatar.position.z }, this.yaw);
    }
    this.renderer.render(this.scene, this.camera);
  };
}
