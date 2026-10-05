/**
 * The business world's models (/dashboard/world), built from simple shapes in
 * metres and merged per material (world-kit.ts's Batch): a warehouse hall with
 * its dock doors, a partner's storefront, the bank, the headquarters, the
 * website's tower, homes, factories, the port's cranes and containers, trees
 * and lamps — and the vehicles: a truck, a van, a forklift, a ship, a plane.
 *
 * A Model places pieces relative to its own origin and turn (front facing +z),
 * so every builder draws in local coordinates.
 */
import * as THREE from 'three';
import { Batch, Shapes, seeded, pick } from '@/components/world/world-kit';
import type { SignAtlas, SignSpec } from '@/components/world/world-signs';

export const COLORS = {
  ground: 0xeef1f6,
  lawn: 0xcfe6c4,
  road: 0xdde2ea,
  sidewalk: 0xf6f7fa,
  curb: 0xc9cfd9,
  marking: 0xffffff,
  yellow: 0xf2b705,
  blue: 0x2f6fe0,
  blueDark: 0x1f4fb0,
  white: 0xfbfcfe,
  steel: 0x9aa4b2,
  steelDark: 0x5b6574,
  rubber: 0x23262c,
  glass: 0x9cc3ea,
  glassDark: 0x2c3b52,
  cardboard: 0xd5a468,
  tape: 0xb98848,
  wood: 0xc49a62,
  gold: 0xe7c35a,
  goldDark: 0xc9a23b,
  leaf: 0x6dbb6a,
  leafDark: 0x4e9e58,
  trunk: 0x8a6a4f,
  water: 0xa9cdea,
  stone: 0xe9e4da,
  red: 0xd9534f,
  orange: 0xf08a3c,
  teal: 0x2aa6a0,
};

export type Materials = { matte: THREE.Material; glass: THREE.Material; signs: THREE.Material };

/** Pieces placed relative to an origin and a turn about y (radians; 0 = front facing +z). */
export class Model {
  private c: number;
  private s: number;
  constructor(readonly batch: Batch, readonly shapes: Shapes, readonly x = 0, readonly z = 0, readonly ry = 0, readonly y = 0) {
    this.c = Math.cos(ry);
    this.s = Math.sin(ry);
  }
  /** A world point from a local one. */
  at(lx: number, lz: number): { x: number; z: number } {
    return { x: this.x + lx * this.c + lz * this.s, z: this.z - lx * this.s + lz * this.c };
  }
  /** A box centred at local (lx, ly + h/2, lz), w along local x, d along local z. */
  box(rgb: number, lx: number, lz: number, w: number, h: number, d: number, ly = 0, turn = 0) {
    const p = this.at(lx, lz);
    this.batch.add(this.shapes.box, { x: p.x, y: this.y + ly + h / 2, z: p.z, sx: w, sy: h, sz: d, ry: this.ry + turn }, rgb);
  }
  /** Any shape, its own size, centred at local (lx, ly, lz), with extra turns. */
  shape(geometry: THREE.BufferGeometry, rgb: number, lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, rx = 0, rz = 0, turn = 0) {
    const p = this.at(lx, lz);
    this.batch.add(geometry, { x: p.x, y: this.y + ly, z: p.z, sx, sy, sz, ry: this.ry + turn, rx, rz }, rgb);
  }
  /** An upright cylinder standing on local ly. */
  post(rgb: number, lx: number, lz: number, r: number, h: number, ly = 0) {
    this.shape(this.shapes.cylinder, rgb, lx, ly + h / 2, lz, r * 2, h, r * 2);
  }
  /** A wheel: a cylinder on its side, axle along local x. */
  wheel(lx: number, lz: number, r: number, w: number) {
    this.shape(this.shapes.cylinder, COLORS.rubber, lx, r, lz, r * 2, w, r * 2, 0, Math.PI / 2);
    this.shape(this.shapes.cylinder, COLORS.steel, lx + Math.sign(lx) * (w / 2 + 0.01), r, lz, r * 1.1, 0.04, r * 1.1, 0, Math.PI / 2);
  }
}

