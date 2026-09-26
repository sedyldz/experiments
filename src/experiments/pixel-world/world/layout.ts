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
 * The yellow spiral stair at the back, in the corner nook under the deck
 * (reference/photo-spiral-stair.jpeg). It rises through an opening in the
 * deck. You step on facing the back wall (tread 0 points +Z), it winds
 * clockwise, and you step off toward +X onto the deck.
 */
const STAIR = { x: -1.85, z: Z0 + 0.82, radius: 0.72 };
/** The opening in the deck the stair comes up through. */
const HOLE = { x0: X0, x1: -1.05, z0: Z0, z1: Z0 + 1.65 };
/** The nook under the deck around the stair: grey render walls, coffee counter, duct. */
const NOOK = { x0: X0, x1: -0.45 };

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
    /** The opening for the spiral stair. */
    hole: HOLE,
  },

  stair: {
    center: [STAIR.x, STAIR.z] as [number, number],
    radius: STAIR.radius,
    /** Ground-floor entry (in front of tread 0) and deck exit (past the top tread). */
    entry: [STAIR.x, STAIR.z + STAIR.radius + 0.3] as [number, number],
    exit: [HOLE.x1 + 0.3, STAIR.z] as [number, number],
  },

  /** The glass shopfront on the +Z wall. */
  facade: { door: { x: -1.3, w: 1.1 } },

  /** Everything else, placed from the kit by name. */
  placements: [
    // ─── Structure ──────────────────────────────────────────────
    { kind: "railing", floor: "mezzanine", from: X0, to: X1, z: MEZZ.front + 0.04, y: MEZZ.level },

    // The pipe at the deck edge with the navy curtain, drawn open, beside it
    { kind: "pipe", floor: "ground", position: [NOOK.x1 + 0.05, 0, MEZZ.front + 0.02], height: H },
    { kind: "curtain", floor: "ground", position: [NOOK.x1 - 0.6, 0, MEZZ.front + 0.06], width: 0.55, height: UNDER - 0.03, pleat: 0.2 },

    // ─── The stair nook (back left, under the deck) ─────────────
    { kind: "wallPanel", floor: "ground", position: [(X0 + 0.55 + NOOK.x1) / 2, 0, Z0], w: NOOK.x1 - X0 - 0.55, h: UNDER },
    { kind: "wallPanel", floor: "ground", position: [X0 + 0.275, 0, Z0], w: 0.55, h: UNDER, color: "white", shade: 3 },
    { kind: "fuseBox", floor: "ground", position: [X0 + 0.3, 1.75, Z0] },
    { kind: "wallWindow", floor: "ground", position: [STAIR.x + 0.1, 1.55, Z0] },
    { kind: "spiralStair", floor: "ground", position: [STAIR.x, 0, STAIR.z], rise: MEZZ.level, radius: STAIR.radius, sweep: -Math.PI * 1.5, endAngle: 0 },
    // The ribbed yellow duct beside the stair, with its checker plate and the extinguisher
    { kind: "pipe", floor: "ground", position: [NOOK.x1 - 0.3, 0, Z0 + 0.22], height: H, r: 0.16, ribs: 0.32 },
    { kind: "floorPlate", floor: "ground", position: [NOOK.x1 - 0.35, 0, Z0 + 0.45], w: 0.6, d: 0.7 },
    { kind: "fireExtinguisher", floor: "ground", position: [NOOK.x1 - 0.05, 0, Z0 + 0.15] },
    { kind: "coffeeStation", floor: "ground", position: [X0 + 0.6, 0, Z0 + 2.15] },
    { kind: "trashBin", floor: "ground", position: [X0 + 1.35, 0, Z0 + 2.05] },
    // Up top, a yellow landing plate where the stair lets out, and a guard rail along the opening
    { kind: "floorPlate", floor: "mezzanine", position: [HOLE.x1 + 0.3, MEZZ.level, STAIR.z], w: 0.6, d: 0.8 },
    { kind: "railing", floor: "mezzanine", from: X0, to: HOLE.x1, z: HOLE.z1, y: MEZZ.level, height: 0.95 },

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

    // ─── Under the mezzanine, right: the dining room + back door ─
    { kind: "rug", floor: "ground", position: [1.3, 0, -3.5], w: 2.0, d: 2.3 },
    { kind: "diningTable", floor: "ground", position: [1.3, 0, -3.6], w: 1.45, d: 0.8 },
    ...[0.85, 1.3, 1.75].map((x): Placement => ({ kind: "diningChair", floor: "ground", position: [x, 0, -4.22] })),
    { kind: "bench", floor: "ground", position: [1.3, 0, -2.9], w: 1.35 },
    { kind: "frame", floor: "ground", position: [0.1, 1.55, Z0], w: 0.38, h: 0.48 },
    { kind: "frame", floor: "ground", position: [0.7, 1.45, Z0], w: 0.42, h: 0.34, art: ["oak", 3] },
    { kind: "frame", floor: "ground", position: [1.28, 1.6, Z0], w: 0.32, h: 0.42, art: ["mustard", 3] },
    ...[1.0, 1.6].map((x): Placement => ({ kind: "pendantLamp", floor: "ground", position: [x, UNDER, -3.6], drop: 0.75, style: "dome" })),
    { kind: "doorway", floor: "ground", position: [2.6, 0, Z0] },

    // ─── Mezzanine ──────────────────────────────────────────────
    ...[-0.05, 1.2, 2.45].map((x): Placement => ({ kind: "desk", floor: "mezzanine", position: [x, MEZZ.level, Z0 + 0.38], w: 1.22 })),
    ...[-0.05, 1.2, 2.45].map((x, i): Placement => ({ kind: "officeChair", floor: "mezzanine", position: [x + (i % 2 ? 0.1 : -0.1), MEZZ.level, Z0 + 1.15], rotation: Math.PI + (i % 2 ? 0.2 : -0.15) })),
    { kind: "laptop", floor: "mezzanine", position: [1.2, MEZZ.level + 0.75, Z0 + 0.42] },
    { kind: "smallTree", floor: "mezzanine", position: [0.35, MEZZ.level + 0.75, Z0 + 0.3], seed: 61, scale: 0.8 },
    { kind: "palm", floor: "mezzanine", position: [X0 + 0.4, MEZZ.level, MEZZ.front - 0.45], seed: 62, upright: true, scale: 1.3 },
    { kind: "palm", floor: "mezzanine", position: [X1 - 0.35, MEZZ.level, -2.5], seed: 63, scale: 1.2 },
    ...[0.55, 1.85].map((x): Placement => ({ kind: "pendantLamp", floor: "mezzanine", position: [x, H, -3.7], drop: 1.25, style: "globe" })),
    // Pothos baskets hung off the railing, trailing over the deck edge
    { kind: "hangingPothos", floor: "mezzanine", position: [-2.55, MEZZ.level + 1.0, MEZZ.front + 0.14], drop: 0.75, seed: 71, length: 1.3 },
    { kind: "hangingPothos", floor: "mezzanine", position: [0.25, MEZZ.level + 1.0, MEZZ.front + 0.14], drop: 0.8, seed: 72, length: 1.0 },
    { kind: "hangingPothos", floor: "mezzanine", position: [1.55, MEZZ.level + 1.0, MEZZ.front + 0.14], drop: 0.6, seed: 73, length: 1.4 },
  ] satisfies Placement[] as Placement[],
};

export type Layout = typeof layout;
