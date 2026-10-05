/**
 * The business world's building kit (world-engine.ts): a few shared shapes, a
 * seeded random for what must look the same on every visit (a store's colours,
 * a factory's roof), and Batch, which merges the many small static pieces of
 * the map (walls, roofs, windows, roads) into one mesh per material: a few draw
 * calls for the whole island instead of thousands.
 */
import * as THREE from 'three';

/** A number in [0, 1) from a string, the same on every visit. */
export function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1_000_003) / 1_000_003;
}

/** A seeded random (mulberry32): the same sequence for the same seed. */
export function seeded(seed: string | number): () => number {
  let a = typeof seed === 'number' ? seed >>> 0 : Math.floor(hash(seed) * 4294967296);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length) % items.length];
}

/** A prism: a convex outline in x–y (counter-clockwise), `depth` deep along z, centred on z = 0. */
export function prism(outline: Array<[number, number]>, depth = 1): THREE.BufferGeometry {
  const z0 = -depth / 2;
  const z1 = depth / 2;
  const positions: number[] = [];
  const tri = (a: number[], b: number[], c: number[]) => positions.push(...a, ...b, ...c);
  const n = outline.length;
  for (let i = 1; i < n - 1; i++) {
    const [a, b, c] = [outline[0], outline[i], outline[i + 1]];
    tri([a[0], a[1], z1], [b[0], b[1], z1], [c[0], c[1], z1]);
    tri([a[0], a[1], z0], [c[0], c[1], z0], [b[0], b[1], z0]);
  }
  for (let i = 0; i < n; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % n];
    tri([a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1]);
    tri([a[0], a[1], z0], [b[0], b[1], z1], [a[0], a[1], z1]);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** The shapes everything is made of, each of size 1 and standing on y = 0 unless said otherwise. */
export class Shapes {
  /** A unit box centred on the origin. */
  box = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
  /** A unit cylinder centred on the origin. */
  cylinder = new THREE.CylinderGeometry(0.5, 0.5, 1, 14).toNonIndexed();
  /** A four-sided pyramid (a hip roof), base 1×1 from y = 0 to 1, turned to sit on a box. */
  hip = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4).translate(0, 0.5, 0).toNonIndexed();
  /** A gable roof: ridge along z, base 1 wide in x, from y = 0 to 1. */
  gable = prism([[-0.5, 0], [0.5, 0], [0, 1]]);
  /** A mansard roof: steep sides, flat top. */
  mansard = prism([[-0.5, 0], [0.5, 0], [0.3, 1], [-0.3, 1]]);
  /** One tooth of a sawtooth roof: upright on its +x side. */
  tooth = prism([[-0.5, 0], [0.5, 0], [0.5, 1]]);
  /** A barrel roof: half a cylinder, axis along z, from y = 0 to 0.5. */
  barrel = new THREE.CylinderGeometry(0.5, 0.5, 1, 14, 1, false, -Math.PI / 2, Math.PI).rotateX(-Math.PI / 2).toNonIndexed();
  /** A cone, base 1 wide from y = 0 to 1 (a pine, a silo's top). */
  cone = new THREE.ConeGeometry(0.5, 1, 10).translate(0, 0.5, 0).toNonIndexed();
  /** A low-poly ball of diameter 1 (a tree's crown, a bush). */
  ball = new THREE.IcosahedronGeometry(0.5, 1);

  dispose() {
    for (const g of [this.box, this.cylinder, this.hip, this.gable, this.mansard, this.tooth, this.barrel, this.cone, this.ball]) g.dispose();
  }
}

const matrix = new THREE.Matrix4();
const quaternion = new THREE.Quaternion();
const euler = new THREE.Euler();
const scale = new THREE.Vector3();
const offset = new THREE.Vector3();

/** Where and how big a piece is: its centre (x, y, z), its size, and turns about y (then x, z). */
export type Place = { x: number; y: number; z: number; sx?: number; sy?: number; sz?: number; ry?: number; rx?: number; rz?: number };

export function placeMatrix(p: Place, out = matrix): THREE.Matrix4 {
  euler.set(p.rx ?? 0, p.ry ?? 0, p.rz ?? 0, 'YXZ');
  quaternion.setFromEuler(euler);
  return out.compose(offset.set(p.x, p.y, p.z), quaternion, scale.set(p.sx ?? 1, p.sy ?? 1, p.sz ?? 1));
}

const normalMatrix = new THREE.Matrix3();
const v = new THREE.Vector3();
const color = new THREE.Color();

/**
 * Static pieces merged into one mesh: add them, then build once. Each piece keeps its own colour
 * (a vertex colour), so one material serves the whole map.
 */
export class Batch {
  private pieces: Array<{ geometry: THREE.BufferGeometry; matrix: THREE.Matrix4; color: number }> = [];
  private vertices = 0;

  get size() {
    return this.pieces.length;
  }

  add(geometry: THREE.BufferGeometry, place: Place, rgb: number) {
    this.pieces.push({ geometry, matrix: placeMatrix(place, new THREE.Matrix4()), color: rgb });
    this.vertices += geometry.attributes.position.count;
  }

  /** A box standing on `y` with its footprint centred on x, z. */
  block(shapes: Shapes, rgb: number, x: number, z: number, w: number, h: number, d: number, y = 0, ry = 0) {
    this.add(shapes.box, { x, y: y + h / 2, z, sx: w, sy: h, sz: d, ry }, rgb);
  }

  /** One geometry of every piece, with a colour per vertex; null when there is nothing. */
  geometry(): THREE.BufferGeometry | null {
    if (!this.pieces.length) return null;
    const positions = new Float32Array(this.vertices * 3);
    const normals = new Float32Array(this.vertices * 3);
    const colors = new Float32Array(this.vertices * 3);
    let at = 0;
    for (const piece of this.pieces) {
      const p = piece.geometry.attributes.position;
      const n = piece.geometry.attributes.normal;
      normalMatrix.getNormalMatrix(piece.matrix);
      color.setHex(piece.color, THREE.SRGBColorSpace);
      for (let i = 0; i < p.count; i++, at++) {
        const k = at * 3;
        v.fromBufferAttribute(p, i).applyMatrix4(piece.matrix);
        positions[k] = v.x;
        positions[k + 1] = v.y;
        positions[k + 2] = v.z;
        v.fromBufferAttribute(n, i).applyMatrix3(normalMatrix).normalize();
        normals[k] = v.x;
        normals[k + 1] = v.y;
        normals[k + 2] = v.z;
        colors[k] = color.r;
        colors[k + 1] = color.g;
        colors[k + 2] = color.b;
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeBoundingSphere();
    return geometry;
  }

  /** The merged mesh, casting and receiving shadows; the caller owns (and disposes) its geometry. */
  mesh(material: THREE.Material, shadows = true): THREE.Mesh | null {
    const geometry = this.geometry();
    if (!geometry) return null;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = shadows;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    return mesh;
  }
}
