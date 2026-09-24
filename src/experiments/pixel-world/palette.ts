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
  ink: ramp(["#1c2130"], 0),

  // Surfaces (sampled from the reference illustrations in /reference)
  cream: ramp(["#9c8f78", "#c9bb9c", "#e2d6b6", "#f3ecd3", "#fbf7e9"], 3),
  wallBlue: ramp(["#6f84a3", "#8fa3c1", "#b1c5de", "#cfdcec", "#e6eef7"], 2),
  concrete: ramp(["#7a6e62", "#9d8f80", "#bcad9b", "#d3c5b2", "#e6dccd"], 3),
  oak: ramp(["#5e3a24", "#8a5a3a", "#b68358", "#d19c68", "#e8bf8a"], 2),
  cobalt: ramp(["#131c3d", "#1f2f66", "#2c4488", "#4560a8", "#7189c8"], 2),
  charcoal: ramp(["#1f2129", "#33353f", "#4a4d58", "#6b6e7a"], 1),
  white: ramp(["#a7a9ae", "#cfd0d2", "#e8e7e3", "#f8f7f3"], 2),

  // Accents
  mustard: ramp(["#8a6410", "#d19a14", "#fcc824", "#ffe07a"], 2),
  navy: ramp(["#1e2436", "#2f3b55", "#3e4a62", "#56627a"], 1),
  terracotta: ramp(["#6e3a25", "#a85a38", "#c97a52", "#e0a27a"], 2),
  orange: ramp(["#7a2e13", "#b0461d", "#d9642e", "#f08a50"], 2),
  tan: ramp(["#9c7048", "#c49464", "#dbb07c"], 1),
  purple: ramp(["#4e2640", "#7a3f64", "#a05e87"], 1),
  glass: ramp(["#9fb9d6", "#c3d7ec", "#e3eef8"], 1),

  // Plants: lots of greens, from deep shade to backlit leaf
  green: ramp(
    ["#17281f", "#22402f", "#2f5a3c", "#3f7248", "#5a8c58", "#7ea676", "#a9c79a"],
    3,
  ),

  // Light sources
  warmLight: ramp(["#ffe9b8", "#fff6dc", "#fffdf4"], 1),

  // Page background behind the diorama
  background: ramp(["#f7f9fc"], 0),
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