/** A sign's face on a model's wall: local centre, size, and which way it faces (local turn). */
export function signOn(atlas: SignAtlas, m: Model, spec: SignSpec, lx: number, ly: number, lz: number, w: number, h: number, turn = 0, twoSided = false) {
  const p = m.at(lx, lz);
  atlas.add(spec, { x: p.x, y: m.y + ly, z: p.z, ry: m.ry + turn, w, h, twoSided, depth: 0.02 });
}

// ── Vehicles (local: front +z, standing on y = 0) ───────────────────────────

/** A semi truck: blue cab, white trailer with a blue band. About 2.6 × 4 × 13 m. */
export function buildTruck(m: Model, cab = COLORS.blue) {
  // Trailer.
  m.box(COLORS.white, 0, -2.2, 2.6, 2.9, 9.4, 1.0);
  m.box(cab, 0, -2.2, 2.62, 0.35, 9.42, 1.55);
  m.box(COLORS.steelDark, 0, -2.2, 2.2, 0.35, 9, 0.65);
  for (const z of [-5.6, -4.4, -6.8]) for (const x of [-1.05, 1.05]) m.wheel(x, z, 0.5, 0.4);
  // Cab.
  m.box(cab, 0, 4.0, 2.5, 2.2, 2.6, 0.9);
  m.box(COLORS.glassDark, 0, 5.32, 2.2, 0.85, 0.04, 2.05);
  for (const x of [-1.26, 1.26]) m.box(COLORS.glassDark, x, 4.6, 0.04, 0.7, 1.0, 2.1);
  m.box(COLORS.steelDark, 0, 5.32, 1.6, 0.6, 0.06, 1.0);
  m.box(COLORS.white, 0, 5.36, 2.5, 0.25, 0.1, 0.55);
  for (const x of [-0.95, 0.95]) m.box(0xfff3c4, x, 5.38, 0.4, 0.18, 0.06, 1.2);
  m.box(COLORS.steelDark, 0, 3.2, 2.0, 0.5, 2.6, 0.55);
  for (const z of [4.4, 2.6]) for (const x of [-1.05, 1.05]) m.wheel(x, z, 0.5, 0.4);
}

/** A delivery van: white with a blue band. About 2 × 2.4 × 5.4 m. */
export function buildVan(m: Model, band = COLORS.blue) {
  m.box(COLORS.white, 0, -0.4, 2.0, 2.0, 4.0, 0.45);
  m.box(COLORS.white, 0, 2.0, 2.0, 1.25, 1.2, 0.45);
  m.box(band, 0, -0.4, 2.02, 0.3, 4.02, 1.2);
  m.box(COLORS.glassDark, 0, 1.62, 1.8, 0.7, 0.04, 1.75);
  for (const x of [-1.01, 1.01]) m.box(COLORS.glassDark, x, 1.25, 0.04, 0.55, 0.8, 1.8);
  for (const x of [-0.7, 0.7]) m.box(0xfff3c4, x, 2.6, 0.35, 0.16, 0.05, 0.95);
  for (const z of [1.6, -1.6]) for (const x of [-0.9, 0.9]) m.wheel(x, z, 0.38, 0.3);
}

/** A forklift without its forks (they move): yellow body, overhead guard, driver. About 1.2 × 2.2 × 2.4 m. */
export function buildForklift(m: Model) {
  m.box(COLORS.yellow, 0, -0.1, 1.2, 0.9, 1.9, 0.25);
  m.box(COLORS.steelDark, 0, -1.0, 1.2, 0.8, 0.45, 0.35);
  m.box(COLORS.rubber, 0, 0.1, 0.5, 0.4, 0.5, 1.15);
  // The driver: orange vest, a head, a cap.
  m.box(COLORS.orange, 0, 0.0, 0.5, 0.55, 0.36, 1.45);
  m.box(0xf2d3b3, 0, 0.02, 0.28, 0.28, 0.28, 2.02);
  m.box(COLORS.yellow, 0, 0.02, 0.32, 0.1, 0.32, 2.3);
  // The overhead guard.
  for (const x of [-0.55, 0.55]) for (const z of [-0.7, 0.6]) m.box(COLORS.rubber, x, z, 0.07, 1.9, 0.07, 0.6);
  m.box(COLORS.rubber, 0, -0.05, 1.2, 0.06, 1.4, 2.5);
  // The mast.
  for (const x of [-0.42, 0.42]) m.box(COLORS.steelDark, x, 0.95, 0.12, 2.6, 0.12, 0.2);
  m.box(COLORS.steelDark, 0, 0.95, 0.96, 0.1, 0.12, 2.75);
  for (const z of [0.55, -0.6]) for (const x of [-0.5, 0.5]) m.wheel(x, z, 0.28, 0.25);
}

