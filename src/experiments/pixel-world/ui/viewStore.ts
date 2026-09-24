import { create } from "zustand";
import { renderConfig } from "../render/config";

// Local, per-viewer view state: camera, zoom and render toggles. This is not
// shared world state, so it never needs to sync over the network.

export type FloorId = "ground" | "mezzanine";

export interface ViewState {
  /**
   * The quarter-turn count. The camera yaw is 45 degrees + step * 90 degrees.
   * It isn't wrapped, so the tween always takes the short way.
   */
  rotationStep: number;
  /** Integer upscale factor. It is null until the canvas size is known. */
  pixelScale: number | null;
  /** The ground-plane point the camera orbits and pans around (meters). */
  target: { x: number; z: number };

  outline: boolean;
  dither: boolean;
  quantize: boolean;
  floors: Record<FloorId, boolean>;

  rotate: (dir: 1 | -1) => void;
  zoom: (dir: 1 | -1) => void;
  initPixelScale: (canvasHeight: number) => void;
  panBy: (dx: number, dz: number) => void;
  toggle: (key: "outline" | "dither" | "quantize") => void;
  toggleFloor: (floor: FloorId) => void;
}

const clampScale = (s: number) =>
  Math.max(renderConfig.minPixelScale, Math.min(renderConfig.maxPixelScale, s));

export const useViewStore = create<ViewState>((set) => ({
  // Start looking in from the front-left corner, like the reference cutaway.
  rotationStep: -1,
  pixelScale: null,
  target: { x: 0, z: 0 },
  outline: true,
  dither: true,
  quantize: true,
  floors: { ground: true, mezzanine: true },

  rotate: (dir) => set((s) => ({ rotationStep: s.rotationStep + dir })),
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
