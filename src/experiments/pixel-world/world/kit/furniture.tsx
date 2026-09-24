import type { PaletteKey } from "../../palette";
import { flat, glow } from "../materials";
import { Box, Cyl, type Vec3 } from "./primitives";

// Furniture kit. Every piece is built at the origin, facing +Z (the side a
// person sits on or approaches from), and is positioned and rotated by the
// caller from layout data.

const STEEL = 0.05;

interface Placed {
  position: Vec3;
  /** Rotation around Y, in radians. */
  rotation?: number;
}

/**
 * A blue steel frame of four legs, with side stretchers and a back
 * stretcher. Its outer size is `w` x `d`, and the top of the legs is at `h`.
 */
function SteelFrame({ w, d, h, stretcherY = 0.12, back = true }: { w: number; d: number; h: number; stretcherY?: number; back?: boolean }) {
  const m = flat("cobalt");
  const x = w / 2 - STEEL / 2;
  const z = d / 2 - STEEL / 2;
  return (
    <group>
      {[
        [-x, -z],
        [x, -z],
        [-x, z],
        [x, z],
      ].map(([lx, lz]) => (
        <Box key={`${lx}:${lz}`} size={[STEEL, h, STEEL]} at={[lx, h / 2, lz]} m={m} />
      ))}
      {/* Side rails, top and bottom */}
      {[-x, x].map((lx) => (
        <group key={lx}>
          <Box size={[STEEL, STEEL, d]} at={[lx, h - STEEL / 2, 0]} m={m} />
          <Box size={[STEEL, STEEL, d]} at={[lx, stretcherY, 0]} m={m} />
        </group>
      ))}
      {back && <Box size={[w, STEEL, STEEL]} at={[0, h - STEEL / 2, -z]} m={m} />}
    </group>
  );
}

/** A wall desk: oak top on a blue steel frame (the tio.ist desk row). */
export function Desk({ position, rotation = 0, w = 1.4, d = 0.7, h = 0.75 }: Placed & { w?: number; d?: number; h?: number }) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <SteelFrame w={w - 0.04} d={d - 0.04} h={h - 0.04} />
      <Box size={[w, 0.04, d]} at={[0, h - 0.02, 0]} m={flat("oak")} />
    </group>
  );
}

/** A tall standing table: oak top on a blue frame with a low shelf. Optionally on casters. */
export function HighTable({ position, rotation = 0, w = 1.8, d = 0.7, h = 1.05, shelf = true, casters = false }: Placed & { w?: number; d?: number; h?: number; shelf?: boolean; casters?: boolean }) {
  const lift = casters ? 0.08 : 0;
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <group position={[0, lift, 0]}>
        <SteelFrame w={w - 0.04} d={d - 0.04} h={h - 0.05 - lift} stretcherY={0.3} />
        <Box size={[w, 0.05, d]} at={[0, h - 0.025 - lift, 0]} m={flat("oak")} />
        {shelf && <Box size={[w - 0.1, 0.03, d - 0.1]} at={[0, 0.3, 0]} m={flat("oak", 3)} />}
      </group>
      {casters &&
        [
          [-1, -1],
          [1, -1],
          [-1, 1],
          [1, 1],
        ].map(([sx, sz]) => (
          <Cyl key={`${sx}${sz}`} r={0.04} h={0.08} at={[(sx * (w - 0.1)) / 2, 0.04, (sz * (d - 0.1)) / 2]} m={flat("charcoal")} rot={[Math.PI / 2, 0, 0]} />
        ))}
    </group>
  );
}

/** A bar stool: blue steel legs with a foot rail and a square oak seat. */
export function Stool({ position, rotation = 0, h = 0.75 }: Placed & { h?: number }) {
  const s = 0.36;
  const m = flat("cobalt");
  const x = s / 2 - STEEL / 2;
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {[
        [-x, -x],
        [x, -x],
        [-x, x],
        [x, x],
      ].map(([lx, lz]) => (
        <Box key={`${lx}${lz}`} size={[STEEL, h - 0.04, STEEL]} at={[lx, (h - 0.04) / 2, lz]} m={m} />
      ))}
      <Box size={[s, 0.035, 0.035]} at={[0, 0.28, x]} m={m} />
      <Box size={[s, 0.035, 0.035]} at={[0, 0.28, -x]} m={m} />
      <Box size={[0.035, 0.035, s]} at={[x, 0.28, 0]} m={m} />
      <Box size={[0.035, 0.035, s]} at={[-x, 0.28, 0]} m={m} />
      <Box size={[s + 0.04, 0.05, s + 0.04]} at={[0, h - 0.025, 0]} m={flat("oak")} />
    </group>
  );
}

