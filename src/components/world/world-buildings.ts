/**
 * The business world's buildings (world-engine.ts): a partner's store, a
 * supplier's factory, a customer's house, a warehouse hall, the headquarters…
 * Each is drawn into the kit's batches (world-kit.ts) and signed in the atlas
 * (world-signs.ts), and each looks its own: its colours, roof, size, awning and
 * chimneys come from its id, so a store looks the same on every visit and no
 * two neighbours look alike.
 */
import type { Batch, Shapes } from '@/components/world/world-kit';
import { pick, seeded } from '@/components/world/world-kit';
import type { SignAtlas } from '@/components/world/world-signs';

/** Where the ground's top is: buildings stand on it. */
export const GROUND = 0.12;

export type Kit = {
  shapes: Shapes;
  /** Walls, roofs, doors. */
  solid: Batch;
  /** Windows and lamps: they light up at dusk. */
  lit: Batch;
  /** Status lights: always bright. */
  glow: Batch;
  signs: SignAtlas;
};

/** A building's box, for picking it: centre, size and height. */
export type Footprint = { x: number; z: number; w: number; d: number; h: number };

const css = (rgb: number) => `#${rgb.toString(16).padStart(6, '0')}`;

const STORE_FACADES = [0xf4efe6, 0xdcece3, 0xf5e0de, 0xdbe7f3, 0xeee0c8, 0xe6dff2, 0xf2d8c3, 0xe1e7d3, 0xfbfaf7, 0xd8dce2];
const STORE_ACCENTS = [0x1f6f6b, 0xd9594c, 0xc99231, 0x24406e, 0x2f6b3f, 0x7a3b69, 0xa8432f, 0x22252b, 0x3d7fb8, 0xb84f72];
const ROOFS = [0x8c6a5a, 0x5d6b7a, 0xb5654a, 0x4a5560, 0x9a8c7a, 0x6e5a4d];
const GLASS = 0x9fb6c9;
const DOOR = 0x3b3f46;
const WHITE = 0xfdfcf9;
const LEAF = [0x7fae6a, 0x6b9e5c, 0x8dbb73, 0x5e8f57];
const FLOWERS = [0xe57aa8, 0xf0c04a, 0xffffff, 0xd9594c, 0x9b7ad8];

function darker(rgb: number, k = 0.72): number {
  const r = Math.round(((rgb >> 16) & 255) * k);
  const g = Math.round(((rgb >> 8) & 255) * k);
  const b = Math.round((rgb & 255) * k);
  return (r << 16) | (g << 8) | b;
}

/** A roof of the given kind over a w × d box whose top is at y. */
function roof(kit: Kit, kind: string, rgb: number, x: number, z: number, w: number, d: number, y: number, height: number, ry = 0) {
  const { shapes, solid } = kit;
  if (kind === 'gable') solid.add(shapes.gable, { x, y, z, sx: w + 0.3, sy: height, sz: d + 0.3, ry }, rgb);
  else if (kind === 'mansard') solid.add(shapes.mansard, { x, y, z, sx: w + 0.2, sy: height * 0.8, sz: d + 0.2, ry }, rgb);
  else if (kind === 'hip') solid.add(shapes.hip, { x, y, z, sx: w + 0.3, sy: height, sz: d + 0.3 }, rgb);
  else {
    // Flat, with a parapet.
    solid.block(shapes, darker(rgb, 0.9), x, z, w + 0.12, 0.16, d + 0.12, y);
  }
}

/** A potted shrub with flowers, by a door. */
function planter(kit: Kit, random: () => number, x: number, z: number) {
  const { shapes, solid } = kit;
  solid.block(shapes, 0x8a7f72, x, z, 0.36, 0.18, 0.22, GROUND);
  solid.add(shapes.ball, { x, y: GROUND + 0.3, z, sx: 0.34, sy: 0.26, sz: 0.22 }, pick(random, LEAF));
  solid.add(shapes.ball, { x: x + 0.06, y: GROUND + 0.42, z: z + 0.05, sx: 0.09, sy: 0.09, sz: 0.09 }, pick(random, FLOWERS));
}

/**
 * A partner's store, its front toward +z, in the w × d plot centred at x, z: its own facade, accent,
 * roof, awning and size; the partner's name on the fascia, and on a blade sign on a two-storey one.
 */
