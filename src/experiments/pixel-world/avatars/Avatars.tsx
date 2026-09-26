import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { layout } from "../world/layout";
import { flat } from "../world/materials";
import { useViewStore, type FloorId } from "../ui/viewStore";
import { useGridStore } from "../pathfinding/gridStore";
import { findPath, type PathStep } from "../pathfinding/astar";
import { cellAt, cellCenter, inBounds, isWalkable, type Cell, type WalkGrid } from "../pathfinding/grid";
import { useAvatarStore } from "./store";
import { buildSeats, type Seat } from "./seats";
import {
  FRAMES,
  FRAME_H,
  FRAME_W,
  SIT_HIP,
  TEXELS_PER_METER,
  atlasTexture,
  labelTexture,
  proceduralSprites,
  setFrame,
  type Facing,
} from "./sprites";
import type { Avatar } from "./types";

// The avatar simulation. Each avatar runs a small loop forever:
//   go sit at its own desk for a while -> get up, then either visit another
//   seat (kitchen stools, the sofa, the meeting table), walk over to someone
//   for a chat ("…"), or wander to a random spot -> back to the desk.
// Paths come from A* over the walkable grid, including trips up and down the
// spiral stair.

const WALK_SPEED = 1.4; // m/s
const STAIR_SPEED = 0.8;
const SPRITE_W = FRAME_W / TEXELS_PER_METER;
const SPRITE_H = FRAME_H / TEXELS_PER_METER;

type Activity =
  | { kind: "sit"; seat: number; dur: number }
  | { kind: "idle"; dur: number; bubble: string | null }
  | { kind: "chat"; with: string; dur: number };

interface Runtime {
  floor: FloorId;
  x: number;
  y: number;
  z: number;
  mode: "walk" | "sit" | "idle" | "chat";
  path: PathStep[];
  pathIdx: number;
  /** When climbing, the helix points still to visit. */
  stairPts: THREE.Vector3[];
  /** The final exact spot to step onto after the last cell (a seat). */
  finalSpot: [number, number] | null;
  next: Activity | null;
  timer: number;
  seat: number | null;
  dir: [number, number];
  walkClock: number;
  /** The speech bubble text, if any: "…" while chatting, "kahve" at the counter. */
  bubble: string | null;
  /** The last activity picked, so a break is followed by work again. */
  last: string;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** The helix an avatar walks when climbing the spiral stair (bottom to top). */
function stairHelix(): THREE.Vector3[] {
  const { center, radius, rise, sweep, endAngle, entry, exit } = layout.stair;
  const steps = Math.round(rise / 0.2);
  const stepRise = rise / steps;
  const pts = [new THREE.Vector3(entry[0], 0, entry[1])];
  for (let i = 0; i < steps; i++) {
    const a = endAngle - sweep + (i / (steps - 1)) * sweep;
    const r = radius * 0.6;
    pts.push(new THREE.Vector3(center[0] + Math.cos(a) * r, (i + 1) * stepRise, center[1] - Math.sin(a) * r));
  }
  pts.push(new THREE.Vector3(exit[0], rise, exit[1]));
  return pts;
}

function cellOf(grid: WalkGrid, rt: Runtime): Cell {
  const g = grid.floors[rt.floor];
  const [ix, iz] = cellAt(g, rt.x, rt.z);
  return { floor: rt.floor, ix, iz };
}

/** The nearest walkable cell to a point, searching outward. */
function nearestWalkable(grid: WalkGrid, floor: FloorId, x: number, z: number): Cell | null {
  const g = grid.floors[floor];
  const [cx, cz] = cellAt(g, x, z);
  for (let r = 0; r < 6; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        if (isWalkable(g, cx + dx, cz + dz)) return { floor, ix: cx + dx, iz: cz + dz };
      }
    }
  }
  return null;
}

function randomWalkable(grid: WalkGrid): Cell {
  for (;;) {
    const floor: FloorId = Math.random() < 0.6 ? "ground" : "mezzanine";
    const g = grid.floors[floor];
    const ix = Math.floor(Math.random() * g.nx);
    const iz = Math.floor(Math.random() * g.nz);
    if (isWalkable(g, ix, iz)) return { floor, ix, iz };
  }
}

