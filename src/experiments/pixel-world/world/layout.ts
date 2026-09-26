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
// The upper floor spans the middle and back sections at full width
// (reference/photo-entrance-view.jpeg). From the entrance you see its front
// as a white wall with one half-width opening, the balcony, where two desks
// sit at the railing under the "hello" / "world!" globes. Behind the
// balcony is the work area, with 2 more desks along the right wall. The
// spiral stair comes up facing the back wall into the kitchen / lounge:
//   - a small window high on the back wall, far left, with the AC beside it
//   - the 3-seat sofa on the left wall, with the cane armchair against the
//     back wall facing out and the kilim in front
//     (reference/photo-upstairs-lounge.jpeg)
//   - the counter and fridge on the right wall, the table in the middle, and
//     the fish poster on the back wall
// The toilet, with its yellow door, sits beside the work area. A navy
// curtain separates the work area from the kitchen
// (reference/photo-upstairs-curtain.png).
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
/** The balcony: the half-width opening in the upper floor's front wall, and the work room behind it. */
const BALCONY = { x0: 0, x1: X1, open0: 0.15, open1: 2.9 };
const UNDER = MEZZ.level - MEZZ.thickness;
const UP = MEZZ.level;

/**
 * The yellow spiral stair, on the left between the middle and back sections
 * (reference/photo-spiral-stair.jpeg). You step on from the room side (+X),
 * and you step off upstairs facing the back wall, into the kitchen.
 */
const STAIR = { x: X0 + 1.1, z: Z_BACK - 0.95, radius: 0.72 };
const HOLE = { x0: X0, x1: STAIR.x + 0.95, z0: STAIR.z - 1.0, z1: STAIR.z + 1.0 };

/**
 * The meeting pod: a small room on the left under the upper floor's front
 * edge (under the building's stair), behind the host table. The navy curtain
 * across its front, with the mustard pipe beside it, is what you see from
 * the entrance. Inside: the yellow table and bench, felt panels and framed
 * pictures (seen in reference/photo-mirror.jpeg).
 */
const POD = { x0: X0, x1: X0 + 1.3, z0: Z_MID - 1.9, z1: Z_MID, h: 2.3 };

// The desk row with the plant shelf above it (entrance, right wall)
const ENTRY_ROW = { x: X1 - 0.35, z0: Z_MID + 0.6, w: 1.15 };
const entryDeskZ = (i: number) => ENTRY_ROW.z0 + ENTRY_ROW.w * (i + 0.5);
const SHELF = { y: 2.2, z0: Z_MID + 0.6, z1: Z1 - 0.25 };
const SHELF_X = X1 - 0.14;
const onShelf = (z: number): [number, number, number] => [SHELF_X, SHELF.y + 0.025, z];

// The middle section's desk row (right wall, under the upper level)
const MID_ROW = { x: X1 - 0.35, z0: Z_BACK + 0.1, w: 0.95 };
const midDeskZ = (i: number) => MID_ROW.z0 + MID_ROW.w * (i + 0.5);

