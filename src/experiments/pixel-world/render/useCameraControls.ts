import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { renderConfig } from "./config";
import { useViewStore } from "../ui/viewStore";

/** A drag has to move this many screen pixels before it counts. */
const DRAG_THRESHOLD = 4;
/** Zoom factor per 100 units of wheel delta. */
const WHEEL_ZOOM = 1.15;
/** Zoom factor per +/- key press. */
const KEY_ZOOM = 1.25;
/** Orbit speed for held arrow keys, in radians per second. */
const KEY_ORBIT = 1.6;

/**
 * Free camera controls:
 * - left drag pans across the ground plane
 * - right drag (or shift / alt + left drag) orbits: sideways turns, up/down tilts
 * - two-finger drag orbits and pinch zooms on touch
 * - the wheel and +/- zoom smoothly
 * - arrow keys orbit while held, Q/E snap to the next quarter view, R resets
 */
export function useCameraControls() {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);

  useEffect(() => {
    const el = gl.domElement;
    const store = useViewStore.getState;

    const held = new Set<string>();
    let raf = 0;
    let last = 0;
    const tick = (t: number) => {
      const dt = last ? Math.min((t - last) / 1000, 0.1) : 0;
      last = t;
      let dy = 0;
      let dp = 0;
      if (held.has("ArrowLeft")) dy -= 1;
      if (held.has("ArrowRight")) dy += 1;
      if (held.has("ArrowUp")) dp += 1;
      if (held.has("ArrowDown")) dp -= 1;
      if (dy || dp) store().orbit(dy * KEY_ORBIT * dt, dp * KEY_ORBIT * 0.6 * dt);
      raf = held.size ? requestAnimationFrame(tick) : 0;
      if (!raf) last = 0;
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key.startsWith("Arrow")) {
        e.preventDefault();
        held.add(e.key);
        if (!raf) raf = requestAnimationFrame(tick);
        return;
      }
      if (e.key === "q" || e.key === "Q") store().rotate(-1);
      else if (e.key === "e" || e.key === "E") store().rotate(1);
      else if (e.key === "r" || e.key === "R") store().resetView();
      else if (e.key === "+" || e.key === "=") store().zoomBy(KEY_ZOOM);
      else if (e.key === "-" || e.key === "_") store().zoomBy(1 / KEY_ZOOM);
    };
    const onKeyUp = (e: KeyboardEvent) => held.delete(e.key);
    const onBlur = () => held.clear();

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // Pixel deltas from trackpads, line deltas from some mice
      const delta = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
      store().zoomBy(Math.pow(WHEEL_ZOOM, -delta / 100));
    };

    // Screen drag -> ground-plane pan. Screen-right is the camera's right
    // vector. Screen-up is the camera's forward vector flattened onto the
    // ground, foreshortened by sin(pitch).
    const right = new THREE.Vector3();
    const fwd = new THREE.Vector3();
    const pan = (dx: number, dy: number) => {
      const s = store();
      const zoom = (camera.userData.zoomLevel as number | undefined) ?? s.zoomLevel;
      const metersPerPx = 1 / ((s.pixelScale ?? 1) * renderConfig.pixelsPerMeter * zoom);
      right.setFromMatrixColumn(camera.matrixWorld, 0).setY(0).normalize();
      camera.getWorldDirection(fwd).setY(0).normalize();
      const mx = dx * metersPerPx;
      const my = (dy * metersPerPx) / Math.max(0.2, Math.sin(s.pitch));
      s.panBy(-right.x * mx + fwd.x * my, -right.z * mx + fwd.z * my);
    };
    const orbit = (dx: number, dy: number) => store().orbit(-dx * renderConfig.orbitSpeed, dy * renderConfig.orbitSpeed);

    const pointers = new Map<number, { x: number; y: number }>();
    let drag: { mode: "pan" | "orbit"; active: boolean; x: number; y: number } | null = null;
    let pinch: { dist: number; cx: number; cy: number } | null = null;

    const pinchState = () => {
      const [a, b] = [...pointers.values()];
      return { dist: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
    };

    const onDown = (e: PointerEvent) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      el.setPointerCapture(e.pointerId);
      if (pointers.size === 2) {
        drag = null;
        pinch = pinchState();
        return;
      }
      const orbitMode = e.button === 2 || e.button === 1 || e.shiftKey || e.altKey;
      drag = { mode: orbitMode ? "orbit" : "pan", active: false, x: e.clientX, y: e.clientY };
    };
    const onMove = (e: PointerEvent) => {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      p.x = e.clientX;
      p.y = e.clientY;
      if (pinch && pointers.size === 2) {
        const now = pinchState();
        if (pinch.dist > 0 && now.dist > 0) store().zoomBy(now.dist / pinch.dist);
        orbit(now.cx - pinch.cx, now.cy - pinch.cy);
        pinch = now;
        return;
      }
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (!drag.active) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        drag.active = true;
      }
      drag.x = e.clientX;
      drag.y = e.clientY;
      if (drag.mode === "orbit") orbit(dx, dy);
      else pan(dx, dy);
    };
    const onUp = (e: PointerEvent) => {
      if (!pointers.delete(e.pointerId)) return;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      if (pointers.size < 2) pinch = null;
      // Lifting one finger of a pinch shouldn't turn into a pan jump
      drag = null;
    };
    const onContext = (e: Event) => e.preventDefault();

    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("contextmenu", onContext);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("contextmenu", onContext);
    };
  }, [gl, camera]);
}