export function Avatars() {
  const avatars = useAvatarStore((s) => s.avatars);
  const grid = useGridStore((s) => s.grid);
  const seats = useMemo(buildSeats, []);
  const helix = useMemo(stairHelix, []);
  const runtimes = useRef(new Map<string, Runtime>());
  const occupied = useRef(new Map<number, string>());
  // Handy for poking at the simulation from the console in dev
  if (import.meta.env.DEV) (window as unknown as { __avatars: unknown }).__avatars = runtimes.current;

  // Work seats: desk chairs and the stools at the standing desks. The rest are social.
  const { workSeats, socialSeats } = useMemo(() => {
    const workSeats: number[] = [];
    const socialSeats: number[] = [];
    seats.forEach((s, i) => (s.desk || s.kind === "stool" ? workSeats : socialSeats).push(i));
    return { workSeats, socialSeats };
  }, [seats]);

  // Give every avatar a home work seat (one each, while they last)
  const homes = useMemo(() => {
    const map = new Map<string, number>();
    avatars.forEach((a, i) => {
      if (a.homeSeat !== undefined) map.set(a.id, a.homeSeat);
      else if (i < workSeats.length) map.set(a.id, workSeats[i]);
    });
    return map;
  }, [avatars, workSeats]);

  // Spawn: everyone starts sitting at their desk (or standing near the door)
  useEffect(() => {
    if (!grid) return;
    const live = runtimes.current;
    for (const a of avatars) {
      if (live.has(a.id)) continue;
      const home = homes.get(a.id);
      const rt: Runtime = {
        floor: "ground",
        x: layout.facade.door.x,
        y: 0,
        z: layout.room.depth / 2 - 0.6,
        mode: "idle",
        path: [],
        pathIdx: 0,
        stairPts: [],
        finalSpot: null,
        next: null,
        timer: rand(0.5, 3),
        seat: null,
        dir: [0, -1],
        walkClock: Math.random() * 10,
        bubble: null,
        last: "break",
      };
      if (home !== undefined && !occupied.current.has(home)) {
        const s = seats[home];
        Object.assign(rt, { floor: s.floor, x: s.x, y: grid.floors[s.floor].y, z: s.z, mode: "sit", seat: home, timer: rand(3, 25), dir: s.facing, last: "work" });
        occupied.current.set(home, a.id);
      }
      live.set(a.id, rt);
    }
    for (const id of [...live.keys()]) {
      if (!avatars.some((a) => a.id === id)) {
        const rt = live.get(id)!;
        if (rt.seat !== null) occupied.current.delete(rt.seat);
        live.delete(id);
      }
    }
  }, [avatars, grid, homes, seats]);

  const go = (rt: Runtime, id: string, goal: Cell, then: Activity, finalSpot: [number, number] | null = null, allowGoalBlocked = false) => {
    if (!grid) return false;
    const from = cellOf(grid, rt);
    const path = findPath(grid, from, goal, { allowGoalBlocked });
    if (!path) return false;
    if (rt.seat !== null && occupied.current.get(rt.seat) === id) occupied.current.delete(rt.seat);
    rt.seat = null;
    rt.path = path;
    rt.pathIdx = 1;
    rt.finalSpot = finalSpot;
    rt.next = then;
    rt.mode = "walk";
    rt.bubble = null;
    return true;
  };

  const spotCell = (name: string): Cell | null => {
    if (!grid) return null;
    const sp = layout.spots[name];
    return nearestWalkable(grid, sp.floor, sp.at[0] + rand(-0.4, 0.4), sp.at[1] + rand(-0.3, 0.3));
  };

  // The daily loop: mostly work at a desk, broken up by coffee, a breath of
  // air outside the door, trips up and down the stair, and chats.
  const chooseNext = (a: Avatar, rt: Runtime) => {
    if (!grid) return;
    const home = homes.get(a.id);
    const trySeat = (i: number, dur: number) => {
      if (occupied.current.has(i)) return false;
      const s = seats[i];
      const g = grid.floors[s.floor];
      const [ix, iz] = cellAt(g, s.x, s.z);
      if (!inBounds(g, ix, iz)) return false;
      if (!go(rt, a.id, { floor: s.floor, ix, iz }, { kind: "sit", seat: i, dur }, [s.x, s.z], true)) return false;
      occupied.current.set(i, a.id); // reserve it
      return true;
    };
    const tryAny = (pool: number[], dur: number) => {
      const free = pool.filter((i) => !occupied.current.has(i));
      for (let n = 0; n < 4 && free.length; n++) {
        if (trySeat(free.splice(Math.floor(Math.random() * free.length), 1)[0], dur)) return true;
      }
      return false;
    };
    const trySpot = (name: string, dur: number, bubble: string | null) => {
      const c = spotCell(name);
      return !!c && go(rt, a.id, c, { kind: "idle", dur, bubble });
    };
    const was = rt.last;
    const roll = Math.random();
    let choice: string;
    if (was !== "work") choice = roll < 0.75 ? "work" : "chat"; // back to work after a break
    else if (roll < 0.28) choice = "coffee";
    else if (roll < 0.48) choice = "outside";
    else if (roll < 0.74) choice = "otherFloor";
    else if (roll < 0.9) choice = "chat";
    else choice = "wander";
    rt.last = choice;

    if (choice === "work") {
      if (home !== undefined && trySeat(home, rand(14, 32))) return;
      if (tryAny(workSeats.filter((i) => seats[i].desk), rand(14, 32))) return;
      if (tryAny(workSeats, rand(10, 24))) return;
    }
    if (choice === "coffee" && trySpot("coffee", rand(4, 7), "kahve")) return;
    if (choice === "outside" && trySpot("outside", rand(6, 12), null)) return;
    if (choice === "otherFloor") {
      // Up to the kitchen / lounge, or down to the meeting table
      const other: FloorId = rt.floor === "ground" ? "mezzanine" : "ground";
      if (other === "mezzanine" && Math.random() < 0.35 && trySpot("kitchen", rand(5, 9), "çay")) return;
      if (other === "mezzanine" && Math.random() < 0.15 && trySpot("window", rand(4, 8), null)) return;
      if (tryAny(socialSeats.filter((i) => seats[i].floor === other), rand(8, 18))) return;
    }
    if (choice === "chat") {
      // Walk over to someone who is sitting or standing still
      const others = [...runtimes.current.entries()].filter(([id, o]) => id !== a.id && (o.mode === "sit" || o.mode === "idle"));
      if (others.length) {
        const [otherId, o] = others[Math.floor(Math.random() * others.length)];
        const spot = nearestWalkable(grid, o.floor, o.x + o.dir[0] * 0.6, o.z + o.dir[1] * 0.6);
        if (spot && go(rt, a.id, spot, { kind: "chat", with: otherId, dur: rand(4, 8) })) return;
      }
    }
    // A random stroll; some cells are pockets with no way in, so try a few
    for (let n = 0; n < 5; n++) if (go(rt, a.id, randomWalkable(grid), { kind: "idle", dur: rand(2, 5), bubble: null })) return;
    rt.timer = rand(1, 3);
  };

  const arrive = (rt: Runtime) => {
    const act = rt.next;
    rt.next = null;
    if (!act) {
      rt.mode = "idle";
      rt.timer = rand(1, 3);
      return;
    }
    if (act.kind === "sit") {
      const s: Seat = seats[act.seat];
      rt.mode = "sit";
      rt.seat = act.seat;
      rt.dir = s.facing;
      rt.timer = act.dur;
    } else if (act.kind === "chat") {
      rt.mode = "chat";
      rt.timer = act.dur;
      rt.bubble = "…";
      const o = runtimes.current.get(act.with);
      if (o) {
        rt.dir = [o.x - rt.x, o.z - rt.z];
        if (o.mode === "sit" || o.mode === "idle" || o.mode === "chat") {
          o.bubble = "…";
          o.timer = Math.max(o.timer, act.dur);
          if (o.mode === "idle") o.dir = [rt.x - o.x, rt.z - o.z];
        }
      }
    } else {
      rt.mode = "idle";
      rt.timer = act.dur;
      rt.bubble = act.bubble;
    }
  };

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.1);
    if (!grid || !useAvatarStore.getState().autonomy) return;
    for (const a of avatars) {
      const rt = runtimes.current.get(a.id);
      if (!rt) continue;
      if (rt.mode === "walk") {
        rt.walkClock += dt;
        let budget = (rt.stairPts.length ? STAIR_SPEED : WALK_SPEED) * dt;
        while (budget > 0) {
          let target: THREE.Vector3 | null = null;
          if (rt.stairPts.length) {
            target = rt.stairPts[0];
          } else if (rt.pathIdx < rt.path.length) {
            const step = rt.path[rt.pathIdx];
            if (step.stair) {
              const up = step.floor === "mezzanine";
              rt.stairPts = (up ? helix : [...helix].reverse()).slice(1).map((p) => p.clone());
              rt.floor = step.floor;
              rt.pathIdx++;
              continue;
            }
            const g = grid.floors[step.floor];
            const last = rt.pathIdx === rt.path.length - 1;
            const [cx, cz] = last && rt.finalSpot ? rt.finalSpot : cellCenter(g, step.ix, step.iz);
            target = new THREE.Vector3(cx, g.y, cz);
          } else {
            arrive(rt);
            break;
          }
          const dx = target.x - rt.x;
          const dy = target.y - rt.y;
          const dz = target.z - rt.z;
          const dist = Math.hypot(dx, dy, dz);
          if (Math.hypot(dx, dz) > 0.01) rt.dir = [dx, dz];
          if (dist <= budget) {
            rt.x = target.x;
            rt.y = target.y;
            rt.z = target.z;
            budget -= dist;
            if (rt.stairPts.length) rt.stairPts.shift();
            else rt.pathIdx++;
          } else {
            rt.x += (dx / dist) * budget;
            rt.y += (dy / dist) * budget;
            rt.z += (dz / dist) * budget;
            budget = 0;
          }
        }
      } else {
        rt.timer -= dt;
        if (rt.timer <= 0) {
          rt.bubble = null;
          chooseNext(a, rt);
        }
      }
    }
  });

  return (
    <>
      {avatars.map((a) => (
        <AvatarSprite key={a.id} avatar={a} runtimes={runtimes} seats={seats} />
      ))}
    </>
  );
}

