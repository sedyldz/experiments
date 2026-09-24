import * as THREE from "three";
import type { PaletteKey } from "../../palette";
import { palette } from "../../palette";

// Procedural leaves, merged into one geometry per palette ramp, so a whole
// plant is one or two draw calls.
//
// A leaf is built in local space pointing +X, lying flat (facing +Y), with a
// slight V-fold along the midrib. The fold gives the normal pass a crease,
// so the midrib reads as a darker line after the outline pass.

/** A leaf outline as a half-width profile along the midrib (t = 0 at the stem, t = 1 at the tip). */
export type LeafProfile = (t: number) => number;

export const leafProfiles = {
  /** A big split leaf. The notches make its edge ragged like a monstera. */
  monstera: (t: number) => {
    const w = 0.52 * Math.pow(Math.sin(Math.PI * Math.min(1, 0.12 + t * 0.9)), 0.6);
    const notch = [0.28, 0.46, 0.64, 0.8].some((n) => Math.abs(t - n) < 0.045);
    return notch ? w * 0.35 : w;
  },
  /** A narrow oval leaflet (schefflera, small trees). */
  oval: (t: number) => 0.2 * Math.sin(Math.PI * t),
  /** A broad heart, wide near the stem (pothos). */
  heart: (t: number) => 0.42 * Math.pow(Math.sin(Math.PI * (0.18 + 0.82 * t)), 0.8),
  /** A long strap (palms, bird of paradise, snake plant). */
  lance: (t: number) => 0.09 * Math.sin(Math.PI * Math.pow(t, 0.8)),
} satisfies Record<string, LeafProfile>;

export type LeafKind = keyof typeof leafProfiles;

const SAMPLES = 9;

/** A seeded PRNG (mulberry32), so plants look the same on every load. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface LeafSpec {
  kind: LeafKind;
  /** Where the leaf's stem end attaches. */
  at: THREE.Vector3;
  /** The direction the leaf points, around Y (radians, 0 = +X). */
  yaw: number;
  /** The tip's elevation above horizontal (radians, negative droops). */
  pitch: number;
  /** A twist around the midrib. */
  roll?: number;
  /** Leaf length in meters. */
  size: number;
  /** Shade index into the ramp. */
  shade: number;
  /** Midrib fold (radians). */
  fold?: number;
}

const _m = new THREE.Matrix4();
const _r = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _c = new THREE.Color();

/** Collects leaves and stems per ramp and turns them into one geometry per ramp. */
export class FoliageBatch {
  private data = new Map<PaletteKey, { pos: number[]; col: number[] }>();

  private bucket(key: PaletteKey) {
    let b = this.data.get(key);
    if (!b) {
      b = { pos: [], col: [] };
      this.data.set(key, b);
    }
    return b;
  }

  private push(key: PaletteKey, shade: number, verts: THREE.Vector3[]) {
    const b = this.bucket(key);
    const ramp = palette[key].ramp;
    _c.set(ramp[Math.max(0, Math.min(ramp.length - 1, shade))]);
    for (const v of verts) {
      b.pos.push(v.x, v.y, v.z);
      b.col.push(_c.r, _c.g, _c.b);
    }
  }

  leaf(spec: LeafSpec, key: PaletteKey = "green") {
    const profile = leafProfiles[spec.kind];
    const fold = Math.tan(spec.fold ?? 0.35);
    _m.makeTranslation(spec.at.x, spec.at.y, spec.at.z);
    _m.multiply(_r.makeRotationY(spec.yaw));
    _m.multiply(_r.makeRotationZ(spec.pitch));
    _m.multiply(_r.makeRotationX(spec.roll ?? 0));
    _m.multiply(_r.makeScale(spec.size, spec.size, spec.size));

    const pt = (x: number, z: number) =>
      new THREE.Vector3(x, Math.abs(z) * fold, z).applyMatrix4(_m);
    const tris: THREE.Vector3[] = [];
    for (let i = 0; i < SAMPLES; i++) {
      const t0 = i / SAMPLES;
      const t1 = (i + 1) / SAMPLES;
      const w0 = profile(t0);
      const w1 = i + 1 === SAMPLES ? 0 : profile(t1);
      for (const side of [1, -1]) {
        const m0 = pt(t0, 0);
        const m1 = pt(t1, 0);
        const e0 = pt(t0, side * w0);
        const e1 = pt(t1, side * w1);
        tris.push(m0, e0, e1, m0, e1, m1);
      }
    }
    this.push(key, spec.shade, tris);
  }

  /** A thin square stem between two points. */
  stem(from: THREE.Vector3, to: THREE.Vector3, thickness: number, shade: number, key: PaletteKey = "green") {
    const dir = _v.copy(to).sub(from);
    const len = dir.length();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    const geo = new THREE.BoxGeometry(thickness, len, thickness).toNonIndexed();
    const mid = from.clone().add(to).multiplyScalar(0.5);
    geo.applyMatrix4(new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1)));
    const p = geo.getAttribute("position");
    const verts: THREE.Vector3[] = [];
    for (let i = 0; i < p.count; i++) verts.push(new THREE.Vector3().fromBufferAttribute(p, i));
    geo.dispose();
    this.push(key, shade, verts);
  }

  build(): { key: PaletteKey; geometry: THREE.BufferGeometry }[] {
    return [...this.data.entries()].map(([key, b]) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(b.pos, 3));
      g.setAttribute("color", new THREE.Float32BufferAttribute(b.col, 3));
      g.computeVertexNormals();
      g.computeBoundingSphere();
      return { key, geometry: g };
    });
  }
}
