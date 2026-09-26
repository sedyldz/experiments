import type { Placement } from "./kit";

// Every dimension and every placement in the space, in meters. The floor
// plan follows the owner's description, checked against the photos in
// /reference. The dimensions are still estimates until a real survey
// arrives, and re-measuring should only mean editing this file.
//
// Walking in from the street, the space has three sections:
//   ENTRANCE (front, double height): the door is on the right of the
//     shopfront. Two window tables on the left, three tables in a row on the
//     right wall (the plant shelf above them), the merch shelves on the left
//     wall with the big host table in front, and the meeting pod behind it,
//     under the building's stair.
//   MIDDLE: two standing desks on the left, three tables on the right.
//   BACK (deeper than the middle): the big meeting table, two benches on its
//     front side and four orange chairs on the back.
// The yellow spiral stair and the coffee corner are on the left, between the
// middle and the back.
//
// The upper floor covers the whole back section, and over the middle section
// only a half-width balcony on the right, which overlooks the entrance.
// Coming up the stair you face the back wall. Ahead on the far left is a
// window, the kitchen counter is on the right and the table is in the
// middle. On your left is the 3-seat sofa with the single armchair facing
// it. The toilet with the yellow door sits beside the balcony. The balcony
// work area has 2 desks at the railing under the "hello" / "world!" globes
// and 2 desks along its side. A curtain separates it from the kitchen.
//
// Coordinates: the origin is the center of the ground floor.
//   +X  toward the right wall, -X toward the left wall
//   +Z  toward the shopfront, -Z toward the back wall
//   +Y  up

const W = 6.5; // interior width (X)
const H = 5.4; // floor to ceiling

// Section boundaries along Z (the front is +Z)
const ENTRANCE_DEPTH = 4.2;
const MIDDLE_DEPTH = 3.0;
const BACK_DEPTH = 3.8;
const D = ENTRANCE_DEPTH + MIDDLE_DEPTH + BACK_DEPTH;

const X0 = -W / 2;
const X1 = W / 2;
const Z0 = -D / 2; // back wall
const Z1 = D / 2; // shopfront
const Z_MID = Z1 - ENTRANCE_DEPTH; // entrance | middle
const Z_BACK = Z_MID - MIDDLE_DEPTH; // middle | back

/** The upper floor. */
const MEZZ = {
  front: Z_MID, // the balcony railing, overlooking the entrance
  level: 2.7,
  thickness: 0.3,
};
/** Over the middle section the upper floor only reaches this far left. The toilet sits at its left end. */
const BALCONY_X0 = -1.4;
const UNDER = MEZZ.level - MEZZ.thickness;
const UP = MEZZ.level;

/**
 * The yellow spiral stair, on the left between the middle and back sections
 * (reference/photo-spiral-stair.jpeg). You step on from the room side (+X),
 * and you step off upstairs facing the back wall, into the kitchen.
 */
const STAIR = { x: X0 + 1.1, z: Z_BACK - 0.95, radius: 0.72 };
const HOLE = { x0: X0, x1: STAIR.x + 0.95, z0: STAIR.z - 1.0, z1: STAIR.z + 1.0 };

/** The meeting pod: on the left behind the host table, under the building's stair. */
const POD = { x0: X0, x1: X0 + 1.6, z0: Z_MID - 0.6, z1: Z_MID + 0.7, h: 2.3 };

// The desk row with the plant shelf above it (entrance, right wall)
const ENTRY_ROW = { x: X1 - 0.35, z0: Z_MID + 0.6, w: 1.15 };
const entryDeskZ = (i: number) => ENTRY_ROW.z0 + ENTRY_ROW.w * (i + 0.5);
const SHELF = { y: 2.2, z0: Z_MID + 0.6, z1: Z1 - 0.25 };
const SHELF_X = X1 - 0.14;
const onShelf = (z: number): [number, number, number] => [SHELF_X, SHELF.y + 0.025, z];

// The middle section's desk row (right wall, under the upper level)
const MID_ROW = { x: X1 - 0.35, z0: Z_BACK + 0.1, w: 0.95 };
const midDeskZ = (i: number) => MID_ROW.z0 + MID_ROW.w * (i + 0.5);

