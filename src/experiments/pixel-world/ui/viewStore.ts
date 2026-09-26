import { create } from "zustand";
import { ISO_PITCH, renderConfig } from "../render/config";

// Local, per-viewer view state: camera, zoom and render toggles. This is not
// shared world state, so it never needs to sync over the network.

export type FloorId = "ground" | "mezzanine";

export interface ViewState {
  /**
   * The camera's goal orientation (radians). The rig eases toward it, so
   * drags, key taps and resets all animate. Yaw isn't wrapped, so easing
   * always takes the short way. Yaw 0 looks from the +Z side.
   */
  yaw: number;
  pitch: number;
  /** Continuous zoom: multiplies the world's low-res pixels per meter. */
  zoomLevel: number;
  /** Integer upscale factor (the size of one art pixel on screen). It is null until the canvas size is known. */
  pixelScale: number | null;
  /** The ground-plane point the camera orbits and pans around (meters). */
  target: { x: number; z: number };

  outline: boolean;
  dither: boolean;
  quantize: boolean;
  floors: Record<FloorId, boolean>;

  /** Snap-rotate to the next 45°-offset quarter view (Q/E). */
  rotate: (dir: 1 | -1) => void;
  /** Free orbit by a yaw and pitch delta (radians). */
  orbit: (dYaw: number, dPitch: number) => void;
  /** Multiply the zoom level (continuous). */
  zoomBy: (factor: number) => void;
  /** Back to the classic isometric view. */
  resetView: () => void;
  /** Step the integer pixel size. */
  zoom: (dir: 1 | -1) => void;
  initPixelScale: (canvasHeight: number) => void;
  panBy: (dx: number, dz: number) => void;
  toggle: (key: "outline" | "dither" | "quantize") => void;
  toggleFloor: (floor: FloorId) => void;
}

/** The classic isometric view, looking in from the front-left corner like the reference cutaway. */
export const HOME_YAW = -Math.PI / 4;
const clampPitch = (p: number) => Math.max(renderConfig.minPitch, Math.min(renderConfig.maxPitch, p));
const clampZoom = (z: number) => Math.max(renderConfig.minZoom, Math.min(renderConfig.maxZoom, z));

/** Low-res pixels per world meter at the current zoom. */
export const pixelsPerMeter = (s: { zoomLevel: number }) => renderConfig.pixelsPerMeter * s.zoomLevel;

const clampScale = (s: number) =>
  Math.max(renderConfig.minPixelScale, Math.min(renderConfig.maxPixelScale, s));

export const useViewStore = create<ViewState>((set) => ({
  yaw: HOME_YAW,
  pitch: ISO_PITCH,
  zoomLevel: 1,
  pixelScale: null,
  target: { x: 0, z: 0 },
  outline: true,
  dither: true,
  quantize: true,
  floors: { ground: true, mezzanine: true },

  rotate: (dir) =>
    set((s) => {
      // Next quarter view (45° + k·90°) in that direction
      const q = Math.PI / 2;
      const k = (s.yaw - Math.PI / 4) / q;
      const next = dir > 0 ? Math.floor(k + 1e-3) + 1 : Math.ceil(k - 1e-3) - 1;
      return { yaw: Math.PI / 4 + next * q };
    }),
  orbit: (dYaw, dPitch) => set((s) => ({ yaw: s.yaw + dYaw, pitch: clampPitch(s.pitch + dPitch) })),
  zoomBy: (factor) => set((s) => ({ zoomLevel: clampZoom(s.zoomLevel * factor) })),
  resetView: () =>
    set((s) => {
      // Take the nearest equivalent of the home yaw so it doesn't spin around
      const turns = Math.round((s.yaw - HOME_YAW) / (Math.PI * 2));
      return { yaw: HOME_YAW + turns * Math.PI * 2, pitch: ISO_PITCH, zoomLevel: 1, target: { x: 0, z: 0 } };
    }),
  zoom: (dir) =>
    set((s) => ({ pixelScale: clampScale((s.pixelScale ?? 1) + dir) })),
  initPixelScale: (canvasHeight) =>
    set((s) =>
      s.pixelScale !== null
        ? s
        : {
            pixelScale: clampScale(
              Math.round(canvasHeight / renderConfig.targetHeight),
            ),
          },
    ),
  panBy: (dx, dz) =>
    set((s) => ({ target: { x: s.target.x + dx, z: s.target.z + dz } })),
  toggle: (key) => set((s) => ({ [key]: !s[key] }) as Partial<ViewState>),
  toggleFloor: (floor) =>
    set((s) => ({ floors: { ...s.floors, [floor]: !s.floors[floor] } })),
}));
