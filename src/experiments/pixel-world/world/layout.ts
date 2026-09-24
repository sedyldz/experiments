import type { Placement } from "./kit";

// Every dimension and every placement in the space, in meters. The floor
// plan is read off the reference illustrations in /reference. It is a
// placeholder until a real survey arrives, and re-measuring the space should
// only mean editing this file.
//
// Coordinates: the origin is the center of the ground floor.
//   +X  toward the right long wall (the desk row with the wall shelf)
//   -X  toward the left long wall (high tables, the stair)
//   -Z  toward the back wall (the mezzanine, the dining area, the kitchen)
//   +Z  toward the glass shopfront (the entrance)
//   +Y  up

const W = 6.5; // interior width (X)
const D = 10; // interior depth (Z)
const H = 5.4; // floor to ceiling
const X0 = -W / 2;
const X1 = W / 2;
const Z0 = -D / 2;
const Z1 = D / 2;

/** The mezzanine deck along the back wall. */
const MEZZ = {
  front: -2.0, // z of the open edge, where the railing is
  level: 2.7, // top of the deck
  thickness: 0.3,
};
const UNDER = MEZZ.level - MEZZ.thickness; // headroom under the mezzanine

/**
 * A steel spiral stair in front of the deck's right end. It's entered from
 * the room side (-X) and exits onto the deck (-Z).
 */
const STAIR = { x: X1 - 0.95, z: MEZZ.front + 0.78, radius: 0.72 };

const DESK_ROW = { x: X1 - 0.35, z0: 0.85, count: 3, w: 1.2 };
const deskZ = (i: number) => DESK_ROW.z0 + DESK_ROW.w * (i + 0.5);

const SHELF = { y: 2.0, z0: 0.95, z1: 4.75 };
const SHELF_X = X1 - 0.14; // where things stand on the wall shelf
const onShelf = (z: number): [number, number, number] => [SHELF_X, SHELF.y + 0.025, z];

const HALF_PI = Math.PI / 2;

