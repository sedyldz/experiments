import type { PaletteKey } from "../../palette";
import { flat } from "../materials";
import { Cutaway } from "../CutawayWall";
import { Box, Cyl, type Vec3 } from "./primitives";

// The kitchen on the mezzanine (reference/photo-kitchen-upstairs.jpeg):
// a pine run with a white-tiled top and backsplash, a mug shelf, a yellow
// coffee maker and a dishwasher; a pine island with a tiled top and a lower
// shelf of yellow tubs; round navy metal stools; and a kilim runner.

interface Placed {
  position: Vec3;
  rotation?: number;
}

/**
 * The kitchen counter run, against a wall at -Z and running along X. It
 * ends in a white dishwasher at +X.
 */
export function KitchenRun({ position, rotation = 0, w = 2.4, d = 0.6, h = 0.9, fridge = false }: Placed & { w?: number; d?: number; h?: number; fridge?: boolean }) {
  const cab = w - 0.6; // pine cabinets, then the 0.6 m dishwasher
  const x0 = -w / 2;
  const doorSeams = Math.max(1, Math.round(cab / 0.6));
  const mugs: [PaletteKey, number][] = [
    ["orange", 2],
    ["mustard", 2],
    ["mustard", 3],
    ["cobalt", 3],
    ["cobalt", 1],
    ["red", 1],
  ];
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {/* Pine cabinets with plank doors */}
      <Box size={[cab, h - 0.05, d - 0.05]} at={[x0 + cab / 2, (h - 0.05) / 2, (d - 0.05) / 2]} m={flat("pine")} />
      {Array.from({ length: doorSeams }, (_, i) => (
        <Box key={i} size={[0.02, h - 0.2, 0.01]} at={[x0 + ((i + 1) * cab) / (doorSeams + 1), (h - 0.05) / 2, d - 0.045]} m={flat("pine", 1)} shadow={false} />
      ))}
      {/* Dishwasher */}
      <Box size={[0.58, h - 0.05, d - 0.05]} at={[x0 + cab + 0.3, (h - 0.05) / 2, (d - 0.05) / 2]} m={flat("white", 3)} />
      <Box size={[0.5, 0.05, 0.01]} at={[x0 + cab + 0.3, h - 0.14, d - 0.045]} m={flat("charcoal", 2)} shadow={false} />
      {/* The white-tiled worktop and backsplash */}
      <Box size={[w, 0.05, d]} at={[0, h - 0.025, d / 2]} m={flat("white", 3)} />
      <Box size={[w, 0.6, 0.02]} at={[0, h + 0.3, 0.01]} m={flat("white", 2)} shadow={false} />
      {/* The sink, the tap and a yellow coffee maker */}
      <Box size={[0.4, 0.01, 0.35]} at={[x0 + cab - 0.35, h + 0.006, d / 2]} m={flat("white", 1)} shadow={false} />
      <Box size={[0.03, 0.25, 0.03]} at={[x0 + cab - 0.35, h + 0.125, 0.1]} m={flat("white", 1)} />
      <Box size={[0.18, 0.3, 0.2]} at={[x0 + 0.55, h + 0.15, 0.2]} m={flat("mustard")} />
      <Box size={[0.16, 0.26, 0.18]} at={[x0 + 0.3, h + 0.13, 0.18]} m={flat("charcoal", 1)} />
      {/* The pine shelf of colorful mugs and glasses */}
      <group position={[x0 + cab / 2 + 0.3, h + 0.8, 0]}>
        <Box size={[cab, 0.035, 0.22]} at={[0, 0, 0.11]} m={flat("pine", 3)} />
        {mugs.map(([k, s], i) => (
          <Cyl key={i} r={0.04} h={0.09} at={[-cab / 2 + 0.12 + i * 0.13, 0.062, 0.11]} m={flat(k, s)} shadow={false} />
        ))}
        {[0, 1, 2].map((i) => (
          <Cyl key={i} r={0.035} h={0.1} at={[cab / 2 - 0.12 - i * 0.1, 0.067, 0.11]} m={flat("glass", 2)} shadow={false} />
        ))}
      </group>
      {/* The tall white fridge past the end of the run, and a gas hob */}
      {fridge && <Box size={[0.6, 1.75, d]} at={[w / 2 + 0.3, 0.875, d / 2]} m={flat("white", 3)} />}
      <Box size={[0.45, 0.03, 0.4]} at={[x0 + cab + 0.3, h + 0.015, d / 2]} m={flat("charcoal", 0)} shadow={false} />
      {/* A rail with hanging utensils and a blue towel */}
      <Box size={[0.5, 0.02, 0.02]} at={[x0 + cab - 0.5, h + 0.62, 0.04]} m={flat("pine", 3)} shadow={false} />
      <Box size={[0.12, 0.3, 0.02]} at={[x0 + 0.95, h + 0.45, 0.04]} m={flat("cobalt", 3)} shadow={false} />
    </group>
  );
}

