import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { renderConfig } from "./config";
import { useViewStore } from "../ui/viewStore";

/**
 * Drives R3F's default camera as the orthographic view camera. It starts in
 * the classic isometric view but can orbit freely: it eases toward the
 * store's goal yaw, pitch and zoom every frame. It is unsnapped and its
 * frustum matches the canvas exactly, so pointer events and raycasts line up
 * with what is on screen. PixelPipeline derives its own pixel-snapped render
 * camera from it.
 */
export function IsoCameraRig() {
  const camera = useThree((s) => s.camera) as THREE.OrthographicCamera;
  const size = useThree((s) => s.size);
  const initPixelScale = useViewStore((s) => s.initPixelScale);

  // The eased orientation and zoom actually in effect
  const state = useRef<{ yaw: number; pitch: number; zoom: number } | null>(null);

  useEffect(() => initPixelScale(size.height), [initPixelScale, size.height]);

  useFrame((_, dt) => {
    const { pixelScale, target, yaw, pitch, zoomLevel } = useViewStore.getState();
    if (pixelScale === null) return;

    const c = (state.current ??= { yaw, pitch, zoom: zoomLevel });
    const k = 1 - Math.exp(-Math.min(dt, 0.1) * renderConfig.cameraEase);
    c.yaw += (yaw - c.yaw) * k;
    c.pitch += (pitch - c.pitch) * k;
    // Zoom eases in log space so in and out feel the same
    c.zoom = Math.exp(Math.log(c.zoom) + (Math.log(zoomLevel) - Math.log(c.zoom)) * k);
    if (Math.abs(c.yaw - yaw) < 1e-4) c.yaw = yaw;
    if (Math.abs(c.pitch - pitch) < 1e-4) c.pitch = pitch;
    if (Math.abs(c.zoom - zoomLevel) < 1e-4) c.zoom = zoomLevel;
    // The pipeline and the pan read the eased zoom from here
    camera.userData.zoomLevel = c.zoom;

    const d = renderConfig.cameraDistance;
    const cp = Math.cos(c.pitch);
    const fy = renderConfig.focusHeight;
    camera.position.set(
      target.x + Math.sin(c.yaw) * cp * d,
      fy + Math.sin(c.pitch) * d,
      target.z + Math.cos(c.yaw) * cp * d,
    );
    camera.up.set(0, 1, 0);
    camera.lookAt(target.x, fy, target.z);

    const unitsPerScreenPx = 1 / (pixelScale * renderConfig.pixelsPerMeter * c.zoom);
    const halfW = (size.width / 2) * unitsPerScreenPx;
    const halfH = (size.height / 2) * unitsPerScreenPx;
    if (camera.right !== halfW || camera.top !== halfH || camera.near !== renderConfig.near) {
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
