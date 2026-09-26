import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { PaletteKey } from "../../palette";
import { flat, foliage } from "../materials";
import { FoliageBatch, rng } from "./foliage";
import { Cyl, Wire, type Vec3 } from "./primitives";

// The plant kit. Every plant is procedural and seeded: the same seed gives
// the same plant. Leaves merge per ramp (see foliage.ts).

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function FoliageMeshes({ build }: { build: (b: FoliageBatch) => void }) {
  const parts = useMemo(() => {
    const b = new FoliageBatch();
    build(b);
    return b.build();
    // The build closure only depends on the plant's seed and props, which
    // the parent memo keys on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => () => parts.forEach((p) => p.geometry.dispose()), [parts]);
  return (
    <>
      {parts.map((p) => (
        <mesh key={p.key} geometry={p.geometry} material={foliage(p.key)} castShadow receiveShadow />
      ))}
    </>
  );
}

export type PotStyle = "terracotta" | "white" | "cream" | "green" | "charcoal";

const potMaterial: Record<PotStyle, [PaletteKey, number?]> = {
  terracotta: ["terracotta"],
  white: ["white", 3],
  cream: ["cream", 2],
  green: ["green", 3],
  charcoal: ["charcoal", 1],
};

/** A tapered pot with a soil top. Its rim sits at y = h. */
export function Pot({ r = 0.2, h = 0.38, style = "terracotta" }: { r?: number; h?: number; style?: PotStyle }) {
  const [key, shade] = potMaterial[style];
  return (
    <group>
      <Cyl r={r} r2={r * 0.78} h={h} at={[0, h / 2, 0]} m={flat(key, shade)} />
      <Cyl r={r * 1.06} h={0.05} at={[0, h - 0.025, 0]} m={flat(key, shade)} />
      <Cyl r={r * 0.92} h={0.02} at={[0, h - 0.02, 0]} m={flat("oak", 0)} shadow={false} />
    </group>
  );
}

interface PlantProps {
  position: Vec3;
  seed?: number;
  scale?: number;
  pot?: PotStyle;
  rotation?: number;
}

/** A monstera trained up a moss pole, with big split leaves all the way up. */
export function Monstera({ position, seed = 1, scale = 1, pot = "cream", rotation = 0 }: PlantProps) {
  const potH = 0.5;
  return (
    <group position={position} rotation={[0, rotation, 0]} scale={scale}>
      <Pot r={0.3} h={potH} style={pot} />
      <Cyl r={0.045} h={1.5} at={[0, potH + 0.75, 0]} m={flat("oak", 1)} />
      <FoliageMeshes
        build={(b) => {
          const r = rng(seed);
          const n = 14;
          for (let i = 0; i < n; i++) {
            const h = potH + 0.1 + (i / n) * 1.5;
            const yaw = i * 2.4 + r() * 0.6;
            const reach = 0.15 + r() * 0.3;
            const base = V(Math.cos(yaw) * reach, h + 0.1, -Math.sin(yaw) * reach);
            b.stem(V(0, h - 0.15, 0), base, 0.025, 3);
            b.leaf({
              kind: "monstera",
              at: base,
              yaw,
              pitch: -0.1 + r() * 0.45 - (i < 4 ? 0.25 : 0),
              roll: (r() - 0.5) * 0.5,
              size: 0.62 + r() * 0.22 - (i > n - 3 ? 0.15 : 0),
              shade: 3 + Math.floor(r() * 3),
              fold: 0.25,
            });
          }
        }}
      />
    </group>
  );
}

/** A schefflera (umbrella tree): thin bare stems topped with radiating leaflet clusters. */
export function Schefflera({ position, seed = 2, scale = 1, pot = "green", rotation = 0 }: PlantProps) {
  const potH = 0.42;
  return (
    <group position={position} rotation={[0, rotation, 0]} scale={scale}>
      <Pot r={0.24} h={potH} style={pot} />
      <FoliageMeshes
        build={(b) => {
          const r = rng(seed);
          const stems = 3;
          for (let s = 0; s < stems; s++) {
            const lean = (r() - 0.5) * 0.35;
            const dir = r() * Math.PI * 2;
            const top = V(Math.cos(dir) * lean, potH + 1.3 + r() * 0.8, Math.sin(dir) * lean);
            const bottom = V(0, potH, 0);
            b.stem(bottom, top, 0.035, 1, "oak");
            // Umbrella clusters along the upper part of each stem.
            const clusters = 3;
            for (let c = 0; c < clusters; c++) {
              const f = 0.55 + (c / clusters) * 0.45 + r() * 0.05;
              const node = bottom.clone().lerp(top, f);
              const out = V(Math.cos(r() * 6.28) * 0.18, 0.08, Math.sin(r() * 6.28) * 0.18);
              const hub = node.clone().add(out);
              b.stem(node, hub, 0.02, 2);
              const leaflets = 7;
              const spin = r() * 6.28;
              for (let l = 0; l < leaflets; l++) {
                b.leaf({
                  kind: "oval",
                  at: hub,
                  yaw: spin + (l / leaflets) * Math.PI * 2,
                  pitch: -0.35 + r() * 0.25,
                  size: 0.26 + r() * 0.08,
                  shade: 3 + Math.floor(r() * 3),
                  fold: 0.4,
                });
              }
            }
          }
        }}
      />
    </group>
  );
}

/** A small bushy tree (ficus-like). Sits on tables and shelves. */
export function SmallTree({ position, seed = 3, scale = 1, pot = "terracotta", rotation = 0 }: PlantProps) {
  const potH = 0.24;
  return (
    <group position={position} rotation={[0, rotation, 0]} scale={scale}>
      <Pot r={0.15} h={potH} style={pot} />
      <FoliageMeshes
        build={(b) => {
          const r = rng(seed);
          const top = V(0.05, potH + 0.45, 0);
          b.stem(V(0, potH, 0), top, 0.035, 1, "oak");
          for (let c = 0; c < 5; c++) {
            const a = (c / 5) * 6.28 + r();
            const hub = top.clone().add(V(Math.cos(a) * 0.2, 0.05 + r() * 0.25, Math.sin(a) * 0.2));
            b.stem(top, hub, 0.02, 1, "oak");
            for (let l = 0; l < 6; l++) {
              b.leaf({
                kind: "oval",
                at: hub,
                yaw: r() * 6.28,
                pitch: -0.3 + r() * 0.7,
                size: 0.18 + r() * 0.06,
                shade: 2 + Math.floor(r() * 4),
              });
            }
          }
        }}
      />
    </group>
  );
}

/** Radiating strap leaves (palm, bird of paradise). `upright` makes them tall and stiff. */
export function Palm({ position, seed = 4, scale = 1, pot = "terracotta", rotation = 0, upright = false }: PlantProps & { upright?: boolean }) {
  const potH = 0.26;
  return (
    <group position={position} rotation={[0, rotation, 0]} scale={scale}>
      <Pot r={0.14} h={potH} style={pot} />
      <FoliageMeshes
        build={(b) => {
          const r = rng(seed);
          const n = upright ? 6 : 12;
          for (let i = 0; i < n; i++) {
            const base = V(0, potH, 0);
            const pitch = upright ? 1.1 + r() * 0.35 : 0.35 + r() * 0.7;
            b.leaf({
              kind: upright ? "lance" : "oval",
              at: base,
              yaw: (i / n) * 6.28 + r() * 0.4,
              pitch,
              roll: (r() - 0.5) * 0.4,
              size: upright ? 0.65 + r() * 0.35 : 0.42 + r() * 0.15,
              shade: 2 + Math.floor(r() * 4),
              fold: upright ? 0.2 : 0.5,
            });
          }
        }}
      />
    </group>
  );
}

/**
 * Trailing vines (pothos, tradescantia) hanging from a point: strands of
 * alternating heart leaves falling under gravity. Used for hanging baskets
 * and for shelf plants spilling over the edge.
 */
export function Trailing({
  seed = 5,
  strands = 5,
  length = 1.1,
  spread = 0.18,
  color = "green",
  shades = [3, 4, 5],
}: {
  seed?: number;
  strands?: number;
  length?: number;
  spread?: number;
  color?: PaletteKey;
  shades?: number[];
}) {
  return (
    <FoliageMeshes
      build={(b) => {
        const r = rng(seed);
        // A crown of leaves on top, then strands falling down.
        for (let i = 0; i < 8; i++) {
          b.leaf({ kind: "heart", at: V(0, 0.02, 0), yaw: r() * 6.28, pitch: 0.1 + r() * 0.5, size: 0.13, shade: shades[i % shades.length] }, color);
        }
        for (let s = 0; s < strands; s++) {
          const a = (s / strands) * 6.28 + r();
          const out = spread * (0.6 + r() * 0.6);
          const len = length * (0.45 + r() * 0.55);
          const steps = Math.max(3, Math.round(len / 0.09));
          let prev = V(0, 0, 0);
          for (let k = 1; k <= steps; k++) {
            const f = k / steps;
            const p = V(Math.cos(a) * out * Math.min(1, f * 3) + (r() - 0.5) * 0.04, -f * len, Math.sin(a) * out * Math.min(1, f * 3) + (r() - 0.5) * 0.04);
            b.stem(prev, p, 0.012, 2, color);
            b.leaf(
              {
                kind: "heart",
                at: p,
                yaw: a + (k % 2 ? 1.3 : -1.3) + (r() - 0.5),
                pitch: -0.5 - r() * 0.5,
                size: 0.1 + r() * 0.04,
                shade: shades[Math.floor(r() * shades.length)],
                fold: 0.3,
              },
              color,
            );
            prev = p;
          }
        }
      }}
    />
  );
}

/** A hanging basket on a cord, with trailing pothos. `drop` is the cord length below the anchor. */
export function HangingPothos({ position, seed = 6, drop = 0.5, length = 1.2, color = "green", pot = "white" }: { position: Vec3; seed?: number; drop?: number; length?: number; color?: PaletteKey; pot?: PotStyle }) {
  const shades = color === "purple" ? [0, 1, 2] : [3, 4, 5];
  return (
    <group position={position}>
      <Wire points={[[0, 0, 0], [0, -drop, 0]]} />
      <group position={[0, -drop - 0.18, 0]}>
        <Pot r={0.15} h={0.18} style={pot} />
        <group position={[0, 0.18, 0]}>
          <Trailing seed={seed} length={length} strands={6} spread={0.16} color={color} shades={shades} />
        </group>
      </group>
    </group>
  );
}

/** A small pot of trailing plant for shelves. */
export function ShelfTrailer({ position, seed = 7, length = 0.8, color = "green", pot = "white" }: { position: Vec3; seed?: number; length?: number; color?: PaletteKey; pot?: PotStyle }) {
  const shades = color === "purple" ? [0, 1, 2] : [3, 4, 5];
  return (
    <group position={position}>
      <Pot r={0.1} h={0.16} style={pot} />
      <group position={[0, 0.16, 0]}>
        <Trailing seed={seed} length={length} strands={4} spread={0.14} color={color} shades={shades} />
      </group>
    </group>
  );
}

/** A rubber plant (ficus elastica): a bare woody stem with big glossy dark ovals. */
export function RubberPlant({ position, seed = 8, scale = 1, pot = "cream", rotation = 0 }: PlantProps) {
  const potH = 0.34;
  return (
    <group position={position} rotation={[0, rotation, 0]} scale={scale}>
      <Pot r={0.2} h={potH} style={pot} />
      <FoliageMeshes
        build={(b) => {
          const r = rng(seed);
          const top = V(0.05, potH + 1.3, 0.02);
          b.stem(V(0, potH, 0), top, 0.03, 1, "oak");
          for (let i = 0; i < 12; i++) {
            const f = 0.25 + (i / 12) * 0.75;
            const at = V(0, potH, 0).lerp(top, f);
            b.leaf({ kind: "broad", at, yaw: i * 2.3 + r() * 0.5, pitch: -0.25 + r() * 0.5, size: 0.3 + r() * 0.08, shade: 1 + Math.floor(r() * 3), fold: 0.15 });
          }
        }}
      />
    </group>
  );
}

/** A climbing monstera adansonii trained up a bamboo stake, with small holey leaves. */
export function Climber({ position, seed = 10, scale = 1, pot = "cream", rotation = 0, height = 1.6 }: PlantProps & { height?: number }) {
  const potH = 0.34;
  return (
    <group position={position} rotation={[0, rotation, 0]} scale={scale}>
      <Pot r={0.18} h={potH} style={pot} />
      <Cyl r={0.012} h={height} at={[0, potH + height / 2, 0]} m={flat("tan", 2)} />
      <FoliageMeshes
        build={(b) => {
          const r = rng(seed);
          let prev = V(0, potH, 0);
          const n = 16;
          for (let i = 1; i <= n; i++) {
            const y = potH + (i / n) * height;
            const p = V(Math.sin(i * 1.3) * 0.08, y, Math.cos(i * 1.3) * 0.08);
            b.stem(prev, p, 0.012, 2);
            b.leaf({ kind: "monstera", at: p, yaw: i * 2.1 + r(), pitch: -0.3 + r() * 0.5, size: 0.14 + r() * 0.06, shade: 3 + Math.floor(r() * 3), fold: 0.2 });
            prev = p;
          }
        }}
      />
    </group>
  );
}

/** A cane begonia: bare zigzag canes with a few red-backed leaves. */
export function BranchPlant({ position, seed = 12, scale = 1, pot = "cream", rotation = 0 }: PlantProps) {
  const potH = 0.34;
  return (
    <group position={position} rotation={[0, rotation, 0]} scale={scale}>
      <Pot r={0.2} h={potH} style={pot} />
      <FoliageMeshes
        build={(b) => {
          const r = rng(seed);
          for (let c = 0; c < 5; c++) {
            let p = V(0, potH, 0);
            const a = r() * 6.28;
            for (let k = 0; k < 5; k++) {
              const q = p.clone().add(V(Math.cos(a + (k % 2 ? 0.8 : -0.8)) * 0.18, 0.25 + r() * 0.1, Math.sin(a + (k % 2 ? 0.8 : -0.8)) * 0.18));
              b.stem(p, q, 0.02, 0, "oak");
              p = q;
            }
            b.leaf({ kind: "heart", at: p, yaw: a, pitch: -0.2, size: 0.2, shade: 1 }, "terracotta");
            b.leaf({ kind: "heart", at: p, yaw: a + 2, pitch: 0.1, size: 0.18, shade: 0 }, "terracotta");
          }
        }}
      />
    </group>
  );
}