/** An office chair: a white five-star base, a gas lift, and a dark seat and back. It faces +Z. */
export function OfficeChair({ position, rotation = 0 }: Placed) {
  const dark = flat("charcoal");
  const base = flat("white", 2);
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {[0, 1, 2, 3, 4].map((i) => {
        const a = (i / 5) * Math.PI * 2 + 0.3;
        return (
          <group key={i} rotation={[0, a, 0]}>
            <Box size={[0.3, 0.035, 0.04]} at={[0.15, 0.07, 0]} m={base} />
            <Box size={[0.05, 0.05, 0.05]} at={[0.29, 0.025, 0]} m={dark} />
          </group>
        );
      })}
      <Cyl r={0.03} h={0.36} at={[0, 0.26, 0]} m={base} seg={6} />
      <Box size={[0.48, 0.08, 0.46]} at={[0, 0.48, 0.02]} m={dark} />
      <Box size={[0.44, 0.48, 0.07]} at={[0, 0.8, -0.2]} m={dark} rot={[-0.12, 0, 0]} />
      <Box size={[0.04, 0.2, 0.04]} at={[0, 0.58, -0.22]} m={dark} />
    </group>
  );
}

/** A laptop, open, with its screen at the back (-Z). */
export function Laptop({ position, rotation = 0 }: Placed) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <Box size={[0.34, 0.02, 0.24]} at={[0, 0.01, 0]} m={flat("white", 1)} shadow={false} />
      <group position={[0, 0.02, -0.12]} rotation={[-0.3, 0, 0]}>
        <Box size={[0.34, 0.23, 0.015]} at={[0, 0.115, 0]} m={flat("white", 1)} />
        <Box size={[0.3, 0.19, 0.005]} at={[0, 0.115, 0.009]} m={glow("glass", 1)} shadow={false} />
      </group>
    </group>
  );
}

/** A row of book spines standing on a shelf, along X. */
export function Books({ position, rotation = 0, count = 5, seed = 1 }: Placed & { count?: number; seed?: number }) {
  const keys: [PaletteKey, number][] = [
    ["orange", 2],
    ["cobalt", 3],
    ["cream", 2],
    ["navy", 2],
    ["mustard", 2],
    ["white", 3],
    ["terracotta", 1],
  ];
  let x = 0;
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {Array.from({ length: count }, (_, i) => {
        const [k, s] = keys[(i * 3 + seed) % keys.length];
        const w = 0.04 + ((i * 7 + seed) % 3) * 0.015;
        const h = 0.2 + ((i * 5 + seed) % 4) * 0.025;
        const cx = x + w / 2;
        x += w + 0.003;
        return <Box key={i} size={[w, h, 0.16]} at={[cx, h / 2, 0]} m={flat(k, s)} shadow={false} />;
      })}
    </group>
  );
}

/**
 * A long wall shelf: an oak plank carried by square blue steel C brackets
 * (the ones above the tio.ist desk row). The wall is at -Z, and the shelf
 * runs along X.
 */
export function WallShelf({ position, rotation = 0, length = 4, depth = 0.28 }: Placed & { length?: number; depth?: number }) {
  const m = flat("cobalt");
  const brackets = Math.max(2, Math.round(length / 1.3) + 1);
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <Box size={[length, 0.045, depth]} at={[0, 0, depth / 2]} m={flat("oak")} />
      {Array.from({ length: brackets }, (_, i) => {
        const x = -length / 2 + 0.08 + (i / (brackets - 1)) * (length - 0.16);
        return (
          <group key={i} position={[x, 0, 0]}>
            {/* An open square bracket: an arm under the plank, an upright at the front, and a top arm back to the wall */}
            <Box size={[0.045, 0.045, depth + 0.04]} at={[0, -0.045, depth / 2]} m={m} />
            <Box size={[0.045, 0.34, 0.045]} at={[0, 0.12, depth + 0.02]} m={m} />
            <Box size={[0.045, 0.045, 0.14]} at={[0, 0.29, depth - 0.05]} m={m} />
          </group>
        );
      })}
    </group>
  );
}

/** A freestanding steel shelving unit with oak shelves. */
export function ShelvingUnit({ position, rotation = 0, w = 1.0, d = 0.4, h = 2.0, shelves = 4 }: Placed & { w?: number; d?: number; h?: number; shelves?: number }) {
  const m = flat("cobalt");
  const x = w / 2 - STEEL / 2;
  const z = d / 2 - STEEL / 2;
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {[
        [-x, -z],
        [x, -z],
        [-x, z],
        [x, z],
      ].map(([lx, lz]) => (
        <Box key={`${lx}${lz}`} size={[STEEL, h, STEEL]} at={[lx, h / 2, lz]} m={m} />
      ))}
      {Array.from({ length: shelves }, (_, i) => {
        const y = 0.15 + (i / (shelves - 1)) * (h - 0.25);
        return <Box key={i} size={[w - 0.02, 0.035, d - 0.04]} at={[0, y, 0]} m={flat("oak")} />;
      })}
    </group>
  );
}

