import type { PaletteKey } from "../../palette";
import { flat, glow } from "../materials";
import { Box, Cyl, type Vec3 } from "./primitives";

// The tio.ist "yerli malı" merch wall (reference/photo-merch-wall.jpeg) and
// other wall pieces from the photos: a vintage poster board, the mirror and
// the blue "tio" sign.

interface Placed {
  position: Vec3;
  rotation?: number;
}

const BAY_A = 1.05; // totes and books
const BAY_B = 1.3; // rolled mats, tomato poster and hanging tees
const DEPTH = 0.42;
const HEIGHT = 2.5;

/** A blue steel ladder frame standing out from the wall at -Z. */
function Ladder({ x }: { x: number }) {
  const m = flat("cobalt");
  return (
    <group position={[x, 0, 0]}>
      <Box size={[0.06, HEIGHT, 0.06]} at={[0, HEIGHT / 2, 0.05]} m={m} />
      <Box size={[0.06, HEIGHT, 0.06]} at={[0, HEIGHT / 2, DEPTH]} m={m} />
      {[0.4, 1.1, 2.0, HEIGHT - 0.03].map((y) => (
        <Box key={y} size={[0.05, 0.05, DEPTH]} at={[0, y, DEPTH / 2 + 0.03]} m={m} />
      ))}
    </group>
  );
}

function Shelf({ x0, x1, y }: { x0: number; x1: number; y: number }) {
  return <Box size={[x1 - x0, 0.04, DEPTH - 0.04]} at={[(x0 + x1) / 2, y, DEPTH / 2 + 0.03]} m={flat("oak", 3)} />;
}

function Rail({ x0, x1, y, z = DEPTH / 2 + 0.03 }: { x0: number; x1: number; y: number; z?: number }) {
  return <Box size={[x1 - x0, 0.035, 0.035]} at={[(x0 + x1) / 2, y, z]} m={flat("cobalt")} />;
}

/** A woven tote bag hanging from a hook: a blue or white body with pink trim and mustard handles. */
function Tote({ x, y, body }: { x: number; y: number; body: [PaletteKey, number] }) {
  return (
    <group position={[x, y, DEPTH / 2 + 0.03]}>
      <Box size={[0.03, 0.12, 0.01]} at={[0, -0.04, 0]} m={flat("ink")} shadow={false} />
      <Box size={[0.2, 0.08, 0.02]} at={[0, -0.14, 0]} m={flat("mustard", 2)} shadow={false} />
      <Box size={[0.36, 0.36, 0.12]} at={[0, -0.36, 0]} m={flat(body[0], body[1])} />
      <Box size={[0.04, 0.34, 0.125]} at={[-0.1, -0.36, 0.002]} m={flat("pink", 1)} shadow={false} />
      <Box size={[0.04, 0.34, 0.125]} at={[0.1, -0.36, 0.002]} m={flat("pink", 1)} shadow={false} />
    </group>
  );
}

/** A t-shirt on a hanger. */
function Tee({ x, y, z, color }: { x: number; y: number; z: number; color: [PaletteKey, number] }) {
  const m = flat(color[0], color[1]);
  return (
    <group position={[x, y, z]}>
      <Box size={[0.36, 0.55, 0.03]} at={[0, -0.33, 0]} m={m} />
      <Box size={[0.52, 0.14, 0.03]} at={[0, -0.12, 0]} m={m} />
    </group>
  );
}

/** A stack of folded tees. */
function Folded({ x, y, color }: { x: number; y: number; color: [PaletteKey, number] }) {
  return <Box size={[0.3, 0.12, 0.26]} at={[x, y + 0.06, DEPTH / 2 + 0.03]} m={flat(color[0], color[1])} />;
}

