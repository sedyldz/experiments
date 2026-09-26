// Tuning for the pixel pipeline and the isometric camera.

export const renderConfig = {
  /**
   * The low-res buffer height the default zoom aims for. The initial integer
   * upscale factor is picked so the buffer comes out close to this. 400 gives
   * a 2x upscale on a typical laptop window.
   */
  targetHeight: 400,
  /** Integer upscale bounds. Zooming steps through these. */
  minPixelScale: 1,
  maxPixelScale: 12,

  /** Low-res pixels per world meter. This sets the world's on-screen size. */
  pixelsPerMeter: 30,

  /** The height (m) the camera looks at above the pan target, so a tall room sits centered. */
  focusHeight: 1.9,
  /** How far behind the target the ortho camera sits (only affects clipping). */
  cameraDistance: 60,
  near: 1,
  far: 140,
  /** How quickly the camera eases toward its goal orientation and zoom (1/s). */
  cameraEase: 14,
  /** Free-orbit limits: from a low, almost eye-level view to nearly top-down (radians). */
  minPitch: 0.12,
  maxPitch: 1.45,
  /** Continuous zoom limits, as multiples of pixelsPerMeter. */
  minZoom: 0.4,
  maxZoom: 3.5,
  /** Orbit speed for a drag, in radians per screen pixel. */
  orbitSpeed: 0.008,

  outline: {
    /** Depth jump (in meters, along the view axis) that counts as a silhouette. */
    depthThreshold: 0.25,
    /** 1 - dot(n1, n2) above which a crease is drawn. */
    normalThreshold: 0.35,
    /** How strongly silhouette pixels are pulled toward `palette.ink`. */
    silhouetteStrength: 1.0,
    /** Multiplier applied to crease pixels (1 = invisible). */
    creaseDarken: 0.72,
  },

  dither: {
    /** Amplitude of the 4x4 Bayer offset added before quantization (0-1 sRGB). */
    strength: 0.02,
    /** Multiplier for the sparse halftone dots (1 = no dots). */
    halftoneDarken: 0.74,
  },

  shadowMapSize: 1024,
} as const;

/** Isometric pitch: the camera looks down at atan(1/sqrt(2)), about 35.26 degrees. */
export const ISO_PITCH = Math.atan(1 / Math.SQRT2);
