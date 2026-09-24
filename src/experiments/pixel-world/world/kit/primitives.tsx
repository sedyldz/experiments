import { useMemo } from "react";
import * as THREE from "three";
import { wire } from "../materials";

// Tiny building blocks the kit is made from. Geometry is shared per size, so
// fifty identical stool legs are one geometry.

type Vec3 = [number, number, number];

const boxCache = new Map<string, THREE.BoxGeometry>();
function boxGeo(w: number, h: number, d: number) {
  const k = `${w}|${h}|${d}`;
  let g = boxCache.get(k);
  if (!g) {
    g = new THREE.BoxGeometry(w, h, d);
    boxCache.set(k, g);
  }
  return g;
}

const cylCache = new Map<string, THREE.CylinderGeometry>();
function cylGeo(rTop: number, rBottom: number, h: number, seg: number) {
  const k = `${rTop}|${rBottom}|${h}|${seg}`;
  let g = cylCache.get(k);
  if (!g) {
    g = new THREE.CylinderGeometry(rTop, rBottom, h, seg);
    cylCache.set(k, g);
  }
  return g;
}

interface SolidProps {
  at?: Vec3;
  rot?: Vec3;
  m: THREE.Material;
  shadow?: boolean;
  dither?: boolean;
}

const DITHER = { pixel: { dither: true } };

/** An axis-aligned box. `at` is its center. */
export function Box({
  size,
  at = [0, 0, 0],
  rot,
  m,
  shadow = true,
  dither,
}: SolidProps & { size: Vec3 }) {
  return (
    <mesh
      geometry={boxGeo(...size)}
      material={m}
      position={at}
      rotation={rot}
      castShadow={shadow}
      receiveShadow
      userData={dither ? DITHER : undefined}
    />
  );
}

/** A cylinder standing on Y. `at` is its center. */
export function Cyl({
  r,
  r2,
  h,
  seg = 8,
  at = [0, 0, 0],
  rot,
  m,
  shadow = true,
}: SolidProps & { r: number; r2?: number; h: number; seg?: number }) {
  return (
    <mesh
      geometry={cylGeo(r, r2 ?? r, h, seg)}
      material={m}
      position={at}
      rotation={rot}
      castShadow={shadow}
      receiveShadow
    />
  );
}

/** A box spanning two points, for struts, rails and pipes. */
export function Bar({
  from,
  to,
  t,
  m,
  shadow = true,
}: {
  from: Vec3;
  to: Vec3;
  t: number;
  m: THREE.Material;
  shadow?: boolean;
}) {
  const { pos, quat, len } = useMemo(() => {
    const a = new THREE.Vector3(...from);
    const b = new THREE.Vector3(...to);
    const dir = b.clone().sub(a);
    const len = dir.length();
    const quat = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      dir.normalize(),
    );
    return { pos: a.add(b).multiplyScalar(0.5), quat, len };
  }, [from, to]);
  return (
    <mesh
      geometry={boxGeo(t, len, t)}
      material={m}
      position={pos}
      quaternion={quat}
      castShadow={shadow}
      receiveShadow
    />
  );
}

/** A one-pixel line through `points`, for cords and wires. */
export function Wire({ points, color }: { points: Vec3[]; color?: string }) {
  const line = useMemo(() => {
    const g = new THREE.BufferGeometry().setFromPoints(
      points.map((p) => new THREE.Vector3(...p)),
    );
    const l = new THREE.Line(g, wire(color));
    l.userData.pixel = { skipNormal: true };
    return l;
  }, [points, color]);
  return <primitive object={line} />;
}

export type { Vec3 };