/** The pine kitchen island: a tiled top on square legs with a lower shelf of yellow tubs. */
export function KitchenIsland({ position, rotation = 0, w = 1.3, d = 0.7, h = 0.95 }: Placed & { w?: number; d?: number; h?: number }) {
  const pine = flat("pine");
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {[
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ].map(([sx, sz]) => (
        <Box key={`${sx}${sz}`} size={[0.07, h - 0.05, 0.07]} at={[(sx * (w - 0.1)) / 2, (h - 0.05) / 2, (sz * (d - 0.1)) / 2]} m={pine} />
      ))}
      <Box size={[w, 0.06, d]} at={[0, h - 0.03, 0]} m={pine} />
      <Box size={[w - 0.12, 0.01, d - 0.12]} at={[0, h + 0.004, 0]} m={flat("white", 3)} shadow={false} />
      <Box size={[w - 0.05, 0.08, d - 0.05]} at={[0, h - 0.1, 0]} m={flat("pine", 1)} />
      <Box size={[w - 0.08, 0.035, d - 0.08]} at={[0, 0.25, 0]} m={flat("pine", 3)} />
      <Box size={[0.36, 0.14, 0.26]} at={[-0.15, 0.34, 0]} m={flat("mustard", 3)} />
      <Box size={[0.36, 0.14, 0.26]} at={[0.22, 0.34, 0.05]} m={flat("mustard", 2)} />
      {/* Cuttings in glass jars and a sweets tray */}
      {[-0.45, -0.3].map((x) => (
        <Cyl key={x} r={0.05} h={0.18} at={[x, h + 0.09, -0.15]} m={flat("glass", 1)} shadow={false} />
      ))}
      <Box size={[0.2, 0.25, 0.02]} at={[-0.38, h + 0.3, -0.15]} m={flat("green", 4)} shadow={false} />
      <Box size={[0.28, 0.03, 0.16]} at={[0.1, h + 0.02, 0.05]} m={flat("wallBlue", 2)} shadow={false} />
    </group>
  );
}

/** A round navy metal stool with a foot ring. */
export function MetalStool({ position, h = 0.65 }: Placed & { h?: number }) {
  const m = flat("navy", 1);
  return (
    <group position={position}>
      <Cyl r={0.17} h={0.04} at={[0, h - 0.02, 0]} m={m} seg={10} />
      {[0, 1, 2, 3].map((i) => {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        return <Box key={i} size={[0.03, h - 0.04, 0.03]} at={[Math.cos(a) * 0.14, (h - 0.04) / 2, Math.sin(a) * 0.14]} rot={[Math.sin(a) * 0.08, 0, -Math.cos(a) * 0.08]} m={m} />;
      })}
      <mesh position={[0, 0.25, 0]} rotation={[Math.PI / 2, 0, 0]} material={m} castShadow>
        <torusGeometry args={[0.15, 0.015, 4, 12]} />
      </mesh>
    </group>
  );
}

/** A striped kilim runner in reds, oranges and mustard. It runs along X. */
export function Kilim({ position, rotation = 0, w = 2.4, d = 0.9 }: Placed & { w?: number; d?: number }) {
  const bands: [PaletteKey, number][] = [
    ["terracotta", 1],
    ["orange", 2],
    ["mustard", 2],
    ["orange", 2],
    ["terracotta", 1],
  ];
  const bandD = d / bands.length;
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {bands.map(([k, s], i) => (
        <Box key={i} size={[w, 0.012, bandD]} at={[0, 0.006, -d / 2 + bandD * (i + 0.5)]} m={flat(k, s)} shadow={false} />
      ))}
      {/* Diamond motifs down the middle */}
      {Array.from({ length: Math.floor(w / 0.35) }, (_, i) => (
        <Box key={i} size={[0.12, 0.014, 0.12]} at={[-w / 2 + 0.2 + i * 0.35, 0.008, 0]} rot={[0, Math.PI / 4, 0]} m={flat("cream", 3)} shadow={false} />
      ))}
    </group>
  );
}

/**
 * A plain partition wall from `from` to `to` (x, z on the floor at height
 * `y`). An optional doorway `door` sits `at` meters along it, with a closed
 * door leaf. Used for the upstairs toilet block.
 */
