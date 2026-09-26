import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { PaletteKey } from "../../palette";
import { flat, foliage, glow } from "../materials";
import { FoliageBatch, rng } from "./foliage";
import { Box, Cyl, type Vec3 } from "./primitives";

// The coffee corner by the spiral stair (reference/photo-spiral-stair.jpeg):
// a white-tiled counter with pink lettering, a mini fridge
// with yellow bins in its cubby, thermoses, a cake dome, and the bits
// around it.

// At about 20 px/m a 15 cm tile is 3 pixels, too small for the blue grout
// grid to survive the low-res pass (it breaks into moiré). So the tiled
// body renders as clean white tile.
function TiledBox({ size, at }: { size: Vec3; at: Vec3 }) {
  return <Box size={size} at={at} m={flat("white", 3)} />;
}

function Eucalyptus({ seed = 9 }: { seed?: number }) {
  const parts = useMemo(() => {
    const b = new FoliageBatch();
    const r = rng(seed);
    for (let s = 0; s < 5; s++) {
      const a = r() * 6.28;
      const top = new THREE.Vector3(Math.cos(a) * 0.12, 0.35 + r() * 0.2, Math.sin(a) * 0.12);
      b.stem(new THREE.Vector3(0, 0, 0), top, 0.012, 3);
      for (let l = 0; l < 6; l++) {
        const p = new THREE.Vector3(0, 0, 0).lerp(top, 0.35 + l * 0.12);
        b.leaf({ kind: "oval", at: p, yaw: r() * 6.28, pitch: -0.2 + r() * 0.6, size: 0.09, shade: 4 + Math.floor(r() * 3) });
      }
    }
    return b.build();
  }, [seed]);
  useEffect(() => () => parts.forEach((p) => p.geometry.dispose()), [parts]);
  return (
    <>
      {parts.map((p) => (
        <mesh key={p.key} geometry={p.geometry} material={foliage(p.key)} castShadow />
      ))}
    </>
  );
}

/**
 * The tiled coffee counter. Its front (with the lettering) faces +Z. The
 * left part is solid tile, and the right part is an open cubby holding a
 * mini fridge with yellow bins on top.
 */
export function CoffeeStation({ position, rotation = 0 }: { position: Vec3; rotation?: number }) {
  const W = 1.1;
  const H = 0.95;
  const D = 0.6;
  const solid = 0.6;
  const cubby = W - solid;
  const x0 = -W / 2;
  const pink = flat("pink");
  // "HAVE A COFFEE / AND / IMAGINE AN INSPIRING / QUOTE / RIGHT HERE" as
  // pink lines of lettering.
  const lines = [0.36, 0.14, 0.46, 0.2, 0.3];
  const lineH = 0.05; // one low-res pixel
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <TiledBox size={[solid, H - 0.06, D]} at={[x0 + solid / 2, (H - 0.06) / 2, 0]} />
      <TiledBox size={[W, 0.06, D]} at={[0, H - 0.03, 0]} />
      <TiledBox size={[0.04, H - 0.06, D]} at={[W / 2 - 0.02, (H - 0.06) / 2, 0]} />
      {lines.map((w, i) => (
        <Box key={i} size={[w, lineH, 0.005]} at={[x0 + solid / 2, 0.74 - i * 0.13, D / 2 + 0.003]} m={pink} shadow={false} />
      ))}
      {/* The mini fridge + yellow bins in the cubby */}
      <group position={[x0 + solid + cubby / 2 - 0.02, 0, 0]}>
        <Box size={[cubby - 0.1, 0.62, D - 0.1]} at={[0, 0.31, 0]} m={flat("white", 3)} />
        <Box size={[cubby - 0.12, 0.012, 0.01]} at={[0, 0.5, D / 2 - 0.045]} m={flat("white", 1)} shadow={false} />
        <Box size={[(cubby - 0.12) / 2, 0.14, D - 0.15]} at={[-(cubby - 0.12) / 4, 0.7, 0]} m={flat("mustard", 2)} />
        <Box size={[(cubby - 0.12) / 2, 0.14, D - 0.15]} at={[(cubby - 0.12) / 4, 0.7, 0]} m={flat("mustard", 3)} />
      </group>
      {/* On top: two thermoses, a cake dome, fruit, cutlery and a vase of eucalyptus */}
      <group position={[0, H, 0]}>
        <Cyl r={0.06} h={0.3} at={[-0.2, 0.15, 0.05]} m={flat("charcoal", 1)} />
        <Cyl r={0.06} h={0.3} at={[-0.05, 0.15, 0.08]} m={flat("charcoal", 1)} />
        <Cyl r={0.12} h={0.02} at={[0.15, 0.01, 0.05]} m={flat("oak", 1)} shadow={false} />
        <mesh position={[0.15, 0.02, 0.05]} material={glow("glass", 2)}>
          <sphereGeometry args={[0.11, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2]} />
        </mesh>
        <Cyl r={0.08} h={0.04} at={[0.35, 0.02, -0.1]} m={flat("cobalt", 1)} shadow={false} />
        <mesh position={[0.34, 0.06, -0.1]} material={flat("red", 1)}>
          <sphereGeometry args={[0.035, 6, 4]} />
        </mesh>
        <Box size={[0.08, 0.14, 0.08]} at={[-0.42, 0.07, -0.15]} m={flat("oak", 3)} />
        <group position={[-0.42, 0, 0.1]}>
          <Cyl r={0.045} h={0.2} at={[0, 0.1, 0]} m={glow("glass", 1)} shadow={false} />
          <group position={[0, 0.18, 0]}>
            <Eucalyptus />
          </group>
        </group>
      </group>
    </group>
  );
}

