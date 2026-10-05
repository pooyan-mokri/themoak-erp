/**
 * The business world's engine (/dashboard/world): the whole business as a small
 * city, drawn from a snapshot (src/lib/world-types.ts) and its plan
 * (world-city.ts) with the models of world-models.ts. A perspective camera that
 * glides from place to place, soft daylight with contact shadows (GTAO), the
 * real time of day in Tehran, weather from how sales are going, and life on the
 * streets: forklifts at the warehouse, trucks and vans carrying each order,
 * transfer and purchase along the streets, ships and planes from the suppliers
 * in China. world-client.tsx owns it and draws the panels around it.
 *
 * Every thing that can be picked carries an id (world-describe.ts reads it):
 * district:<key>, warehouse:<id>, product:<warehouseId>:<productId>,
 * account:<id>, supplier:<id>, customer:<id>, crowd, site, office, hq, out.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Batch, Shapes, seeded, hash } from '@/components/world/world-kit';
import { SignAtlas, signFontLoaded, signFontReady } from '@/components/world/world-signs';
import { along, pathLength, planCity, route, type CityPlan, type DistrictKey, type Point, type Rect } from '@/components/world/world-city';
import {
  COLORS, Model, buildBank, buildContainer, buildCrane, buildFactory, buildForklift, buildForks, buildHall, buildHome,
  buildHq, buildLamp, buildOffice, buildPallet, buildPlane, buildShip, buildStore, buildTower, buildTree, buildTruck, buildVan, signOn,
  buildMansion, buildVilla, buildTerrace, buildApartment,
} from '@/components/world/world-models';
import type { WorldCustomer, WorldData, WorldEvent } from '@/lib/world-types';
import { tomanTick } from '@/lib/chart-format';
import { businessWeather, daylight, type Weather } from '@/components/world/world-hud';

export type EngineCallbacks = {
  onHover: (id: string | null) => void;
  onSelect: (id: string | null) => void;
  /** The district the view is over, as the camera moves. */
  onDistrict: (key: DistrictKey | null) => void;
  /** The view's centre and its turn, a few times a second (the minimap). */
  onView: (target: Point, yaw: number) => void;
};

type Picked = { id: string; base: Point; radius: number; height: number; facing?: number };
type Mover = {
  mesh: THREE.Object3D;
  legs: Array<{ path: Point[]; speed: number; y?: (t: number) => number; kind: 'road' | 'sea' | 'air' | 'walk' }>;
  leg: number;
  s: number;
  label: HTMLDivElement | null;
  done?: () => void;
  ambient: boolean;
};
type Label = { el: HTMLDivElement; pos: THREE.Vector3; kind: 'district' | 'thing' | 'info'; id?: string };
type Tone = 'red' | 'amber' | 'blue' | 'green';
type Token = { x: number; y: number; z: number; amount: number; tone: 'red' | 'amber' };

const PIN_COLOR = 0x2f6fe0;
const TAU = Math.PI * 2;

/** Tehran's local hour now, with minutes as a fraction (0–24). */
function tehranHour(now = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tehran', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 12);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return h + m / 60;
}