export function buildStore(kit: Kit, id: string, name: string, plot: { x: number; z: number; w: number; d: number }): Footprint {
  const { shapes, solid, lit, signs } = kit;
  const random = seeded(`store:${id}`);
  const facade = pick(random, STORE_FACADES);
  const accent = pick(random, STORE_ACCENTS);
  const w = plot.w * (0.8 + random() * 0.2);
  const d = plot.d * (0.82 + random() * 0.16);
  const floors = random() < 0.45 ? 2 : 1;
  const h = floors === 2 ? 3.5 + random() * 0.4 : 2.5 + random() * 0.3;
  const x = plot.x + ((plot.w - w) / 2) * (random() * 2 - 1);
  const z = plot.z + (plot.d - d) / 2;
  const front = z + d / 2;
  const doorSide = random() < 0.5 ? -1 : 1;

  solid.block(shapes, facade, x, z, w, h, d, GROUND);
  solid.block(shapes, darker(facade, 0.8), x, z, w + 0.06, 0.18, d + 0.06, GROUND);
  const roofKind = pick(random, ['flat', 'gable', 'mansard', 'hip', 'flat']);
  roof(kit, roofKind, random() < 0.35 ? darker(accent, 0.85) : pick(random, ROOFS), x, z, w, d, GROUND + h, 0.7 + random() * 0.4);
  if (roofKind === 'flat') solid.block(shapes, 0xc9ccd1, x - w * 0.2, z - d * 0.15, 0.5, 0.3, 0.4, GROUND + h + 0.16);

  // The shop window, a few things on show in it, and the door.
  const windowW = w * 0.5;
  const windowX = x - doorSide * w * 0.18;
  lit.block(shapes, GLASS, windowX, front + 0.03, windowW, 0.95, 0.06, GROUND + 0.3);
  solid.block(shapes, darker(accent), windowX, front + 0.06, windowW + 0.12, 0.08, 0.1, GROUND + 0.24);
  for (let i = 0; i < 3; i++) {
    const ix = windowX - windowW * 0.3 + i * windowW * 0.3;
    solid.block(shapes, pick(random, [0x22252b, 0xb4846c, 0x6f9a8d, 0xd9a441, 0xc06c84]), ix, front + 0.07, 0.24, 0.1, 0.04, GROUND + 0.62);
  }
  const doorX = x + doorSide * w * 0.32;
  solid.block(shapes, random() < 0.5 ? DOOR : darker(accent, 0.8), doorX, front + 0.03, 0.6, 1.15, 0.06, GROUND);
  lit.block(shapes, GLASS, doorX, front + 0.03, 0.6, 0.16, 0.06, GROUND + 1.2);

  // The awning: stripes, plain, a flat canopy, or none.
  const awning = pick(random, ['stripes', 'stripes', 'solid', 'canopy', 'none']);
  const awningY = GROUND + 1.42;
  if (awning === 'stripes') {
    const n = Math.max(4, Math.round(w / 0.42));
    for (let i = 0; i < n; i++) {
      solid.add(shapes.box, { x: x - w / 2 + (i + 0.5) * (w / n), y: awningY, z: front + 0.36, sx: w / n, sy: 0.06, sz: 0.8, rx: 0.42 }, i % 2 ? WHITE : accent);
    }
  } else if (awning === 'solid') {
    solid.add(shapes.box, { x, y: awningY, z: front + 0.36, sx: w, sy: 0.07, sz: 0.8, rx: 0.42 }, accent);
  } else if (awning === 'canopy') {
    solid.block(shapes, accent, x, front + 0.32, w + 0.1, 0.08, 0.64, awningY - 0.04);
  }
  if (random() < 0.6) planter(kit, random, doorX + doorSide * 0.55, front + 0.2);

  // Upstairs windows.
  if (floors === 2) {
    const n = w > 3.6 ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const wx = x - w / 2 + ((i + 0.5) * w) / n;
      lit.block(shapes, GLASS, wx, front + 0.03, 0.55, 0.62, 0.06, GROUND + 2.7);
      solid.block(shapes, accent, wx, front + 0.05, 0.68, 0.06, 0.1, GROUND + 2.65);
    }
  }

  // The big board over the shop front, as shops have, with the partner's name; the same at the back.
  const signW = w - 0.1;
  for (const [sz, ry] of [[front + 0.06, 0], [z - d / 2 - 0.06, Math.PI]] as const) {
    solid.block(shapes, darker(accent, 0.6), x, sz, signW + 0.1, 0.9, 0.1, GROUND + 1.6);
    signs.add({ text: name, style: 'store', bg: css(accent) }, { x, y: GROUND + 2.05, z: sz, ry, w: signW, h: 0.8, depth: 0.1, twoSided: false });
  }
  return { x, z, w: w + 0.4, d: d + 0.8, h: h + 0.6 };
}

