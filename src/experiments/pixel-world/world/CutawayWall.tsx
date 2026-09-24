import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { layout } from "./layout";

interface CutawayWallProps {
  /** The center of the wall's footprint on the floor (y is the floor level). */
  position: [number, number, number];
  /** Length along the wall, full height, and thickness. */
  size: [number, number, number];
  /** The outward normal, in the XZ plane. The wall is hidden when it faces the camera. */
  normal: [number, number];
  material: THREE.Material;
}

const _dir = new THREE.Vector3();

/**
 * A dollhouse wall. When its outward side faces the camera it shrinks to a
 * short stub, so we can see into the room but the footprint still reads.
 */
export function CutawayWall({
  position,
  size,
  normal,
  material,
}: CutawayWallProps) {
  const camera = useThree((s) => s.camera);
  const full = useRef<THREE.Mesh>(null);
  const stub = useRef<THREE.Mesh>(null);
  const [len, height, thick] = size;
  const stubH = layout.room.cutawayStubHeight;
  // A wall normal along X means the wall's length runs along Z.
  const rotY = Math.abs(normal[0]) > 0.5 ? Math.PI / 2 : 0;
  const pixel = useMemo(() => ({ pixel: { dither: true } }), []);

  useFrame(() => {
    camera.getWorldDirection(_dir);
    // The camera looks along _dir, so a wall faces it when its normal
    // opposes _dir.
    const facing = -(normal[0] * _dir.x + normal[1] * _dir.z) > 0.01;
    if (full.current) full.current.visible = !facing;
    if (stub.current) stub.current.visible = facing;
  });

  return (
    <group position={position} rotation={[0, rotY, 0]}>
      <mesh
        ref={full}
        position={[0, height / 2, 0]}
        material={material}
        castShadow
        receiveShadow
        userData={pixel}
      >
        <boxGeometry args={[len, height, thick]} />
      </mesh>
      <mesh
        ref={stub}
        position={[0, stubH / 2, 0]}
        material={material}
        receiveShadow
        userData={pixel}
      >
        <boxGeometry args={[len, stubH, thick]} />
      </mesh>
    </group>
  );
}