/** The forks, on their carriage: moved up and down by the engine. Local origin at the mast's foot. */
export function buildForks(m: Model) {
  m.box(COLORS.steelDark, 0, 0.0, 1.0, 0.5, 0.08, 0.1);
  for (const x of [-0.3, 0.3]) m.box(COLORS.steelDark, x, 0.55, 0.12, 0.06, 1.1, 0.1);
}

/** A cargo ship: hull, the bridge at the stern, rows of containers. About 12 × 60 m, bow +z. */
export function buildShip(m: Model, seed: string) {
  const random = seeded(seed);
  m.box(0x23395d, 0, 0, 12, 3.2, 56, -2.2);
  m.box(COLORS.red, 0, 0, 12.05, 1.0, 56.05, -2.6);
  // The bow: a gable laid down, its ridge pointing forward.
  m.shape(m.shapes.gable, 0x23395d, 0, -0.6, 28, 12, 6, 3.2, Math.PI / 2, 0, 0);
  m.box(0xeef1f6, 0, 0, 11.6, 0.3, 55.6, 1.0);
  // The bridge.
  m.box(COLORS.white, 0, -23, 10, 7, 6, 1.3);
  m.box(COLORS.glassDark, 0, -19.98, 9, 0.9, 0.05, 6.8);
  m.box(COLORS.white, 0, -23, 12, 0.3, 3, 8.4);
  m.post(COLORS.red, 0, -25, 0.6, 4, 8.3);
  // Containers.
  const hues = [COLORS.blue, COLORS.red, COLORS.orange, COLORS.teal, 0x8a8f99, 0xe7c35a];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 4; col++) {
      const layers = 1 + Math.floor(random() * 3);
      for (let l = 0; l < layers; l++) m.box(pick(random, hues), -3.9 + col * 2.6, -14 + row * 5.6, 2.4, 2.5, 5.4, 1.3 + l * 2.55);
    }
  }
}

/** A cargo plane, nose +z. About 30 × 28 m. */
export function buildPlane(m: Model) {
  m.shape(m.shapes.cylinder, COLORS.white, 0, 0, 0, 3.2, 26, 3.2, Math.PI / 2);
  m.shape(m.shapes.cone, COLORS.white, 0, 0, 13, 3.2, 3, 3.2, Math.PI / 2);
  m.box(COLORS.blue, 0, 0, 3.25, 0.5, 20, 0.2);
  m.box(COLORS.white, 0, 1, 30, 0.35, 4.5, -0.2);
  m.box(COLORS.white, 0, -11.5, 10, 0.3, 2.6, 0.2);
  m.box(COLORS.blue, 0, -11.8, 0.3, 4.2, 3, 0.4);
  for (const x of [-7, 7]) m.shape(m.shapes.cylinder, COLORS.steel, x, -0.9, 1.6, 1.3, 3, 1.3, Math.PI / 2);
  m.box(COLORS.glassDark, 0, 12.2, 1.6, 0.5, 1.2, 0.7);
}

// ── Small things ────────────────────────────────────────────────────────────

/** A wooden pallet, 1.2 × 1.0 m. */
export function buildPallet(m: Model) {
  m.box(COLORS.wood, 0, 0, 1.2, 0.04, 1.0, 0.11);
  for (const x of [-0.5, 0, 0.5]) m.box(0xa9824f, x, 0, 0.14, 0.11, 1.0, 0);
  for (const z of [-0.42, 0, 0.42]) m.box(COLORS.wood, 0, z, 1.2, 0.03, 0.12, 0.15);
}

/** A tree: a round crown or a cone of a pine. */
export function buildTree(m: Model, seed: string) {
  const random = seeded(seed);
  const tall = 4 + random() * 3;
  m.post(COLORS.trunk, 0, 0, 0.18, tall * 0.45);
  if (random() < 0.3) {
    m.shape(m.shapes.cone, COLORS.leafDark, 0, tall * 0.3, 0, 2.6, tall * 0.8, 2.6);
  } else {
    const r = 1.4 + random() * 0.8;
    m.shape(m.shapes.ball, random() < 0.5 ? COLORS.leaf : COLORS.leafDark, 0, tall * 0.62, 0, r * 2, r * 2.1, r * 2);
    m.shape(m.shapes.ball, COLORS.leaf, 0.5, tall * 0.8, 0.3, r * 1.3, r * 1.3, r * 1.3);
  }
}