/** A rolled silver picnic mat with pink straps. */
function RolledMat({ x, y, z }: { x: number; y: number; z: number }) {
  return (
    <group position={[x, y + 0.1, z]}>
      <Cyl r={0.1} h={0.55} rot={[0, 0, Math.PI / 2]} m={flat("white", 1)} />
      {[-0.15, 0.15].map((dx) => (
        <Cyl key={dx} r={0.105} h={0.04} at={[dx, 0, 0]} rot={[0, 0, Math.PI / 2]} m={flat("pink", 0)} shadow={false} />
      ))}
    </group>
  );
}

/**
 * The merch wall: blue steel ladder frames with oak shelves and hanging
 * rails. It is against a wall at -Z, runs along X, and starts at local x = 0.
 */
export function MerchWall({ position, rotation = 0 }: Placed) {
  const xa = 0;
  const xb = BAY_A;
  const xc = BAY_A + BAY_B;
  const blue: [PaletteKey, number] = ["cobalt", 3];
  const red: [PaletteKey, number] = ["red", 1];
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <Ladder x={xa} />
      <Ladder x={xb} />
      <Ladder x={xc} />

      {/* Bay A: totes on hooks, a shelf of books, a phone and a mug, and folded tees below */}
      <Rail x0={xa} x1={xb} y={2.0} />
      <Tote x={xa + 0.3} y={2.0} body={["cobalt", 3]} />
      <Tote x={xa + 0.72} y={2.0} body={["white", 3]} />
      <Shelf x0={xa} x1={xb} y={1.1} />
      <group position={[0, 1.12, DEPTH / 2 + 0.03]}>
        <Box size={[0.2, 0.12, 0.16]} at={[xa + 0.18, 0.06, 0]} m={flat("cream", 2)} />
        {[0, 1, 2, 3].map((i) => (
          <Box key={i} size={[0.04, 0.22, 0.15]} at={[xa + 0.36 + i * 0.045, 0.11, 0]} m={flat(i % 2 ? "green" : "white", i % 2 ? 2 : 3)} shadow={false} />
        ))}
        <Box size={[0.24, 0.3, 0.03]} at={[xa + 0.72, 0.15, -0.05]} m={flat("mustard", 3)} shadow={false} />
        <Cyl r={0.05} h={0.1} at={[xa + 0.62, 0.05, 0.06]} m={flat("wallBlue", 2)} shadow={false} />
      </group>
      <Shelf x0={xa} x1={xc} y={0.4} />
      <Folded x={xa + 0.22} y={0.42} color={blue} />
      <Folded x={xa + 0.58} y={0.42} color={red} />
      {/* The yellow mushroom lamp */}
      <group position={[xa + 0.9, 0.42, DEPTH / 2 + 0.03]}>
        <Cyl r={0.03} h={0.25} at={[0, 0.125, 0]} m={flat("mustard")} />
        <mesh position={[0, 0.25, 0]} material={glow("warmLight", 1)}>
          <sphereGeometry args={[0.1, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2]} />
        </mesh>
      </group>

      {/* Bay B: rolled mats up top, the tomato poster on the wall, and hanging tees */}
      <Shelf x0={xb} x1={xc + 0.3} y={2.0} />
      <RolledMat x={xb + 0.35} y={2.02} z={0.15} />
      <RolledMat x={xb + 0.92} y={2.02} z={0.15} />
      <RolledMat x={xb + 0.6} y={2.02} z={0.34} />
      <group position={[xb + BAY_B / 2, 1.55, 0.01]}>
        <Box size={[0.42, 0.56, 0.01]} at={[0, 0, 0]} m={flat("cream", 2)} shadow={false} />
        <Box size={[0.3, 0.06, 0.01]} at={[0, 0.2, 0.006]} m={flat("red", 1)} shadow={false} />
        {[
          [-0.08, 0.02],
          [0.06, 0.04],
          [-0.02, -0.1],
          [0.1, -0.08],
        ].map(([x, y]) => (
          <Box key={`${x}${y}`} size={[0.09, 0.09, 0.01]} at={[x, y, 0.008]} m={flat("red", 1)} shadow={false} />
        ))}
      </group>
      <Rail x0={xb} x1={xc + 0.3} y={1.3} />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <Tee key={i} x={xb + 0.25 + i * 0.16} y={1.3} z={DEPTH / 2 + 0.03 + (i % 2) * 0.02} color={i < 3 ? blue : red} />
      ))}
      <Folded x={xb + 0.3} y={0.42} color={red} />
      <Folded x={xb + 0.85} y={0.42} color={blue} />
    </group>
  );
}

