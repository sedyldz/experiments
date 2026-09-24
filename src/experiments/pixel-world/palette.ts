// The whole look lives here. Every surface color and every color the
// quantization pass is allowed to output comes from these ramps, so tuning a
// hex value here retunes the entire diorama.
//
// Ramps run dark -> light. Materials use the `base` shade; the darker and
// lighter shades exist so lighting can still read after quantization (a
// shadowed oak tabletop snaps to the dark oak shade, not to brown-grey mush).

export type Ramp = readonly string[];

export interface RampSet {
  ramp: Ramp;
  /** index into `ramp` of the color materials should use */
  base: number;
}

function ramp(colors: Ramp, base: number): RampSet {
  return { ramp: colors, base };
}

export const palette = {
  // Outline + deepest shadow. Also the fallback "void" color.
  ink: ramp(["#14151f"], 0),

  // Surfaces
  concrete: ramp(["#4f5561", "#767d88", "#a2a8ae", "#c6c9ca", "#e0e1dd"], 3),
  cream: ramp(["#7d6c58", "#a9957a", "#cdb999", "#e6d7b8", "#f4ecd6"], 3),
  oak: ramp(["#5a3620", "#8a582e", "#b98446", "#d9aa68", "#ecc98f"], 2),
  cobalt: ramp(["#111b4d", "#1c3190", "#2a52c9", "#4f7ce6", "#88aaf2"], 2),

  // Accents
  mustard: ramp(["#6e4f10", "#a87c19", "#d8a82a", "#f0cc5c"], 2),
  navy: ramp(["#0c1028", "#18203f", "#27325c", "#3b4a7a"], 1),
  terracotta: ramp(["#6b3224", "#a24f33", "#cf7a4f", "#e9a67a"], 2),
  steelGrey: ramp(["#2b2e36", "#454a55", "#6a707c"], 1),

  // Plants: lots of greens, from deep shade to backlit leaf
  green: ramp(
    ["#0f2618", "#173d24", "#1f5a2e", "#2e7a35", "#4c9c3c", "#78bd52", "#a9d97a"],
    3,
  ),

  // Light sources
  warmLight: ramp(["#fff3c4", "#fffbe8"], 0),

  // Page background behind the diorama
  background: ramp(["#1e2238"], 0),
} as const satisfies Record<string, RampSet>;

export type PaletteKey = keyof typeof palette;

/** The shade a material of this family should use. */
export function base(key: PaletteKey): string {
  const set = palette[key];
  return set.ramp[set.base];
}

/** A specific shade, clamped to the ramp. */
export function shade(key: PaletteKey, index: number): string {
  const r = palette[key].ramp;
  return r[Math.max(0, Math.min(r.length - 1, index))];
}

export const paletteKeys = Object.keys(palette) as PaletteKey[];

/**
 * The id the pixel pipeline uses for a ramp. 0 means "no ramp": such
 * surfaces get snapped to the nearest color in the whole palette.
 */
export function rampId(key: PaletteKey): number {
  return paletteKeys.indexOf(key) + 1;
}

/**
 * Every ramp, flattened, for the quantization pass. Ramp `rampId(key)`
 * occupies `colors[start .. start + length)`.
 */
export function rampTable(): {
  colors: string[];
  ramps: { start: number; length: number }[];
} {
  const colors: string[] = [];
  const ramps = paletteKeys.map((key) => {
    const r = palette[key].ramp;
    const start = colors.length;
    colors.push(...r);
    return { start, length: r.length };
  });
  return { colors, ramps };
}