/** A street lamp: pole, arm, head. Its light is the engine's. */
export function buildLamp(m: Model) {
  m.post(COLORS.steelDark, 0, 0, 0.09, 6);
  m.box(COLORS.steelDark, 0, 0.6, 0.1, 0.1, 1.3, 5.9);
  m.box(COLORS.white, 0, 1.2, 0.35, 0.12, 0.55, 5.85);
}

/** A shipping container, 2.4 × 2.6 × 6 m, with ribs. */
export function buildContainer(m: Model, rgb: number, ly = 0) {
  m.box(rgb, 0, 0, 2.4, 2.6, 6, ly);
  for (let i = -2.6; i <= 2.6; i += 0.65) {
    m.box(rgb, 1.22, i, 0.06, 2.4, 0.18, ly + 0.1);
    m.box(rgb, -1.22, i, 0.06, 2.4, 0.18, ly + 0.1);
  }
  m.box(COLORS.steelDark, 0, 3.02, 2.3, 2.4, 0.05, ly + 0.1);
}

// ── Buildings (local: front facing +z, footprint centred on the origin) ─────

/** A warehouse hall: corrugated blue walls on a white base, a low gable roof, roll-up dock doors in front. */
export function buildHall(atlas: SignAtlas, m: Model, w: number, d: number, doors: number, name: string) {
  const h = 9;
  m.box(COLORS.white, 0, 0, w, 1.2, d);
  m.box(COLORS.blue, 0, 0, w - 0.1, h - 1.2, d - 0.1, 1.2);
  // Ribs on every wall.
  for (let x = -w / 2 + 0.6; x < w / 2; x += 1.2) {
    m.box(COLORS.blueDark, x, d / 2 + 0.02, 0.18, h - 1.4, 0.06, 1.3);
    m.box(COLORS.blueDark, x, -d / 2 - 0.02, 0.18, h - 1.4, 0.06, 1.3);
  }
  for (let z = -d / 2 + 0.6; z < d / 2; z += 1.2) {
    m.box(COLORS.blueDark, w / 2 + 0.02, z, 0.06, h - 1.4, 0.18, 1.3);
    m.box(COLORS.blueDark, -w / 2 - 0.02, z, 0.06, h - 1.4, 0.18, 1.3);
  }
  // Roof: a shallow gable with a white ridge and a few skylights and fans.
  // The gable's ridge runs along z in its own space: turned a quarter, along the hall's length.
  m.shape(m.shapes.gable, 0xe4e8ef, 0, h, 0, d + 0.6, 1.8, w + 0.6, 0, 0, Math.PI / 2);
  m.box(COLORS.white, 0, 0, w + 0.6, 0.25, 0.5, h + 1.75);
  const random = seeded(name);
  for (let i = 0; i < 4; i++) {
    const x = -w / 2 + 6 + random() * (w - 12);
    m.box(0xf4f6fa, x, d * 0.18, 2.2, 0.8, 2.2, h + 1.1);
    m.post(COLORS.steel, x, d * 0.18, 0.7, 0.2, h + 1.9);
  }
  // Dock doors along the front: frame, roll-up door with slats, bumpers, a canopy.
  for (let k = 0; k < doors; k++) {
    const x = -w / 2 + (w / doors) * (k + 0.5);
    m.box(COLORS.steelDark, x, d / 2 + 0.05, 4.4, 4.6, 0.12, 1.0);
    m.box(0xd3d9e2, x, d / 2 + 0.1, 3.8, 4.1, 0.08, 1.2);
    for (let y = 1.5; y < 5.2; y += 0.42) m.box(0xbcc4cf, x, d / 2 + 0.15, 3.8, 0.05, 0.04, y);
    for (const dx of [-2.0, 2.0]) m.box(COLORS.rubber, x + dx, d / 2 + 0.25, 0.3, 0.5, 0.35, 0.9);
    m.box(COLORS.white, x, d / 2 + 0.8, 4.8, 0.12, 1.5, 5.9);
    m.box(COLORS.yellow, x, d / 2 + 0.1, 4.4, 0.04, 0.2, 0.02);
  }
  // An office at the west end: glass and white.
  m.box(COLORS.white, -w / 2 - 4, d / 2 - 5, 8, 6, 10);
  m.box(COLORS.glass, -w / 2 - 4, d / 2 + 0.02, 7, 1.6, 0.06, 1.2);
  m.box(COLORS.glass, -w / 2 - 4, d / 2 + 0.02, 7, 1.6, 0.06, 3.7);
  m.box(COLORS.glass, -w / 2 - 8.02, d / 2 - 5, 0.06, 1.6, 9, 3.7);
  m.box(COLORS.blueDark, -w / 2 - 4, d / 2 - 5, 8.3, 0.4, 10.3, 6);
  // The name over the doors and the brand on the side.
  signOn(atlas, m, { text: name, style: 'host' }, 0, h - 1.3, d / 2 + 0.08, Math.min(w * 0.45, 22), 2.2);
  signOn(atlas, m, { text: 'TheMoak', style: 'brand', ltr: true }, w / 2 + 0.08, h - 2.4, 0, Math.min(d * 0.6, 12), 2.0, Math.PI / 2);
}

