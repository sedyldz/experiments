// Every dimension of the space, in meters. These are placeholders until a
// real floor plan arrives, and re-measuring the space should only mean
// editing this file.
//
// Coordinates: the origin is the center of the ground floor, +X runs to the
// right wall (the desk row), +Z runs toward the viewer at the default
// rotation, and +Y is up.

export const layout = {
  room: {
    /** Interior width along X. */
    width: 14,
    /** Interior depth along Z. */
    depth: 10,
    /** Floor-to-ceiling height (double height, because of the mezzanine). */
    height: 5.4,
    wallThickness: 0.2,
    floorThickness: 0.2,
    /** How much of a cutaway (camera-facing) wall is still drawn. */
    cutawayStubHeight: 0.25,
  },
} as const;

export type Layout = typeof layout;