/** The toilet: a box beside the work room, with its yellow door facing the kitchen. */
const WC = { x0: -1.3, x1: 0, z0: Z_BACK, z1: Z_BACK + 1.4 };
const RAIL_DESKS = [0.85, 2.05];

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
    decks: [[X0, X1, Z0, MEZZ.front]] as [number, number, number, number][],
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
    // ═══ OUTSIDE (reference/photo-sidewalk.jpeg) ════════════════
    // A strip of pavement, the wooden bench on blue legs under the window, and the blue A-frame sign
    { kind: "sidewalk", floor: "ground", position: [0, 0, Z1 + 0.2 + 0.8], w: W + 0.4, d: 1.6 },
    { kind: "highTable", floor: "ground", position: [-1.7, 0, Z1 + 0.5], w: 1.7, d: 0.38, h: 0.46, shelf: false },
    { kind: "aFrameSign", floor: "ground", position: [0.9, 0, Z1 + 1.25], rotation: 0.35 },

    // ═══ ENTRANCE (double height) ═══════════════════════════════
    // Left: two tables at the window, facing the street
    ...[-2.6, -1.35].map((x): Placement => ({ kind: "desk", floor: "ground", position: [x, 0, Z1 - 0.4], rotation: Math.PI, w: 1.2 })),
    ...[-2.6, -1.35].map((x, i): Placement => ({ kind: "officeChair", floor: "ground", position: [x, 0, Z1 - 1.1], rotation: i ? 0.15 : -0.2 })),
    { kind: "laptop", floor: "ground", position: [-1.35, 0.75, Z1 - 0.45], rotation: Math.PI },

    // Left wall: the merch shelves (reference/photo-merch-wall.jpeg)
    { kind: "merchWall", floor: "ground", position: [X0, 0, Z1 - 0.95], rotation: HALF_PI },
    // Beside it toward the window: the vintage poster board, a climbing monstera and a cane begonia
    { kind: "posterBoard", floor: "ground", position: [X0, 1.75, Z1 - 0.5], rotation: HALF_PI },
    { kind: "climber", floor: "ground", position: [-0.45, 0, Z1 - 0.4], seed: 20, height: 1.9 },
    { kind: "branchPlant", floor: "ground", position: [0.15, 0, Z1 - 0.35], seed: 22 },
    { kind: "hangingPothos", floor: "ground", position: [X0 + 0.5, 3.1, Z1 - 0.9], drop: 0.5, seed: 19, length: 0.9, color: "purple", pot: "charcoal" },
    // The big host table in front of the shelves
    { kind: "desk", floor: "ground", position: [-1.85, 0, Z_MID + 2.0], rotation: HALF_PI, w: 1.8, d: 0.85 },
    { kind: "officeChair", floor: "ground", position: [-2.5, 0, Z_MID + 2.0], rotation: HALF_PI },
    { kind: "laptop", floor: "ground", position: [-1.9, 0.75, Z_MID + 2.3], rotation: HALF_PI },

    // The meeting pod, behind the host table
    { kind: "partition", floor: "ground", from: [POD.x0, POD.z0], to: [POD.x1, POD.z0], height: POD.h },
    { kind: "partition", floor: "ground", from: [POD.x1, POD.z0], to: [POD.x1, POD.z1 - 0.05], height: POD.h },
    { kind: "curtain", floor: "ground", position: [POD.x0 + 0.25, 0, POD.z1], width: POD.x1 - POD.x0 - 0.2, height: POD.h - 0.05, pleat: 0.24 },
    { kind: "pipe", floor: "ground", position: [POD.x0 + 0.12, 0, POD.z1 + 0.12], height: H },
    { kind: "slab", floor: "ground", position: [(POD.x0 + POD.x1) / 2, POD.h + 0.15, (POD.z0 + POD.z1) / 2], size: [POD.x1 - POD.x0, 0.12, POD.z1 - POD.z0], tilt: 0.12 },
    { kind: "highTable", floor: "ground", position: [(POD.x0 + POD.x1) / 2, 0, POD.z0 + 0.5], w: 1.0, d: 0.55, h: 0.75, shelf: false, frame: "mustard" },
    { kind: "highTable", floor: "ground", position: [(POD.x0 + POD.x1) / 2, 0, POD.z0 + 1.1], w: 1.0, d: 0.32, h: 0.45, shelf: false, frame: "mustard" },
    ...[-0.35, 0.2].map((dx): Placement => ({ kind: "wallPanel", floor: "ground", position: [(POD.x0 + POD.x1) / 2 + dx, 1.25, POD.z0 + 0.06], w: 0.44, h: 0.44, color: "white", shade: 1 })),
    { kind: "frame", floor: "ground", position: [POD.x1 - 0.06, 1.5, POD.z0 + 0.8], rotation: -HALF_PI, w: 0.4, h: 0.5, art: ["terracotta", 2] },
    { kind: "frame", floor: "ground", position: [POD.x1 - 0.06, 1.55, POD.z0 + 1.35], rotation: -HALF_PI, w: 0.35, h: 0.45, art: ["wallBlue", 1] },
    { kind: "logoSign", floor: "ground", position: [POD.x1 + 0.06, 1.95, POD.z0 + 0.9], rotation: HALF_PI },

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
    { kind: "monstera", floor: "ground", position: [-0.8, 0, Z_MID + 2.6], seed: 41, pot: "white" },
    { kind: "schefflera", floor: "ground", position: [0.9, 0, Z1 - 0.5], seed: 42, pot: "charcoal", scale: 1.05 },
    { kind: "linearLamp", floor: "ground", position: [0.3, H, Z_MID + 2.1], rotation: HALF_PI, length: 2.8, drop: 1.0 },

    // ═══ MIDDLE (under the upper level) ═════════════════════════
    // Left: two standing desks end to end beside the pod, with blue stools
    ...[Z_MID - 0.6, Z_MID - 1.8].map((z): Placement => ({ kind: "highTable", floor: "ground", position: [-1.35, 0, z], rotation: HALF_PI, w: 1.2, d: 0.62, shelf: false })),
    ...[Z_MID - 0.3, Z_MID - 0.9, Z_MID - 1.5, Z_MID - 2.1].map((z): Placement => ({ kind: "stool", floor: "ground", position: [-0.75, 0, z] })),
    { kind: "laptop", floor: "ground", position: [-1.35, 1.05, Z_MID - 0.5], rotation: HALF_PI },
    { kind: "smallTree", floor: "ground", position: [-1.4, 1.05, Z_MID - 2.2], seed: 31, scale: 0.7 },
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
    { kind: "trashBin", floor: "ground", position: [X0 + 0.95, 0, Z_BACK + 0.2] },
    // The navy curtain on the right, between the middle section and the meeting room
    { kind: "curtain", floor: "ground", position: [1.4, 0, Z_BACK], width: 1.2, height: UNDER - 0.05, pleat: 0.24 },

    // ═══ BACK (the meeting room) ════════════════════════════════
    { kind: "diningTable", floor: "ground", position: [0.9, 0, -3.3], w: 2.4, d: 1.0 },
    ...[0.3, 1.5].map((x): Placement => ({ kind: "bench", floor: "ground", position: [x, 0, -2.5], w: 1.1 })),
    ...[-0.0, 0.6, 1.2, 1.8].map((x): Placement => ({ kind: "diningChair", floor: "ground", position: [x, 0, -4.05] })),
    ...[0.4, 1.4].map((x): Placement => ({ kind: "pendantLamp", floor: "ground", position: [x, UNDER, -3.3], drop: 0.7, style: "dome" })),
    { kind: "frame", floor: "ground", position: [0.3, 1.5, Z0], w: 0.45, h: 0.55, art: ["terracotta", 2] },
    { kind: "frame", floor: "ground", position: [0.9, 1.6, Z0], w: 0.4, h: 0.5, art: ["wallBlue", 1] },
    { kind: "frame", floor: "ground", position: [1.5, 1.45, Z0], w: 0.42, h: 0.34, art: ["mustard", 3] },

    // ═══ UPPER FLOOR ═══════════════════════════════════════════
    // The front wall facing the entrance, with the balcony opening and its railing
    { kind: "partition", floor: "mezzanine", from: [X0, MEZZ.front], to: [X1, MEZZ.front], y: UP, height: H - UP, door: { at: (BALCONY.open0 + BALCONY.open1) / 2 - X0, w: BALCONY.open1 - BALCONY.open0, open: true, h: 2.2 } },
    { kind: "railing", floor: "mezzanine", from: BALCONY.open0, to: BALCONY.open1, z: MEZZ.front - 0.1, y: UP },
    // The work room's left wall (the toilet is on its other side)
    { kind: "partition", floor: "mezzanine", from: [BALCONY.x0, WC.z0], to: [BALCONY.x0, MEZZ.front], y: UP, height: H - UP, cutaway: [-1, 0] },

    // ── The kitchen side (the back section), where the stair comes up ──
    // Ahead on the far left: a small window high on the back wall, with the AC beside it
    { kind: "wallWindow", floor: "mezzanine", position: [X0 + 0.95, UP + 1.6, Z0], w: 0.6, h: 0.6, wall: [0, -1] },
    { kind: "airCon", floor: "mezzanine", position: [-1.3, UP + 2.2, Z0] },
    // On the left: the 3-seat sofa against the left wall. The cane armchair
    // stands against the back wall facing out, with the kilim in front of it.
    { kind: "sofa", floor: "mezzanine", position: [X0 + 0.42, UP, -4.6], rotation: HALF_PI },
    { kind: "armChair", floor: "mezzanine", position: [-1.5, UP, Z0 + 0.4], rotation: -0.35 },
    { kind: "kilim", floor: "mezzanine", position: [-1.6, UP, -4.35], rotation: HALF_PI, w: 1.4, d: 0.65 },
    // On the right: the kitchen counter along the right wall, with the fridge at its front end
    { kind: "kitchenRun", floor: "mezzanine", position: [X1, UP, -4.2], rotation: -HALF_PI, w: 2.2, fridge: true },
    // In the middle: the table
    // The table runs parallel to the counter, with its stools on the room side
    { kind: "kitchenIsland", floor: "mezzanine", position: [1.55, UP, -4.2], rotation: HALF_PI, w: 1.3, d: 0.7 },
    { kind: "metalStool", floor: "mezzanine", position: [0.85, UP, -4.5] },
    { kind: "metalStool", floor: "mezzanine", position: [0.85, UP, -3.85] },
    ...[-4.5, -3.9].map((z): Placement => ({ kind: "pendantLamp", floor: "mezzanine", position: [1.55, H, z], drop: 1.3, style: "dome" })),
    { kind: "frame", floor: "mezzanine", position: [1.2, UP + 1.5, Z0], w: 0.75, h: 0.55, art: ["orange", 3] },
    { kind: "shelvingUnit", floor: "mezzanine", position: [X1 - 0.22, UP, -2.15], rotation: -HALF_PI, w: 0.7, d: 0.35, h: 1.6, wood: true },

    // ── The toilet, with its yellow door facing the kitchen ──
    { kind: "partition", floor: "mezzanine", from: [WC.x0, WC.z0], to: [WC.x1, WC.z0], y: UP, door: { at: 0.65, w: 0.7, color: "mustard" } },
    { kind: "partition", floor: "mezzanine", from: [WC.x0, WC.z0], to: [WC.x0, WC.z1], y: UP, cutaway: [-1, 0] },
    { kind: "partition", floor: "mezzanine", from: [WC.x0, WC.z1], to: [WC.x1, WC.z1], y: UP, cutaway: [0, 1] },
    { kind: "toilet", floor: "mezzanine", position: [(WC.x0 + WC.x1) / 2, UP, WC.z1 - 0.05], rotation: Math.PI },

    // ── The curtain between the kitchen and the work area, drawn half open ──
    { kind: "curtain", floor: "mezzanine", position: [WC.x1, UP, Z_BACK], width: 1.3, height: H - UP - 0.1, pleat: 0.22 },

    // ── The work area on the balcony ──
    // Ahead, at the railing: 2 desks under the "hello" / "world!" globes
    ...RAIL_DESKS.map((x): Placement => ({ kind: "desk", floor: "mezzanine", position: [x, UP, MEZZ.front - 0.45], rotation: Math.PI, w: 1.2 })),
    ...RAIL_DESKS.map((x, i): Placement => ({ kind: "officeChair", floor: "mezzanine", position: [x + (i ? 0.1 : -0.1), UP, MEZZ.front - 1.15], rotation: i ? 0.2 : -0.15 })),
    ...RAIL_DESKS.map((x): Placement => ({ kind: "pendantLamp", floor: "mezzanine", position: [x, H, MEZZ.front + 0.5], drop: 1.55, style: "globe", label: true })),
    // On its side (the right wall): 2 more desks
    ...[-1.35, -0.3].map((z): Placement => ({ kind: "desk", floor: "mezzanine", position: [X1 - 0.35, UP, z], rotation: -HALF_PI, w: 1.05 })),
    ...[-1.35, -0.3].map((z): Placement => ({ kind: "officeChair", floor: "mezzanine", position: [X1 - 1.05, UP, z - 0.1], rotation: HALF_PI })),
    { kind: "laptop", floor: "mezzanine", position: [RAIL_DESKS[1], UP + 0.75, MEZZ.front - 0.5], rotation: Math.PI },
    { kind: "palm", floor: "mezzanine", position: [X1 - 0.3, UP + 0.75, -1.6], seed: 65, upright: true, scale: 0.6, pot: "white" },
    { kind: "palm", floor: "mezzanine", position: [X1 - 0.3, UP, MEZZ.front - 0.35], seed: 62, scale: 1.0, pot: "terracotta" },
    // Another cane armchair on a jute rug, just past the curtain
    { kind: "rug", floor: "mezzanine", position: [0.8, UP, Z_BACK + 0.6], w: 1.2, d: 0.9 },
    { kind: "armChair", floor: "mezzanine", position: [0.75, UP, Z_BACK + 0.6], rotation: 2.4 },
    // Pothos baskets hung off the balcony railing
    { kind: "hangingPothos", floor: "mezzanine", position: [0.4, UP + 1.0, MEZZ.front + 0.1], drop: 0.8, seed: 72, length: 1.1 },
  ] satisfies Placement[] as Placement[],
};

export type Layout = typeof layout;
