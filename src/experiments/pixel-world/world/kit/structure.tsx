import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { flat, glow } from "../materials";
import { Bar, Box, Cyl, Wire, type Vec3 } from "./primitives";
import { LogoSign } from "./merch";

// Architectural pieces of the kit: pipe, railing, curtain, stair, doorway,
// glass facade and lamps.

const STEEL = 0.05;

/**
 * The mustard services pipe: a vertical run from `bottom` to `top`, with an
 * optional elbow that turns into the wall at the top.
 */
export function Pipe({ position, height, r = 0.075, elbow, ribs }: { position: Vec3; height: number; r?: number; elbow?: { length: number; dir: [number, number] }; ribs?: number }) {
  const m = flat("mustard");
  // A spiral-wound duct shows a seam every `ribs` meters. A plain pipe just
  // has two collars.
  const collars = ribs
    ? Array.from({ length: Math.floor(height / ribs) }, (_, i) => (i + 0.5) * ribs)
    : [0.4, height - 0.4];
  return (
    <group position={position}>
      <Cyl r={r} h={height} at={[0, height / 2, 0]} m={m} seg={10} />
      {collars.map((y) => (
        <Cyl key={y} r={ribs ? r * 1.08 : r * 1.35} h={ribs ? 0.03 : 0.06} at={[0, y, 0]} m={flat("mustard", ribs ? 3 : 1)} seg={10} />
      ))}
      {elbow && (
        <group position={[0, height, 0]} rotation={[0, Math.atan2(-elbow.dir[1], elbow.dir[0]), 0]}>
          <Cyl r={r} h={elbow.length} at={[elbow.length / 2, 0, 0]} rot={[0, 0, Math.PI / 2]} m={m} />
          <Cyl r={r * 1.15} h={r * 2.4} at={[0, 0, 0]} m={m} />
        </group>
      )}
    </group>
  );
}

/** A blue steel railing along X from `from` to `to`, with square posts and three round-ish rails. */
export function Railing({ from, to, z = 0, y = 0, height = 1.0, rails = [0.38, 0.68] }: { from: number; to: number; z?: number; y?: number; height?: number; rails?: number[] }) {
  const m = flat("cobalt");
  const len = to - from;
  const posts = Math.max(2, Math.round(len / 1.25) + 1);
  return (
    <group position={[(from + to) / 2, y, z]}>
      {Array.from({ length: posts }, (_, i) => (
        <Box key={i} size={[STEEL, height, STEEL]} at={[-len / 2 + (i / (posts - 1)) * len, height / 2, 0]} m={m} />
      ))}
      <Box size={[len + 0.08, 0.09, 0.09]} at={[0, height, 0]} m={m} />
      {rails.map((ry) => (
        <Box key={ry} size={[len, 0.07, 0.07]} at={[0, ry, 0]} m={m} />
      ))}
    </group>
  );
}

/**
 * A heavy pleated floor-to-ceiling curtain on a rod, running along X from its
 * left edge (local x = 0).
 */
export function Curtain({ position, rotation = 0, width, height, pleat = 0.34, depth = 0.12 }: { position: Vec3; rotation?: number; width: number; height: number; pleat?: number; depth?: number }) {
  const geo = useMemo(() => {
    const seg = Math.max(2, Math.round(width / (pleat / 2)));
    const g = new THREE.PlaneGeometry(width, height, seg, 1);
    const p = g.getAttribute("position");
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i) + width / 2;
      const k = Math.round(x / (pleat / 2));
      p.setXYZ(i, x, p.getY(i) + height / 2, k % 2 === 0 ? 0 : depth);
    }
    g.computeVertexNormals();
    return g.toNonIndexed();
  }, [width, height, pleat, depth]);
  useEffect(() => () => geo.dispose(), [geo]);
  const m = flat("navy", 2);
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh geometry={geo} material={m} castShadow receiveShadow />
      <Box size={[width + 0.1, 0.035, 0.035]} at={[width / 2, height + 0.02, depth / 2]} m={flat("charcoal")} />
    </group>
  );
}

/**
 * A straight steel stair with oak treads. It starts at the origin and climbs
 * toward -Z to `rise`, and it is `width` wide along X. `railSide` puts a
 * handrail on the open side (+1 = +X).
 */