/** A heavy wooden dining table. */
export function DiningTable({ position, rotation = 0, w = 2.0, d = 0.9, h = 0.76 }: Placed & { w?: number; d?: number; h?: number }) {
  const wood = flat("oak", 1);
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <Box size={[w, 0.07, d]} at={[0, h - 0.035, 0]} m={flat("oak", 2)} />
      <Box size={[w - 0.2, 0.1, d - 0.15]} at={[0, h - 0.12, 0]} m={wood} />
      {[
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ].map(([sx, sz]) => (
        <Box key={`${sx}${sz}`} size={[0.09, h - 0.07, 0.09]} at={[(sx * (w - 0.3)) / 2, (h - 0.07) / 2, (sz * (d - 0.2)) / 2]} m={wood} />
      ))}
    </group>
  );
}

/** A molded orange dining chair. It faces +Z. */
export function DiningChair({ position, rotation = 0 }: Placed) {
  const m = flat("orange");
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {[
        [-0.18, -0.18],
        [0.18, -0.18],
        [-0.18, 0.18],
        [0.18, 0.18],
      ].map(([x, z]) => (
        <Box key={`${x}${z}`} size={[0.035, 0.45, 0.035]} at={[x, 0.225, z]} m={flat("orange", 1)} />
      ))}
      <Box size={[0.42, 0.04, 0.42]} at={[0, 0.46, 0]} m={m} />
      <Box size={[0.42, 0.4, 0.04]} at={[0, 0.68, -0.2]} m={m} rot={[-0.1, 0, 0]} />
    </group>
  );
}

/** A wooden bench with a cream cushion. */
export function Bench({ position, rotation = 0, w = 1.8 }: Placed & { w?: number }) {
  const wood = flat("oak", 1);
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <Box size={[0.08, 0.36, 0.34]} at={[-w / 2 + 0.12, 0.18, 0]} m={wood} />
      <Box size={[0.08, 0.36, 0.34]} at={[w / 2 - 0.12, 0.18, 0]} m={wood} />
      <Box size={[w, 0.06, 0.4]} at={[0, 0.39, 0]} m={wood} />
      <Box size={[w - 0.04, 0.08, 0.38]} at={[0, 0.46, 0]} m={flat("cream", 4)} />
    </group>
  );
}

/** A flat rug. */
export function Rug({ position, rotation = 0, w = 3, d = 2.2 }: Placed & { w?: number; d?: number }) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <Box size={[w, 0.015, d]} at={[0, 0.008, 0]} m={flat("tan")} shadow={false} dither />
    </group>
  );
}

/** A framed picture hanging on a wall. The wall is at -Z. */
export function Frame({ position, w = 0.45, h = 0.55, art = ["wallBlue", 1] as [PaletteKey, number] }: { position: Vec3; w?: number; h?: number; art?: [PaletteKey, number] }) {
  return (
    <group position={position}>
      <Box size={[w, h, 0.03]} at={[0, 0, 0.015]} m={flat("oak", 3)} shadow={false} />
      <Box size={[w - 0.1, h - 0.1, 0.01]} at={[0, 0, 0.032]} m={flat("white", 3)} shadow={false} />
      <Box size={[w * 0.45, h * 0.45, 0.01]} at={[0, 0, 0.038]} m={flat(art[0], art[1])} shadow={false} />
    </group>
  );
}

/** A kitchen counter run against a wall at -Z: grey cabinets with an oak top. */
export function KitchenCounter({ position, rotation = 0, w = 2.4, d = 0.62, h = 0.92 }: Placed & { w?: number; d?: number; h?: number }) {
  const doors = Math.max(1, Math.round(w / 0.6));
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <Box size={[w, h - 0.04, d - 0.04]} at={[0, (h - 0.04) / 2, (d - 0.04) / 2]} m={flat("wallBlue", 1)} />
      {Array.from({ length: doors }, (_, i) => (
        <Box key={i} size={[0.03, 0.12, 0.02]} at={[-w / 2 + (i + 0.5) * (w / doors) + 0.2, h - 0.2, d - 0.03]} m={flat("mustard")} shadow={false} />
      ))}
      <Box size={[w + 0.02, 0.04, d]} at={[0, h - 0.02, d / 2]} m={flat("oak", 3)} />
      {/* A kettle and a couple of mugs */}
      <Cyl r={0.08} r2={0.1} h={0.2} at={[-w / 2 + 0.35, h + 0.1, d / 2]} m={flat("white", 3)} />
      <Cyl r={0.04} h={0.09} at={[0.1, h + 0.045, d / 2]} m={flat("cream", 4)} />
      <Cyl r={0.04} h={0.09} at={[0.25, h + 0.045, d / 2 - 0.1]} m={flat("mustard", 2)} />
    </group>
  );
}
