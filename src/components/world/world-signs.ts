/**
 * The business world's signboards: every name on the map (a partner's store, a
 * supplier's factory, a customer's door, the headquarters) painted in the app's
 * own font into one shared canvas, an atlas, and shown on boards in 3D. One
 * texture and one draw call for all of them; drawn again once the font has
 * loaded, so Persian is never left in a fallback face.
 */
import * as THREE from 'three';

export type SignStyle = 'store' | 'factory' | 'plate' | 'brand' | 'host' | 'hall' | 'office' | 'kiosk';

export type SignSpec = {
  text: string;
  style: SignStyle;
  /** The board's colour, for a store's or a kiosk's sign. */
  bg?: string;
  /** Latin text (TheMoak, the website's address) reads left to right. */
  ltr?: boolean;
};

/** Where a sign's face goes: its centre, its turn about y (0 faces +z), its size in world units. */
export type SignPlace = { x: number; y: number; z: number; ry?: number; w: number; h: number; twoSided?: boolean; depth?: number };

const WIDTH = 2048;
const MAX_HEIGHT = 4096;

const STYLES: Record<SignStyle, { bg: string; fg: string; border?: string; weight: number }> = {
  store: { bg: '#2e3440', fg: '#ffffff', border: 'rgba(255,255,255,0.45)', weight: 800 },
  factory: { bg: '#b3261e', fg: '#f6d27a', border: '#f6d27a', weight: 800 },
  plate: { bg: '#d9b86c', fg: '#3b2a12', border: '#7a5a22', weight: 700 },
  brand: { bg: '#15171c', fg: '#ffffff', weight: 800 },
  host: { bg: '#2f6fe0', fg: '#ffffff', border: 'rgba(255,255,255,0.5)', weight: 700 },
  hall: { bg: '#2e3440', fg: '#f3f4f6', border: '#f0a14a', weight: 700 },
  office: { bg: '#ffffff', fg: '#1f2328', border: '#9aa3ad', weight: 700 },
  kiosk: { bg: '#5b8def', fg: '#ffffff', weight: 800 },
};

/** The app's font (Vazirmatn, loaded by the root layout), as the page's body uses it. */
export function signFamily(): string {
  try {
    return getComputedStyle(document.body).fontFamily || 'sans-serif';
  } catch {
    return 'sans-serif';
  }
}

let fontLoad: Promise<void> | null = null;

/** Resolves once the app's font can be drawn into a canvas (or could not load; then the fallback stays). */
export function signFontReady(): Promise<void> {
  fontLoad ??= (async () => {
    try {
      await document.fonts.load(`800 48px ${signFamily()}`, 'تئ');
      await document.fonts.ready;
    } catch {
      // No FontFace API: draw with whatever there is.
    }
  })();
  return fontLoad;
}

export function signFontLoaded(): boolean {
  try {
    return document.fonts.check(`800 48px ${signFamily()}`, 'تئ');
  } catch {
    return true;
  }
}