const FACTORY_WALLS = [0xd9d2c4, 0xc8ccd0, 0xc49a80, 0xe2ddd3, 0xb4bec6, 0xd6c7ae];
const METAL = [0x8f9aa6, 0x7d8894, 0x9aa3ad, 0x6f7a86];

export type Factory = Footprint & {
  /** Where its smoke comes out, when it has one. */
  chimney: { x: number; y: number; z: number } | null;
};

/**
 * A supplier's factory, its front toward +z: a sawtooth, flat, barrel or gable roof, chimneys, silos and a
 * loading dock, all from its id; its name on a red and gold board on the roof. An amber light while money is
 * still owed to it.
 */
export function buildFactory(kit: Kit, id: string, name: string, at: { x: number; z: number }, unpaid: boolean): Factory {
  const { shapes, solid, lit, glow, signs } = kit;
  const random = seeded(`factory:${id}`);
  const wall = pick(random, FACTORY_WALLS);
  const metal = pick(random, METAL);
  const w = 3.4 + random() * 0.9;
  const d = 2.6 + random() * 0.6;
  const h = 1.8 + random() * 0.8;
  const x = at.x - 0.3;
  const z = at.z;
  const front = z + d / 2;
  const top = GROUND + h;

  solid.block(shapes, wall, x, z, w, h, d, GROUND);
  solid.block(shapes, darker(wall, 0.82), x, z, w + 0.06, 0.22, d + 0.06, GROUND);
  const kind = pick(random, ['sawtooth', 'flat', 'barrel', 'gable']);
  if (kind === 'sawtooth') {
    const n = w > 3.9 ? 4 : 3;
    for (let i = 0; i < n; i++) {
      const tx = x - w / 2 + (i + 0.5) * (w / n);
      solid.add(shapes.tooth, { x: tx, y: top, z, sx: w / n, sy: 0.75, sz: d }, metal);
      lit.block(shapes, GLASS, tx + w / n / 2 - 0.03, z, 0.05, 0.6, d * 0.9, top + 0.05);
    }
  } else if (kind === 'barrel') {
    solid.add(shapes.barrel, { x, y: top, z, sx: w, sy: 1.3, sz: d }, metal);
  } else if (kind === 'gable') {
    solid.add(shapes.gable, { x, y: top, z, sx: d + 0.2, sy: 0.8, sz: w + 0.2, ry: Math.PI / 2 }, metal);
  } else {
    solid.block(shapes, darker(wall, 0.9), x, z, w + 0.1, 0.14, d + 0.1, top);
    solid.block(shapes, 0xc9ccd1, x + w * 0.25, z - d * 0.2, 0.7, 0.4, 0.5, top + 0.14);
    solid.add(shapes.cylinder, { x: x - w * 0.3, y: top + 0.35, z: z - d * 0.15, sx: 0.3, sy: 0.5, sz: 0.3 }, 0x9aa3ad);
  }

  // A band of windows, the loading dock with its roller doors, a door.
  const windows = Math.floor(w / 0.75);
  for (let i = 0; i < windows; i++) {
    lit.block(shapes, GLASS, x - w / 2 + (i + 0.5) * (w / windows), front + 0.02, 0.42, 0.32, 0.05, GROUND + h * 0.62);
  }
  const doors = random() < 0.5 ? 1 : 2;
  solid.block(shapes, 0x8a8f96, x + w * 0.12, front + 0.25, doors * 1.05 + 0.3, 0.3, 0.5, GROUND);
  for (let i = 0; i < doors; i++) {
    const dx = x + w * 0.12 + (i - (doors - 1) / 2) * 1.05;
    solid.block(shapes, 0x5b6470, dx, front + 0.03, 0.85, 1.05, 0.06, GROUND + 0.3);
    for (let k = 1; k < 4; k++) solid.block(shapes, 0x737d89, dx, front + 0.065, 0.85, 0.03, 0.02, GROUND + 0.3 + k * 0.26);
  }
  solid.block(shapes, DOOR, x - w * 0.36, front + 0.03, 0.42, 0.85, 0.06, GROUND);

  // Chimneys, with red and white bands at the top; silos beside the hall.
  let chimney: Factory['chimney'] = null;
  const chimneys = pick(random, [0, 1, 1, 2]);
  for (let i = 0; i < chimneys; i++) {
    const cx = x + w / 2 - 0.45 - i * 0.7;
    const cz = z - d / 2 + 0.45;
    const ch = 2.3 + random() * 1.3;
    solid.add(shapes.cylinder, { x: cx, y: GROUND + ch / 2, z: cz, sx: 0.36, sy: ch, sz: 0.36 }, 0x9c8f82);
    solid.add(shapes.cylinder, { x: cx, y: GROUND + ch - 0.32, z: cz, sx: 0.39, sy: 0.2, sz: 0.39 }, 0xd2554a);
    solid.add(shapes.cylinder, { x: cx, y: GROUND + ch - 0.12, z: cz, sx: 0.39, sy: 0.2, sz: 0.39 }, WHITE);
    chimney ??= { x: cx, y: GROUND + ch, z: cz };
  }
  const silos = pick(random, [0, 0, 1, 2]);
  for (let i = 0; i < silos; i++) {
    const sx = x + w / 2 + 0.55;
    const sz = z - d / 2 + 0.55 + i * 1;
    const sh = 1.6 + random() * 0.8;
    solid.add(shapes.cylinder, { x: sx, y: GROUND + sh / 2, z: sz, sx: 0.85, sy: sh, sz: 0.85 }, 0xd7dbe0);
    solid.add(shapes.cone, { x: sx, y: GROUND + sh, z: sz, sx: 0.88, sy: 0.4, sz: 0.88 }, metal);
  }

  // The name on the roof, on two posts.
  const signY = top + (kind === 'flat' ? 0.85 : 1.05);
  const signW = Math.min(w, 4.2);
  for (const px of [-signW * 0.38, signW * 0.38]) solid.block(shapes, 0x5b4636, x + px, front - 0.3, 0.07, signY - top, 0.07, top);
  solid.block(shapes, 0x7d1f18, x, front - 0.3, signW + 0.12, 0.92, 0.08, signY - 0.46);
  signs.add({ text: name, style: 'factory' }, { x, y: signY, z: front - 0.3, w: signW, h: 0.8, depth: 0.08 });
  if (unpaid) glow.block(shapes, 0xf0a63b, x - w / 2 + 0.25, front + 0.05, 0.36, 0.26, 0.05, GROUND + h - 0.45);
  return { x, z, w: w + (silos ? 1.4 : 0.2), d: d + 0.6, h: Math.max(h + 1.4, chimney ? chimney.y : 0), chimney };
}

