import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { ISO_PITCH, renderConfig } from "./config";
import { useViewStore } from "../ui/viewStore";

/** A drag has to move this many screen pixels before it counts as a pan. */
const DRAG_THRESHOLD = 4;
/** Wheel delta to accumulate per zoom step (trackpads send lots of small ones). */
const WHEEL_STEP = 80;

/**
 * Q/E rotate by 90 degrees, +/- or the wheel zoom in integer pixel-scale
 * steps, and dragging pans across the ground plane.
 */
export function useCameraControls() {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);

  useEffect(() => {
    const el = gl.domElement;
    const store = useViewStore.getState;

    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === "q" || e.key === "Q") store().rotate(-1);
      else if (e.key === "e" || e.key === "E") store().rotate(1);
      else if (e.key === "+" || e.key === "=") store().zoom(1);
      else if (e.key === "-" || e.key === "_") store().zoom(-1);
    };

    let wheelAccum = 0;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      wheelAccum += e.deltaY;
      while (Math.abs(wheelAccum) >= WHEEL_STEP) {
        store().zoom(wheelAccum < 0 ? 1 : -1);
        wheelAccum -= Math.sign(wheelAccum) * WHEEL_STEP;
      }
    };

    // Screen drag -> ground-plane pan. Screen-right is the camera's right
    // vector. Screen-up is the camera's forward vector flattened onto the
    // ground, foreshortened by sin(pitch).
    const right = new THREE.Vector3();
    const fwd = new THREE.Vector3();
    let drag: { id: number; x: number; y: number; active: boolean } | null =
      null;

    const onDown = (e: PointerEvent) => {
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, active: false };
    };
    const onMove = (e: PointerEvent) => {
      if (!drag || drag.id !== e.pointerId) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (!drag.active) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        drag.active = true;
        el.setPointerCapture(e.pointerId);
      }
      drag.x = e.clientX;
      drag.y = e.clientY;

      const scale = store().pixelScale ?? 1;
      const metersPerPx = 1 / (scale * renderConfig.pixelsPerMeter);
      right.setFromMatrixColumn(camera.matrixWorld, 0).setY(0).normalize();
      camera.getWorldDirection(fwd).setY(0).normalize();
      const mx = dx * metersPerPx;
      const my = (dy * metersPerPx) / Math.sin(ISO_PITCH);
      store().panBy(
        -right.x * mx + fwd.x * my,
        -right.z * mx + fwd.z * my,
      );
    };
    const onUp = (e: PointerEvent) => {
      if (drag?.id !== e.pointerId) return;
      if (drag.active) el.releasePointerCapture(e.pointerId);
      drag = null;
    };
    const onContext = (e: Event) => e.preventDefault();

    window.addEventListener("keydown", onKey);
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("contextmenu", onContext);
    return () => {
      window.removeEventListener("keydown", onKey);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("contextmenu", onContext);
    };
  }, [gl, camera]);
}