const FACADES = [0xf3efe6, 0xe9eef5, 0xf6e7dc, 0xe6efe8, 0xefe6f2, 0xfaf7f0];
const AWNINGS = [COLORS.red, COLORS.blue, 0x2e3440, COLORS.teal, 0x8e5bd6, COLORS.orange];

/** A partner's store on the shopping street: a shop window full of sunglasses, a striped awning, its name above. */
export function buildStore(atlas: SignAtlas, m: Model, w: number, d: number, name: string, seed: string, units: number) {
  const random = seeded(seed);
  const h = 6 + Math.floor(random() * 3) * 1.4;
  const facade = pick(random, FACADES);
  const awning = pick(random, AWNINGS);
  m.box(facade, 0, -0.5, w, h, d - 1);
  m.box(0xffffff, 0, -0.5, w + 0.3, 0.5, d - 0.7, h);
  // Upper windows.
  for (let x = -w / 2 + 2; x < w / 2 - 1; x += 3) m.box(COLORS.glass, x, d / 2 - 0.98, 1.6, 1.5, 0.06, h - 2.4);
  // The shop front: a big window and a door.
  m.box(0x2e3440, 0, d / 2 - 0.95, w - 1, 3.4, 0.12, 0.3);
  m.box(COLORS.glass, -1.2, d / 2 - 0.88, w - 4.2, 2.6, 0.06, 0.6);
  m.box(COLORS.glassDark, w / 2 - 2.0, d / 2 - 0.88, 1.6, 2.7, 0.06, 0.5);
  // Sunglasses on stands behind the glass, as many as the store holds (up to a dozen).
  const shown = Math.min(12, units);
  for (let i = 0; i < shown; i++) {
    const x = -w / 2 + 1.4 + (i % 6) * ((w - 5) / 6);
    const y = 1.0 + Math.floor(i / 6) * 0.9;
    m.box(COLORS.white, x, d / 2 - 1.4, 0.7, 0.06, 0.4, y - 0.05);
    for (const dx of [-0.15, 0.15]) m.box(0x15171c, x + dx, d / 2 - 1.35, 0.24, 0.14, 0.04, y + 0.08);
  }
  // The awning: stripes in its colour and white.
  for (let i = 0; i < 8; i++) {
    const x = -w / 2 + (w / 8) * (i + 0.5);
    m.box(i % 2 ? COLORS.white : awning, x, d / 2 + 0.2, w / 8, 0.08, 2.0, 3.7, 0);
  }
  m.box(awning, 0, d / 2 + 1.18, w, 0.4, 0.08, 3.4);
  // Its name, in its colour.
  signOn(atlas, m, { text: name, style: 'store', bg: `#${awning.toString(16).padStart(6, '0')}` }, 0, h - 1.0, d / 2 - 0.9, Math.min(w - 2, 10), 1.5);
  // Plants by the door.
  for (const x of [w / 2 - 0.4, -w / 2 + 0.4]) m.shape(m.shapes.ball, COLORS.leafDark, x, 0.7, d / 2 - 0.3, 0.9, 1.1, 0.9);
}

