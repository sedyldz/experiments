import * as THREE from "three";
import { type PaletteKey, palette, rampId } from "../palette";

// Flat Lambert materials, shared per palette shade. The pixel pipeline
// supplies the look, so materials stay dumb: one flat color each, with light
// doing the shading. Each one remembers its ramp, so quantization only snaps
// it to shades of its own family: a shadowed oak top becomes dark oak, never
// brown-grey.

const cache = new Map<string, THREE.Material>();

function cached<T extends THREE.Material>(id: string, make: () => T): T {
  let m = cache.get(id) as T | undefined;
  if (!m) {
    m = make();
    cache.set(id, m);
  }
  return m;
}

function shadeOf(key: PaletteKey, shadeIndex?: number): string {
  const set = palette[key];
  return set.ramp[Math.max(0, Math.min(set.ramp.length - 1, shadeIndex ?? set.base))];
}

/** A material in palette family `key`, using the ramp's base shade by default. */
export function flat(key: PaletteKey, shadeIndex?: number): THREE.MeshLambertMaterial {
  const color = shadeOf(key, shadeIndex);
  return cached(`flat:${key}:${color}`, () => {
    const m = new THREE.MeshLambertMaterial({ color, flatShading: true });
    m.userData.rampId = rampId(key);
    return m;
  });
}

/**
 * Double-sided, vertex-colored material for merged foliage. Each leaf picks
 * its own green shade through vertex colors, and the whole plant is one draw
 * call.
 */
export function foliage(key: PaletteKey = "green"): THREE.MeshLambertMaterial {
  return cached(`foliage:${key}`, () => {
    const m = new THREE.MeshLambertMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      flatShading: true,
    });
    m.userData.rampId = rampId(key);
    return m;
  });
}

/** Unlit material for light sources (lamp globes, fluorescent tubes). */
export function glow(key: PaletteKey = "warmLight", shadeIndex?: number): THREE.MeshBasicMaterial {
  const color = shadeOf(key, shadeIndex);
  return cached(`glow:${key}:${color}`, () => {
    const m = new THREE.MeshBasicMaterial({ color });
    m.userData.rampId = rampId(key);
    return m;
  });
}

/**
 * 1px lines (lamp cords, wires). They skip the depth write so they never
 * pick up an outline, and they stay exactly one low-res pixel wide.
 */
export function wire(color = palette.ink.ramp[0]): THREE.LineBasicMaterial {
  return cached(`wire:${color}`, () => new THREE.LineBasicMaterial({ color, depthWrite: false }));
}