/** A felt pinboard covered in vintage Turkish ads. The wall is at -Z. */
export function PosterBoard({ position, rotation = 0 }: Placed) {
  const papers: [number, number, number, number, PaletteKey, number][] = [
    [-0.18, 0.12, 0.2, 0.28, "tan", 2],
    [0.05, 0.16, 0.18, 0.22, "cream", 2],
    [0.2, -0.05, 0.16, 0.3, "orange", 3],
    [-0.12, -0.18, 0.2, 0.24, "mustard", 3],
    [0.04, -0.12, 0.14, 0.2, "red", 2],
  ];
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <Box size={[0.6, 0.62, 0.02]} at={[0, 0, 0.01]} m={flat("white", 1)} shadow={false} />
      {papers.map(([x, y, w, h, k, s], i) => (
        <Box key={i} size={[w, h, 0.01]} at={[x, y, 0.025 + i * 0.002]} m={flat(k, s)} shadow={false} />
      ))}
    </group>
  );
}

/** A tall wall mirror with a thin dark frame and two round stickers. The wall is at -Z. */
export function Mirror({ position, rotation = 0, w = 0.75, h = 1.7 }: Placed & { w?: number; h?: number }) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <Box size={[w + 0.04, h + 0.04, 0.02]} at={[0, h / 2 + 0.3, 0.01]} m={flat("charcoal", 2)} shadow={false} />
      <Box size={[w, h, 0.01]} at={[0, h / 2 + 0.3, 0.025]} m={glow("glass", 1)} shadow={false} />
      <Cyl r={0.07} h={0.01} at={[-0.12, h + 0.12, 0.033]} rot={[Math.PI / 2, 0, 0]} m={flat("orange", 3)} shadow={false} />
      <Cyl r={0.07} h={0.01} at={[0.1, h + 0.12, 0.033]} rot={[Math.PI / 2, 0, 0]} m={flat("charcoal", 1)} shadow={false} />
    </group>
  );
}

/** The blue outlined "tio" logo sign. The wall is at -Z. */
export function LogoSign({ position, rotation = 0, neon = false }: Placed & { neon?: boolean }) {
  // The shopfront one is neon tube, so it's unlit and bright.
  const m = neon ? glow("cobalt", 4) : flat("cobalt", 2);
  const t = 0.035;
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {/* Outline box */}
      <Box size={[0.7, t, t]} at={[0, 0.17, 0.02]} m={m} shadow={false} />
      <Box size={[0.7, t, t]} at={[0, -0.17, 0.02]} m={m} shadow={false} />
      <Box size={[t, 0.34, t]} at={[-0.35, 0, 0.02]} m={m} shadow={false} />
      <Box size={[t, 0.34, t]} at={[0.35, 0, 0.02]} m={m} shadow={false} />
      {/* t, i, o */}
      <Box size={[t, 0.26, t]} at={[-0.22, 0, 0.02]} m={m} shadow={false} />
      <Box size={[0.14, t, t]} at={[-0.22, 0.05, 0.02]} m={m} shadow={false} />
      <Box size={[t, 0.18, t]} at={[-0.05, -0.04, 0.02]} m={m} shadow={false} />
      <mesh position={[0.17, -0.03, 0.02]} material={m}>
        <torusGeometry args={[0.08, 0.018, 4, 12]} />
      </mesh>
    </group>
  );
}
