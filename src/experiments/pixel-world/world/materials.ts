import * as THREE from "three";
import { type PaletteKey, palette, rampId } from "../palette";

// Flat Lambert materials, shared per palette shade. The pixel pipeline
// supplies the look, so materials stay dumb: one flat color each, with light
// doing the shading. Each one remembers its ramp, so quantization only snaps
// it to shades of its own family: a shadowed oak top becomes dark oak, never
// brown-grey.

const cache = new Map<string, THREE.MeshLambertMaterial>();

/** A material in palette family `key`, using the ramp's base shade by default. */
export function flat(key: PaletteKey, shadeIndex?: number): THREE.MeshLambertMaterial {
  const set = palette[key];
  const i = Math.max(0, Math.min(set.ramp.length - 1, shadeIndex ?? set.base));
  const id = `${key}:${i}`;
  let m = cache.get(id);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color: set.ramp[i], flatShading: true });
    m.userData.rampId = rampId(key);
    cache.set(id, m);
  }
  return m;
}
