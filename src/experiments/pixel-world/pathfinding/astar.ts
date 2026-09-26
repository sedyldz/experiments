import type { FloorId } from "../ui/viewStore";
import { isWalkable, type Cell, type WalkGrid } from "./grid";

// A* across both floors. Nodes are (floor, ix, iz). Moves go to the 8
// neighbours, with diagonals only when both orthogonal cells are free so
// corners aren't cut. The stair adds one extra edge between its foot and its
// top.

/** One step of a path: a cell, or `stair` when the step climbs or descends the spiral. */
export type PathStep = Cell & { stair?: boolean };

const STAIR_COST = 8;
const FLOORS: FloorId[] = ["ground", "mezzanine"];

const key = (f: FloorId, ix: number, iz: number, nx: number) => (f === "ground" ? 0 : 1) * 100000 + iz * nx + ix;

export function findPath(grid: WalkGrid, from: Cell, to: Cell, opts: { allowGoalBlocked?: boolean } = {}): PathStep[] | null {
  const nx = Math.max(grid.floors.ground.nx, grid.floors.mezzanine.nx);
  const goalKey = key(to.floor, to.ix, to.iz, nx);
  const startKey = key(from.floor, from.ix, from.iz, nx);
  const { stair } = grid;

  const h = (c: Cell) => {
    const d = Math.hypot(c.ix - to.ix, c.iz - to.iz);
    if (c.floor === to.floor) return d;
    // Must go through the stair
    const s = c.floor === "ground" ? stair.ground : stair.mezzanine;
    const t = c.floor === "ground" ? stair.mezzanine : stair.ground;
    return Math.hypot(c.ix - s.ix, c.iz - s.iz) + STAIR_COST + Math.hypot(t.ix - to.ix, t.iz - to.iz);
  };

  const g = new Map<number, number>([[startKey, 0]]);
  const came = new Map<number, number>();
  const nodes = new Map<number, PathStep>([[startKey, { ...from }]]);
  // A small binary heap of [f, key]
  const heap: [number, number][] = [[h(from), startKey]];
  const push = (item: [number, number]) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };

  const closed = new Set<number>();
  while (heap.length) {
    const [, k] = pop();
    if (closed.has(k)) continue;
    closed.add(k);
    const cur = nodes.get(k)!;
    if (k === goalKey) {
      const path: PathStep[] = [cur];
      let c = k;
      while (came.has(c)) {
        c = came.get(c)!;
        path.push(nodes.get(c)!);
      }
      return path.reverse();
    }
    const fg = grid.floors[cur.floor];
    const base = g.get(k)!;
    const tryStep = (n: PathStep, cost: number) => {
      const nk = key(n.floor, n.ix, n.iz, nx);
      if (closed.has(nk)) return;
      const ng = base + cost;
      if (ng < (g.get(nk) ?? Infinity)) {
        g.set(nk, ng);
        nodes.set(nk, n);
        came.set(nk, k);
        push([ng + h(n), nk]);
      }
    };
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const ix = cur.ix + dx;
        const iz = cur.iz + dz;
        const isGoal = cur.floor === to.floor && ix === to.ix && iz === to.iz;
        if (!isWalkable(fg, ix, iz) && !(isGoal && opts.allowGoalBlocked)) continue;
        if (dx && dz && (!isWalkable(fg, cur.ix + dx, cur.iz) || !isWalkable(fg, cur.ix, cur.iz + dz))) continue;
        tryStep({ floor: cur.floor, ix, iz }, dx && dz ? Math.SQRT2 : 1);
      }
    }
    // The stair edge
    for (const f of FLOORS) {
      const here = stair[f];
      if (cur.floor === f && cur.ix === here.ix && cur.iz === here.iz) {
        const there = stair[f === "ground" ? "mezzanine" : "ground"];
        tryStep({ ...there, stair: true }, STAIR_COST);
      }
    }
  }
  return null;
}