type Slot = { spec: SignSpec; x: number; y: number; w: number; h: number };
type Face = { slot: Slot; place: SignPlace };

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Paints one sign into its slot. */
function paint(ctx: CanvasRenderingContext2D, slot: Slot, family: string) {
  const { spec, x, y, w, h } = slot;
  const style = STYLES[spec.style];
  const bg = spec.bg ?? style.bg;
  ctx.save();
  ctx.clearRect(x, y, w, h);
  ctx.fillStyle = bg;
  ctx.fillRect(x, y, w, h);
  const inset = Math.max(3, h * 0.07);
  if (style.border) {
    ctx.strokeStyle = style.border;
    ctx.lineWidth = Math.max(2, h * 0.045);
    roundRect(ctx, x + inset, y + inset, w - inset * 2, h - inset * 2, h * 0.08);
    ctx.stroke();
  }
  if (spec.style === 'factory') {
    // Two lanterns' dots at the ends.
    ctx.fillStyle = style.border!;
    for (const cx of [x + h * 0.32, x + w - h * 0.32]) {
      ctx.beginPath();
      ctx.arc(cx, y + h / 2, h * 0.09, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (spec.style === 'plate') {
    const gradient = ctx.createLinearGradient(x, y, x, y + h);
    gradient.addColorStop(0, 'rgba(255,255,255,0.35)');
    gradient.addColorStop(0.5, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(x, y, w, h);
  }
  // The name, as large as fits; cut short with … when it cannot.
  const pad = spec.style === 'factory' ? h * 0.6 : h * 0.32;
  const room = w - pad * 2;
  let size = h * 0.56;
  let text = spec.text.trim() || '—';
  ctx.font = `${style.weight} ${size}px ${family}`;
  let width = ctx.measureText(text).width;
  if (width > room) {
    size = Math.max(h * 0.34, size * (room / width));
    ctx.font = `${style.weight} ${size}px ${family}`;
    width = ctx.measureText(text).width;
    while (width > room && text.length > 2) {
      text = text.slice(0, -1);
      width = ctx.measureText(`${text}…`).width;
    }
    if (text !== spec.text.trim()) text = `${text.trimEnd()}…`;
  }
  ctx.direction = spec.ltr ? 'ltr' : 'rtl';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = style.fg;
  // Vazirmatn's middle sits a little high for Persian: nudge it down.
  ctx.fillText(text, x + w / 2, y + h / 2 + size * 0.06);
  ctx.restore();
}

/**
 * Every sign of one build of the map. add() each face, then mesh() once: the atlas is sized to what was
 * added, painted, and the faces merged into one mesh. dispose() frees the canvas's texture.
 */
export class SignAtlas {
  readonly canvas = document.createElement('canvas');
  readonly texture: THREE.CanvasTexture;
  private slots = new Map<string, Slot>();
  private faces: Face[] = [];
  private x = 0;
  private y = 0;
  private family = signFamily();
  private disposed = false;

  /** `cell`: a sign's height in pixels, twice what it shows at a close look. */
  constructor(private cell: number, anisotropy: number) {
    this.canvas.width = WIDTH;
    this.canvas.height = cell;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = anisotropy;
  }

  /** Puts a sign on the map; the same text and style share their pixels. False when the atlas is full. */
  add(spec: SignSpec, place: SignPlace): boolean {
    const key = `${spec.style}|${spec.bg ?? ''}|${spec.ltr ? 1 : 0}|${spec.text}|${Math.round((place.w / place.h) * 4)}`;
    let slot = this.slots.get(key);
    if (!slot) {
      const w = Math.min(WIDTH, Math.max(this.cell, Math.round((this.cell * place.w) / place.h / 16) * 16));
      if (this.x + w > WIDTH) {
        this.x = 0;
        this.y += this.cell;
      }
      if (this.y + this.cell > MAX_HEIGHT) return false;
      slot = { spec, x: this.x, y: this.y, w, h: this.cell };
      this.x += w;
      this.slots.set(key, slot);
    }
    this.faces.push({ slot, place });
    return true;
  }

  /** Paints every sign again: once the app's font has loaded. */
  redraw() {
    if (this.disposed) return;
    this.family = signFamily();
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    for (const slot of this.slots.values()) paint(ctx, slot, this.family);
    this.texture.needsUpdate = true;
  }

  /** The faces of every sign added, in one mesh (null when there is none). */
  mesh(material: THREE.Material): THREE.Mesh | null {
    if (!this.faces.length) return null;
    this.canvas.height = Math.min(MAX_HEIGHT, this.y + this.cell);
    this.redraw();
    const W = this.canvas.width;
    const H = this.canvas.height;
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const quad = (c: THREE.Vector3, right: THREE.Vector3, n: THREE.Vector3, w: number, h: number, u0: number, u1: number, v0: number, v1: number) => {
      const corner = (sx: number, sy: number) => [c.x + right.x * sx * w / 2, c.y + sy * h / 2, c.z + right.z * sx * w / 2];
      const bl = corner(-1, -1);
      const br = corner(1, -1);
      const tr = corner(1, 1);
      const tl = corner(-1, 1);
      positions.push(...bl, ...br, ...tr, ...bl, ...tr, ...tl);
      for (let i = 0; i < 6; i++) normals.push(n.x, n.y, n.z);
      uvs.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1);
    };
    const c = new THREE.Vector3();
    const right = new THREE.Vector3();
    const n = new THREE.Vector3();
    for (const { slot, place } of this.faces) {
      const ry = place.ry ?? 0;
      const half = (place.depth ?? 0) / 2 + 0.012;
      right.set(Math.cos(ry), 0, -Math.sin(ry));
      n.set(Math.sin(ry), 0, Math.cos(ry));
      // A little in from the slot's edges, so a neighbour never bleeds in at a far look.
      const u0 = (slot.x + 2) / W;
      const u1 = (slot.x + slot.w - 2) / W;
      const v1 = 1 - (slot.y + 2) / H;
      const v0 = 1 - (slot.y + slot.h - 2) / H;
      c.set(place.x + n.x * half, place.y, place.z + n.z * half);
      quad(c, right, n, place.w, place.h, u0, u1, v0, v1);
      if (place.twoSided !== false) {
        // The back reads the right way round too: seen from behind, its left is the front's right.
        c.set(place.x - n.x * half, place.y, place.z - n.z * half);
        quad(c, right.clone().negate(), n.clone().negate(), place.w, place.h, u0, u1, v0, v1);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    return mesh;
  }

  dispose() {
    this.disposed = true;
    this.texture.dispose();
    this.canvas.width = 0;
    this.canvas.height = 0;
  }
}