const HOUSE_WALLS = [0xfdfbf7, 0xf3e7d3, 0xe6eee4, 0xf2e2dc, 0xe2e8f1, 0xf6ecd6, 0xefe9f4];
const HOUSE_ROOFS = [0xd98b5f, 0x8c6a5a, 0x6f7f8f, 0xb07a4f, 0x9c5b47, 0x5f7a6a];
export const DEBT_ROOF = 0xd2554a;

/**
 * One of the best customers' houses, its front toward +z: `h` tall for what they spent, a red roof while
 * they owe; its own colours, roof and garden with a fence and a tree; their name on a plate by the gate.
 */
export function buildHouse(kit: Kit, id: string, name: string, at: { x: number; z: number }, h: number, debt: boolean): Footprint {
  const { shapes, solid, lit, signs } = kit;
  const random = seeded(`house:${id}`);
  const wall = pick(random, HOUSE_WALLS);
  const w = 1.8 + random() * 0.5;
  const d = 1.7 + random() * 0.4;
  const { x } = at;
  const z = at.z - 0.25;
  const front = z + d / 2;

  // The garden, its low fence (open at the gate) and a tree or a bush.
  const gw = 3.3;
  const gd = 3.1;
  const gz = at.z;
  solid.block(shapes, pick(random, [0xb7d39d, 0xa9cb92, 0xc2d9a4]), x, gz, gw, 0.03, gd, GROUND);
  const fence = random() < 0.5 ? WHITE : 0x9c7b5b;
  const rail = (fx: number, fz: number, fw: number, fd: number) => solid.block(shapes, fence, fx, fz, fw, 0.22, fd, GROUND);
  rail(x, gz - gd / 2, gw, 0.05);
  rail(x - gw / 2, gz, 0.05, gd);
  rail(x + gw / 2, gz, 0.05, gd);
  rail(x - gw / 2 + (gw / 2 - 0.45) / 2, gz + gd / 2, gw / 2 - 0.45, 0.05);
  rail(x + gw / 2 - (gw / 2 - 0.45) / 2, gz + gd / 2, gw / 2 - 0.45, 0.05);
  const treeX = x + (random() < 0.5 ? -1 : 1) * (gw / 2 - 0.45);
  if (random() < 0.6) {
    solid.add(shapes.cylinder, { x: treeX, y: GROUND + 0.35, z: gz - gd / 2 + 0.5, sx: 0.12, sy: 0.7, sz: 0.12 }, 0x8a6a4f);
    solid.add(shapes.ball, { x: treeX, y: GROUND + 1, z: gz - gd / 2 + 0.5, sx: 0.85, sy: 0.85, sz: 0.85 }, pick(random, LEAF));
  } else {
    solid.add(shapes.ball, { x: treeX, y: GROUND + 0.22, z: gz + gd / 2 - 0.45, sx: 0.55, sy: 0.42, sz: 0.5 }, pick(random, LEAF));
  }
  for (let i = 0; i < 4; i++) {
    solid.add(shapes.ball, { x: x - 0.5 + i * 0.33 * (random() < 0.5 ? 1 : 1.1), y: GROUND + 0.1, z: front + 0.32, sx: 0.14, sy: 0.14, sz: 0.14 }, pick(random, FLOWERS));
  }

  // The house.
  solid.block(shapes, wall, x, z, w, h, d, GROUND);
  const kind = pick(random, ['hip', 'gable', 'gable', 'flat']);
  roof(kit, kind, debt ? DEBT_ROOF : pick(random, HOUSE_ROOFS), x, z, w, d, GROUND + h, 0.75 + random() * 0.3);
  solid.block(shapes, pick(random, [DOOR, 0x7a5a3c, 0x2f6b3f, 0x24406e]), x + w * 0.22, front + 0.02, 0.42, 0.8, 0.05, GROUND);
  lit.block(shapes, GLASS, x - w * 0.22, front + 0.02, 0.5, 0.45, 0.05, GROUND + 0.5);
  if (h > 1.9) for (const wx of [-w * 0.22, w * 0.22]) lit.block(shapes, GLASS, x + wx, front + 0.02, 0.45, 0.4, 0.05, GROUND + h - 0.75);

  // The name plate on a post by the gate.
  const plateX = x - 0.75;
  const plateZ = gz + gd / 2 + 0.08;
  solid.block(shapes, 0x5b4636, plateX, plateZ, 0.07, 0.5, 0.07, GROUND);
  solid.block(shapes, 0x7a5a22, plateX, plateZ, 1.78, 0.54, 0.05, GROUND + 0.5);
  signs.add({ text: name, style: 'plate' }, { x: plateX, y: GROUND + 0.77, z: plateZ, w: 1.7, h: 0.46, depth: 0.05 });
  return { x, z: gz, w: gw, d: gd, h: h + 1 };
}