/** The toilet: a box at the balcony's left end, with its yellow door facing the kitchen. */
const WC = { x0: BALCONY_X0, x1: 0, z0: Z_BACK, z1: -0.1 };
const RAIL_DESKS = [0.55, 1.8];

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

  sections: { entrance: [Z_MID, Z1], middle: [Z_BACK, Z_MID], back: [Z0, Z_BACK] } as Record<string, [number, number]>,

  mezzanine: {
    level: MEZZ.level,
    thickness: MEZZ.thickness,
    /** The upper floor's footprint as [x0, x1, z0, z1] rectangles. */
    decks: [
      [X0, X1, Z0, Z_BACK], // the whole back section
      [BALCONY_X0, X1, Z_BACK, MEZZ.front], // the balcony over the middle
    ] as [number, number, number, number][],
    /** The opening for the spiral stair. */
    hole: HOLE,
  },

  stair: {
    center: [STAIR.x, STAIR.z] as [number, number],
    radius: STAIR.radius,
    /** Ground-floor entry (in front of tread 0) and upstairs exit (past the top tread). */
    entry: [STAIR.x + STAIR.radius + 0.3, STAIR.z] as [number, number],
    exit: [STAIR.x, HOLE.z0 - 0.3] as [number, number],
  },

  /** The shopfront (reference/photo-shopfront.jpeg). The door is on the right. */
  facade: { door: { x: 2.2, w: 1.1 } },

  placements: [
    // ═══ ENTRANCE (double height) ═══════════════════════════════
    // Left: two tables at the window, facing the street
    ...[-2.6, -1.35].map((x): Placement => ({ kind: "desk", floor: "ground", position: [x, 0, Z1 - 0.4], rotation: Math.PI, w: 1.2 })),
    ...[-2.6, -1.35].map((x, i): Placement => ({ kind: "officeChair", floor: "ground", position: [x, 0, Z1 - 1.1], rotation: i ? 0.15 : -0.2 })),
    { kind: "laptop", floor: "ground", position: [-1.35, 0.75, Z1 - 0.45], rotation: Math.PI },

    // Left wall: the merch shelves (reference/photo-merch-wall.jpeg)
    { kind: "merchWall", floor: "ground", position: [X0, 0, Z1 - 0.8], rotation: HALF_PI },
    { kind: "hangingPothos", floor: "ground", position: [X0 + 0.5, 3.1, Z1 - 0.9], drop: 0.5, seed: 19, length: 0.9, color: "purple", pot: "charcoal" },
    // The big host table in front of the shelves
    { kind: "desk", floor: "ground", position: [-1.85, 0, Z_MID + 2.0], rotation: HALF_PI, w: 1.8, d: 0.85 },
    { kind: "officeChair", floor: "ground", position: [-2.5, 0, Z_MID + 2.0], rotation: HALF_PI },
    { kind: "laptop", floor: "ground", position: [-1.9, 0.75, Z_MID + 2.3], rotation: HALF_PI },

    // The meeting pod, behind the host table, under the building's stair.
    // The mustard pipe marks its corner, and the navy curtain is its door.
    { kind: "partition", floor: "ground", from: [POD.x0, POD.z1], to: [POD.x1, POD.z1], height: POD.h, cutaway: [0, 1] },
    { kind: "partition", floor: "ground", from: [POD.x0, POD.z0], to: [POD.x1, POD.z0], height: POD.h },
    { kind: "curtain", floor: "ground", position: [POD.x1, 0, POD.z1 - 0.05], rotation: HALF_PI, width: POD.z1 - POD.z0 - 0.1, height: POD.h - 0.05, pleat: 0.24 },
    { kind: "slab", floor: "ground", position: [(POD.x0 + POD.x1) / 2, POD.h + 0.2, (POD.z0 + POD.z1) / 2], size: [POD.x1 - POD.x0, 0.12, POD.z1 - POD.z0 + 0.2], tilt: -0.28 },
    { kind: "pipe", floor: "ground", position: [POD.x1 + 0.1, 0, POD.z1 + 0.1], height: H },
    { kind: "wcSign", floor: "ground", position: [(POD.x0 + POD.x1) / 2, 1.9, POD.z1 + 0.05] },
    { kind: "desk", floor: "ground", position: [(POD.x0 + POD.x1) / 2, 0, (POD.z0 + POD.z1) / 2], w: 0.9, d: 0.6 },
    { kind: "officeChair", floor: "ground", position: [POD.x0 + 0.4, 0, POD.z0 + 0.35], rotation: 0 },

    // Right wall: three tables in a row, with the plant shelf above (reference/photo-wall-shelf.jpeg)
    ...[0, 1, 2].map((i): Placement => ({ kind: "desk", floor: "ground", position: [ENTRY_ROW.x, 0, entryDeskZ(i)], rotation: -HALF_PI, w: ENTRY_ROW.w - 0.02, divider: i === 0 })),
    ...[0, 1, 2].map((i): Placement => ({ kind: "officeChair", floor: "ground", position: [ENTRY_ROW.x - 0.7, 0, entryDeskZ(i) + (i % 2 ? 0.1 : -0.1)], rotation: HALF_PI + (i % 2 ? 0.25 : -0.2) })),
    { kind: "laptop", floor: "ground", position: [ENTRY_ROW.x - 0.05, 0.75, entryDeskZ(1)], rotation: -HALF_PI },
    { kind: "wallShelf", floor: "ground", position: [X1, SHELF.y, (SHELF.z0 + SHELF.z1) / 2], rotation: -HALF_PI, length: SHELF.z1 - SHELF.z0 },
    { kind: "palm", floor: "ground", position: onShelf(Z_MID + 0.9), upright: true, seed: 11, scale: 1.35, pot: "charcoal" },
    { kind: "schefflera", floor: "ground", position: onShelf(Z_MID + 1.6), seed: 17, scale: 0.55, pot: "terracotta" },
    { kind: "smallTree", floor: "ground", position: onShelf(Z_MID + 2.15), seed: 12, scale: 0.8, pot: "terracotta" },
    { kind: "books", floor: "ground", position: [SHELF_X - 0.02, SHELF.y + 0.025, Z_MID + 2.55], rotation: -HALF_PI, count: 4, seed: 2 },
    { kind: "shelfTrailer", floor: "ground", position: onShelf(Z_MID + 3.05), seed: 14, length: 0.5, pot: "white" },
    { kind: "shelfTrailer", floor: "ground", position: onShelf(Z_MID + 3.5), seed: 15, length: 1.0, pot: "green" },
    { kind: "hangingPothos", floor: "ground", position: [X1 - 0.3, 3.4, Z1 - 0.45], drop: 0.45, seed: 18, length: 1.7 },
    // The mirror on the right wall, with the rubber plant in front of it
    { kind: "mirror", floor: "ground", position: [X1, 0, Z_MID + 0.25], rotation: -HALF_PI, w: 0.5 },
    { kind: "rubberPlant", floor: "ground", position: [X1 - 0.45, 0, Z_MID + 0.2], seed: 81, scale: 0.9 },

    // The middle of the entrance: the big monstera and a schefflera
    { kind: "monstera", floor: "ground", position: [0.2, 0, Z_MID + 2.4], seed: 41, pot: "white" },
    { kind: "schefflera", floor: "ground", position: [0.9, 0, Z1 - 0.5], seed: 42, pot: "charcoal", scale: 1.05 },
    { kind: "linearLamp", floor: "ground", position: [0.3, H, Z_MID + 2.1], rotation: HALF_PI, length: 2.8, drop: 1.0 },

    // ═══ MIDDLE (under the upper level) ═════════════════════════
    // Left: two standing desks
    ...[0.05, -0.85].map((z): Placement => ({ kind: "highTable", floor: "ground", position: [-1.3, 0, z], w: 1.2, d: 0.62, shelf: false })),
    { kind: "laptop", floor: "ground", position: [-1.55, 1.05, 0.05] },
    { kind: "smallTree", floor: "ground", position: [-0.85, 1.05, -0.85], seed: 31, scale: 0.8 },
    // Right: three tables in a row
    ...[0, 1, 2].map((i): Placement => ({ kind: "desk", floor: "ground", position: [MID_ROW.x, 0, midDeskZ(i)], rotation: -HALF_PI, w: MID_ROW.w - 0.02 })),
    ...[0, 1, 2].map((i): Placement => ({ kind: "officeChair", floor: "ground", position: [MID_ROW.x - 0.7, 0, midDeskZ(i)], rotation: HALF_PI + (i % 2 ? 0.2 : -0.15) })),
    { kind: "laptop", floor: "ground", position: [MID_ROW.x - 0.05, 0.75, midDeskZ(0)], rotation: -HALF_PI },

    // ═══ LEFT, BETWEEN MIDDLE AND BACK: the stair + coffee corner ══
    // Along the left wall from front to back: the coffee counter, the stair, then the duct
    { kind: "fuseBox", floor: "ground", position: [X0, 1.75, Z_BACK + 0.35], rotation: HALF_PI, wall: [-1, 0] },
    { kind: "coffeeStation", floor: "ground", position: [X0 + 0.35, 0, Z_BACK + 0.35], rotation: HALF_PI },
    { kind: "wallPanel", floor: "ground", position: [X0, 0, STAIR.z - 0.35], rotation: HALF_PI, w: 2.1, h: UNDER, wall: [-1, 0] },
    { kind: "wallWindow", floor: "ground", position: [X0, 1.55, STAIR.z], rotation: HALF_PI, wall: [-1, 0] },
    { kind: "spiralStair", floor: "ground", position: [STAIR.x, 0, STAIR.z], rise: MEZZ.level, radius: STAIR.radius, sweep: -Math.PI * 1.5, endAngle: HALF_PI },
    { kind: "pipe", floor: "ground", position: [X0 + 0.25, 0, STAIR.z - 1.05], height: H, r: 0.16, ribs: 0.32 },
    { kind: "floorPlate", floor: "ground", position: [X0 + 0.4, 0, STAIR.z - 1.05], w: 0.6, d: 0.6 },
    { kind: "fireExtinguisher", floor: "ground", position: [X0 + 0.15, 0, STAIR.z - 1.45] },
    { kind: "trashBin", floor: "ground", position: [X0 + 0.3, 0, Z_BACK + 1.1] },

    // ═══ BACK (the meeting room) ════════════════════════════════
    { kind: "diningTable", floor: "ground", position: [0.9, 0, -3.3], w: 2.4, d: 1.0 },
    ...[0.3, 1.5].map((x): Placement => ({ kind: "bench", floor: "ground", position: [x, 0, -2.5], w: 1.1 })),
    ...[-0.0, 0.6, 1.2, 1.8].map((x): Placement => ({ kind: "diningChair", floor: "ground", position: [x, 0, -4.05] })),
    ...[0.4, 1.4].map((x): Placement => ({ kind: "pendantLamp", floor: "ground", position: [x, UNDER, -3.3], drop: 0.7, style: "dome" })),
    { kind: "frame", floor: "ground", position: [0.3, 1.5, Z0], w: 0.45, h: 0.55, art: ["terracotta", 2] },
    { kind: "frame", floor: "ground", position: [0.9, 1.6, Z0], w: 0.4, h: 0.5, art: ["wallBlue", 1] },
    { kind: "frame", floor: "ground", position: [1.5, 1.45, Z0], w: 0.42, h: 0.34, art: ["mustard", 3] },
    { kind: "logoSign", floor: "ground", position: [2.5, 1.8, Z0] },
    // The yellow table and bench (reference/photo-mirror.jpeg) along the right wall
    { kind: "highTable", floor: "ground", position: [X1 - 0.4, 0, -4.5], rotation: -HALF_PI, w: 1.3, d: 0.7, h: 0.75, shelf: false, frame: "mustard" },
    { kind: "highTable", floor: "ground", position: [X1 - 1.05, 0, -4.5], rotation: -HALF_PI, w: 1.2, d: 0.36, h: 0.45, shelf: false, frame: "mustard" },
    ...[-0.5, -1.0].map((x): Placement => ({ kind: "wallPanel", floor: "ground", position: [x, 1.3, Z0], w: 0.44, h: 0.44, color: "white", shade: 1, wall: [0, -1] })),

    // ═══ UPPER FLOOR ═══════════════════════════════════════════
    // Railings: along the balcony's front and its open left edge, and along
    // the back section's edge where it overlooks the middle section's left half
    { kind: "railing", floor: "mezzanine", from: BALCONY_X0, to: X1, z: MEZZ.front - 0.04, y: UP },
    { kind: "railing", floor: "mezzanine", axis: "z", from: WC.z1, to: MEZZ.front, x: BALCONY_X0 + 0.04, y: UP },
    { kind: "railing", floor: "mezzanine", from: X0, to: BALCONY_X0, z: Z_BACK + 0.04, y: UP },

    // ── The kitchen side (the back section), where the stair comes up ──
    // Ahead on the far left: a window on the back wall
    { kind: "wallWindow", floor: "mezzanine", position: [X0 + 0.75, UP + 1.5, Z0], w: 0.9, h: 1.1, wall: [0, -1] },
    // On the left: the 3-seat sofa against the left wall, and the armchair facing it
    { kind: "sofa", floor: "mezzanine", position: [X0 + 0.45, UP, -4.55], rotation: HALF_PI },
    { kind: "kilim", floor: "mezzanine", position: [-2.0, UP, -4.55], rotation: HALF_PI, w: 1.5, d: 0.7 },
    { kind: "armChair", floor: "mezzanine", position: [-1.2, UP, -4.55], rotation: -HALF_PI },
    // On the right: the kitchen counter along the right wall, with the fridge at its front end
    { kind: "kitchenRun", floor: "mezzanine", position: [X1, UP, -4.2], rotation: -HALF_PI, w: 2.2, fridge: true },
    // In the middle: the table
    { kind: "kitchenIsland", floor: "mezzanine", position: [0.5, UP, -3.8], w: 1.3, d: 0.7 },
    { kind: "metalStool", floor: "mezzanine", position: [-0.3, UP, -3.7] },
    { kind: "metalStool", floor: "mezzanine", position: [1.3, UP, -3.9] },
    ...[0.2, 0.8].map((x): Placement => ({ kind: "pendantLamp", floor: "mezzanine", position: [x, H, -3.8], drop: 1.3, style: "dome" })),
    { kind: "frame", floor: "mezzanine", position: [0.5, UP + 1.5, Z0], w: 0.75, h: 0.55, art: ["orange", 3] },
    { kind: "shelvingUnit", floor: "mezzanine", position: [X1 - 0.22, UP, -2.15], rotation: -HALF_PI, w: 0.7, d: 0.35, h: 1.6, wood: true },

    // ── The toilet, with its yellow door facing the kitchen ──
    { kind: "partition", floor: "mezzanine", from: [WC.x0, WC.z0], to: [WC.x1, WC.z0], y: UP, door: { at: 0.7, w: 0.7, color: "mustard" } },
    { kind: "partition", floor: "mezzanine", from: [WC.x0, WC.z0], to: [WC.x0, WC.z1], y: UP },
    { kind: "partition", floor: "mezzanine", from: [WC.x0, WC.z1], to: [WC.x1, WC.z1], y: UP, cutaway: [0, 1] },
    { kind: "partition", floor: "mezzanine", from: [WC.x1, WC.z0], to: [WC.x1, WC.z1], y: UP },
    { kind: "toilet", floor: "mezzanine", position: [(WC.x0 + WC.x1) / 2, UP, WC.z1 - 0.05], rotation: Math.PI },

    // ── The curtain between the kitchen and the work area, drawn half open ──
    { kind: "curtain", floor: "mezzanine", position: [WC.x1, UP, Z_BACK], width: 1.3, height: H - UP - 0.1, pleat: 0.22 },

    // ── The work area on the balcony ──
    // Ahead, at the railing: 2 desks under the "hello" / "world!" globes
    ...RAIL_DESKS.map((x): Placement => ({ kind: "desk", floor: "mezzanine", position: [x, UP, MEZZ.front - 0.45], rotation: Math.PI, w: 1.2 })),
    ...RAIL_DESKS.map((x, i): Placement => ({ kind: "officeChair", floor: "mezzanine", position: [x + (i ? 0.1 : -0.1), UP, MEZZ.front - 1.15], rotation: i ? 0.2 : -0.15 })),
    ...RAIL_DESKS.map((x): Placement => ({ kind: "pendantLamp", floor: "mezzanine", position: [x, H, MEZZ.front + 0.5], drop: 1.55, style: "globe", label: true })),
    // On its side (the right wall): 2 more desks
    ...[-1.15, -0.05].map((z): Placement => ({ kind: "desk", floor: "mezzanine", position: [X1 - 0.35, UP, z], rotation: -HALF_PI, w: 1.05 })),
    ...[-1.15, -0.05].map((z): Placement => ({ kind: "officeChair", floor: "mezzanine", position: [X1 - 1.05, UP, z - 0.1], rotation: HALF_PI })),
    { kind: "laptop", floor: "mezzanine", position: [RAIL_DESKS[1], UP + 0.75, MEZZ.front - 0.5], rotation: Math.PI },
    { kind: "palm", floor: "mezzanine", position: [X1 - 0.3, UP + 0.75, -1.5], seed: 65, upright: true, scale: 0.6, pot: "white" },
    { kind: "palm", floor: "mezzanine", position: [BALCONY_X0 + 0.35, UP, MEZZ.front - 0.35], seed: 62, scale: 1.0 },
    // Pothos baskets hung off the balcony railing
    { kind: "hangingPothos", floor: "mezzanine", position: [-0.3, UP + 1.0, MEZZ.front + 0.14], drop: 0.8, seed: 72, length: 1.0 },
    { kind: "hangingPothos", floor: "mezzanine", position: [2.7, UP + 1.0, MEZZ.front + 0.14], drop: 0.6, seed: 73, length: 1.4 },
  ] satisfies Placement[] as Placement[],
};

export type Layout = typeof layout;
