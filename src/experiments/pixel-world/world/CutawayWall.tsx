import { useRef, type ReactNode } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { layout } from "./layout";
import { Box } from "./kit/primitives";

const _dir = new THREE.Vector3();

/**
 * Dollhouse cutaway: `full` shows while the wall's outward normal faces away
 * from the camera. When it faces the camera, `stub` shows instead, so we can
 * look into the room and the footprint still reads.
 */
export function Cutaway({ normal, full, stub }: { normal: [number, number]; full: ReactNode; stub: ReactNode }) {
  const camera = useThree((s) => s.camera);
  const fullRef = useRef<THREE.Group>(null);
  const stubRef = useRef<THREE.Group>(null);

  useFrame(() => {
    camera.getWorldDirection(_dir);
    // The camera looks along _dir, so the wall faces it when its normal opposes _dir.
    const facing = -(normal[0] * _dir.x + normal[1] * _dir.z) > 0.01;
    if (fullRef.current) fullRef.current.visible = !facing;
    if (stubRef.current) stubRef.current.visible = facing;
  });

  return (
    <>
      <group ref={fullRef}>{full}</group>
      <group ref={stubRef}>{stub}</group>
    </>
  );
}

interface CutawayWallProps {
  /** The center of the wall's footprint on the floor (y is the floor level). */
  position: [number, number, number];
  /** Length along the wall, full height, and thickness. */
  size: [number, number, number];
  /** The outward normal, in the XZ plane. */
  normal: [number, number];
  material: THREE.Material;
  /** Extra things on the wall's inner face, cut away with it (frames, doors). */
  children?: ReactNode;
}

/** A plain solid wall with the cutaway behavior. */
export function CutawayWall({ position, size, normal, material, children }: CutawayWallProps) {
  const [len, height, thick] = size;
  const stubH = layout.room.cutawayStubHeight;
  // A wall normal along X means the wall's length runs along Z.
  const rot: [number, number, number] = [0, Math.abs(normal[0]) > 0.5 ? Math.PI / 2 : 0, 0];
  return (
    <group position={position}>
      <Cutaway
        normal={normal}
        full={
          <>
            <Box size={[len, height, thick]} at={[0, height / 2, 0]} rot={rot} m={material} dither />
            {children}
          </>
        }
        stub={<Box size={[len, stubH, thick]} at={[0, stubH / 2, 0]} rot={rot} m={material} dither shadow={false} />}
      />
    </group>
  );
}