export const CROWD_WALLS = [0xf6efe4, 0xefe3cf, 0xe6ece2, 0xf1e1da, 0xe1e6ee];
export const CROWD_ROOFS = [0xd98b5f, 0xb07a4f, 0x9aa3ad, 0x8c6a5a, 0xc98f6a, 0x7f8c99];

/**
 * A warehouse: a long hall with a pitched roof, roof lights and a big door; its name over the door, front
 * and back.
 */
export function buildHall(kit: Kit, id: string, name: string, b: { x: number; z: number; width: number; depth: number }): Footprint {
  const { shapes, solid, lit, signs } = kit;
  const random = seeded(`hall:${id}`);
  const wall = pick(random, [0xfbfaf7, 0xeef0f2, 0xf1ece3]);
  const roofColor = pick(random, [0x9aa3ad, 0x7d8894, 0xa38f7f]);
  solid.block(shapes, wall, b.x, b.z, b.width, 3, b.depth, GROUND);
  solid.block(shapes, darker(wall, 0.8), b.x, b.z, b.width + 0.06, 0.3, b.depth + 0.06, GROUND);
  solid.add(shapes.gable, { x: b.x, y: GROUND + 3, z: b.z, sx: b.depth + 0.4, sy: 1.1, sz: b.width + 0.3, ry: Math.PI / 2 }, roofColor);
  for (let i = 0; i < 3; i++) lit.block(shapes, GLASS, b.x - b.width * 0.3 + i * b.width * 0.3, b.z + b.depth * 0.18, 0.9, 0.12, 0.7, GROUND + 3.35, 0);
  const front = b.z + b.depth / 2;
  solid.block(shapes, 0x5b6470, b.x, front + 0.03, b.width * 0.36, 2.1, 0.08, GROUND);
  for (let k = 1; k < 7; k++) solid.block(shapes, 0x737d89, b.x, front + 0.075, b.width * 0.36, 0.03, 0.02, GROUND + k * 0.3);
  for (const side of [-1, 1]) {
    solid.block(shapes, 0xf0a14a, b.x + side * (b.width * 0.18 + 0.12), front + 0.06, 0.12, 2.1, 0.08, GROUND);
    for (let i = 0; i < 2; i++) lit.block(shapes, GLASS, b.x + side * (b.width * 0.36 + i * 0.75), front + 0.03, 0.5, 0.5, 0.05, GROUND + 1.7);
  }
  const signW = Math.min(b.width * 0.62, 5.2);
  for (const [z, ry] of [[front + 0.05, 0], [b.z - b.depth / 2 - 0.05, Math.PI]] as const) {
    solid.block(shapes, 0x1d2129, b.x, z, signW + 0.14, 0.86, 0.08, GROUND + 2.12);
    signs.add({ text: name, style: 'hall' }, { x: b.x, y: GROUND + 2.55, z, ry, w: signW, h: 0.76, depth: 0.08, twoSided: false });
  }
  return { x: b.x, z: b.z, w: b.width, d: b.depth, h: 4.2 };
}

