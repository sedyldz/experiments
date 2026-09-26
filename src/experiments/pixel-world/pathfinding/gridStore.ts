import { create } from "zustand";
import type { WalkGrid } from "./grid";

/** The built walkable grid (it is derived data, rebuilt from the scene, not persisted). */
export const useGridStore = create<{ grid: WalkGrid | null; showGrid: boolean; setGrid: (g: WalkGrid) => void; toggleGrid: () => void }>((set) => ({
  grid: null,
  showGrid: false,
  setGrid: (grid) => set({ grid }),
  toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),
}));