/** A white bin with a yellow liner folded over the rim. */
export function TrashBin({ position }: { position: Vec3 }) {
  return (
    <group position={position}>
      <Cyl r={0.15} r2={0.12} h={0.36} at={[0, 0.18, 0]} m={flat("white", 3)} />
      <Cyl r={0.155} h={0.06} at={[0, 0.36, 0]} m={flat("mustard", 3)} />
    </group>
  );
}

/** A wall-mounted fire extinguisher. */
export function FireExtinguisher({ position }: { position: Vec3 }) {
  return (
    <group position={position}>
      <Cyl r={0.08} h={0.5} at={[0, 0.25, 0]} m={flat("red")} />
      <Cyl r={0.03} h={0.08} at={[0, 0.54, 0]} m={flat("charcoal")} />
    </group>
  );
}

/** A flat plate on the floor, like the yellow checker plate at the duct's base. */
export function FloorPlate({ position, w, d, color = "mustard" }: { position: Vec3; w: number; d: number; color?: PaletteKey }) {
  return <Box size={[w, 0.02, d]} at={[position[0], position[1] + 0.01, position[2]]} m={flat(color)} shadow={false} />;
}

/**
 * A finish panel on a wall at -Z: the rough grey render or a patch of white
 * plaster. `at` is the bottom center of the panel.
 */
export function WallPanel({ position, w, h, color = "render", shade }: { position: Vec3; w: number; h: number; color?: PaletteKey; shade?: number }) {
  return (
    <group position={position}>
      <mesh position={[0, h / 2, 0.012]} material={flat(color, shade)} receiveShadow userData={{ pixel: { dither: true } }}>
        <boxGeometry args={[w, h, 0.02]} />
      </mesh>
    </group>
  );
}

/** A small bright window set in a wall at -Z, with a white frame. */
export function WallWindow({ position, w = 0.45, h = 0.7 }: { position: Vec3; w?: number; h?: number }) {
  return (
    <group position={position}>
      <Box size={[w + 0.08, h + 0.08, 0.03]} at={[0, 0, 0.02]} m={flat("white", 3)} shadow={false} />
      <Box size={[w, h, 0.02]} at={[0, 0, 0.03]} m={glow("glass", 2)} shadow={false} />
      <Box size={[0.03, h, 0.025]} at={[0, 0, 0.04]} m={flat("white", 3)} shadow={false} />
    </group>
  );
}

/** The white fuse box on the wall above the coffee counter. */
export function FuseBox({ position }: { position: Vec3 }) {
  return (
    <group position={position}>
      <Box size={[0.36, 0.42, 0.08]} at={[0, 0, 0.04]} m={flat("white", 3)} shadow={false} />
      <Box size={[0.26, 0.3, 0.01]} at={[0, 0, 0.085]} m={flat("charcoal", 1)} shadow={false} />
    </group>
  );
}