export const layout = {
  room: {
    width: W,
    depth: D,
    height: H,
    wallThickness: 0.2,
    floorThickness: 0.25,
    /** How much of a cutaway (camera-facing) wall is still drawn. */
    cutawayStubHeight: 0.25,
  },

  mezzanine: {
    zFrom: Z0,
    zTo: MEZZ.front,
    level: MEZZ.level,
    thickness: MEZZ.thickness,
  },

  stair: {
    center: [STAIR.x, STAIR.z] as [number, number],
    radius: STAIR.radius,
    /** Ground-floor entry (the first tread points -X) and deck exit (the last tread points -Z). */
    entry: [STAIR.x - STAIR.radius - 0.3, STAIR.z] as [number, number],
    exit: [STAIR.x, MEZZ.front - 0.35] as [number, number],
  },

  /** The glass shopfront on the +Z wall. */
  facade: { door: { x: -1.3, w: 1.1 } },

  /** Everything else, placed from the kit by name. */
  placements: [
    // ─── Structure ──────────────────────────────────────────────
    { kind: "spiralStair", floor: "ground", position: [STAIR.x, 0, STAIR.z], rise: MEZZ.level, radius: STAIR.radius },
    { kind: "railing", floor: "mezzanine", from: X0, to: STAIR.x - 0.45, z: MEZZ.front + 0.04, y: MEZZ.level },
    { kind: "railing", floor: "mezzanine", from: STAIR.x + 0.45, to: X1, z: MEZZ.front + 0.04, y: MEZZ.level },

    // The services wall: the mustard pipe with the navy curtain beside it
    { kind: "pipe", floor: "ground", position: [-1.05, 0, MEZZ.front + 0.02], height: H },
    { kind: "curtain", floor: "ground", position: [-2.4, 0, MEZZ.front + 0.06], width: 1.25, height: UNDER - 0.03 },
    { kind: "pipe", floor: "ground", position: [0.55, 1.3, Z0 + 0.12], height: 0.9, r: 0.06, elbow: { length: 0.8, dir: [1, 0] } },

    { kind: "linearLamp", floor: "ground", position: [0.3, H, 2.3], rotation: HALF_PI, length: 2.8, drop: 1.1 },

    // ─── Wall desk row (right wall) ─────────────────────────────
    ...Array.from({ length: DESK_ROW.count }, (_, i): Placement => ({
      kind: "desk",
      floor: "ground",
      position: [DESK_ROW.x, 0, deskZ(i)],
      rotation: -HALF_PI,
      w: DESK_ROW.w - 0.02,
    })),
    ...Array.from({ length: DESK_ROW.count }, (_, i): Placement => ({
      kind: "officeChair",
      floor: "ground",
      position: [DESK_ROW.x - 0.7, 0, deskZ(i) + (i % 2 ? 0.1 : -0.1)],
      rotation: HALF_PI + (i % 2 ? 0.25 : -0.2),
    })),
    { kind: "laptop", floor: "ground", position: [DESK_ROW.x - 0.05, 0.75, deskZ(0)], rotation: -HALF_PI },
    { kind: "laptop", floor: "ground", position: [DESK_ROW.x - 0.05, 0.75, deskZ(2) - 0.15], rotation: -HALF_PI },

    // The wall shelf above the desks, with its plants
    { kind: "wallShelf", floor: "ground", position: [X1, SHELF.y, (SHELF.z0 + SHELF.z1) / 2], rotation: -HALF_PI, length: SHELF.z1 - SHELF.z0 },
    { kind: "palm", floor: "ground", position: onShelf(1.2), upright: true, seed: 11, scale: 1.4 },
    { kind: "smallTree", floor: "ground", position: onShelf(1.9), seed: 12, scale: 1.4 },
    { kind: "shelfTrailer", floor: "ground", position: onShelf(2.5), color: "purple", seed: 13, length: 0.8 },
    { kind: "shelfTrailer", floor: "ground", position: onShelf(3.15), seed: 14, length: 0.6, pot: "white" },
    { kind: "books", floor: "ground", position: [SHELF_X - 0.02, SHELF.y + 0.025, 3.5], rotation: -HALF_PI, count: 5, seed: 2 },
    { kind: "shelfTrailer", floor: "ground", position: onShelf(4.1), seed: 15, length: 0.9, pot: "terracotta" },
    { kind: "palm", floor: "ground", position: onShelf(4.5), seed: 16, pot: "white", scale: 1.1 },

    // A schefflera in the corner at the end of the desk row
    { kind: "schefflera", floor: "ground", position: [X1 - 0.35, 0, Z1 - 0.35], seed: 21, pot: "green" },

    // ─── High tables (left + center) ────────────────────────────
    { kind: "highTable", floor: "ground", position: [X0 + 0.38, 0, 2.6], rotation: HALF_PI, w: 2.2, d: 0.68 },
    ...[1.9, 2.6, 3.3].map((z): Placement => ({ kind: "stool", floor: "ground", position: [X0 + 1.0, 0, z] })),
    { kind: "laptop", floor: "ground", position: [X0 + 0.42, 1.05, 2.2], rotation: HALF_PI },
    { kind: "smallTree", floor: "ground", position: [X0 + 0.33, 1.05, 3.4], seed: 31 },

    { kind: "highTable", floor: "ground", position: [-0.1, 0, -0.35], w: 1.8, d: 0.75 },
    ...[-0.55, 0.35].flatMap((x): Placement[] => [
      { kind: "stool", floor: "ground", position: [x, 0, -0.95] },
      { kind: "stool", floor: "ground", position: [x, 0, 0.25] },
    ]),

    // The big monstera on its moss pole, and a second schefflera
    { kind: "monstera", floor: "ground", position: [-0.35, 0, 3.0], seed: 41, pot: "white" },
    { kind: "schefflera", floor: "ground", position: [1.3, 0, 0.7], seed: 42, pot: "charcoal", scale: 1.05 },

    // Front-left: a steel shelving unit and a work table on casters
    { kind: "shelvingUnit", floor: "ground", position: [X0 + 0.23, 0, Z1 - 0.75], rotation: HALF_PI, w: 1.0, d: 0.38, h: 1.8 },
    { kind: "palm", floor: "ground", position: [X0 + 0.23, 1.8, Z1 - 0.95], seed: 51, scale: 0.85 },
    { kind: "smallTree", floor: "ground", position: [X0 + 0.23, 1.22, Z1 - 0.55], seed: 52, scale: 0.75 },
    { kind: "books", floor: "ground", position: [X0 + 0.23, 0.66, Z1 - 1.1], rotation: HALF_PI, count: 5, seed: 4 },
    { kind: "highTable", floor: "ground", position: [-1.6, 0, Z1 - 0.8], w: 1.3, d: 0.7, h: 0.95, casters: true },

    // ─── Under the mezzanine, left: the dining room ─────────────
    { kind: "rug", floor: "ground", position: [-2.15, 0, -3.5], w: 2.0, d: 2.3 },
    { kind: "diningTable", floor: "ground", position: [-2.15, 0, -3.6], w: 1.45, d: 0.8 },
    ...[-2.6, -2.15, -1.7].map((x): Placement => ({ kind: "diningChair", floor: "ground", position: [x, 0, -4.22] })),
    { kind: "bench", floor: "ground", position: [-2.15, 0, -2.9], w: 1.35 },
    { kind: "frame", floor: "ground", position: [-2.8, 1.55, Z0], w: 0.38, h: 0.48 },
    { kind: "frame", floor: "ground", position: [-2.2, 1.45, Z0], w: 0.42, h: 0.34, art: ["oak", 3] },
    { kind: "frame", floor: "ground", position: [-1.62, 1.6, Z0], w: 0.32, h: 0.42, art: ["mustard", 3] },
    ...[-2.45, -1.85].map((x): Placement => ({ kind: "pendantLamp", floor: "ground", position: [x, UNDER, -3.6], drop: 0.75, style: "dome" })),

    // ─── Under the mezzanine, right: the kitchen + back door ────
    { kind: "doorway", floor: "ground", position: [-0.3, 0, Z0] },
    { kind: "kitchenCounter", floor: "ground", position: [2.15, 0, Z0], w: 2.1 },
    { kind: "highTable", floor: "ground", position: [0.75, 0, -3.3], w: 1.2, d: 0.65, shelf: false },
    ...[0.4, 1.1].map((x): Placement => ({ kind: "stool", floor: "ground", position: [x, 0, -2.75] })),
    ...[0.35, 0.75, 1.15].map((x): Placement => ({ kind: "pendantLamp", floor: "ground", position: [x, UNDER, -3.3], drop: 0.6, style: "cone" })),

    // ─── Mezzanine ──────────────────────────────────────────────
    ...[-2.55, -1.3, -0.05, 1.2].map((x): Placement => ({ kind: "desk", floor: "mezzanine", position: [x, MEZZ.level, Z0 + 0.38], w: 1.22 })),
    ...[-2.55, -1.3, -0.05, 1.2].map((x, i): Placement => ({ kind: "officeChair", floor: "mezzanine", position: [x + (i % 2 ? 0.1 : -0.1), MEZZ.level, Z0 + 1.15], rotation: Math.PI + (i % 2 ? 0.2 : -0.15) })),
    { kind: "laptop", floor: "mezzanine", position: [-1.3, MEZZ.level + 0.75, Z0 + 0.42] },
    { kind: "smallTree", floor: "mezzanine", position: [1.6, MEZZ.level + 0.75, Z0 + 0.3], seed: 61, scale: 0.8 },
    { kind: "palm", floor: "mezzanine", position: [X0 + 0.4, MEZZ.level, MEZZ.front - 0.45], seed: 62, upright: true, scale: 1.3 },
    { kind: "palm", floor: "mezzanine", position: [2.55, MEZZ.level, Z0 + 0.4], seed: 63, scale: 1.2 },
    ...[-1.5, 0.7].map((x): Placement => ({ kind: "pendantLamp", floor: "mezzanine", position: [x, H, -3.7], drop: 1.25, style: "globe" })),
    // Pothos baskets hung off the railing, trailing over the deck edge
    { kind: "hangingPothos", floor: "mezzanine", position: [-2.55, MEZZ.level + 1.0, MEZZ.front + 0.14], drop: 0.75, seed: 71, length: 1.3 },
    { kind: "hangingPothos", floor: "mezzanine", position: [-0.35, MEZZ.level + 1.0, MEZZ.front + 0.14], drop: 0.8, seed: 72, length: 1.0 },
    { kind: "hangingPothos", floor: "mezzanine", position: [1.55, MEZZ.level + 1.0, MEZZ.front + 0.14], drop: 0.6, seed: 73, length: 1.4 },
  ] satisfies Placement[] as Placement[],
};

export type Layout = typeof layout;