const _f = new THREE.Vector3();
const bubbleTextures = new Map<string, ReturnType<typeof labelTexture>>();
const bubbleTexture = (text: string) => {
  let t = bubbleTextures.get(text);
  if (!t) bubbleTextures.set(text, (t = labelTexture(text)));
  return t;
};

function AvatarSprite({ avatar, runtimes, seats }: { avatar: Avatar; runtimes: React.MutableRefObject<Map<string, Runtime>>; seats: Seat[] }) {
  const camera = useThree((s) => s.camera);
  const group = useRef<THREE.Group>(null);
  const body = useRef<THREE.Mesh>(null);
  const label = useRef<THREE.Mesh>(null);
  const bubble = useRef<THREE.Mesh>(null);
  const shadow = useRef<THREE.Mesh>(null);

  const { tex, bodyMat, labelMat, labelSize } = useMemo(() => {
    const tex = atlasTexture(proceduralSprites.atlas(avatar.appearance));
    const bodyMat = new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.5 });
    const l = labelTexture(avatar.name);
    const labelMat = new THREE.MeshBasicMaterial({ map: l.texture, alphaTest: 0.5 });
    return { tex, bodyMat, labelMat, labelSize: [l.w / TEXELS_PER_METER, l.h / TEXELS_PER_METER] as [number, number] };
  }, [avatar.appearance, avatar.name]);
  const bubbleMat = useMemo(() => new THREE.MeshBasicMaterial({ map: bubbleTexture("…").texture, alphaTest: 0.5 }), []);
  useEffect(
    () => () => {
      tex.dispose();
      bodyMat.dispose();
      labelMat.map?.dispose();
      labelMat.dispose();
      bubbleMat.dispose();
    },
    [tex, bodyMat, labelMat, bubbleMat],
  );

  useFrame(() => {
    const rt = runtimes.current.get(avatar.id);
    const g = group.current;
    if (!rt || !g || !body.current) return;
    const floors = useViewStore.getState().floors;
    g.visible = floors[rt.floor];

    camera.getWorldDirection(_f);
    const yaw = Math.atan2(-_f.x, -_f.z);
    const toCam: [number, number] = [-_f.x, -_f.z];
    const tl = Math.hypot(toCam[0], toCam[1]) || 1;

    // Pick the sprite facing from the motion / facing direction relative to the camera
    const [mx, mz] = rt.dir;
    const fwd = -(mx * toCam[0] + mz * toCam[1]) / tl; // > 0: moving away from the camera
    const right = (mx * Math.cos(yaw) - mz * Math.sin(yaw));
    let facing: Facing;
    if (Math.abs(fwd) >= Math.abs(right) * 0.85) facing = fwd > 0 ? "back" : "front";
    else facing = right > 0 ? "right" : "left";

    let frame: number = FRAMES.idle0;
    let baseY = rt.y;
    let px = rt.x;
    let pz = rt.z;
    if (rt.mode === "walk") {
      frame = FRAMES.walk0 + (Math.floor(rt.walkClock * 8) % 4);
    } else if (rt.mode === "sit" && rt.seat !== null) {
      frame = FRAMES.sit;
      const s = seats[rt.seat];
      baseY = s.height - SIT_HIP / TEXELS_PER_METER;
      // Nudge toward the camera so the chair doesn't swallow the sprite
      px += (toCam[0] / tl) * 0.22;
      pz += (toCam[1] / tl) * 0.22;
    } else {
      frame = Math.floor(performance.now() / 600 + avatar.id.length) % 2 ? FRAMES.idle1 : FRAMES.idle0;
    }
    setFrame(tex, facing, frame);

    g.position.set(px, baseY, pz);
    g.rotation.y = yaw;
    const top = rt.mode === "sit" ? SPRITE_H - 0.1 : SPRITE_H;
    if (label.current) label.current.position.y = top + 0.12;
    if (bubble.current) {
      const b = bubble.current;
      b.visible = !!rt.bubble;
      if (rt.bubble) {
        const t = bubbleTexture(rt.bubble);
        if (bubbleMat.map !== t.texture) {
          bubbleMat.map = t.texture;
          bubbleMat.needsUpdate = true;
        }
        b.scale.set(t.w / TEXELS_PER_METER, t.h / TEXELS_PER_METER, 1);
        b.position.set(t.w / TEXELS_PER_METER / 2 + 0.05, top + 0.45, 0.03);
      }
    }
    if (shadow.current) {
      shadow.current.visible = rt.mode !== "sit";
      shadow.current.position.y = rt.y - baseY + 0.015;
    }
  });

  return (
    <group ref={group}>
      <mesh ref={shadow} rotation={[-Math.PI / 2, 0, 0]} material={flat("concrete", 0)} userData={{ pixel: { skipNormal: true } }}>
        <circleGeometry args={[0.22, 10]} />
      </mesh>
      <mesh ref={body} position={[0, SPRITE_H / 2, 0]} material={bodyMat}>
        <planeGeometry args={[SPRITE_W, SPRITE_H]} />
      </mesh>
      <mesh ref={label} position={[0, SPRITE_H + 0.12, 0.02]} material={labelMat}>
        <planeGeometry args={labelSize} />
      </mesh>
      <mesh ref={bubble} position={[0.3, SPRITE_H + 0.45, 0.03]} material={bubbleMat} visible={false}>
        <planeGeometry args={[1, 1]} />
      </mesh>
    </group>
  );
}