export function Stair({ position, rotation = 0, rise, run, width = 0.9, railSide = 1 }: { position: Vec3; rotation?: number; rise: number; run: number; width?: number; railSide?: 1 | -1 | 0 }) {
  const steps = Math.round(rise / 0.19);
  const stepRise = rise / steps;
  const stepRun = run / steps;
  const angle = Math.atan2(rise, run);
  const stringerLen = Math.hypot(rise, run);
  const blue = flat("cobalt");
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {Array.from({ length: steps }, (_, i) => (
        <Box key={i} size={[width - 0.06, 0.045, stepRun + 0.03]} at={[0, (i + 1) * stepRise - 0.022, -(i + 0.5) * stepRun]} m={flat("oak")} />
      ))}
      {[-1, 1].map((s) => (
        <Box key={s} size={[0.05, 0.2, stringerLen]} at={[(s * width) / 2, rise / 2 - 0.05, -run / 2]} rot={[angle, 0, 0]} m={blue} />
      ))}
      {railSide !== 0 && (
        <group position={[(railSide * width) / 2, 0, 0]}>
          {[0.1, 0.5, 0.9].map((f) => (
            <Box key={f} size={[STEEL, 0.95, STEEL]} at={[0, rise * f + 0.47, -run * f]} m={blue} />
          ))}
          <Box size={[0.06, 0.06, stringerLen + 0.2]} at={[0, rise / 2 + 0.95, -run / 2]} rot={[angle, 0, 0]} m={blue} />
          <Box size={[0.045, 0.045, stringerLen]} at={[0, rise / 2 + 0.5, -run / 2]} rot={[angle, 0, 0]} m={blue} />
        </group>
      )}
    </group>
  );
}

/**
 * The tio.ist spiral stair (see reference/photo-spiral-stair.jpeg): a
 * mustard-yellow steel column with grey treads in yellow frames, scroll
 * balusters and a helical yellow handrail. Tread 0 points along
 * `endAngle - sweep` and the top tread points along `endAngle`. Both are
 * yaw angles, where 0 = +X and PI/2 = -Z. A negative sweep winds clockwise.
 */
export function SpiralStair({ position, rise, radius = 0.72, sweep = Math.PI * 1.5, endAngle = Math.PI / 2 }: { position: Vec3; rise: number; radius?: number; sweep?: number; endAngle?: number }) {
  const steps = Math.round(rise / 0.2);
  const stepRise = rise / steps;
  const yellow = flat("mustard");
  const treadLen = radius - 0.08;
  const angle = (i: number) => endAngle - sweep + (i / (steps - 1)) * sweep;
  const outer = (i: number, y: number): Vec3 => [Math.cos(angle(i)) * radius, y, -Math.sin(angle(i)) * radius];
  return (
    <group position={position}>
      <Cyl r={0.07} h={rise + 0.15} at={[0, (rise + 0.15) / 2, 0]} m={yellow} />
      {Array.from({ length: steps }, (_, i) => {
        const y = (i + 1) * stepRise;
        return (
          <group key={i} rotation={[0, angle(i), 0]}>
            {/* A grey tread in a yellow frame */}
            <Box size={[treadLen, 0.03, 0.3]} at={[0.06 + treadLen / 2, y - 0.015, 0]} m={flat("concrete", 1)} />
            <Box size={[treadLen + 0.02, 0.035, 0.34]} at={[0.06 + treadLen / 2, y - 0.045, 0]} m={yellow} shadow={false} />
            {/* A baluster with two scroll curls */}
            <Box size={[0.025, 0.9, 0.025]} at={[radius - 0.02, y + 0.45, 0]} m={yellow} />
            {[0.32, 0.58].map((h, k) => (
              <mesh key={h} position={[radius - 0.02, y + h, k ? 0.05 : -0.05]} material={yellow} castShadow>
                <torusGeometry args={[0.055, 0.012, 4, 10]} />
              </mesh>
            ))}
          </group>
        );
      })}
      {/* The helical handrail, as straight segments between the post tops */}
      {Array.from({ length: steps - 1 }, (_, i) => (
        <Bar key={i} from={outer(i, (i + 1) * stepRise + 0.9)} to={outer(i + 1, (i + 2) * stepRise + 0.9)} t={0.045} m={yellow} />
      ))}
    </group>
  );
}

/** A dark doorway set into a wall at -Z: a white frame around a deep dark opening. */
export function Doorway({ position, w = 0.95, h = 2.15, open = true }: { position: Vec3; w?: number; h?: number; open?: boolean }) {
  return (
    <group position={position}>
      <Box size={[w, h, 0.02]} at={[0, h / 2, 0.01]} m={open ? flat("navy", 0) : flat("white", 3)} shadow={false} />
      <Box size={[0.07, h + 0.05, 0.06]} at={[-w / 2 - 0.035, (h + 0.05) / 2, 0.03]} m={flat("white", 3)} />
      <Box size={[0.07, h + 0.05, 0.06]} at={[w / 2 + 0.035, (h + 0.05) / 2, 0.03]} m={flat("white", 3)} />
      <Box size={[w + 0.14, 0.07, 0.06]} at={[0, h + 0.035, 0.03]} m={flat("white", 3)} />
      {!open && <Box size={[0.03, 0.03, 0.06]} at={[w / 2 - 0.1, 1.0, 0.05]} m={flat("charcoal")} />}
    </group>
  );
}

/**
 * The shopfront (reference/photo-shopfront.jpeg): heavy dark navy frames
 * around big panes, a solid navy lower panel on a cobalt tiled plinth, a
 * door with a solid lower half, and the blue neon "tio" sign glowing in the
 * upper pane. It runs along X, centered, with the room behind it at -Z.
 */