/** The headquarters: its windows are a pair of sunglasses; TheMoak on the roof. */
export function buildHq(kit: Kit): Footprint {
  const { shapes, solid, lit, signs } = kit;
  const z = -1.2;
  solid.block(shapes, WHITE, 0, z, 5.6, 3.2, 3.6, GROUND);
  solid.block(shapes, 0xe4e1da, 0, z, 5.7, 0.25, 3.7, GROUND);
  solid.block(shapes, 0xe9e6df, 0, z, 5.8, 0.16, 3.8, GROUND + 3.2);
  for (const x of [-1.25, 1.25]) lit.add(shapes.cylinder, { x, y: GROUND + 2, z: 0.62, sx: 1.9, sy: 0.12, sz: 1.25, rx: Math.PI / 2 }, 0x1f2328);
  lit.block(shapes, 0x1f2328, 0, 0.62, 0.9, 0.16, 0.12, GROUND + 2.17);
  solid.block(shapes, 0x5b6470, 0, 0.62, 1.1, 1.1, 0.1, GROUND);
  const signY = GROUND + 4.15;
  for (const px of [-1.7, 1.7]) solid.block(shapes, 0x2e3440, px, z + 0.6, 0.1, 0.9, 0.1, GROUND + 3.3);
  solid.block(shapes, 0x15171c, 0, z + 0.6, 4.7, 0.98, 0.12, signY - 0.49);
  signs.add({ text: 'TheMoak', style: 'brand', ltr: true }, { x: 0, y: signY, z: z + 0.6, w: 4.5, h: 0.86, depth: 0.12 });
  return { x: 0, z, w: 5.8, d: 3.8, h: 4.8 };
}

