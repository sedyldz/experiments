import * as THREE from "three";
import { layout } from "../world/layout";
import type { FloorId } from "../ui/viewStore";

// The walkable grid: 0.5 m cells per floor, derived from the actual scene
// geometry. Every placed kit piece blocks the cells its meshes cover at body
// height. Seats are cells you may path *into* (as a goal) even though the
// chair blocks them. The two floors are linked by the spiral stair.

export const CELL = 0.5;

/** Kinds that never block: flat on the floor, on the walls, or overhead. */
const NON_BLOCKING = new Set([
  "rug",
  "kilim",
  "floorPlate",
  "wallPanel",
  "wallWindow",
  "fuseBox",
  "frame",
  "logoSign",
  "wcSign",
  "airCon",
  "pendantLamp",
  "linearLamp",
  "hangingPothos",
  "curtain",
  "sidewalk",
  "slab",
  "wallShelf",
  "posterBoard",
]);

/** Plants: only the pot blocks; the canopy is something you brush past. */
const PLANTS = new Set(["monstera", "schefflera", "smallTree", "palm", "trailing", "rubberPlant", "climber", "branchPlant", "eucalyptus", "shelfTrailer"]);
const POT_HEIGHT = 0.6;
/** Anything that starts this high above the floor is overhead or on a wall. */
const OVERHEAD = 1.1;

/** Body height band, above the floor, that counts as an obstacle. */
const BODY = { min: 0.12, max: 1.7 };
/** A mesh blocks a cell if it overlaps the cell's inner square (center ± this). */
const INNER = 0.14;

export interface Cell {
  floor: FloorId;
  ix: number;
  iz: number;
}

export interface FloorGrid {
  floor: FloorId;
  /** World y of the walking surface. */
  y: number;
  x0: number;
  z0: number;
  nx: number;
  nz: number;
  /** 1 = walkable, 0 = blocked or off the floor. */
  walkable: Uint8Array;
}

export interface WalkGrid {
  floors: Record<FloorId, FloorGrid>;
  /** The stair connector: the ground cell at its foot and the upstairs cell at its top. */
  stair: { ground: Cell; mezzanine: Cell };
}

export const cellCenter = (g: FloorGrid, ix: number, iz: number): [number, number] => [
  g.x0 + (ix + 0.5) * CELL,
  g.z0 + (iz + 0.5) * CELL,
];

export function cellAt(g: FloorGrid, x: number, z: number): [number, number] {
  return [Math.floor((x - g.x0) / CELL), Math.floor((z - g.z0) / CELL)];
}

export const inBounds = (g: FloorGrid, ix: number, iz: number) => ix >= 0 && iz >= 0 && ix < g.nx && iz < g.nz;

export function isWalkable(g: FloorGrid, ix: number, iz: number) {
  return inBounds(g, ix, iz) && g.walkable[iz * g.nx + ix] === 1;
}

function emptyFloor(floor: FloorId, y: number): FloorGrid {
  const { width, depth } = layout.room;
  const nx = Math.round(width / CELL);
  // Both floors reach out over the sidewalk; upstairs those cells simply stay off
  const nz = Math.round((depth + layout.outside) / CELL);
  return { floor, y, x0: -width / 2, z0: -depth / 2, nx, nz, walkable: new Uint8Array(nx * nz) };
}

const _box = new THREE.Box3();

/**
 * Builds the grid from the scene: the floor footprints from layout.ts, minus
 * every cell covered by a placed kit piece's meshes at body height.
 */
export function buildWalkGrid(scene: THREE.Object3D): WalkGrid {
  const mz = layout.mezzanine;
  const floors: Record<FloorId, FloorGrid> = {
    ground: emptyFloor("ground", 0),
    mezzanine: emptyFloor("mezzanine", mz.level),
  };

  // Footprints: the whole ground floor, and the upper decks minus the stair opening
  // Ground: the room plus the sidewalk, with the shopfront a wall except at the door
  const ground = floors.ground;
  ground.walkable.fill(1);
  const front = layout.room.depth / 2;
  const { door } = layout.facade;
  for (let ix = 0; ix < ground.nx; ix++) {
    const [x] = cellCenter(ground, ix, 0);
    if (Math.abs(x - door.x) < door.w / 2) continue;
    const [, iz] = cellAt(ground, x, front + 0.01);
    ground.walkable[iz * ground.nx + ix] = 0;
  }
  const up = floors.mezzanine;
  const { hole } = mz;
  for (let iz = 0; iz < up.nz; iz++) {
    for (let ix = 0; ix < up.nx; ix++) {
      const [x, z] = cellCenter(up, ix, iz);
      const onDeck = mz.decks.some(([x0, x1, z0, z1]) => x > x0 && x < x1 && z > z0 && z < z1);
      const inHole = x > hole.x0 && x < hole.x1 && z > hole.z0 && z < hole.z1;
      up.walkable[iz * up.nx + ix] = onDeck && !inHole ? 1 : 0;
    }
  }

  // Obstacles
  scene.updateMatrixWorld(true);
  scene.traverse((obj) => {
    const tag = obj.userData.placement as { kind: string; floor: FloorId } | undefined;
    if (!tag || NON_BLOCKING.has(tag.kind)) return;
    const g = floors[tag.floor];
    obj.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh || child.userData.pixel?.skipNormal) return;
      _box.setFromObject(mesh);
      if (_box.min.y - g.y > Math.min(BODY.max, OVERHEAD) || _box.max.y - g.y < BODY.min) return;
      if (PLANTS.has(tag.kind) && _box.max.y - g.y > POT_HEIGHT) return;
      const [ix0, iz0] = cellAt(g, _box.min.x, _box.min.z);
      const [ix1, iz1] = cellAt(g, _box.max.x, _box.max.z);
      for (let iz = Math.max(0, iz0); iz <= Math.min(g.nz - 1, iz1); iz++) {
        for (let ix = Math.max(0, ix0); ix <= Math.min(g.nx - 1, ix1); ix++) {
          const [cx, cz] = cellCenter(g, ix, iz);
          if (_box.max.x < cx - INNER || _box.min.x > cx + INNER || _box.max.z < cz - INNER || _box.min.z > cz + INNER) continue;
          g.walkable[iz * g.nx + ix] = 0;
        }
      }
    });
  });

  const [ex, ez] = layout.stair.entry;
  const [ux, uz] = layout.stair.exit;
  const [gix, giz] = cellAt(floors.ground, ex, ez);
  const [mix, miz] = cellAt(floors.mezzanine, ux, uz);
  // The stair's own ends are always open
  floors.ground.walkable[giz * floors.ground.nx + gix] = 1;
  floors.mezzanine.walkable[miz * floors.mezzanine.nx + mix] = 1;

  return {
    floors,
    stair: {
      ground: { floor: "ground", ix: gix, iz: giz },
      mezzanine: { floor: "mezzanine", ix: mix, iz: miz },
    },
  };
}