/** The bank: steps, columns, a pediment, «خزانه» over the door. */
export function buildBank(atlas: SignAtlas, m: Model, w: number, d: number) {
  m.box(COLORS.stone, 0, 0, w + 2, 0.5, d + 2);
  m.box(COLORS.stone, 0, d / 2 + 1.4, w * 0.7, 0.3, 1.6, 0);
  m.box(0xf6f2ea, 0, -1, w, 9, d - 3, 0.5);
  for (let i = 0; i < 6; i++) m.post(0xfbf8f2, -w * 0.38 + i * (w * 0.76) / 5, d / 2 - 1.2, 0.55, 7.5, 0.5);
  m.box(0xfbf8f2, 0, d / 2 - 1.2, w * 0.86, 0.9, 2.2, 8.0);
  m.shape(m.shapes.gable, 0xefe9de, 0, 8.9, d / 2 - 1.2, w * 0.88, 2.6, 2.4, 0, 0, 0);
  m.box(COLORS.glassDark, 0, d / 2 - 2.55, 3, 4, 0.1, 0.5);
  signOn(atlas, m, { text: 'خزانه', style: 'plate' }, 0, 7.0, d / 2 - 0.08, 6, 1.3);
}

/** The headquarters: two glass volumes, white frames, the brand on the roof. */
export function buildHq(atlas: SignAtlas, m: Model, w: number, d: number) {
  m.box(COLORS.white, 0, 0, w, 1, d);
  m.box(COLORS.glass, -w * 0.12, 0, w * 0.7, 14, d * 0.8, 1);
  m.box(COLORS.glass, w * 0.25, d * 0.05, w * 0.45, 20, d * 0.55, 1);
  for (let y = 4; y < 20; y += 3.2) {
    m.box(COLORS.white, -w * 0.12, 0, w * 0.71, 0.25, d * 0.81, y);
    if (y < 21) m.box(COLORS.white, w * 0.25, d * 0.05, w * 0.46, 0.25, d * 0.56, y);
  }
  m.box(COLORS.white, w * 0.25, d * 0.05, w * 0.47, 0.6, d * 0.57, 21);
  // The sunglasses canopy over the entrance.
  for (const x of [-1.6, 1.6]) m.shape(m.shapes.cylinder, 0x15171c, x - w * 0.12, 4.2, d * 0.42, 2.8, 0.3, 2.2, Math.PI / 2);
  m.box(0x15171c, -w * 0.12, d * 0.42, 1.0, 0.3, 0.3, 4.5);
  signOn(atlas, m, { text: 'TheMoak', style: 'brand', ltr: true }, w * 0.25, 23, d * 0.05, 12, 2.4, 0, true);
}

/** The website's tower: glass, an antenna, a dish, its address on top. */
export function buildTower(atlas: SignAtlas, m: Model, w: number, d: number, host: string) {
  m.box(COLORS.white, 0, 0, w, 1, d);
  m.box(COLORS.glass, 0, 0, w * 0.8, 38, d * 0.8, 1);
  for (let y = 5; y < 39; y += 3) m.box(0xdfe6ef, 0, 0, w * 0.81, 0.2, d * 0.81, y);
  m.box(COLORS.white, 0, 0, w * 0.84, 1, d * 0.84, 39);
  m.post(COLORS.steel, 0, 0, 0.25, 10, 40);
  m.shape(m.shapes.ball, COLORS.white, w * 0.25, 41.5, -d * 0.2, 2.6, 1.2, 2.6);
  signOn(atlas, m, { text: host, style: 'host', ltr: true }, 0, 36, d * 0.41, w * 0.7, 2.2, 0, true);
}

/** The projects' office: three white floors with window bands. */
export function buildOffice(atlas: SignAtlas, m: Model, w: number, d: number) {
  m.box(COLORS.white, 0, 0, w, 11, d);
  for (const y of [1.2, 4.7, 8.2]) m.box(COLORS.glass, 0, d / 2 + 0.02, w - 2, 2.0, 0.06, y);
  m.box(0xe4e8ef, 0, 0, w + 0.4, 0.5, d + 0.4, 11);
  signOn(atlas, m, { text: 'دفتر پروژه‌ها', style: 'office' }, 0, 10.3, d / 2 + 0.06, Math.min(w - 2, 9), 1.2);
}