export function Partition({ from, to, y = 0, height = 2.3, t = 0.1, door, cutaway }: { from: [number, number]; to: [number, number]; y?: number; height?: number; t?: number; door?: { at: number; w: number; color?: PaletteKey }; cutaway?: [number, number] }) {
  const [x0, z0] = from;
  const [x1, z1] = to;
  const len = Math.hypot(x1 - x0, z1 - z0);
  const yaw = -Math.atan2(z1 - z0, x1 - x0);
  const wall = flat("cream", 4);
  const segs: [number, number][] = door
    ? [
        [0, door.at - door.w / 2],
        [door.at + door.w / 2, len],
      ]
    : [[0, len]];
  const body = (
    <group position={[x0, y, z0]} rotation={[0, yaw, 0]}>
      {segs
        .filter(([a, b]) => b - a > 0.01)
        .map(([a, b]) => (
          <mesh key={a} position={[(a + b) / 2, height / 2, 0]} material={wall} castShadow receiveShadow userData={{ pixel: { dither: true } }}>
            <boxGeometry args={[b - a, height, t]} />
          </mesh>
        ))}
      {door && (
        <>
          {/* Header over the doorway, then the closed door leaf */}
          <Box size={[door.w, height - 2.05, t]} at={[door.at, 2.05 + (height - 2.05) / 2, 0]} m={wall} />
          <Box size={[door.w - 0.06, 2.0, 0.04]} at={[door.at, 1.0, 0]} m={door.color ? flat(door.color) : flat("white", 2)} />
          <Box size={[0.08, 0.03, 0.1]} at={[door.at + door.w / 2 - 0.12, 1.0, 0]} m={flat("charcoal", 1)} shadow={false} />
        </>
      )}
    </group>
  );
  if (!cutaway) return body;
  // Dollhouse cutaway: when the wall faces the camera it drops to a low
  // strip, so the room behind it can be seen.
  return (
    <Cutaway
      normal={cutaway}
      full={body}
      stub={
        <group position={[x0, y, z0]} rotation={[0, yaw, 0]}>
          <Box size={[len, 0.25, t]} at={[len / 2, 0.125, 0]} m={wall} shadow={false} />
        </group>
      }
    />
  );
}

/** A toilet, with its back against a wall at -Z. */
export function Toilet({ position, rotation = 0 }: Placed) {
  const m = flat("white", 3);
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <Box size={[0.38, 0.38, 0.16]} at={[0, 0.62, 0.1]} m={m} />
      <Cyl r={0.19} r2={0.15} h={0.4} at={[0, 0.2, 0.4]} m={m} seg={10} />
      <Cyl r={0.2} h={0.03} at={[0, 0.415, 0.4]} m={flat("white", 2)} seg={10} shadow={false} />
    </group>
  );
}

/** A small wall-hung basin with a mirror above it, on a wall at -Z. */
export function Basin({ position, rotation = 0 }: Placed) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <Box size={[0.45, 0.14, 0.36]} at={[0, 0.8, 0.18]} m={flat("white", 3)} />
      <Box size={[0.03, 0.14, 0.03]} at={[0, 0.94, 0.05]} m={flat("white", 1)} shadow={false} />
      <Box size={[0.4, 0.55, 0.02]} at={[0, 1.4, 0.01]} m={flat("glass", 1)} shadow={false} />
    </group>
  );
}

/** A small "WC" plate: a navy square with a white mark. The wall is at -Z. */
export function WcSign({ position, rotation = 0 }: Placed) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <Box size={[0.22, 0.22, 0.02]} at={[0, 0, 0.01]} m={flat("navy", 1)} shadow={false} />
      <Box size={[0.12, 0.04, 0.01]} at={[0, 0, 0.022]} m={flat("white", 3)} shadow={false} />
    </group>
  );
}

/** A cane-backed wooden armchair with a grey seat. It faces +Z. */
export function ArmChair({ position, rotation = 0 }: Placed) {
  const wood = flat("oak", 1);
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {[
        [-0.25, -0.22],
        [0.25, -0.22],
        [-0.25, 0.22],
        [0.25, 0.22],
      ].map(([x, z]) => (
        <Box key={`${x}${z}`} size={[0.05, 0.42, 0.05]} at={[x, 0.21, z]} m={wood} />
      ))}
      <Box size={[0.58, 0.1, 0.52]} at={[0, 0.45, 0.02]} m={flat("white", 1)} />
      <Box size={[0.54, 0.55, 0.05]} at={[0, 0.8, -0.24]} m={flat("tan", 1)} />
      {[-0.28, 0.28].map((x) => (
        <Box key={x} size={[0.05, 0.05, 0.5]} at={[x, 0.66, 0]} m={wood} />
      ))}
    </group>
  );
}

/** A three-seat sofa. It faces +Z. */
export function Sofa({ position, rotation = 0, w = 1.9, color = "navy" as PaletteKey, shade = 3 }: Placed & { w?: number; color?: PaletteKey; shade?: number }) {
  const m = flat(color, shade);
  const d = 0.85;
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <Box size={[w, 0.25, d]} at={[0, 0.2, 0]} m={m} />
      {[-1, 0, 1].map((i) => (
        <Box key={i} size={[w / 3 - 0.06, 0.12, d - 0.25]} at={[(i * (w - 0.3)) / 3, 0.38, 0.08]} m={m} />
      ))}
      <Box size={[w, 0.45, 0.2]} at={[0, 0.55, -d / 2 + 0.1]} m={m} />
      {[-1, 1].map((sx) => (
        <Box key={sx} size={[0.16, 0.5, d]} at={[(sx * (w - 0.16)) / 2, 0.3, 0]} m={m} />
      ))}
      {[-1, 1].map((sx) => (
        <Box key={sx} size={[0.05, 0.08, 0.05]} at={[(sx * (w - 0.2)) / 2, 0.04, 0.3]} m={flat("oak", 1)} shadow={false} />
      ))}
    </group>
  );
}