export function GlassFacade({ position, rotation = 0, width, height, door = { x: -0.6, w: 1.1 } }: { position: Vec3; rotation?: number; width: number; height: number; door?: { x: number; w: number } }) {
  const frame = flat("navy", 0);
  const sill = 0.75; // top of the solid lower panel
  const transom = 2.55;
  const cols = [-width / 2, -width / 2 + (door.x - door.w / 2 + width / 2) / 2, door.x - door.w / 2, door.x + door.w / 2, width / 2];
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {/* The glazing */}
      <Box size={[width, height - sill, 0.03]} at={[0, sill + (height - sill) / 2, 0]} m={flat("glass")} shadow={false} />
      {/* The solid lower panel and the tiled plinth */}
      <Box size={[width, sill, 0.1]} at={[0, sill / 2, 0]} m={frame} />
      <Box size={[width + 0.02, 0.28, 0.12]} at={[0, 0.14, 0.01]} m={flat("cobalt", 1)} />
      {/* Mullions and transoms */}
      {cols.map((x) => (
        <Box key={x} size={[0.12, height, 0.12]} at={[x, height / 2, 0]} m={frame} />
      ))}
      {[sill, transom, height - 0.06].map((y) => (
        <Box key={y} size={[width, 0.12, 0.12]} at={[0, y, 0]} m={frame} />
      ))}
      {/* The door: a solid lower half and a glass upper half */}
      <group position={[door.x, 0, 0.02]}>
        <Box size={[door.w - 0.1, 1.1, 0.06]} at={[0, 0.55, 0]} m={frame} />
        <Box size={[0.05, 0.2, 0.08]} at={[-door.w / 2 + 0.15, 1.2, 0.03]} m={flat("charcoal", 1)} shadow={false} />
      </group>
      {/* The blue neon "tio" sign in the upper pane */}
      <group position={[door.x - 0.2, transom + 0.6, -0.08]} rotation={[0, Math.PI, 0]}>
        <LogoSign position={[0, 0, 0]} neon />
      </group>
    </group>
  );
}

type PendantStyle = "globe" | "cone" | "dome";

/**
 * A pendant lamp hanging from `position` (the ceiling anchor) on a cord of
 * length `drop`.
 */
export function PendantLamp({ position, drop, style = "globe", label = false }: { position: Vec3; drop: number; style?: PendantStyle; label?: boolean }) {
  return (
    <group position={position}>
      <Wire points={[[0, 0, 0], [0, -drop, 0]]} />
      <Box size={[0.08, 0.02, 0.08]} at={[0, -0.01, 0]} m={flat("charcoal")} shadow={false} />
      <group position={[0, -drop, 0]}>
        {style === "globe" && (
          <>
            <Cyl r={0.025} h={0.05} at={[0, -0.02, 0]} m={flat("charcoal")} shadow={false} />
            <mesh position={[0, -0.18, 0]} material={glow("warmLight", 2)} userData={{ pixel: {} }}>
              <sphereGeometry args={[0.15, 12, 8]} />
            </mesh>
            {/* The red "hello" / "world!" lettering on the upstairs globes */}
            {label && <Box size={[0.16, 0.05, 0.02]} at={[0, -0.18, 0.145]} m={flat("red", 1)} shadow={false} />}
          </>
        )}
        {style === "cone" && (
          <>
            <Cyl r={0.025} r2={0.13} h={0.16} at={[0, -0.08, 0]} m={flat("white", 1)} shadow={false} />
            <Cyl r={0.11} h={0.01} at={[0, -0.165, 0]} m={glow("warmLight", 1)} shadow={false} />
          </>
        )}
        {style === "dome" && (
          <>
            <Cyl r={0.05} r2={0.22} h={0.18} at={[0, -0.09, 0]} m={flat("navy", 2)} shadow={false} />
            <Cyl r={0.19} h={0.01} at={[0, -0.185, 0]} m={glow("warmLight", 1)} shadow={false} />
          </>
        )}
      </group>
    </group>
  );
}

/** A long linear fluorescent fixture on two cords, running along X. */
export function LinearLamp({ position, rotation = 0, length = 3, drop = 0.6 }: { position: Vec3; rotation?: number; length?: number; drop?: number }) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {[-1, 1].map((s) => (
        <Wire key={s} points={[[(s * length) / 2 - s * 0.2, 0, 0], [(s * length) / 2 - s * 0.2, -drop, 0]]} />
      ))}
      <Box size={[length, 0.06, 0.12]} at={[0, -drop - 0.03, 0]} m={flat("wallBlue", 3)} shadow={false} />
      <Box size={[length - 0.06, 0.01, 0.08]} at={[0, -drop - 0.065, 0]} m={glow("warmLight", 2)} shadow={false} />
    </group>
  );
}
