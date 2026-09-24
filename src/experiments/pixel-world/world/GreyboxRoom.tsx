import { useMemo } from "react";
import { layout } from "./layout";
import { CutawayWall } from "./CutawayWall";
import { flat } from "./materials";

/**
 * Phase 1 grey-box: the room shell plus a few primitive stand-ins. They're
 * here to judge outlines, shading steps, dither and quantization before any
 * real furniture exists.
 */
export function GreyboxRoom() {
  const { width, depth, height, wallThickness: t, floorThickness } =
    layout.room;
  const wallMat = flat("cream");
  const floorPixel = useMemo(() => ({ pixel: { dither: true } }), []);

  return (
    <group>
      {/* Floor slab. Its top surface sits at y = 0. */}
      <mesh
        position={[0, -floorThickness / 2, 0]}
        material={flat("concrete")}
        receiveShadow
        userData={floorPixel}
      >
        <boxGeometry args={[width + 2 * t, floorThickness, depth + 2 * t]} />
      </mesh>

      <CutawayWall
        position={[0, 0, -depth / 2 - t / 2]}
        size={[width + 2 * t, height, t]}
        normal={[0, -1]}
        material={wallMat}
      />
      <CutawayWall
        position={[0, 0, depth / 2 + t / 2]}
        size={[width + 2 * t, height, t]}
        normal={[0, 1]}
        material={wallMat}
      />
      <CutawayWall
        position={[-width / 2 - t / 2, 0, 0]}
        size={[depth, height, t]}
        normal={[-1, 0]}
        material={wallMat}
      />
      <CutawayWall
        position={[width / 2 + t / 2, 0, 0]}
        size={[depth, height, t]}
        normal={[1, 0]}
        material={wallMat}
      />

      {/* Stand-in: a desk (oak top on cobalt legs) */}
      <group position={[4.5, 0, -1]}>
        <mesh position={[0, 0.74, 0]} material={flat("oak")} castShadow receiveShadow>
          <boxGeometry args={[1.6, 0.04, 0.8]} />
        </mesh>
        {[
          [-0.75, -0.35],
          [0.75, -0.35],
          [-0.75, 0.35],
          [0.75, 0.35],
        ].map(([x, z]) => (
          <mesh key={`${x}${z}`} position={[x, 0.36, z]} material={flat("cobalt")} castShadow>
            <boxGeometry args={[0.05, 0.72, 0.05]} />
          </mesh>
        ))}
      </group>

      {/* Stand-in: a high table */}
      <group position={[-2, 0, 1.5]}>
        <mesh position={[0, 1.05, 0]} material={flat("oak")} castShadow receiveShadow>
          <boxGeometry args={[2.2, 0.06, 0.9]} />
        </mesh>
        <mesh position={[0, 0.52, 0]} material={flat("cobalt")} castShadow>
          <boxGeometry args={[0.08, 1.04, 0.6]} />
        </mesh>
      </group>

      {/* Stand-in: the mustard pipe on the back wall, with the curtain beside it */}
      <mesh position={[-3, height / 2, -depth / 2 + 0.2]} material={flat("mustard")} castShadow>
        <cylinderGeometry args={[0.12, 0.12, height, 8]} />
      </mesh>
      <mesh position={[-4.6, height / 2, -depth / 2 + 0.15]} material={flat("navy")} castShadow>
        <boxGeometry args={[2.6, height, 0.08]} />
      </mesh>

      {/* Stand-in: a plant (pot + blob) */}
      <group position={[1, 0, -3]}>
        <mesh position={[0, 0.25, 0]} material={flat("terracotta")} castShadow>
          <cylinderGeometry args={[0.28, 0.22, 0.5, 8]} />
        </mesh>
        <mesh position={[0, 1.2, 0]} material={flat("green")} castShadow>
          <icosahedronGeometry args={[0.7, 0]} />
        </mesh>
        <mesh position={[0.35, 1.7, 0.2]} material={flat("green", 4)} castShadow>
          <icosahedronGeometry args={[0.45, 0]} />
        </mesh>
      </group>

      {/* Stand-in: a mezzanine block with stairs */}
      <mesh position={[-4, 2.6, -3]} material={flat("concrete")} castShadow receiveShadow>
        <boxGeometry args={[6, 0.25, 4]} />
      </mesh>
      {Array.from({ length: 12 }, (_, i) => (
        <mesh
          key={i}
          position={[-0.6, 0.11 + i * 0.22, -3.2 + 1.8 - i * 0.25]}
          material={flat("steelGrey", 2)}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[0.9, 0.22, 0.26]} />
        </mesh>
      ))}
    </group>
  );
}
