import type { Placement } from "./kit";

// Every dimension and every placement in the space, in meters. The floor
// plan is pieced together from the illustrations and photos in /reference.
// The arrangement follows them, but the dimensions are estimates until a real
// survey arrives. Re-measuring the space should only mean editing this file.
//
// Coordinates: the origin is the center of the ground floor.
//   +X  toward the right long wall (the desk row with the wall shelf)
//   -X  toward the left long wall (the merch wall, a high table)
//   -Z  toward the back wall (the mezzanine: kitchen + desks upstairs; the
//       stair nook and the yellow tables below)
//   +Z  toward the glass shopfront (the entrance)
//   +Y  up

const W = 6.5; // interior width (X)
const D = 10; // interior depth (Z)
const H = 5.4; // floor to ceiling
const X0 = -W / 2;
const X1 = W / 2;
const Z0 = -D / 2;
const Z1 = D / 2;

/** The mezzanine deck along the back wall: the kitchen and a desk area upstairs. */
const MEZZ = {
  front: -1.2, // z of the open edge, where the railing is
  level: 2.7, // top of the deck
  thickness: 0.3,
};
const UNDER = MEZZ.level - MEZZ.thickness; // headroom under the mezzanine
const UP = MEZZ.level;

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

/** Upstairs desks along the railing, looking out over the double-height room. */
const MEZZ_DESKS = [-2.55, -1.3, -0.05];
const KITCHEN = { x: 1.95, w: 2.6, island: { x: 1.9, z: -3.6 } };

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

  /** The shopfront on the +Z wall (reference/photo-shopfront.jpeg). The door is on the right. */
  facade: { door: { x: X1 - 0.75, w: 1.1 } },

  /** Everything else, placed from the kit by name. */
  placements: [
    // ─── Structure ──────────────────────────────────────────────
    { kind: "railing", floor: "mezzanine", from: X0, to: X1, z: MEZZ.front + 0.04, y: UP },
    { kind: "railing", floor: "mezzanine", from: X0, to: HOLE.x1, z: HOLE.z1, y: UP, height: 0.95 },

    // The pipe at the deck edge with the navy curtain, drawn open, beside it
    { kind: "pipe", floor: "ground", position: [NOOK.x1 + 0.05, 0, MEZZ.front + 0.02], height: H },
    { kind: "curtain", floor: "ground", position: [NOOK.x1 - 0.6, 0, MEZZ.front + 0.06], width: 0.55, height: UNDER - 0.03, pleat: 0.2 },

    { kind: "linearLamp", floor: "ground", position: [0.3, H, 2.3], rotation: HALF_PI, length: 2.8, drop: 1.1 },

    // ─── The stair nook (back left, under the deck) ─────────────
    { kind: "wallPanel", floor: "ground", position: [(X0 + 0.55 + NOOK.x1) / 2, 0, Z0], w: NOOK.x1 - X0 - 0.55, h: UNDER },
    { kind: "fuseBox", floor: "ground", position: [X0 + 0.3, 1.75, Z0] },
    { kind: "wallWindow", floor: "ground", position: [STAIR.x + 0.1, 1.55, Z0] },
    { kind: "spiralStair", floor: "ground", position: [STAIR.x, 0, STAIR.z], rise: MEZZ.level, radius: STAIR.radius, sweep: -Math.PI * 1.5, endAngle: 0 },
    // The ribbed yellow duct beside the stair, with its checker plate and the extinguisher
    { kind: "pipe", floor: "ground", position: [NOOK.x1 - 0.3, 0, Z0 + 0.22], height: H, r: 0.16, ribs: 0.32 },
    { kind: "floorPlate", floor: "ground", position: [NOOK.x1 - 0.35, 0, Z0 + 0.45], w: 0.6, d: 0.7 },
    { kind: "fireExtinguisher", floor: "ground", position: [NOOK.x1 - 0.05, 0, Z0 + 0.15] },
    { kind: "coffeeStation", floor: "ground", position: [X0 + 0.6, 0, Z0 + 2.15] },
    { kind: "trashBin", floor: "ground", position: [X0 + 1.35, 0, Z0 + 2.05] },

    // ─── Under the deck, right: the yellow table + bench, felt panels, pictures, the "tio" sign ──
    { kind: "highTable", floor: "ground", position: [1.6, 0, -4.2], w: 1.4, d: 0.7, h: 0.75, shelf: false, frame: "mustard" },
    { kind: "highTable", floor: "ground", position: [1.6, 0, -3.5], w: 1.3, d: 0.36, h: 0.45, shelf: false, frame: "mustard" },
    { kind: "highTable", floor: "ground", position: [0.9, 0, -2.2], w: 1.5, d: 0.6 },
    ...[0.5, 1.3].map((x): Placement => ({ kind: "stool", floor: "ground", position: [x, 0, -1.65] })),
    { kind: "frame", floor: "ground", position: [0.05, 1.5, Z0], w: 0.45, h: 0.55, art: ["terracotta", 2] },
    { kind: "frame", floor: "ground", position: [0.65, 1.6, Z0], w: 0.4, h: 0.5, art: ["wallBlue", 1] },
    ...[1.3, 1.78, 2.26].map((x): Placement => ({ kind: "wallPanel", floor: "ground", position: [x, 1.35, Z0], w: 0.44, h: 0.44, color: "white", shade: 1 })),
    { kind: "logoSign", floor: "ground", position: [1.78, 2.1, Z0] },
    { kind: "doorway", floor: "ground", position: [2.85, 0, Z0], w: 0.7 },
    { kind: "pendantLamp", floor: "ground", position: [1.6, UNDER, -4.0], drop: 0.55, style: "cone" },

    // The mirror on the right wall, with the rubber plant in front of it
    { kind: "mirror", floor: "ground", position: [X1, 0, 0.1], rotation: -HALF_PI },
    { kind: "rubberPlant", floor: "ground", position: [X1 - 0.55, 0, -0.3], seed: 81 },

    // ─── Wall desk row (right wall) ─────────────────────────────
    ...Array.from({ length: DESK_ROW.count }, (_, i): Placement => ({
      kind: "desk",
      floor: "ground",
      position: [DESK_ROW.x, 0, deskZ(i)],
      rotation: -HALF_PI,
      w: DESK_ROW.w - 0.02,
      divider: i === 0,
    })),
    ...Array.from({ length: DESK_ROW.count }, (_, i): Placement => ({
      kind: "officeChair",
      floor: "ground",
      position: [DESK_ROW.x - 0.7, 0, deskZ(i) + (i % 2 ? 0.1 : -0.1)],
      rotation: HALF_PI + (i % 2 ? 0.25 : -0.2),
    })),
    { kind: "laptop", floor: "ground", position: [DESK_ROW.x - 0.05, 0.75, deskZ(1)], rotation: -HALF_PI },
    { kind: "laptop", floor: "ground", position: [DESK_ROW.x - 0.05, 0.75, deskZ(2) - 0.15], rotation: -HALF_PI },

    // The wall shelf above the desks (reference/photo-wall-shelf.jpeg)
    { kind: "wallShelf", floor: "ground", position: [X1, SHELF.y, (SHELF.z0 + SHELF.z1) / 2], rotation: -HALF_PI, length: SHELF.z1 - SHELF.z0 },
    { kind: "palm", floor: "ground", position: onShelf(1.2), upright: true, seed: 11, scale: 1.35, pot: "charcoal" },
    { kind: "schefflera", floor: "ground", position: onShelf(1.9), seed: 17, scale: 0.55, pot: "terracotta" },
    { kind: "smallTree", floor: "ground", position: onShelf(2.45), seed: 12, scale: 0.8, pot: "terracotta" },
    { kind: "books", floor: "ground", position: [SHELF_X - 0.02, SHELF.y + 0.025, 3.05], rotation: -HALF_PI, count: 4, seed: 2 },
    { kind: "shelfTrailer", floor: "ground", position: onShelf(3.5), seed: 14, length: 0.5, pot: "white" },
    { kind: "shelfTrailer", floor: "ground", position: onShelf(4.0), seed: 15, length: 1.0, pot: "green" },
    // The hoya hanging from a hook above the end of the shelf
    { kind: "hangingPothos", floor: "ground", position: [X1 - 0.3, 3.2, 4.45], drop: 0.45, seed: 18, length: 1.7 },

    // A schefflera in the corner at the end of the desk row
    { kind: "schefflera", floor: "ground", position: [X1 - 0.35, 0, Z1 - 0.35], seed: 21, pot: "green" },

    // ─── Main floor ─────────────────────────────────────────────
    // The long high table on the left wall, with the laptop and small tree
    { kind: "highTable", floor: "ground", position: [X0 + 0.38, 0, 0.9], rotation: HALF_PI, w: 1.8, d: 0.68 },
    ...[0.3, 0.9, 1.5].map((z): Placement => ({ kind: "stool", floor: "ground", position: [X0 + 1.0, 0, z] })),
    { kind: "laptop", floor: "ground", position: [X0 + 0.42, 1.05, 0.5], rotation: HALF_PI },
    { kind: "smallTree", floor: "ground", position: [X0 + 0.33, 1.05, 1.55], seed: 31 },

    // The center high table
    { kind: "highTable", floor: "ground", position: [-0.1, 0, -0.2], w: 1.8, d: 0.75 },
    ...[-0.55, 0.35].flatMap((x): Placement[] => [
      { kind: "stool", floor: "ground", position: [x, 0, -0.75] },
      { kind: "stool", floor: "ground", position: [x, 0, 0.35] },
    ]),

    // The big monstera on its moss pole, and a second schefflera
    { kind: "monstera", floor: "ground", position: [-0.35, 0, 3.0], seed: 41, pot: "white" },
    { kind: "schefflera", floor: "ground", position: [1.3, 0, 0.9], seed: 42, pot: "charcoal", scale: 1.05 },

    // The merch wall on the left wall by the entrance (reference/photo-merch-wall.jpeg)
    { kind: "merchWall", floor: "ground", position: [X0, 0, 4.35], rotation: HALF_PI },
    { kind: "posterBoard", floor: "ground", position: [X0, 1.6, 4.72], rotation: HALF_PI },
    { kind: "hangingPothos", floor: "ground", position: [X0 + 0.45, 3.0, 4.55], drop: 0.5, seed: 19, length: 0.9, color: "purple", pot: "charcoal" },
    { kind: "climber", floor: "ground", position: [X0 + 0.7, 0, 4.7], seed: 20, height: 1.9 },
    { kind: "branchPlant", floor: "ground", position: [X0 + 0.3, 0, 4.75], seed: 22 },

    // The window desks just inside the shopfront, looking out at the street
    ...[-1.3, -0.05].map((x): Placement => ({ kind: "desk", floor: "ground", position: [x, 0, Z1 - 0.4], rotation: Math.PI, w: 1.24 })),
    ...[-1.35, 0.0].map((x, i): Placement => ({ kind: "officeChair", floor: "ground", position: [x, 0, Z1 - 1.1], rotation: i ? 0.15 : -0.2 })),

    // ─── Mezzanine: the kitchen (reference/photo-kitchen-upstairs.jpeg) ──
    { kind: "kitchenRun", floor: "mezzanine", position: [KITCHEN.x, UP, Z0], w: KITCHEN.w },
    { kind: "kitchenIsland", floor: "mezzanine", position: [KITCHEN.island.x, UP, KITCHEN.island.z] },
    { kind: "metalStool", floor: "mezzanine", position: [KITCHEN.island.x - 0.85, UP, KITCHEN.island.z + 0.1] },
    { kind: "metalStool", floor: "mezzanine", position: [KITCHEN.island.x + 0.85, UP, KITCHEN.island.z - 0.1] },
    ...[-0.3, 0.3].map((dx): Placement => ({ kind: "pendantLamp", floor: "mezzanine", position: [KITCHEN.island.x + dx, H, KITCHEN.island.z], drop: 1.3, style: "dome" })),
    { kind: "frame", floor: "mezzanine", position: [-0.3, UP + 1.45, Z0], w: 0.75, h: 0.55, art: ["orange", 3] },
    { kind: "kilim", floor: "mezzanine", position: [-0.6, UP, -4.15], rotation: HALF_PI, w: 1.6, d: 0.7 },

    // ─── Mezzanine: desks at the railing (reference/photo-mezzanine-desks.jpeg) ──
    ...MEZZ_DESKS.map((x): Placement => ({ kind: "desk", floor: "mezzanine", position: [x, UP, MEZZ.front - 0.45], rotation: Math.PI, w: 1.22 })),
    ...MEZZ_DESKS.map((x, i): Placement => ({ kind: "officeChair", floor: "mezzanine", position: [x + (i % 2 ? 0.1 : -0.1), UP, MEZZ.front - 1.15], rotation: i % 2 ? 0.2 : -0.15 })),
    { kind: "laptop", floor: "mezzanine", position: [-1.3, UP + 0.75, MEZZ.front - 0.5], rotation: Math.PI },
    { kind: "desk", floor: "mezzanine", position: [X1 - 0.35, UP, -2.0], rotation: -HALF_PI, w: 1.2 },
    { kind: "officeChair", floor: "mezzanine", position: [X1 - 1.05, UP, -2.0], rotation: HALF_PI },
    { kind: "palm", floor: "mezzanine", position: [X1 - 0.3, UP + 0.75, -2.4], seed: 64, upright: true, scale: 0.7, pot: "white" },
    { kind: "palm", floor: "mezzanine", position: [0.85, UP, MEZZ.front - 0.35], seed: 62, scale: 1.2 },
    // The "hello" / "world!" globes, hung out over the double-height room
    ...[-1.9, -0.7].map((x): Placement => ({ kind: "pendantLamp", floor: "mezzanine", position: [x, H, MEZZ.front + 0.5], drop: 1.55, style: "globe", label: true })),
    // Pothos baskets hung off the railing, trailing over the deck edge
    { kind: "hangingPothos", floor: "mezzanine", position: [-2.2, UP + 1.0, MEZZ.front + 0.14], drop: 0.75, seed: 71, length: 1.3 },
    { kind: "hangingPothos", floor: "mezzanine", position: [0.6, UP + 1.0, MEZZ.front + 0.14], drop: 0.8, seed: 72, length: 1.0 },
    { kind: "hangingPothos", floor: "mezzanine", position: [2.4, UP + 1.0, MEZZ.front + 0.14], drop: 0.6, seed: 73, length: 1.4 },
  ] satisfies Placement[] as Placement[],
};

export type Layout = typeof layout;
