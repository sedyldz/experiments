import { layout } from "../world/layout";
import type { FloorId } from "../ui/viewStore";

// Every place an avatar can sit, derived from the placements in layout.ts.

export interface Seat {
  floor: FloorId;
  /** World position of the seat's center, on its floor. */
  x: number;
  z: number;
  /** Height of the sitting surface above the floor. */
  height: number;
  /** The direction a seated person faces (unit vector in XZ). */
  facing: [number, number];
  /** True for desk chairs: these are the "home" seats avatars get assigned. */
  desk: boolean;
  /** The placement kind it came from. */
  kind: string;
}

const SEAT_KINDS: Record<string, { height: number; desk?: boolean; spots?: number[] }> = {
  officeChair: { height: 0.5, desk: true },
  stool: { height: 0.75 },
  diningChair: { height: 0.46 },
  bench: { height: 0.47, spots: [-0.35, 0.35] },
  sofa: { height: 0.44, spots: [-0.6, 0, 0.6] },
  armChair: { height: 0.48 },
  metalStool: { height: 0.65 },
};

export function buildSeats(): Seat[] {
  const seats: Seat[] = [];
  for (const p of layout.placements) {
    const spec = SEAT_KINDS[p.kind];
    if (!spec || !("position" in p)) continue;
    const [px, py, pz] = p.position as [number, number, number];
    const r = ("rotation" in p ? (p.rotation as number | undefined) : 0) ?? 0;
    const facing: [number, number] = [Math.sin(r), Math.cos(r)];
    const right: [number, number] = [Math.cos(r), -Math.sin(r)];
    for (const off of spec.spots ?? [0]) {
      seats.push({
        floor: p.floor,
        x: px + right[0] * off,
        z: pz + right[1] * off,
        height: py + spec.height,
        facing,
        desk: !!spec.desk,
        kind: p.kind,
      });
    }
  }
  return seats;
}