export class WorldEngine {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 1, 6000);
  private composer: EffectComposer | null = null;
  private ao: GTAOPass | null = null;
  private bloom: UnrealBloomPass | null = null;
  private effects = true;
  private world = new THREE.Group();
  private life = new THREE.Group();
  private sun = new THREE.DirectionalLight(0xffffff, 2.4);
  private hemi = new THREE.HemisphereLight(0xffffff, 0xcfd8e6, 1.25);
  private sea: THREE.Mesh;
  private shapes = new Shapes();
  private matte = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.04 });
  private glass = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.22, metalness: 0.15, emissive: 0x000000 });
  private signMaterial: THREE.MeshStandardMaterial | null = null;
  private atlas: SignAtlas | null = null;
  private owned: Array<{ dispose: () => void }> = [];
  private proxies: THREE.Object3D[] = [];
  private labels: Label[] = [];
  private movers: Mover[] = [];
  private animated: Array<(t: number, dt: number) => void> = [];
  private kinds = new Map<string, THREE.BufferGeometry>();
  private pinGeometry: THREE.BufferGeometry;
  private pinMaterial = new THREE.MeshStandardMaterial({ color: PIN_COLOR, roughness: 0.35, metalness: 0.1, emissive: 0x0c2a66, emissiveIntensity: 0.4 });
  private selectPin: THREE.Mesh;
  private hoverRing: THREE.Mesh;
  private selectRing: THREE.Mesh;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private pointerAt: { x: number; y: number } | null = null;
  private keys = new Set<string>();
  // The camera rig: a target on the ground, a turn, a tilt and a distance, each easing to its goal.
  private target = new THREE.Vector3();
  private targetGoal = new THREE.Vector3();
  private yaw = Math.PI / 4;
  private yawGoal = Math.PI / 4;
  private pitch = 0.62;
  private pitchGoal = 0.62;
  private dist = 400;
  private distGoal = 400;
  private plan: CityPlan | null = null;
  private data: WorldData | null = null;
  private hovered: string | null = null;
  private selected: string | null = null;
  private district: DistrictKey | null = null;
  private dark: boolean;
  private weather: Weather = 'sunny';
  private clouds = new THREE.Group();
  private rain: THREE.LineSegments | null = null;
  private rainbow: THREE.Mesh | null = null;
  private lampHeads: THREE.Mesh | null = null;
  private frame = 0;
  private clock = new THREE.Clock();
  private elapsed = 0;
  private lastReport = 0;
  private lastLight = -1;
  private drag: { x: number; y: number; button: number; moved: boolean; pinch?: number; spread?: number } | null = null;
  private touches = new Map<number, { x: number; y: number }>();
  private resizeObserver: ResizeObserver;
  private disposed = false;
  private small: boolean;
  private people = new Map<string, { mesh: THREE.Mesh; label: HTMLDivElement; goal: THREE.Vector3 }>();

  constructor(private container: HTMLElement, private labelLayer: HTMLElement, private callbacks: EngineCallbacks, dark: boolean) {
    this.dark = dark;
    this.small = Math.min(window.innerWidth, window.innerHeight) < 700;
    this.effects = !this.small;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.touchAction = 'none';
    this.renderer.domElement.setAttribute('aria-label', 'نقشهٔ سه‌بعدی کسب‌وکار');
    container.appendChild(this.renderer.domElement);

    this.sun.castShadow = true;
    const size = 2048;
    this.sun.shadow.mapSize.set(size, size);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    this.sun.shadow.radius = 4;
    this.scene.add(this.hemi, this.sun, this.sun.target, this.world, this.life, this.clouds);

    this.sea = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000, 1, 1), new THREE.MeshStandardMaterial({ color: COLORS.water, roughness: 0.35, metalness: 0.05 }));
    this.sea.rotation.x = -Math.PI / 2;
    this.sea.position.y = -1.2;
    this.sea.receiveShadow = true;
    this.scene.add(this.sea);

    // The pin: a ball over a cone, its point at the origin.
    const ball = new THREE.SphereGeometry(1, 20, 14).translate(0, 2.6, 0);
    const cone = new THREE.ConeGeometry(0.82, 2.0, 20).rotateX(Math.PI).translate(0, 1.15, 0);
    this.pinGeometry = mergeGeometries([ball, cone]);
    ball.dispose();
    cone.dispose();
    this.selectPin = new THREE.Mesh(this.pinGeometry, this.pinMaterial);
    this.selectPin.visible = false;
    this.selectPin.castShadow = true;
    this.hoverRing = ring(0x2f6fe0, 0.55);
    this.selectRing = ring(0x2f6fe0, 0.95);
    this.scene.add(this.selectPin, this.hoverRing, this.selectRing);

    this.setupComposer();
    this.applyLight(true);

    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('pointercancel', this.onPointerUp);
    el.addEventListener('pointerleave', this.onPointerLeave);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('dblclick', this.onDoubleClick);
    el.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    // Persian names are drawn once the app's font is in.
    if (!signFontLoaded()) signFontReady().then(() => this.atlas?.redraw());
    this.loop();
  }

  private setupComposer() {
    this.composer?.dispose();
    this.composer = null;
    this.ao = null;
    this.bloom = null;
    if (!this.effects) return;
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    const target = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4 });
    const composer = new EffectComposer(this.renderer, target);
    composer.addPass(new RenderPass(this.scene, this.camera));
    const ao = new GTAOPass(this.scene, this.camera, w, h);
    ao.updateGtaoMaterial({ radius: 2.2, distanceExponent: 1.4, thickness: 2, scale: 1.1, samples: 8 });
    ao.blendIntensity = 0.85;
    composer.addPass(ao);
    const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.6, 0.5, 0.92);
    bloom.enabled = false;
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    this.composer = composer;
    this.ao = ao;
    this.bloom = bloom;
  }

  // ── Public ────────────────────────────────────────────────────────────────

  setData(data: WorldData) {
    const first = !this.data;
    this.data = data;
    this.plan = planCity(data);
    this.rebuild();
    this.setWeather(businessWeather(data));
    if (first) this.overview(true);
    if (this.selected && !this.findPick(this.selected)) this.select(null);
  }

  setDark(dark: boolean) {
    if (dark === this.dark) return;
    this.dark = dark;
    this.applyLight(true);
  }

  /** Contact shadows and glow: on by default on a desktop, off on a phone. */
  setEffects(on: boolean) {
    if (on === this.effects) return;
    this.effects = on;
    this.setupComposer();
    this.resize();
    this.applyLight(true);
  }

  get effectsOn() {
    return this.effects;
  }

  /** Glides the view to a thing or a district, and picks it. */
  goTo(id: string) {
    if (!this.plan) return;
    if (id.startsWith('district:')) {
      const d = this.plan.districts.find((x) => `district:${x.key}` === id);
      if (!d) return;
      this.flyTo(d.center, Math.max(80, Math.max(d.rect.w, d.rect.d) * 1.5));
      this.select(id);
      return;
    }
    const pick = this.findPick(id);
    if (!pick) return;
    // Framed whole, from a little to one side of its front when it has one.
    const distance = THREE.MathUtils.clamp(pick.radius * 6.5 + pick.height * 3, 55, 280);
    this.flyTo(pick.base, distance, pick.facing === undefined ? undefined : pick.facing + Math.PI / 7, pick.facing === undefined ? undefined : 0.55);
    this.select(id);
  }

  /** Glides to a district. */
  jump(key: DistrictKey) {
    this.goTo(`district:${key}`);
  }

  rotate(dir: 1 | -1) {
    this.yawGoal += (dir * Math.PI) / 4;
  }

  zoomBy(factor: number) {
    this.distGoal = THREE.MathUtils.clamp(this.distGoal / factor, 18, this.maxDistance());
  }

  /** The whole main island in view. */
  overview(instant = false) {
    if (!this.plan) return;
    const i = this.plan.island;
    this.flyTo({ x: i.x + i.w / 2, z: i.z + i.d / 2 }, Math.max(i.w, i.d) * 1.15, Math.PI / 4, 0.72);
    if (instant) this.settle();
  }

  select(id: string | null) {
    this.selected = id;
    this.placeMarker(this.selectRing, id, true);
    this.callbacks.onSelect(id);
  }

  /** Sends one event across the map; a fresh one carries its label and ends in confetti. */
  spawn(event: WorldEvent, fresh = false) {
    if (!this.plan || this.disposed) return;
    const cap = fresh ? 18 : 10;
    if (this.movers.filter((m) => !m.ambient).length >= cap) return;
    this.sendEvent(event, fresh);
  }

  /**
   * Everyone else in the world right now (src/lib/world-presence.ts): a figure in sunglasses with a name,
   * standing where their view is, gliding as it moves.
   */
  setPeople(people: Array<{ userId: string; name: string; x: number; z: number }>) {
    const seen = new Set<string>();
    for (const person of people) {
      seen.add(person.userId);
      let entry = this.people.get(person.userId);
      if (!entry) {
        const paint = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, color: PEOPLE[Math.floor(hash(person.userId) * PEOPLE.length) % PEOPLE.length] });
        const mesh = new THREE.Mesh(this.vehicle('person'), paint);
        mesh.castShadow = true;
        mesh.position.set(person.x, 0, person.z);
        this.scene.add(mesh);
        const label = document.createElement('div');
        label.dir = 'rtl';
        label.className = 'pointer-events-none absolute left-0 top-0 flex items-center gap-1.5 whitespace-nowrap rounded-full bg-slate-900/90 px-2.5 py-1 text-[11.5px] font-medium text-white shadow-md will-change-transform';
        const dot = document.createElement('span');
        dot.className = 'inline-block h-2 w-2 rounded-full bg-emerald-400';
        label.append(dot, document.createTextNode(person.name));
        this.labelLayer.appendChild(label);
        entry = { mesh, label, goal: new THREE.Vector3(person.x, 0, person.z) };
        this.people.set(person.userId, entry);
      }
      entry.goal.set(person.x, 0, person.z);
    }
    for (const [id, entry] of this.people) {
      if (seen.has(id)) continue;
      this.scene.remove(entry.mesh);
      (entry.mesh.material as THREE.Material).dispose();
      entry.label.remove();
      this.people.delete(id);
    }
  }

  private updatePeople(dt: number) {
    const v = new THREE.Vector3();
    const w = this.renderer.domElement.clientWidth;
    const h = this.renderer.domElement.clientHeight;
    for (const { mesh, label, goal } of this.people.values()) {
      const dx = goal.x - mesh.position.x;
      const dz = goal.z - mesh.position.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.2) {
        mesh.position.x += dx * Math.min(1, dt * 2);
        mesh.position.z += dz * Math.min(1, dt * 2);
        mesh.rotation.y = Math.atan2(dx, dz);
      }
      mesh.position.y = Math.abs(Math.sin(this.elapsed * (d > 0.5 ? 9 : 2))) * (d > 0.5 ? 0.35 : 0.08);
      v.set(mesh.position.x, 6.2, mesh.position.z).project(this.camera);
      const show = v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
      label.style.display = show ? '' : 'none';
      if (show) label.style.transform = `translate(-50%, -100%) translate(${(((v.x + 1) / 2) * w).toFixed(1)}px, ${(((1 - v.y) / 2) * h).toFixed(1)}px)`;
    }
  }

  dispose() {
    this.disposed = true;
    this.setPeople([]);
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerup', this.onPointerUp);
    el.removeEventListener('pointercancel', this.onPointerUp);
    el.removeEventListener('pointerleave', this.onPointerLeave);
    el.removeEventListener('wheel', this.onWheel);
    el.removeEventListener('dblclick', this.onDoubleClick);
    el.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.clearWorld();
    for (const g of this.kinds.values()) g.dispose();
    this.shapes.dispose();
    this.pinGeometry.dispose();
    for (const m of [this.matte, this.glass, this.pinMaterial]) m.dispose();
    this.composer?.dispose();
    this.renderer.dispose();
    el.remove();
  }

  // ── Camera ────────────────────────────────────────────────────────────────

  private maxDistance() {
    const i = this.plan?.island;
    return i ? Math.max(i.w, i.d) * 2.4 + 300 : 1200;
  }

  private flyTo(p: Point, distance: number, yaw?: number, pitch?: number) {
    this.targetGoal.set(p.x, 0, p.z);
    this.distGoal = THREE.MathUtils.clamp(distance, 18, this.maxDistance());
    if (yaw !== undefined) {
      // The shorter way round.
      let d = yaw - this.yawGoal;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yawGoal += d;
    }
    if (pitch !== undefined) this.pitchGoal = pitch;
  }

  private settle() {
    this.target.copy(this.targetGoal);
    this.yaw = this.yawGoal;
    this.pitch = this.pitchGoal;
    this.dist = this.distGoal;
  }

  private updateCamera(dt: number) {
    const k = 1 - Math.exp(-dt * 4.2);
    this.target.lerp(this.targetGoal, k);
    this.yaw += (this.yawGoal - this.yaw) * k;
    this.pitch += (this.pitchGoal - this.pitch) * k;
    this.dist += (this.distGoal - this.dist) * k;
    const horizontal = Math.cos(this.pitch) * this.dist;
    this.camera.position.set(
      this.target.x + Math.sin(this.yaw) * horizontal,
      this.target.y + Math.sin(this.pitch) * this.dist,
      this.target.z + Math.cos(this.yaw) * horizontal,
    );
    this.camera.lookAt(this.target);
    // The sun's shadows follow the view, sized to it.
    const span = THREE.MathUtils.clamp(this.dist * 0.75, 40, 420);
    const cam = this.sun.shadow.camera;
    if (Math.abs(cam.right - span) > span * 0.15) {
      Object.assign(cam, { left: -span, right: span, top: span, bottom: -span, near: 1, far: 1600 });
      cam.updateProjectionMatrix();
    }
    const sunDir = this.sunDirection();
    this.sun.position.set(this.target.x + sunDir.x * 500, sunDir.y * 500, this.target.z + sunDir.z * 500);
    this.sun.target.position.copy(this.target);
  }

  /** Pans along the ground by screen pixels. */
  private panBy(dx: number, dy: number) {
    const h = this.renderer.domElement.clientHeight || 1;
    const perPixel = (2 * this.dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) / h;
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.targetGoal.addScaledVector(right, -dx * perPixel).addScaledVector(forward, (dy * perPixel) / Math.max(0.35, Math.sin(this.pitch)));
    this.clampTarget();
  }

  private clampTarget() {
    if (!this.plan) return;
    const { island, china } = this.plan;
    const minX = Math.min(island.x, china.island.x) - 40;
    const maxX = island.x + island.w + 40;
    const minZ = Math.min(island.z, china.island.z) - 40;
    const maxZ = Math.max(island.z + island.d, china.island.z + china.island.d) + 40;
    this.targetGoal.x = THREE.MathUtils.clamp(this.targetGoal.x, minX, maxX);
    this.targetGoal.z = THREE.MathUtils.clamp(this.targetGoal.z, minZ, maxZ);
  }

  // ── Light, time of day and weather ───────────────────────────────────────

  /** Where the light comes from: the sun along its day in Tehran, or the moon. */
  private sunDirection(): THREE.Vector3 {
    const hour = tehranHour();
    if (this.dark || daylight(hour) === 0) return new THREE.Vector3(0.35, 0.85, 0.4).normalize();
    const a = THREE.MathUtils.clamp((hour - 6) / 12, 0, 1) * Math.PI;
    return new THREE.Vector3(Math.cos(a), 0.3 + Math.sin(a) * 0.85, 0.55).normalize();
  }

  /** Night-ness 0–1: the theme's night, or Tehran's real night in the light theme. */
  private night(): number {
    return this.dark ? 1 : 1 - daylight(tehranHour());
  }

  private applyLight(force = false) {
    const night = this.night();
    const key = Math.round(night * 20) + (this.weather === 'sunny' ? 0 : this.weather === 'cloudy' ? 100 : 200);
    if (!force && key === this.lastLight) return;
    this.lastLight = key;
    const dim = this.weather === 'sunny' ? 1 : this.weather === 'cloudy' ? 0.62 : 0.42;
    const dayBg = new THREE.Color(this.weather === 'sunny' ? 0xe9eff7 : this.weather === 'cloudy' ? 0xdfe3ea : 0xc9cfd8);
    const duskTint = new THREE.Color(0xf6d6bf);
    const nightBg = new THREE.Color(0x111723);
    const twilight = night > 0 && night < 1 ? 1 - Math.abs(night - 0.5) * 2 : 0;
    const bg = dayBg.clone().lerp(duskTint, twilight * 0.6).lerp(nightBg, night);
    this.scene.background = bg;
    this.scene.fog = new THREE.Fog(bg, 1400, 4200);
    this.hemi.color.set(0xffffff).lerp(new THREE.Color(0x7083b5), night);
    this.hemi.groundColor.set(0xcfd8e6).lerp(new THREE.Color(0x1b2130), night);
    this.hemi.intensity = THREE.MathUtils.lerp(1.25, 0.5, night) * (0.75 + dim * 0.25);
    this.sun.color.set(0xffffff).lerp(new THREE.Color(0xffc48a), twilight).lerp(new THREE.Color(0xa8b8ff), night);
    this.sun.intensity = THREE.MathUtils.lerp(2.5, 0.55, night) * dim;
    (this.sea.material as THREE.MeshStandardMaterial).color.set(COLORS.water).lerp(new THREE.Color(0x1a2a40), night);
    this.renderer.toneMappingExposure = THREE.MathUtils.lerp(1.05, 0.95, night);
    // Windows and lamps light up at dusk.
    const glow = THREE.MathUtils.smoothstep(night, 0.25, 0.8);
    this.glass.emissive.set(0xffcf7a);
    this.glass.emissiveIntensity = glow * 0.55;
    if (this.lampHeads) {
      const m = this.lampHeads.material as THREE.MeshStandardMaterial;
      m.emissive.set(0xfff0c8);
      m.emissiveIntensity = glow * 2.2;
    }
    if (this.bloom) this.bloom.enabled = glow > 0.05;
    if (this.ao) this.ao.blendIntensity = THREE.MathUtils.lerp(0.85, 0.45, night);
  }

  private setWeather(w: { weather: Weather; rainbow: boolean }) {
    this.weather = w.weather;
    // Clouds: a few in fine weather, many when sales are down.
    this.clouds.clear();
    const count = w.weather === 'sunny' ? 4 : w.weather === 'cloudy' ? 12 : 18;
    const random = seeded(`clouds${count}`);
    const island = this.plan?.island ?? { x: -300, z: -200, w: 600, d: 400 };
    const puff = this.kind('cloud', () => {
      const batch = new Batch();
      const m = new Model(batch, this.shapes);
      const tone = 0xffffff;
      m.shape(this.shapes.ball, tone, 0, 0, 0, 22, 12, 16);
      m.shape(this.shapes.ball, tone, 9, 2, 2, 16, 10, 12);
      m.shape(this.shapes.ball, tone, -9, 1, -1, 15, 9, 12);
      m.shape(this.shapes.ball, tone, 3, 5, -3, 14, 9, 11);
      return batch.geometry()!;
    });
    // Only the clouds' shadows cross the map: seen from above they would hide it.
    const cloudMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    this.owned.push(cloudMaterial);
    for (let i = 0; i < count; i++) {
      const c = new THREE.Mesh(puff, cloudMaterial);
      c.position.set(island.x - 200 + random() * (island.w + 400), 110 + random() * 50, island.z - 100 + random() * (island.d + 200));
      const s = 0.8 + random() * 1.2;
      c.scale.set(s, s, s);
      c.castShadow = true;
      c.userData.speed = 3 + random() * 4;
      this.clouds.add(c);
    }
    // Rain.
    if (this.rain) {
      this.scene.remove(this.rain);
      this.rain.geometry.dispose();
      (this.rain.material as THREE.Material).dispose();
      this.rain = null;
    }
    if (w.weather === 'rain') {
      const n = this.small ? 1200 : 3000;
      const pos = new Float32Array(n * 6);
      for (let i = 0; i < n; i++) {
        const x = (Math.random() - 0.5) * 600;
        const y = Math.random() * 160;
        const z = (Math.random() - 0.5) * 600;
        pos.set([x, y, z, x + 0.4, y - 3.2, z + 0.2], i * 6);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      this.rain = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x9fb3cc, transparent: true, opacity: 0.55 }));
      this.scene.add(this.rain);
    }
    // A rainbow on the best day of the window.
    if (this.rainbow) {
      this.scene.remove(this.rainbow);
      this.rainbow.geometry.dispose();
      this.rainbow = null;
    }
    if (w.rainbow && this.plan) {
      const bands = [0xe74c3c, 0xf39c12, 0xf1c40f, 0x2ecc71, 0x3498db, 0x8e44ad];
      const parts = bands.map((c, i) => {
        const t = new THREE.TorusGeometry(260 - i * 7, 3.4, 6, 64, Math.PI);
        const colors = new Float32Array(t.attributes.position.count * 3);
        const col = new THREE.Color(c);
        for (let k = 0; k < t.attributes.position.count; k++) colors.set([col.r, col.g, col.b], k * 3);
        t.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        return t;
      });
      const geometry = mergeGeometries(parts);
      parts.forEach((p) => p.dispose());
      const material = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.38, depthWrite: false, fog: false });
      this.owned.push(material);
      this.rainbow = new THREE.Mesh(geometry, material);
      const i = this.plan.island;
      this.rainbow.position.set(i.x + i.w / 2, -20, i.z - 120);
      this.scene.add(this.rainbow);
    }
    this.applyLight(true);
  }

  // ── Building the city ─────────────────────────────────────────────────────

  /** A shared geometry made once (a vehicle, a cloud). */
  private kind(name: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
    let g = this.kinds.get(name);
    if (!g) {
      g = make();
      this.kinds.set(name, g);
    }
    return g;
  }

  private vehicle(name: 'truck' | 'van' | 'cash' | 'forklift' | 'forks' | 'ship' | 'plane' | 'car' | 'pallet' | 'container' | 'person') {
    return this.kind(name, () => {
      const batch = new Batch();
      const m = new Model(batch, this.shapes);
      if (name === 'truck') buildTruck(m);
      else if (name === 'van') buildVan(m);
      else if (name === 'cash') buildVan(m, 0x2e7d4f);
      else if (name === 'forklift') buildForklift(m);
      else if (name === 'forks') buildForks(m);
      else if (name === 'ship') buildShip(m, 'ship');
      else if (name === 'plane') buildPlane(m);
      else if (name === 'pallet') {
        buildPallet(m);
        for (let i = 0; i < 6; i++) m.box(COLORS.cardboard, -0.38 + (i % 3) * 0.38, -0.22 + Math.floor(i / 3) * 0.44, 0.36, 0.34, 0.42, 0.15);
      } else if (name === 'container') buildContainer(m, COLORS.teal);
      else if (name === 'person') {
        // A figure in sunglasses, twice life size so it reads from afar.
        const k = 2.2;
        m.box(COLORS.white, 0, 0, 0.8 * k, 0.9 * k, 0.5 * k, 0.65 * k);
        m.box(0xf2d3b3, 0, 0, 0.66 * k, 0.6 * k, 0.6 * k, 1.58 * k);
        for (const x of [-0.17, 0.17]) m.box(0x111317, x * k, 0.31 * k, 0.27 * k, 0.16 * k, 0.05 * k, 1.78 * k);
        m.box(0x111317, 0, 0.31 * k, 0.6 * k, 0.05 * k, 0.04 * k, 1.83 * k);
        for (const x of [-0.2, 0.2]) m.box(0x3b4252, x * k, 0, 0.26 * k, 0.65 * k, 0.3 * k);
      }
      else {
        // A small car: body, cabin, wheels.
        m.box(COLORS.white, 0, 0, 1.8, 0.7, 4.2, 0.35);
        m.box(COLORS.glassDark, 0, -0.2, 1.6, 0.6, 2.2, 1.05);
        for (const z of [1.3, -1.3]) for (const x of [-0.85, 0.85]) m.wheel(x, z, 0.33, 0.25);
      }
      return batch.geometry()!;
    });
  }

  private clearWorld() {
    for (const o of this.owned) o.dispose();
    this.owned = [];
    this.world.clear();
    for (const m of this.movers) m.label?.remove();
    this.movers = [];
    this.life.clear();
    this.proxies = [];
    this.animated = [];
    for (const l of this.labels) l.el.remove();
    this.labels = [];
    this.atlas?.dispose();
    this.atlas = null;
    this.signMaterial?.dispose();
    this.signMaterial = null;
    this.lampHeads = null;
  }

  /** An invisible box to pick a thing by. */
  private proxy(id: string, x: number, z: number, w: number, h: number, d: number, ry = 0, facing?: number) {
    const mesh = new THREE.Mesh(this.shapes.box, PROXY_MATERIAL);
    mesh.position.set(x, h / 2, z);
    mesh.scale.set(w, h, d);
    mesh.rotation.y = ry;
    mesh.userData.pick = { id, base: { x, z }, radius: Math.max(w, d) / 2, height: h, facing } satisfies Picked;
    mesh.updateMatrixWorld();
    this.world.add(mesh);
    this.proxies.push(mesh);
  }

  private label(text: string, x: number, y: number, z: number, kind: Label['kind'], id?: string, tone?: Tone) {
    const el = document.createElement('div');
    el.textContent = text;
    el.dir = 'rtl';
    const toned = {
      red: 'bg-red-50/95 text-red-700 ring-red-200 dark:bg-red-950/90 dark:text-red-200',
      amber: 'bg-amber-50/95 text-amber-800 ring-amber-200 dark:bg-amber-950/90 dark:text-amber-200',
      blue: 'bg-white/95 text-[#2f6fe0] ring-black/5 dark:bg-slate-900/90',
      green: 'bg-emerald-50/95 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/90 dark:text-emerald-200',
    };
    el.className =
      kind === 'district'
        ? 'pointer-events-none absolute left-0 top-0 whitespace-nowrap rounded-full bg-white/90 px-3 py-1 text-[12.5px] font-semibold text-slate-800 shadow-md ring-1 ring-black/5 backdrop-blur will-change-transform dark:bg-slate-900/85 dark:text-slate-100'
        : `pointer-events-none absolute left-0 top-0 flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold shadow-md ring-1 will-change-transform ${
            tone ? toned[tone] : 'bg-white/95 text-slate-800 ring-black/5 dark:bg-slate-900/90 dark:text-slate-100'
          }`;
    this.labelLayer.appendChild(el);
    this.labels.push({ el, pos: new THREE.Vector3(x, y, z), kind, id });
  }

  private rebuild() {
    const plan = this.plan!;
    const data = this.data!;
    this.clearWorld();
    const glassBatch = new Batch();
    const batch = new Router(glassBatch);
    const lamps = new Batch();
    const atlas = new SignAtlas(this.small ? 96 : 128, this.renderer.capabilities.getMaxAnisotropy());
    this.atlas = atlas;
    const S = this.shapes;
    const flat = new Model(batch, S);

    // ── The ground: two islands in the sea ───────────────────────────────
    for (const rect of [plan.island, plan.china.island]) {
      const slab = islandSlab(rect, 10);
      this.owned.push(slab.geometry);
      this.world.add(slab);
    }
    // Lawns: the centre's plazas, the homes' quarter.
    for (const d of plan.districts) {
      if (d.key === 'customers' || d.key === 'hq' || d.key === 'treasury' || d.key === 'office' || d.key === 'site') {
        flat.box(d.key === 'customers' ? COLORS.lawn : 0xe6efe2, d.center.x, d.center.z, d.rect.w, 0.05, d.rect.d);
      }
    }
    // The warehouse block's concrete, the port's quay.
    const wd = plan.districts.find((d) => d.key === 'warehouse');
    if (wd) flat.box(0xe4e8ee, wd.center.x, wd.center.z, wd.rect.w, 0.06, wd.rect.d);
    const pd = plan.districts.find((d) => d.key === 'port')!;
    flat.box(0xdadfe6, pd.center.x, pd.center.z, pd.rect.w, 0.07, pd.rect.d);

    // ── Roads: asphalt, sidewalks, markings, crossings ────────────────────
    for (const r of plan.roads) this.paveRoad(flat, r, plan);

    // ── The warehouses ───────────────────────────────────────────────────
    const boxes: Array<{ x: number; y: number; z: number; ry: number; family: string; top: boolean }> = [];
    const pins: Array<{ x: number; z: number; y: number; color: number }> = [];
    for (const y of plan.warehouses) {
      const w = data.stock?.warehouses.find((x) => x.id === y.warehouseId);
      if (!w) continue;
      const b = y.building;
      const hall = new Model(batch, S, b.x + b.w / 2, b.z + b.d / 2, 0);
      buildHall(atlas, hall, b.w, b.d, y.docks.length, w.name);
      this.proxy(`warehouse:${w.id}`, b.x + b.w / 2, b.z + b.d / 2, b.w, 11, b.d, 0, 0);
      const low = data.stock!.products.filter((p) => (p.byWarehouse[w.id] ?? 0) > 0 && p.level === 'LOW').length;
      this.label(`${w.units.toLocaleString('fa-IR')} عدد · ${y.pallets.length.toLocaleString('fa-IR')} کالا${low ? ` · ${low.toLocaleString('fa-IR')} کم` : ''}`, b.x + b.w / 2, 14, b.z + b.d / 2, 'info', `warehouse:${w.id}`, 'blue');
      // Truck bays: yellow lines; a truck backed up to some of them.
      const busy = Math.min(y.truckBays.length - 1, 2 + (data.sales?.today.orders ?? 0));
      y.truckBays.forEach((bay, k) => {
        for (const dx of [0, bay.w]) flat.box(COLORS.yellow, bay.x + dx, bay.z + bay.d / 2, 0.18, 0.07, bay.d);
        if (k < busy) buildTruck(new Model(batch, S, bay.x + bay.w / 2, y.docks[k].z + 7.4, 0), k % 2 ? COLORS.blue : 0x26303f);
      });
      // The pallet yard: an outline, then a pallet per product with a box per unit (up to 24).
      if (y.pallets.length) {
        const xs = y.pallets.map((p) => p.x);
        const zs = y.pallets.map((p) => p.z);
        const outline: Rect = { x: Math.min(...xs) - 1.8, z: Math.min(...zs) - 1.6, w: Math.max(...xs) - Math.min(...xs) + 3.6, d: Math.max(...zs) - Math.min(...zs) + 3.2 };
        for (const [x, z, w2, d2] of [
          [outline.x + outline.w / 2, outline.z, outline.w, 0.16],
          [outline.x + outline.w / 2, outline.z + outline.d, outline.w, 0.16],
          [outline.x, outline.z + outline.d / 2, 0.16, outline.d],
          [outline.x + outline.w, outline.z + outline.d / 2, 0.16, outline.d],
        ]) flat.box(COLORS.yellow, x, z, w2, 0.075, d2);
      }
      for (const p of y.pallets) {
        buildPallet(new Model(batch, S, p.x, p.z, 0));
        const shown = Math.min(24, p.units);
        for (let i = 0; i < shown; i++) {
          const layer = Math.floor(i / 6);
          const cell = i % 6;
          boxes.push({ x: p.x - 0.38 + (cell % 3) * 0.38, y: 0.15 + layer * 0.35, z: p.z - 0.22 + Math.floor(cell / 3) * 0.44, ry: 0, family: p.product.family, top: i >= shown - Math.min(6, shown - layer * 6) });
        }
        if (p.product.level !== 'OK') pins.push({ x: p.x, z: p.z, y: 0.3 + Math.ceil(shown / 6) * 0.35, color: p.product.level === 'OUT' ? 0xd9534f : 0xf0a14a });
        this.proxy(`product:${w.id}:${p.product.id}`, p.x, p.z, 1.3, 0.4 + Math.ceil(shown / 6) * 0.35, 1.1);
      }
      // Containers by the hall, the brand's own among them.
      const cx = b.x + b.w + 6;
      buildContainer(new Model(batch, S, cx, b.z + 5, 0), COLORS.teal);
      buildContainer(new Model(batch, S, cx, b.z + 12, 0), COLORS.blue);
      buildContainer(new Model(batch, S, cx, b.z + 5, 0, 2.6), COLORS.orange);
      signOn(atlas, new Model(batch, S, cx, b.z + 5, 0), { text: 'THEMOAK LINE', style: 'brand', ltr: true }, 1.25, 1.4, 0, 4.6, 1.0, Math.PI / 2);
      // A fence round the block.
      if (wd) this.fence(flat, wd.rect);
      // Forklifts at work.
      const docks = y.docks;
      const forklifts = Math.min(3, Math.max(1, Math.ceil(y.pallets.length / 30)));
      for (let k = 0; k < forklifts; k++) this.addForklift(y.pallets.map((p) => ({ x: p.x, z: p.z })), docks, k);
    }
    this.instanceBoxes(boxes);
    this.instancePins(pins);

    this.buildCentre(batch, atlas, lamps, plan, data);

    // ── Finishing: the merged meshes ─────────────────────────────────────
    for (const [b, material] of [[batch, this.matte], [glassBatch, this.glass]] as const) {
      const mesh = b.mesh(material);
      if (mesh) {
        this.owned.push(mesh.geometry);
        this.world.add(mesh);
      }
    }
    const lampMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, emissive: 0x000000 });
    this.owned.push(lampMaterial);
    const lampMesh = lamps.mesh(lampMaterial, false);
    if (lampMesh) {
      this.owned.push(lampMesh.geometry);
      this.world.add(lampMesh);
      this.lampHeads = lampMesh;
    }
    this.signMaterial = new THREE.MeshStandardMaterial({ map: atlas.texture, roughness: 0.6, emissive: 0xffffff, emissiveMap: atlas.texture, emissiveIntensity: 0.12 });
    const signs = atlas.mesh(this.signMaterial);
    if (signs) {
      this.owned.push(signs.geometry);
      this.world.add(signs);
    }
    for (const d of plan.districts) this.label(d.label, d.center.x, 16, d.center.z, 'district', `district:${d.key}`);
    this.startTraffic();
    this.applyLight(true);
  }

  /** A road: asphalt, sidewalks with curbs, a dashed centre line, zebra crossings near each junction. */
  private paveRoad(m: Model, r: { a: Point; b: Point; width: number }, plan: CityPlan) {
    const dx = r.b.x - r.a.x;
    const dz = r.b.z - r.a.z;
    const length = Math.hypot(dx, dz);
    if (length < 0.5) return;
    const vertical = Math.abs(dx) < 1e-6;
    const cx = (r.a.x + r.b.x) / 2;
    const cz = (r.a.z + r.b.z) / 2;
    const along = (w: number, h: number, d: number, ox: number, oz: number, rgb: number, y = 0) =>
      vertical ? m.box(rgb, cx + ox, cz + oz, w, h, d, y) : m.box(rgb, cx + oz, cz + ox, d, h, w, y);
    along(r.width, 0.08, length + r.width, 0, 0, COLORS.road);
    for (const side of [-1, 1]) {
      along(2.6, 0.2, length + r.width + 5, side * (r.width / 2 + 1.3), 0, COLORS.sidewalk);
      along(0.25, 0.22, length + r.width + 5, side * (r.width / 2 + 0.12), 0, COLORS.curb);
    }
    // Junctions on this road: where another one meets it.
    const junctions = plan.nodes.filter((n) => plan.links[plan.nodes.indexOf(n)].length > 2 && (vertical ? Math.abs(n.x - r.a.x) < 1e-6 : Math.abs(n.z - r.a.z) < 1e-6));
    const start = vertical ? Math.min(r.a.z, r.b.z) : Math.min(r.a.x, r.b.x);
    const near = (t: number) => junctions.some((j) => Math.abs((vertical ? j.z : j.x) - t) < r.width * 0.9);
    for (let t = start + 4; t < start + length - 2; t += 7) {
      if (near(t)) continue;
      const o = t - (vertical ? cz : cx);
      along(0.22, 0.09, 3.2, 0, o, COLORS.marking);
    }
    for (const j of junctions) {
      for (const sign of [-1, 1]) {
        const o = (vertical ? j.z - cz : j.x - cx) + sign * (r.width * 0.5 + 2.2);
        if (Math.abs(o) > length / 2) continue;
        for (let k = -r.width / 2 + 1; k < r.width / 2 - 0.5; k += 1.4) along(0.7, 0.09, 2.6, k, o, COLORS.marking);
      }
    }
  }

  /** A fence round a block: posts and two rails, open where the trucks come in. */
  private fence(m: Model, rect: Rect) {
    const gate = { z0: rect.z + rect.d * 0.3, z1: rect.z + rect.d * 0.62 };
    const side = (ax: number, az: number, bx: number, bz: number) => {
      const length = Math.hypot(bx - ax, bz - az);
      const steps = Math.max(1, Math.floor(length / 3));
      for (let i = 0; i <= steps; i++) {
        const x = ax + ((bx - ax) * i) / steps;
        const z = az + ((bz - az) * i) / steps;
        if (ax === bx && ax > rect.x + 1 && z > gate.z0 && z < gate.z1) continue;
        m.post(COLORS.steel, x, z, 0.06, 1.8);
      }
      const vertical = ax === bx;
      for (const y of [0.9, 1.75]) {
        if (vertical && ax > rect.x + 1) {
          m.box(COLORS.steel, ax, (az + gate.z0) / 2, 0.06, 0.06, gate.z0 - az, y);
          m.box(COLORS.steel, ax, (gate.z1 + bz) / 2, 0.06, 0.06, bz - gate.z1, y);
        } else if (vertical) m.box(COLORS.steel, ax, (az + bz) / 2, 0.06, 0.06, bz - az, y);
        else m.box(COLORS.steel, (ax + bx) / 2, az, bx - ax, 0.06, 0.06, y);
      }
    };
    const x1 = rect.x + rect.w;
    const z1 = rect.z + rect.d;
    side(rect.x, rect.z, x1, rect.z);
    side(rect.x, z1, x1, z1);
    side(rect.x, rect.z, rect.x, z1);
    side(x1, rect.z, x1, z1);
  }

  /** Every box on every pallet, in one instanced mesh; the top layer's tape in the model's colour. */
  private instanceBoxes(boxes: Array<{ x: number; y: number; z: number; ry: number; family: string; top: boolean }>) {
    if (!boxes.length) return;
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
    this.owned.push(material);
    const mesh = new THREE.InstancedMesh(this.shapes.box, material, boxes.length);
    const tape = new THREE.InstancedMesh(this.shapes.box, material, boxes.length);
    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();
    boxes.forEach((b, i) => {
      matrix.compose(new THREE.Vector3(b.x, b.y + 0.17, b.z), new THREE.Quaternion(), new THREE.Vector3(0.36, 0.34, 0.42));
      mesh.setMatrixAt(i, matrix);
      mesh.setColorAt(i, color.set(COLORS.cardboard).offsetHSL(0, 0, (hash(`${b.x}${b.z}${i}`) - 0.5) * 0.06));
      matrix.compose(new THREE.Vector3(b.x, b.y + 0.345, b.z), new THREE.Quaternion(), new THREE.Vector3(0.08, b.top ? 0.012 : 0.001, 0.43));
      tape.setMatrixAt(i, matrix);
      tape.setColorAt(i, color.set(FAMILY[Math.floor(hash(b.family) * FAMILY.length) % FAMILY.length]));
    });
    for (const m of [mesh, tape]) {
      m.castShadow = true;
      m.receiveShadow = true;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      this.world.add(m);
      this.owned.push({ dispose: () => m.dispose() });
    }
  }

  /** Small pins over the pallets that are out (red) or running low (amber), bobbing. */
  private instancePins(pins: Array<{ x: number; z: number; y: number; color: number }>) {
    if (!pins.length) return;
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, emissive: 0x220000, emissiveIntensity: 0.3 });
    this.owned.push(material);
    const mesh = new THREE.InstancedMesh(this.pinGeometry, material, pins.length);
    const color = new THREE.Color();
    pins.forEach((p, i) => mesh.setColorAt(i, color.set(p.color)));
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = true;
    this.world.add(mesh);
    this.owned.push({ dispose: () => mesh.dispose() });
    const matrix = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(0.32, 0.32, 0.32);
    const v = new THREE.Vector3();
    this.animated.push((t) => {
      pins.forEach((p, i) => {
        q.setFromAxisAngle(UP, t * 1.2 + i);
        matrix.compose(v.set(p.x, p.y + 0.3 + Math.sin(t * 2.4 + i) * 0.12, p.z), q, s);
        mesh.setMatrixAt(i, matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    });
  }

  /** A forklift that takes a pallet from the yard to a dock door and comes back, over and over. */
  private addForklift(spots: Point[], docks: Point[], k: number) {
    if (!spots.length || !docks.length) return;
    const body = new THREE.Mesh(this.vehicle('forklift'), this.matte);
    const forks = new THREE.Mesh(this.vehicle('forks'), this.matte);
    const load = new THREE.Mesh(this.vehicle('pallet'), this.matte);
    for (const m of [body, forks, load]) m.castShadow = true;
    forks.position.set(0, 0.1, 1.1);
    load.position.set(0, 0.12, 0.6);
    forks.add(load);
    const group = new THREE.Group();
    group.add(body, forks);
    this.life.add(group);
    const random = seeded(`forklift${k}`);
    let from = spots[Math.floor(random() * spots.length)];
    let to = docks[Math.floor(random() * docks.length)];
    let phase = 0;
    let t = random() * 3;
    const yardSpeed = 3.2;
    group.position.set(from.x, 0, from.z + 1.6);
    this.animated.push((_, dt) => {
      t += dt;
      // 0: drive to the pallet · 1: lift · 2: drive to the dock · 3: lower · 4: back off
      const goal = phase === 0 ? { x: from.x, z: from.z + 1.6 } : phase === 2 || phase === 3 ? { x: to.x, z: to.z + 2.2 } : null;
      if (goal) {
        const dx = goal.x - group.position.x;
        const dz = goal.z - group.position.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.1 && phase !== 3) {
          const step = Math.min(d, yardSpeed * dt);
          group.position.x += (dx / d) * step;
          group.position.z += (dz / d) * step;
          const heading = phase === 0 ? Math.atan2(-dx, -dz) : Math.atan2(dx, dz);
          let turn = heading - group.rotation.y;
          turn = Math.atan2(Math.sin(turn), Math.cos(turn));
          group.rotation.y += turn * Math.min(1, dt * 6);
          return;
        }
      }
      if (phase === 0) {
        phase = 1;
        t = 0;
        load.visible = true;
      } else if (phase === 1) {
        forks.position.y = 0.1 + Math.min(1, t / 1.2) * 0.5;
        if (t > 1.4) phase = 2;
      } else if (phase === 2) {
        phase = 3;
        t = 0;
      } else if (phase === 3) {
        forks.position.y = 0.6 - Math.min(1, t / 1.2) * 0.5;
        if (t > 1.4) {
          load.visible = false;
          phase = 0;
          from = spots[Math.floor(random() * spots.length)];
          to = docks[Math.floor(random() * docks.length)];
        }
      }
    });
    load.visible = false;
  }

  /** The rest of the city: stores, the bank and its coins, the headquarters, the tower, the office, homes, both ports, China, trees and lamps. */
  private buildCentre(batch: Batch, atlas: SignAtlas, lamps: Batch, plan: CityPlan, data: WorldData) {
    const S = this.shapes;
    // Stores on the shopping street.
    const columns: Array<{ x: number; z: number; units: number; family: string; id: string }> = [];
    const tokens: Token[] = [];
    for (const st of plan.stores) {
      const w = data.stock?.warehouses.find((x) => x.id === st.warehouseId);
      if (!w) continue;
      const b = st.building;
      const m = new Model(batch, S, b.x + b.w / 2, b.z + b.d / 2, b.facing);
      const height = buildStore(atlas, m, b.d, b.w, w.partner ?? w.name, w.id, w.units, st.size);
      this.proxy(`warehouse:${w.id}`, b.x + b.w / 2, b.z + b.d / 2, b.w, height, b.d, 0, b.facing);
      const sold = w.sales90 !== undefined ? ` · فروش ${tomanTick(w.sales90)}` : '';
      this.label(`${w.units.toLocaleString('fa-IR')} عدد${sold}`, b.x + b.w / 2, height + 2.5, b.z + b.d / 2, 'info', `warehouse:${w.id}`, 'blue');
      if (w.receivable) tokens.push({ x: b.x + b.w / 2, y: height + 6, z: b.z + b.d / 2 - 2, amount: w.receivable, tone: 'red' });
      if (w.payable) tokens.push({ x: b.x + b.w / 2, y: height + 6, z: b.z + b.d / 2 + 2, amount: w.payable, tone: 'amber' });
      // The forecourt: a pale pad, then a column of crates per product with sunglasses on top.
      const pad = st.plot;
      const fx = st.building.x === pad.x ? pad.x + b.w : pad.x;
      flatPad(batch, S, fx + (pad.w - b.w) / 2, pad.z + pad.d / 2, pad.w - b.w - 0.6, pad.d - 0.6);
      for (const c of st.display) {
        columns.push({ x: c.x, z: c.z, units: c.units, family: c.product.family, id: `product:${w.id}:${c.product.id}` });
      }
    }
    this.instanceColumns(columns);
    // The bank, its forecourt, a coin stack and a name plate per account.
    if (data.finance) {
      const b = plan.bank;
      buildBank(atlas, new Model(batch, S, b.x + b.w / 2, b.z + b.d / 2, 0), b.w, b.d);
      this.proxy('district:treasury', b.x + b.w / 2, b.z + b.d / 2, b.w, 11, b.d);
      const max = Math.max(1, ...data.finance.accounts.map((a) => Math.abs(a.toman ?? 0)));
      plan.accounts.forEach((spot) => {
        const a = data.finance!.accounts.find((x) => x.id === spot.id);
        if (!a) return;
        const value = a.toman ?? 0;
        const h = a.toman === null ? 0.3 : value <= 0 ? 0.15 : 0.4 + 6.5 * (Math.log10(1 + value / 1e5) / Math.log10(1 + max / 1e5));
        const color = value < 0 ? COLORS.red : a.toman === null ? 0xb9b2a6 : a.currency === 'USD' ? 0x5fb59a : a.currency === 'EUR' ? 0x8f86d6 : COLORS.gold;
        const m = new Model(batch, S, spot.x, spot.z, 0);
        m.box(COLORS.stone, 0, 0, 3.2, 0.3, 3.2);
        const discs = Math.max(1, Math.round(h / 0.3));
        // A stack of coins, each a little off the one below; Toman coins alternate two golds.
        for (let i = 0; i < discs; i++) m.post(i % 2 && color === COLORS.gold ? COLORS.goldDark : color, Math.sin(i * 1.7) * 0.06, Math.cos(i * 1.3) * 0.06, 1.0, (h / discs) * 0.92, 0.3 + (i * h) / discs);
        signOn(atlas, m, { text: a.name, style: 'plate' }, 0, 0.45, 1.62, 2.8, 0.55);
        this.proxy(`account:${a.id}`, spot.x, spot.z, 3.2, h + 0.6, 3.2);
        const shownAmount = a.currency === 'TOMAN' ? tomanTick(a.balance) : `${a.balance.toLocaleString('fa-IR', { maximumFractionDigits: 0 })} ${a.currency}`;
        this.label(shownAmount, spot.x, h + 2.4, spot.z, 'info', `account:${a.id}`, value < 0 ? 'red' : 'blue');
      });
    }
    // The headquarters and its plaza with a fountain.
    const hq = plan.hq;
    buildHq(atlas, new Model(batch, S, hq.x + hq.w / 2, hq.z + hq.d / 2, 0), hq.w, hq.d);
    this.proxy('district:hq', hq.x + hq.w / 2, hq.z + hq.d / 2, hq.w, 22, hq.d);
    const fountain = new Model(batch, S, plan.plaza.fountain.x, plan.plaza.fountain.z, 0);
    fountain.post(COLORS.stone, 0, 0, 6, 0.8);
    fountain.post(COLORS.water, 0, 0, 5.4, 0.85);
    fountain.post(COLORS.stone, 0, 0, 0.8, 2.6);
    if (data.sales) {
      const plaza = new Model(batch, S);
      const dayMax = Math.max(1, ...data.sales.days.map((d) => d.total));
      plan.plaza.days.forEach((spot, i) => {
        const d = data.sales!.days[i];
        if (!d) return;
        const h = 0.25 + 14 * (d.total / dayMax);
        const today = i === data.sales!.days.length - 1;
        plaza.box(COLORS.stone, spot.x, spot.z, 1.9, 0.25, 1.9);
        plaza.box(today ? COLORS.orange : COLORS.blue, spot.x, spot.z, 1.3, h, 1.3, 0.25);
        this.proxy(`day:${d.day}`, spot.x, spot.z, 1.9, h + 0.5, 1.9);
      });
      if (plan.plaza.days.length) {
        const first = plan.plaza.days[0];
        const last = plan.plaza.days[plan.plaza.days.length - 1];
        this.label('فروش ۳۰ روز', (first.x + last.x) / 2, 17, first.z, 'info', undefined, 'blue');
      }
      const topMax = Math.max(1, ...data.sales.topProducts.map((t) => t.units));
      plan.plaza.podium.forEach((spot, i) => {
        const t = data.sales!.topProducts[i];
        if (!t) return;
        const h = 0.6 + 5 * (t.units / topMax);
        plaza.box(COLORS.white, spot.x, spot.z, 3.4, h, 3.4);
        plaza.box(FAMILY[Math.floor(hash(t.family) * FAMILY.length) % FAMILY.length], spot.x, spot.z, 2, 1.4, 2, h);
        for (const dx of [-0.42, 0.42]) plaza.box(0x111317, spot.x + dx, spot.z + 1.02, 0.66, 0.34, 0.06, h + 0.8);
        plaza.box(0x111317, spot.x, spot.z + 1.02, 0.4, 0.08, 0.06, h + 1.02);
        this.proxy(`top:${t.id}`, spot.x, spot.z, 3.4, h + 1.6, 3.4);
        this.label(`${(i + 1).toLocaleString('fa-IR')}. ${t.name} · ${t.units.toLocaleString('fa-IR')}`, spot.x, h + 3.4, spot.z, 'info', `top:${t.id}`);
      });
    }
    // A billboard on the plaza: the best sellers' photos, one after another.
    const photos = (data.sales?.topProducts ?? []).filter((p) => p.image).slice(0, 8);
    if (photos.length) this.billboard(batch, atlas, plan.plaza.billboard, photos.map((p) => p.image!));
    // The website's tower and its status light.
    if (data.site) {
      const t = plan.tower;
      buildTower(atlas, new Model(batch, S, t.x + t.w / 2, t.z + t.d / 2, 0), t.w, t.d, data.site.host ?? 'وب‌سایت');
      this.proxy('site', t.x + t.w / 2, t.z + t.d / 2, t.w, 40, t.d);
      const failing = data.site.hook.paused || !!data.site.hook.failingSince;
      const status = !data.site.host ? 0x9aa3ad : failing ? 0xd9534f : data.site.stockPush ? 0x2ecc71 : 0xf0a14a;
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(1.1, 16, 12), new THREE.MeshStandardMaterial({ color: status, emissive: status, emissiveIntensity: 1.4 }));
      beacon.position.set(t.x + t.w / 2, 51.5, t.z + t.d / 2);
      this.world.add(beacon);
      this.owned.push(beacon.geometry, beacon.material as THREE.Material);
      this.animated.push((time) => {
        const k = 1 + Math.sin(time * (failing ? 7 : 2.2)) * 0.18;
        beacon.scale.set(k, k, k);
      });
    }
    // The projects' office.
    const o = plan.office;
    buildOffice(atlas, new Model(batch, S, o.x + o.w / 2, o.z + o.d / 2, 0), o.w, o.d);
    this.proxy('office', o.x + o.w / 2, o.z + o.d / 2, o.w, 11, o.d);
    // Homes by tier: mansions, villas and houses with their names; terraces and apartment blocks in the town,
    // their windows lit for those who bought in 90 days. Above each, what they owe us and what we owe them.
    const people = new Map<string, WorldCustomer>((data.customers?.people ?? []).map((c) => [c.id, c]));
    const lately = (c: WorldCustomer | undefined) => !!c?.lastAt && Date.parse(c.lastAt) > Date.now() - 90 * 86_400_000;
    for (const h of plan.homes) {
      const residents = h.residents.map((id) => people.get(id)).filter((c): c is WorldCustomer => !!c);
      if (!residents.length) continue;
      const cx = h.x + h.w / 2;
      const cz = h.z + h.d / 2;
      const m = new Model(batch, S, cx, cz, h.facing);
      const one = residents[0];
      let height = 9;
      if (h.kind === 'mansion') buildMansion(atlas, m, h.w, h.d, h.id, one.name);
      else if (h.kind === 'villa') buildVilla(atlas, m, h.w, h.d, h.id, one.name);
      else if (h.kind === 'house') {
        buildHome(atlas, m, h.w * 0.8, h.d * 0.8, h.id, one.name, false);
        height = 7;
      } else if (h.kind === 'terrace') buildTerrace(m, h.w, h.d, residents.length, h.id, residents.map(lately));
      else {
        buildApartment(m, h.w, h.d, residents.length, h.id, residents.map(lately));
        height = Math.max(2, Math.ceil(residents.length / 3)) * 3.1 + 0.5;
      }
      const single = h.kind === 'mansion' || h.kind === 'villa' || h.kind === 'house';
      this.proxy(single ? `customer:${one.id}` : `home:${h.id}`, cx, cz, h.w, height, h.d, 0, h.facing);
      const debt = residents.reduce((sum, c) => sum + c.debt, 0);
      const credit = residents.reduce((sum, c) => sum + c.credit, 0);
      if (debt > 0) {
        tokens.push({ x: cx - 1.8, y: height + 4, z: cz, amount: debt, tone: 'red' });
        this.label(`طلب ${tomanTick(debt)}`, cx - 1.8, height + 7.5, cz, 'info', single ? `customer:${one.id}` : `home:${h.id}`, 'red');
      }
      if (credit > 0) {
        tokens.push({ x: cx + 1.8, y: height + 4, z: cz, amount: credit, tone: 'amber' });
        this.label(`بدهی ${tomanTick(credit)}`, cx + 1.8, height + 7.5, cz, 'info', single ? `customer:${one.id}` : `home:${h.id}`, 'amber');
      }
    }
    // The quarters' signs.
    for (const q of plan.quarters) {
      const m = new Model(batch, S, q.rect.x + 9, q.rect.z + q.rect.d / 2, Math.PI);
      for (const x of [-3.2, 3.2]) m.post(COLORS.steelDark, x, 0, 0.12, 3.2);
      signOn(atlas, m, { text: q.label, style: 'hall' }, 0, 3.6, 0, 7.6, 1.5, 0, true);
    }
    // The port: the quay, its cranes, stacked containers, a ship at the berth.
    const port = plan.port;
    const quay = new Model(batch, S);
    quay.box(0xcfd5de, port.quay.x + port.quay.w / 2, port.quay.z + port.quay.d / 2, port.quay.w, 1.0, port.quay.d, -0.9);
    for (let z = port.quay.z + 3; z < port.quay.z + port.quay.d; z += 8) quay.post(COLORS.rubber, port.quay.x + 0.8, z, 0.3, 0.5, 0.1);
    for (const c of port.cranes) buildCrane(new Model(batch, S, c.x, c.z, 0));
    const random = seeded('port');
    const hues = [COLORS.blue, COLORS.red, COLORS.orange, COLORS.teal, 0x8a8f99];
    for (const c of port.containers) {
      const layers = 1 + Math.floor(random() * 3);
      for (let l = 0; l < layers; l++) buildContainer(new Model(batch, S, c.x, c.z, 0, l * 2.62), hues[Math.floor(random() * hues.length)]);
    }
    buildShip(new Model(batch, S, port.berth.x - 2, port.berth.z + 34, Math.PI), 'docked');
    this.proxy('port', port.quay.x + port.quay.w / 2, port.quay.z + port.quay.d / 2, 30, 26, port.quay.d);
    // China: the suppliers' factories, their quay and cranes.
    const china = plan.china;
    const cq = new Model(batch, S);
    cq.box(0xcfd5de, china.quay.x + china.quay.w / 2, china.quay.z + china.quay.d / 2, china.quay.w, 1.0, china.quay.d, -0.9);
    for (const c of china.cranes) buildCrane(new Model(batch, S, c.x, c.z, Math.PI));
    for (const f of china.factories) {
      const s = data.suppliers?.suppliers.find((x) => x.id === f.id);
      if (!s) continue;
      const fh = buildFactory(atlas, new Model(batch, S, f.x + f.w / 2, f.z + f.d / 2, f.facing), f.d, f.w, s.name, s.id, f.size);
      this.proxy(`supplier:${s.id}`, f.x + f.w / 2, f.z + f.d / 2, f.w, fh + 3, f.d, 0, f.facing);
      if (s.credit) {
        tokens.push({ x: f.x + f.w / 2, y: fh + 9, z: f.z + f.d / 2 - 2.5, amount: s.credit, tone: 'red' });
        this.label(`طلب ${tomanTick(s.credit)}`, f.x + f.w / 2, fh + 12.5, f.z + f.d / 2 - 2.5, 'info', `supplier:${s.id}`, 'red');
      }
      if (s.unpaid) {
        tokens.push({ x: f.x + f.w / 2, y: fh + 9, z: f.z + f.d / 2 + 2.5, amount: s.unpaid, tone: 'amber' });
        this.label(`بدهی ${tomanTick(s.unpaid)}`, f.x + f.w / 2, fh + 12.5, f.z + f.d / 2 + 2.5, 'info', `supplier:${s.id}`, 'amber');
      }
      if (s.open > 0) this.smoke(f.x + f.w / 2 - (f.w * 0.3), f.z + f.d / 2 - f.d * 0.32, fh * 2 + 1);
    }
    if (china.factories.length) {
      const c = china.island;
      this.label('چین', c.x + c.w / 2, 30, c.z + 10, 'district', 'district:suppliers');
    }
    // Trees and lamps along the streets.
    for (const [i, t] of plan.trees.entries()) buildTree(new Model(batch, S, t.x, t.z, 0), `tree${i}`);
    for (const l of plan.lamps) {
      buildLamp(new Model(batch, S, l.x, l.z, 0));
      lamps.add(S.box, { x: l.x, y: 5.85, z: l.z + 1.2, sx: 0.5, sy: 0.12, sz: 0.7 }, 0xfffbe8);
    }
    // Revenue and expenses beside the bank, a bar per category.
    if (data.finance) {
      const fm = new Model(batch, S);
      const max = Math.max(1, ...data.finance.flows.income.map((f) => f.amount), ...data.finance.flows.expense.map((f) => f.amount));
      for (const [kind, rows, spots] of [['income', data.finance.flows.income, plan.flows.income], ['expense', data.finance.flows.expense, plan.flows.expense]] as const) {
        rows.forEach((row, i) => {
          const spot = spots[i];
          if (!spot) return;
          const h = 0.3 + 10 * (row.amount / max);
          fm.box(COLORS.stone, spot.x, spot.z, 3, 0.25, 3);
          fm.box(kind === 'income' ? 0x2ecc71 : COLORS.red, spot.x, spot.z, 2.2, h, 2.2, 0.25);
          this.proxy(`flow:${kind}:${row.category}`, spot.x, spot.z, 3, h + 0.5, 3);
          this.label(`${row.category} · ${tomanTick(row.amount)}`, spot.x, h + 2.4, spot.z, 'info', `flow:${kind}:${row.category}`, kind === 'income' ? 'green' : 'red');
        });
      }
    }
    // The products on the website circle its tower.
    if (data.site && data.site.productsOnSite > 0) {
      const t = plan.tower;
      const count = Math.min(120, data.site.productsOnSite);
      const ringMesh = new THREE.InstancedMesh(this.shapes.box, this.matte, count);
      const matrix = new THREE.Matrix4();
      for (let i = 0; i < count; i++) {
        const a = (i / count) * TAU;
        matrix.compose(new THREE.Vector3(Math.cos(a) * 15, Math.sin(i * 1.7) * 0.6, Math.sin(a) * 15), new THREE.Quaternion(), new THREE.Vector3(0.8, 0.8, 0.8));
        ringMesh.setMatrixAt(i, matrix);
        ringMesh.setColorAt(i, new THREE.Color(FAMILY[i % FAMILY.length]));
      }
      ringMesh.instanceMatrix.needsUpdate = true;
      if (ringMesh.instanceColor) ringMesh.instanceColor.needsUpdate = true;
      const holder = new THREE.Group();
      holder.position.set(t.x + t.w / 2, 30, t.z + t.d / 2);
      holder.add(ringMesh);
      this.world.add(holder);
      this.owned.push({ dispose: () => ringMesh.dispose() });
      this.animated.push((_, dt) => {
        holder.rotation.y += dt * 0.25;
      });
      this.label(`${data.site.productsOnSite.toLocaleString('fa-IR')} کالا روی سایت`, t.x + t.w / 2, 55, t.z + t.d / 2, 'info', 'site', 'blue');
    }
    this.instanceTokens(tokens);
  }

  /** A billboard: posts, a frame, a photo that changes every few seconds, «پرفروش‌ها» under it. */
  private billboard(batch: Batch, atlas: SignAtlas, at: Point, urls: string[]) {
    const m = new Model(batch, this.shapes, at.x, at.z, Math.PI / 4);
    for (const x of [-5, 5]) m.post(COLORS.steelDark, x, -0.3, 0.25, 6);
    m.box(0x26303f, 0, 0, 13.4, 8.2, 0.5, 5.6);
    signOn(atlas, m, { text: 'پرفروش‌ها', style: 'host' }, 0, 5.0, 0.3, 6, 1.0);
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.owned.push(material);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(12.6, 7.4), material);
    this.owned.push(screen.geometry);
    const p = m.at(0, 0.27);
    screen.position.set(p.x, 9.7, p.z);
    screen.rotation.y = Math.PI / 4;
    this.world.add(screen);
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');
    const textures: Array<THREE.Texture | null> = urls.map(() => null);
    let shown = -1;
    const show = (i: number) => {
      const done = (t: THREE.Texture | null) => {
        if (!t || this.disposed) return;
        textures[i] = t;
        material.map = t;
        material.needsUpdate = true;
      };
      if (textures[i]) done(textures[i]);
      else
        loader.load(urls[i], (t) => {
          t.colorSpace = THREE.SRGBColorSpace;
          this.owned.push(t);
          done(t);
        }, undefined, () => undefined);
    };
    this.animated.push((t) => {
      const i = Math.floor(t / 6) % urls.length;
      if (i !== shown) {
        shown = i;
        show(i);
      }
    });
  }

  /** A crate column per product in front of each store: a crate per unit (up to 10), sunglasses on top. */
  private instanceColumns(columns: Array<{ x: number; z: number; units: number; family: string; id: string }>) {
    if (!columns.length) return;
    const crates = columns.reduce((n, c) => n + Math.min(10, c.units), 0);
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75 });
    this.owned.push(material);
    const boxes = new THREE.InstancedMesh(this.shapes.box, material, crates);
    const lenses = new THREE.InstancedMesh(this.shapes.box, material, columns.length * 3);
    const matrix = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const color = new THREE.Color();
    let i = 0;
    columns.forEach((c, k) => {
      const tint = FAMILY[Math.floor(hash(c.family) * FAMILY.length) % FAMILY.length];
      const n = Math.min(10, c.units);
      for (let l = 0; l < n; l++) {
        matrix.compose(new THREE.Vector3(c.x, 0.2 + l * 0.36, c.z), q, new THREE.Vector3(0.7, 0.33, 0.7));
        boxes.setMatrixAt(i, matrix);
        boxes.setColorAt(i, color.set(tint).offsetHSL(0, 0, l % 2 ? 0.06 : 0));
        i++;
      }
      const top = 0.2 + n * 0.36 + 0.1;
      for (const [j, dx, w] of [[0, -0.15, 0.24], [1, 0.15, 0.24], [2, 0, 0.56]] as const) {
        matrix.compose(new THREE.Vector3(c.x + dx, top + (j === 2 ? 0.08 : 0), c.z), q, new THREE.Vector3(w, j === 2 ? 0.03 : 0.12, 0.05));
        lenses.setMatrixAt(k * 3 + j, matrix);
        lenses.setColorAt(k * 3 + j, color.set(0x111317));
      }
      this.proxy(c.id, c.x, c.z, 0.8, top + 0.3, 0.8);
    });
    for (const m of [boxes, lenses]) {
      m.castShadow = true;
      m.receiveShadow = true;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      this.world.add(m);
      this.owned.push({ dispose: () => m.dispose() });
    }
  }

  /** Coins floating over who owes whom: red, they owe us; amber, we owe them. Bigger for more. */
  private instanceTokens(tokens: Token[]) {
    if (!tokens.length) return;
    const geometry = new THREE.CylinderGeometry(1, 1, 0.28, 28).rotateX(Math.PI / 2);
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.4, emissive: 0x220000, emissiveIntensity: 0.25 });
    this.owned.push(geometry, material);
    const mesh = new THREE.InstancedMesh(geometry, material, tokens.length);
    const color = new THREE.Color();
    tokens.forEach((t, i) => mesh.setColorAt(i, color.set(t.tone === 'red' ? 0xe0443e : 0xf2a33a)));
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = true;
    this.world.add(mesh);
    this.owned.push({ dispose: () => mesh.dispose() });
    const sizes = tokens.map((t) => THREE.MathUtils.clamp(0.7 + Math.log10(1 + t.amount / 1e5) * 0.45, 0.7, 2.6));
    const matrix = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    this.animated.push((t) => {
      tokens.forEach((tok, i) => {
        q.setFromAxisAngle(UP, t * 1.6 + i);
        sc.setScalar(sizes[i]);
        matrix.compose(v.set(tok.x, tok.y + Math.sin(t * 2 + i) * 0.35, tok.z), q, sc);
        mesh.setMatrixAt(i, matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    });
  }

  /** Smoke from a chimney while a purchase order is open. */
  private smoke(x: number, z: number, y = 15) {
    const material = new THREE.MeshStandardMaterial({ color: 0xe6e9ef, transparent: true, opacity: 0.75, roughness: 1 });
    this.owned.push(material);
    const puffs = Array.from({ length: 4 }, (_, k) => {
      const m = new THREE.Mesh(this.shapes.ball, material);
      this.world.add(m);
      return { m, phase: k / 4 };
    });
    this.animated.push((t) => {
      for (const { m, phase } of puffs) {
        const f = (t * 0.25 + phase) % 1;
        const s = 1.2 + f * 3;
        m.position.set(x + f * 3, y + f * 9, z - f);
        m.scale.set(s, s, s);
      }
    });
  }

  // ── Life on the streets ───────────────────────────────────────────────────

  private moverMesh(name: Parameters<WorldEngine['vehicle']>[0]) {
    const mesh = new THREE.Mesh(this.vehicle(name), this.matte);
    mesh.castShadow = true;
    this.life.add(mesh);
    return mesh;
  }

  /** Cars going about the city, and a ship plying between the ports. */
  private startTraffic() {
    const plan = this.plan!;
    const cars = this.small ? 5 : 12;
    const tints = [0xfbfcfe, 0xd9534f, 0x2f6fe0, 0x26303f, 0xf2b705, 0x9aa4b2];
    for (let i = 0; i < cars; i++) {
      const mesh = this.moverMesh('car');
      const random = seeded(`car${i}`);
      // White paint times a tint: cars in a few colours.
      const paint = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.2, color: tints[i % tints.length] });
      this.owned.push(paint);
      mesh.material = paint;
      const go = () => {
        const a = plan.nodes[Math.floor(random() * plan.nodes.length)];
        const b = plan.nodes[Math.floor(random() * plan.nodes.length)];
        const mover: Mover = { mesh, legs: [{ path: route(plan, a, b), speed: 8 + random() * 4, kind: 'road' }], leg: 0, s: 0, label: null, ambient: true, done: () => go() };
        this.movers.push(mover);
      };
      go();
    }
    // People out for a walk, on the sidewalks.
    const walkers = this.small ? 6 : 16;
    for (let i = 0; i < walkers; i++) {
      const paint = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, color: PEOPLE[i % PEOPLE.length] });
      this.owned.push(paint);
      const mesh = new THREE.Mesh(this.vehicle('person'), paint);
      mesh.scale.setScalar(0.42);
      mesh.castShadow = true;
      this.life.add(mesh);
      const random = seeded(`walker${i}`);
      const go = () => {
        const a = plan.nodes[Math.floor(random() * plan.nodes.length)];
        const b = plan.nodes[Math.floor(random() * plan.nodes.length)];
        this.movers.push({ mesh, legs: [{ path: route(plan, a, b), speed: 1.3 + random() * 0.6, kind: 'walk' }], leg: 0, s: 0, label: null, ambient: true, done: () => go() });
      };
      go();
    }
    const ship = this.moverMesh('ship');
    const sail = (forward: boolean) => {
      const path = forward ? plan.lane : [...plan.lane].reverse();
      const offset = path.map((p) => ({ x: p.x, z: p.z + 70 }));
      this.movers.push({ mesh: ship, legs: [{ path: offset, speed: 7, kind: 'sea' }], leg: 0, s: 0, label: null, ambient: true, done: () => sail(!forward) });
    };
    sail(true);
  }

  /** One event's journey: by street, by sea or air, by street again. */
  private sendEvent(event: WorldEvent, fresh: boolean) {
    const plan = this.plan!;
    const from = plan.places.get(event.from);
    const to = plan.places.get(event.to);
    if (!from || !to) return;
    if (event.kind === 'adjust' || (from.x === to.x && from.z === to.z)) {
      this.burst(to, 0x9aa4b2, 14);
      return;
    }
    const kind = event.kind === 'transfer' || event.kind === 'purchase' ? 'truck' : event.kind === 'income' || event.kind === 'expense' ? 'cash' : 'van';
    const legs: Mover['legs'] = [];
    if (event.from.startsWith('sup:')) {
      // From the factory to the quay in China, over the water, from the port to the warehouse.
      const china = plan.china;
      legs.push({ path: [from, { x: china.quay.x - 6, z: from.z }, { x: china.quay.x - 6, z: china.berth.z }], speed: 12, kind: 'road' });
      const byAir = hash(event.id) < 0.34;
      if (byAir) legs.push({ path: [{ x: china.island.x + china.island.w / 2, z: china.berth.z }, plan.port.berth], speed: 60, kind: 'air', y: (t) => 8 + Math.sin(t * Math.PI) * 70 });
      else legs.push({ path: plan.lane, speed: 28, kind: 'sea' });
      const portStreet = plan.places.get('port')!;
      legs.push({ path: route(plan, portStreet, to), speed: 14, kind: 'road' });
    } else {
      legs.push({ path: route(plan, from, to), speed: kind === 'truck' ? 13 : 16, kind: 'road' });
    }
    const first = legs[0].kind === 'road' ? kind : legs[0].kind === 'air' ? 'plane' : 'ship';
    const mesh = this.moverMesh(first as any);
    let label: HTMLDivElement | null = null;
    if (fresh || this.dist < 260) {
      label = document.createElement('div');
      label.dir = 'rtl';
      label.className = `pointer-events-none absolute left-0 top-0 flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium shadow-md ring-1 will-change-transform ${
        fresh ? 'bg-amber-50 text-amber-900 ring-amber-300 dark:bg-amber-950 dark:text-amber-100' : 'bg-white/95 text-slate-700 ring-black/5 dark:bg-slate-900/90 dark:text-slate-200'
      }`;
      const dot = document.createElement('span');
      dot.className = 'inline-block h-2 w-2 rounded-full';
      dot.style.background = `#${EVENT_COLORS[event.kind].toString(16).padStart(6, '0')}`;
      label.append(dot, document.createTextNode(event.label));
      this.labelLayer.appendChild(label);
    }
    const mover: Mover = {
      mesh,
      legs,
      leg: 0,
      s: 0,
      label,
      ambient: false,
      done: () => {
        if (fresh) this.burst(to, EVENT_COLORS[event.kind], 60);
      },
    };
    this.movers.push(mover);
  }

  /** Confetti (or a puff) at a place. */
  private burst(at: Point, rgb: number, count: number) {
    const geometry = this.shapes.box;
    const colors = [rgb, 0xf2b705, 0x2f6fe0, 0xd9534f, 0x2ecc71, 0xffffff];
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    const bits = Array.from({ length: count }, (_, i) => ({
      p: new THREE.Vector3(at.x, 3, at.z),
      v: new THREE.Vector3((Math.random() - 0.5) * 10, 8 + Math.random() * 10, (Math.random() - 0.5) * 10),
      r: Math.random() * TAU,
      c: colors[i % colors.length],
    }));
    const color = new THREE.Color();
    bits.forEach((b, i) => mesh.setColorAt(i, color.set(b.c)));
    this.life.add(mesh);
    let t = 0;
    const matrix = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(0.35, 0.06, 0.25);
    const step = (_: number, dt: number) => {
      t += dt;
      bits.forEach((b, i) => {
        b.v.y -= 18 * dt;
        b.p.addScaledVector(b.v, dt);
        if (b.p.y < 0.1) {
          b.p.y = 0.1;
          b.v.set(0, 0, 0);
        }
        q.setFromAxisAngle(UP, b.r + t * 6);
        matrix.compose(b.p, q, s);
        mesh.setMatrixAt(i, matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (t > 3.2) {
        this.life.remove(mesh);
        mesh.dispose();
        material.dispose();
        this.animated.splice(this.animated.indexOf(step), 1);
      }
    };
    this.animated.push(step);
  }

  private updateMovers(dt: number) {
    const v = new THREE.Vector3();
    const w = this.renderer.domElement.clientWidth;
    const h = this.renderer.domElement.clientHeight;
    for (let i = this.movers.length - 1; i >= 0; i--) {
      const m = this.movers[i];
      const leg = m.legs[m.leg];
      m.s += leg.speed * dt;
      const total = pathLength(leg.path);
      const { p, heading } = along(leg.path, m.s);
      let x = p.x;
      let z = p.z;
      if (leg.kind === 'road' || leg.kind === 'walk') {
        // Cars keep to the right-hand lane, people to the sidewalk.
        const side = leg.kind === 'walk' ? 7.4 : 2.4;
        x += -Math.cos(heading) * side;
        z += Math.sin(heading) * side;
      }
      const y = leg.y
        ? leg.y(Math.min(1, m.s / Math.max(1, total)))
        : leg.kind === 'sea'
          ? -0.6 + Math.sin(this.elapsed * 0.8 + i) * 0.15
          : leg.kind === 'walk'
            ? 0.18 + Math.abs(Math.sin(this.elapsed * 8 + i)) * 0.08
            : 0;
      m.mesh.position.set(x, y, z);
      let turn = heading - m.mesh.rotation.y;
      turn = Math.atan2(Math.sin(turn), Math.cos(turn));
      m.mesh.rotation.y += turn * Math.min(1, dt * 8);
      if (m.label) {
        v.set(x, y + (leg.kind === 'sea' ? 16 : 5), z).project(this.camera);
        const show = v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
        m.label.style.display = show ? '' : 'none';
        if (show) m.label.style.transform = `translate(-50%, -100%) translate(${(((v.x + 1) / 2) * w).toFixed(1)}px, ${(((1 - v.y) / 2) * h).toFixed(1)}px)`;
      }
      if (m.s < total) continue;
      // The next leg, perhaps by another means.
      m.leg += 1;
      m.s = 0;
      if (m.leg < m.legs.length) {
        const next = m.legs[m.leg];
        if (next.kind !== leg.kind && !m.ambient) {
          this.life.remove(m.mesh);
          m.mesh = this.moverMesh(next.kind === 'sea' ? 'ship' : next.kind === 'air' ? 'plane' : 'truck');
        }
        continue;
      }
      this.movers.splice(i, 1);
      if (!m.ambient) {
        this.life.remove(m.mesh);
        m.label?.remove();
      }
      m.done?.();
    }
  }

  // ── Picking ───────────────────────────────────────────────────────────────

  private findPick(id: string): Picked | null {
    for (const o of this.proxies) if ((o.userData.pick as Picked).id === id) return o.userData.pick as Picked;
    if (id.startsWith('district:') && this.plan) {
      const d = this.plan.districts.find((x) => `district:${x.key}` === id);
      if (d) return { id, base: d.center, radius: Math.max(d.rect.w, d.rect.d) / 2, height: 10 };
    }
    return null;
  }

  private placeMarker(r: THREE.Mesh, id: string | null, pin: boolean) {
    const p = id ? this.findPick(id) : null;
    const show = !!p && !id!.startsWith('district:') && id !== 'crowd';
    r.visible = show;
    if (pin) this.selectPin.visible = show;
    if (!p || !show) return;
    r.position.set(p.base.x, 0.25, p.base.z);
    const s = p.radius + 1.2;
    r.scale.set(s, s, s);
    if (pin) {
      this.selectPin.position.set(p.base.x, p.height + 1.5, p.base.z);
      const k = THREE.MathUtils.clamp(p.radius * 0.45, 0.8, 4);
      this.selectPin.scale.set(k, k, k);
      this.selectPin.userData.base = p.height + 1.5;
    }
  }

  private raycast(clientX: number, clientY: number): { pick: Picked | null; ground: THREE.Vector3 | null } {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects(this.proxies, false)[0];
    const ground = new THREE.Vector3();
    const onGround = this.raycaster.ray.intersectPlane(new THREE.Plane(UP, 0), ground);
    return { pick: hit ? (hit.object.userData.pick as Picked) : null, ground: onGround ? ground : null };
  }

  // ── Input ─────────────────────────────────────────────────────────────────

  private onPointerDown = (e: PointerEvent) => {
    this.renderer.domElement.setPointerCapture(e.pointerId);
    this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.touches.size === 2) {
      const [a, b] = [...this.touches.values()];
      this.drag = { x: e.clientX, y: e.clientY, button: 0, moved: true, pinch: Math.hypot(a.x - b.x, a.y - b.y), spread: Math.atan2(b.y - a.y, b.x - a.x) };
      return;
    }
    this.drag = { x: e.clientX, y: e.clientY, button: e.button === 2 || e.shiftKey ? 2 : 0, moved: false };
  };

  private onPointerMove = (e: PointerEvent) => {
    this.pointerAt = { x: e.clientX, y: e.clientY };
    if (this.touches.has(e.pointerId)) this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const drag = this.drag;
    if (!drag) return;
    if (drag.pinch !== undefined && this.touches.size === 2) {
      const [a, b] = [...this.touches.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      this.zoomBy(d / drag.pinch);
      this.yawGoal += angle - (drag.spread ?? angle);
      drag.pinch = d;
      drag.spread = angle;
      return;
    }
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    drag.moved = true;
    drag.x = e.clientX;
    drag.y = e.clientY;
    if (drag.button === 2) {
      this.yawGoal -= dx * 0.006;
      this.pitchGoal = THREE.MathUtils.clamp(this.pitchGoal + dy * 0.004, 0.32, 1.35);
    } else {
      this.panBy(dx, dy);
    }
  };

  private onPointerUp = (e: PointerEvent) => {
    this.touches.delete(e.pointerId);
    const drag = this.drag;
    if (this.touches.size === 0) this.drag = null;
    if (!drag || drag.moved || drag.pinch !== undefined) return;
    const { pick } = this.raycast(e.clientX, e.clientY);
    if (pick) this.goTo(pick.id);
    else this.select(null);
  };

  private onPointerLeave = () => {
    this.pointerAt = null;
    if (this.hovered) {
      this.hovered = null;
      this.hoverRing.visible = false;
      this.callbacks.onHover(null);
    }
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.zoomBy(Math.pow(1.0018, -e.deltaY));
  };

  private onDoubleClick = (e: MouseEvent) => {
    const { ground } = this.raycast(e.clientX, e.clientY);
    if (ground) this.flyTo({ x: ground.x, z: ground.z }, Math.max(40, this.distGoal * 0.55));
  };

  private onContextMenu = (e: Event) => e.preventDefault();

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t instanceof Element && t.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return;
    const code = e.code;
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(code)) {
      this.keys.add(code);
      if (code.startsWith('Arrow')) e.preventDefault();
    } else if (code === 'KeyQ') this.rotate(-1);
    else if (code === 'KeyE') this.rotate(1);
    else if (code === 'Equal' || code === 'NumpadAdd') this.zoomBy(1.2);
    else if (code === 'Minus' || code === 'NumpadSubtract') this.zoomBy(1 / 1.2);
    else if (code === 'Escape') this.select(null);
    else if (code === 'Home') this.overview();
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private onBlur = () => this.keys.clear();

  // ── The loop ──────────────────────────────────────────────────────────────

  private resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = `${w}px`;
    this.renderer.domElement.style.height = `${h}px`;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.composer?.setSize(w, h);
  }

  private updateLabels() {
    const w = this.renderer.domElement.clientWidth;
    const h = this.renderer.domElement.clientHeight;
    const v = new THREE.Vector3();
    const placed: Array<[number, number, number, number]> = [];
    const showDistricts = this.dist > 230;
    for (const label of this.labels) {
      let show =
        label.kind === 'district'
          ? showDistricts || label.id === this.hovered
          : label.kind === 'info'
            ? this.dist < 260 || (label.id !== undefined && (label.id === this.hovered || label.id === this.selected))
            : label.id === this.hovered || label.id === this.selected;
      if (show) {
        v.copy(label.pos).project(this.camera);
        show = v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
      }
      if (!show) {
        if (label.el.style.display !== 'none') label.el.style.display = 'none';
        continue;
      }
      const x = ((v.x + 1) / 2) * w;
      const y = ((1 - v.y) / 2) * h;
      label.el.style.display = '';
      const lw = label.el.offsetWidth || 60;
      const lh = label.el.offsetHeight || 22;
      const box: [number, number, number, number] = [x - lw / 2, y - lh, x + lw / 2, y];
      if (placed.some((p) => box[0] < p[2] + 4 && box[2] > p[0] - 4 && box[1] < p[3] + 4 && box[3] > p[1] - 4)) {
        label.el.style.display = 'none';
        continue;
      }
      placed.push(box);
      label.el.style.transform = `translate(-50%, -100%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    }
  }

  private loop = () => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, this.clock.getDelta());
    this.elapsed += dt;

    // Keys pan the view.
    const k = this.keys;
    const fx = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const fz = (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0);
    if (fx || fz) this.panBy(-fx * 900 * dt, -fz * 900 * dt);

    this.updateCamera(dt);
    for (const fn of [...this.animated]) fn(this.elapsed, dt);
    this.updateMovers(dt);
    this.updatePeople(dt);
    for (const c of this.clouds.children) {
      c.position.x += (c.userData.speed as number) * dt;
      const i = this.plan?.island;
      if (i && c.position.x > i.x + i.w + 300) c.position.x = i.x - 300;
    }
    if (this.rain) {
      this.rain.position.set(this.target.x, (this.rain.position.y - dt * 90) % 40, this.target.z);
    }
    if (this.selectPin.visible) {
      this.selectPin.position.y = (this.selectPin.userData.base as number) + Math.sin(this.elapsed * 3) * 0.4;
      this.selectPin.rotation.y += dt * 1.5;
      this.selectRing.rotation.z += dt * 0.8;
    }

    if (this.pointerAt && !this.drag) {
      const { pick } = this.raycast(this.pointerAt.x, this.pointerAt.y);
      const id = pick?.id ?? null;
      if (id !== this.hovered) {
        this.hovered = id;
        this.placeMarker(this.hoverRing, id, false);
        this.renderer.domElement.style.cursor = id ? 'pointer' : 'grab';
        this.callbacks.onHover(id);
      }
    }

    if (this.elapsed - this.lastReport > 0.2) {
      this.lastReport = this.elapsed;
      this.callbacks.onView({ x: this.target.x, z: this.target.z }, this.yaw);
      let found: DistrictKey | null = null;
      for (const d of this.plan?.districts ?? []) {
        const r = d.rect;
        if (this.target.x >= r.x && this.target.x <= r.x + r.w && this.target.z >= r.z && this.target.z <= r.z + r.d) found = d.key;
      }
      if (this.dist > 500) found = null;
      if (found !== this.district) {
        this.district = found;
        this.callbacks.onDistrict(found);
      }
      // The time of day moves on.
      if (Math.floor(this.elapsed) % 30 === 0) this.applyLight();
    }
    this.updateLabels();
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** A pale paved pad on the ground. */
function flatPad(batch: Batch, shapes: Shapes, x: number, z: number, w: number, d: number) {
  batch.add(shapes.box, { x, y: 0.06, z, sx: w, sy: 0.08, sz: d }, 0xf4f1ea);
}

const UP = new THREE.Vector3(0, 1, 0);
const PROXY_MATERIAL = new THREE.MeshBasicMaterial({ visible: false });
/** Shirts for the people in the world: each user always the same one. */
const PEOPLE = [0x2f6fe0, 0xd9534f, 0x2aa6a0, 0x8e5bd6, 0xf08a3c, 0x26303f];
/** The colour of a model's tape on its boxes. */
const FAMILY = [0x2f6fe0, 0xd9534f, 0x2aa6a0, 0xf2b705, 0x8e5bd6, 0x26303f, 0xf08a3c, 0x5fb36b];
const EVENT_COLORS: Record<WorldEvent['kind'], number> = {
  order: 0x2f6fe0,
  sale: 0x2f6fe0,
  transfer: 0xf08a3c,
  purchase: 0x8a6a4f,
  return: 0x8e5bd6,
  adjust: 0x9aa4b2,
  income: 0x2ecc71,
  expense: 0xd9534f,
};

/** Sends glass pieces to their own batch, so windows can light up at night. */
class Router extends Batch {
  constructor(private glassBatch: Batch) {
    super();
  }
  add(geometry: THREE.BufferGeometry, place: Parameters<Batch['add']>[1], rgb: number) {
    if (rgb === COLORS.glass || rgb === COLORS.glassDark) this.glassBatch.add(geometry, place, rgb);
    else super.add(geometry, place, rgb);
  }
}

/** An island: a rounded slab, its top at y = 0. */
function islandSlab(rect: Rect, radius: number): THREE.Mesh {
  const { x, z, w, d } = rect;
  const r = Math.min(radius, w / 2, d / 2);
  const shape = new THREE.Shape();
  shape.moveTo(x + r, z);
  shape.lineTo(x + w - r, z);
  shape.quadraticCurveTo(x + w, z, x + w, z + r);
  shape.lineTo(x + w, z + d - r);
  shape.quadraticCurveTo(x + w, z + d, x + w - r, z + d);
  shape.lineTo(x + r, z + d);
  shape.quadraticCurveTo(x, z + d, x, z + d - r);
  shape.lineTo(x, z + r);
  shape.quadraticCurveTo(x, z, x + r, z);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 3, bevelEnabled: true, bevelSize: 1.2, bevelThickness: 0.6, bevelSegments: 2, curveSegments: 8 });
  const mesh = new THREE.Mesh(geometry, [ISLAND_TOP, ISLAND_SIDE]);
  mesh.rotation.x = Math.PI / 2;
  mesh.position.y = -0.6;
  mesh.receiveShadow = true;
  return mesh;
}

const ISLAND_TOP = new THREE.MeshStandardMaterial({ color: COLORS.ground, roughness: 0.95 });
const ISLAND_SIDE = new THREE.MeshStandardMaterial({ color: 0xc9cfd9, roughness: 0.95 });

function ring(color: number, opacity: number) {
  const mesh = new THREE.Mesh(new THREE.RingGeometry(0.93, 1, 64), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
  mesh.rotation.x = -Math.PI / 2;
  mesh.visible = false;
  mesh.renderOrder = 2;
  return mesh;
}
