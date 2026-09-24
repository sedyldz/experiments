import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { ISO_PITCH, renderConfig } from "./config";
import { useViewStore } from "../ui/viewStore";

/** The camera yaw for a quarter-turn count. Step 0 looks from the +X/+Z corner. */
export const yawForStep = (step: number) => Math.PI / 4 + (step * Math.PI) / 2;

const easeInOut = (t: number) =>
  t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

/**
 * Drives R3F's default camera as the true isometric view camera. It is
 * unsnapped and its frustum matches the canvas exactly, so pointer events and
 * raycasts line up with what is on screen. PixelPipeline derives its own
 * pixel-snapped render camera from it.
 */
export function IsoCameraRig() {
  const camera = useThree((s) => s.camera) as THREE.OrthographicCamera;
  const size = useThree((s) => s.size);
  const initPixelScale = useViewStore((s) => s.initPixelScale);

  const yaw = useRef(yawForStep(useViewStore.getState().rotationStep));
  const tween = useRef<{ from: number; to: number; t0: number } | null>(null);

  useEffect(() => initPixelScale(size.height), [initPixelScale, size.height]);

  useEffect(
    () =>
      useViewStore.subscribe((s, prev) => {
        if (s.rotationStep === prev.rotationStep) return;
        tween.current = {
          from: yaw.current,
          to: yawForStep(s.rotationStep),
          t0: performance.now(),
        };
      }),
    [],
  );

  useFrame(() => {
    const { pixelScale, target } = useViewStore.getState();
    if (pixelScale === null) return;

    const tw = tween.current;
    if (tw) {
      const t = Math.min(
        1,
        (performance.now() - tw.t0) / 1000 / renderConfig.rotateDuration,
      );
      yaw.current = tw.from + (tw.to - tw.from) * easeInOut(t);
      if (t >= 1) tween.current = null;
    }

    const d = renderConfig.cameraDistance;
    const cp = Math.cos(ISO_PITCH);
    const fy = renderConfig.focusHeight;
    camera.position.set(
      target.x + Math.sin(yaw.current) * cp * d,
      fy + Math.sin(ISO_PITCH) * d,
      target.z + Math.cos(yaw.current) * cp * d,
    );
    camera.up.set(0, 1, 0);
    camera.lookAt(target.x, fy, target.z);

    const unitsPerScreenPx = 1 / (pixelScale * renderConfig.pixelsPerMeter);
    const halfW = (size.width / 2) * unitsPerScreenPx;
    const halfH = (size.height / 2) * unitsPerScreenPx;
    if (
      camera.right !== halfW ||
      camera.top !== halfH ||
      camera.near !== renderConfig.near
    ) {
      camera.left = -halfW;
      camera.right = halfW;
      camera.top = halfH;
      camera.bottom = -halfH;
      camera.near = renderConfig.near;
      camera.far = renderConfig.far;
      camera.zoom = 1;
      camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld();
  });

  return null;
}