const WALLS = [0xf6efe4, 0xefe3cf, 0xe6ece2, 0xf1e1da, 0xe1e6ee, 0xfaf7f0];
const ROOFS = [0xd98b5f, 0xb07a4f, 0x8a95a5, 0x8c6a5a, 0xc98f6a, 0x6f7c8c];

/** A home: walls, a roof, a door and windows, a garden; a name plate for the best customers. */
export function buildHome(atlas: SignAtlas | null, m: Model, w: number, d: number, seed: string, name: string | null, debt: boolean) {
  const random = seeded(seed);
  const h = 3.2 + random() * (name ? 3 : 1.5);
  m.box(COLORS.lawn, 0, 0, w + 2, 0.06, d + 2);
  m.box(pick(random, WALLS), 0, -0.5, w * 0.8, h, d * 0.7);
  const roof = debt ? COLORS.red : pick(random, ROOFS);
  if (random() < 0.5) m.shape(m.shapes.hip, roof, 0, h, -0.5, w * 0.9, 2.2, d * 0.8);
  else m.shape(m.shapes.gable, roof, 0, h, -0.5, d * 0.8, 2.2, w * 0.9, 0, 0, Math.PI / 2);
  m.box(0x6b4f3a, 0, d * 0.35 - 0.48, 1.0, 2.1, 0.08);
  for (const x of [-w * 0.25, w * 0.25]) m.box(COLORS.glass, x, d * 0.35 - 0.48, 1.1, 1.0, 0.06, 1.3);
  if (random() < 0.5) m.box(0x9a6b54, w * 0.25, -0.8, 0.6, 1.6, 0.6, h + 0.6);
  m.shape(m.shapes.ball, COLORS.leaf, w * 0.42, 0.6, d * 0.4, 1.2, 1.2, 1.2);
  if (name && atlas) signOn(atlas, m, { text: name, style: 'plate' }, 0, h * 0.78, d * 0.35 - 0.42, Math.min(w * 0.7, 6), 0.9);
}

/** A supplier's factory: a sawtooth roof, a chimney, silos, its name in red and gold. */
export function buildFactory(atlas: SignAtlas, m: Model, w: number, d: number, name: string, seed: string) {
  const random = seeded(seed);
  const wall = pick(random, [0xe7ded2, 0xd9dde4, 0xe9d8c8, 0xd6dcd2]);
  m.box(wall, 0, 0, w, 7, d);
  const teeth = Math.max(3, Math.floor(w / 4));
  for (let i = 0; i < teeth; i++) m.shape(m.shapes.tooth, 0x8a95a5, -w / 2 + (w / teeth) * (i + 0.5), 7, 0, w / teeth, 2.4, d, 0, 0, 0);
  m.post(0xb7aa9b, w * 0.32, -d * 0.3, 0.8, 14);
  m.post(COLORS.red, w * 0.32, -d * 0.3, 0.82, 1, 13);
  for (let i = 0; i < 2; i++) m.post(0xdfe3ea, -w / 2 - 2.2, -d * 0.25 + i * 4, 1.6, 9);
  for (let k = 0; k < 2; k++) m.box(COLORS.steelDark, -w * 0.2 + k * w * 0.4, d / 2 + 0.05, 4, 4.2, 0.1, 0);
  signOn(atlas, m, { text: name, style: 'factory', ltr: /^[\x00-\x7F]+$/.test(name) }, 0, 5.6, d / 2 + 0.08, Math.min(w * 0.8, 14), 1.8);
}

/** A ship-to-shore crane: legs over the quay, a boom out over the water (local -x). */
export function buildCrane(m: Model) {
  for (const x of [-4, 4]) for (const z of [-3, 3]) m.box(COLORS.red, x, z, 0.8, 22, 0.8);
  m.box(COLORS.white, 0, 0, 9, 1.2, 7, 22);
  m.box(COLORS.red, -10, 0, 30, 1.0, 1.4, 25);
  m.box(COLORS.white, 6, 0, 3, 3, 3, 23);
  m.box(COLORS.red, 0, 0, 0.6, 8, 0.6, 23);
}
