import { useEffect, useRef } from "react";
import * as THREE from "three";
import { renderConfig } from "./config";
import { layout } from "../world/layout";

/**
 * A warm key light from the front-left windows plus a cool fill. The key
 * casts hard shadow-map shadows, and at low res those read as pixel-art
 * shadows.
 */
export function Lighting() {
  const key = useRef<THREE.DirectionalLight>(null);
  const { width, depth } = layout.room;

  useEffect(() => {
    const light = key.current;
    if (!light) return;
    const cam = light.shadow.camera;
    const r = Math.max(width, depth) * 0.75;
    cam.left = -r;
    cam.right = r;
    cam.top = r;
    cam.bottom = -r;
    cam.near = 0.5;
    cam.far = 60;
    cam.updateProjectionMatrix();
    light.shadow.mapSize.set(renderConfig.shadowMapSize, renderConfig.shadowMapSize);
    light.shadow.bias = -0.0005;
    light.shadow.normalBias = 0.03;
    light.target.position.set(0, 0, 0);
    light.target.updateMatrixWorld();
  }, [width, depth]);

  return (
    <>
      <hemisphereLight args={["#f6f2ea", "#9c978f", 1.5]} />
      <directionalLight
        ref={key}
        position={[-9, 16, 12]}
        intensity={1.5}
        color="#fff4e2"
        castShadow
      />
    </>
  );
}