/** The office: windows, a door, its name, and the task board in front, a note per open task, red when overdue. */
export function buildOffice(kit: Kit, at: { x: number; z: number }, open: number, overdue: number): Footprint {
  const { shapes, solid, lit, signs } = kit;
  const { x, z } = at;
  solid.block(shapes, WHITE, x, z - 1, 4.4, 2.8, 3, GROUND);
  solid.block(shapes, 0x9aa3ad, x, z - 1, 4.55, 0.14, 3.15, GROUND + 2.8);
  for (const dx of [-1.3, 0, 1.3]) lit.block(shapes, GLASS, x + dx, z + 0.52, 0.7, 0.8, 0.04, GROUND + 1.4);
  solid.block(shapes, DOOR, x + 0.65, z + 0.52, 0.7, 1.1, 0.05, GROUND);
  signs.add({ text: 'دفتر پروژه‌ها', style: 'office' }, { x, y: GROUND + 2.5, z: z + 0.53, w: 3.2, h: 0.5, depth: 0.04, twoSided: false });
  solid.block(shapes, 0x8a7f72, x, z + 2.4, 3.6, 1.8, 0.12, GROUND + 0.2);
  for (const px of [-1.6, 1.6]) solid.block(shapes, 0x6b6157, x + px, z + 2.4, 0.12, 0.3, 0.12, GROUND);
  const notes = Math.min(24, open);
  for (let i = 0; i < notes; i++) {
    const late = i < overdue;
    solid.block(shapes, late ? 0xd2554a : 0xf6d36b, x - 1.45 + (i % 8) * 0.41, z + 2.48, 0.32, 0.32, 0.04, GROUND + 1.55 - Math.floor(i / 8) * 0.5);
  }
  return { x, z: z + 0.4, w: 4.6, d: 5, h: 3 };
}

/** The website's tower: its address on a board at its foot. The status light is the engine's (it pulses). */
export function buildTower(kit: Kit, at: { x: number; z: number }, host: string | null): Footprint {
  const { shapes, solid, lit, signs } = kit;
  const { x, z } = at;
  solid.add(shapes.cylinder, { x, y: GROUND + 0.5, z, sx: 4, sy: 1, sz: 4 }, WHITE);
  solid.add(shapes.cylinder, { x, y: GROUND + 1.04, z, sx: 4.1, sy: 0.08, sz: 4.1 }, 0x5b8def);
  solid.add(shapes.cylinder, { x, y: GROUND + 3, z, sx: 0.9, sy: 4.2, sz: 0.9 }, 0x5b8def);
  lit.block(shapes, 0x24304a, x, z + 0.5, 2.4, 1.5, 0.12, GROUND + 1.45);
  for (const px of [-1.6, 1.6]) solid.block(shapes, 0x2e3440, x + px, z + 2.55, 0.08, 0.7, 0.08, GROUND);
  solid.block(shapes, 0x1f4fb0, x, z + 2.55, 3.8, 0.9, 0.08, GROUND + 0.6);
  signs.add({ text: host ?? 'وب‌سایت', style: 'host', ltr: !!host }, { x, y: GROUND + 1.05, z: z + 2.55, w: 3.66, h: 0.8, depth: 0.08 });
  return { x, z, w: 4, d: 4, h: 6.2 };
}

/** A sales channel's kiosk, `h` tall for what it sold, in its colour, its name over the counter. */
export function buildKiosk(kit: Kit, at: { x: number; z: number }, h: number, rgb: number, name: string): Footprint {
  const { shapes, solid, signs } = kit;
  const { x, z } = at;
  solid.block(shapes, WHITE, x, z, 3, h, 2.4, GROUND);
  solid.add(shapes.hip, { x, y: GROUND + h, z, sx: 3.3, sy: 1.1, sz: 2.7 }, rgb);
  solid.block(shapes, rgb, x, z + 1.25, 2.6, 0.9, 0.12, GROUND);
  solid.block(shapes, 0xf6f3ec, x, z + 1.32, 2.7, 0.08, 0.3, GROUND + 0.9);
  if (h > 1.7) signs.add({ text: name, style: 'kiosk', bg: css(rgb) }, { x, y: GROUND + h - 0.42, z: z + 1.2, w: 2.7, h: 0.7, depth: 0.02, twoSided: false });
  return { x, z, w: 3.3, d: 2.8, h: h + 1.1 };
}
