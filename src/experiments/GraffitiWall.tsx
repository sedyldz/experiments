import { useCallback, useEffect, useRef, useState } from "react";
import {
  FaceDetector,
  FilesetResolver,
  HandLandmarker,
  type HandLandmarkerResult,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";
import { OneEuroFilter } from "../lib/OneEuroFilter";

const MAX_HANDS = 4;

// A new hand has to be tracked for this many consecutive camera frames
// before it can paint or show a cursor. Real hands pass in a fraction of a
// second; the model's brief false positives (a face, a patterned shirt)
// mostly don't.
const CONFIRM_FRAMES = 8;
// The face detector runs every Nth camera frame; faces move slowly enough
// that reusing the boxes in between is fine.
const FACE_EVERY_N_FRAMES = 2;
// Face boxes are grown by this fraction on each side before rejecting
// hands inside them (the detector's box is tight around the features).
const FACE_BOX_MARGIN = 0.25;
// A face is remembered this long after the detector last saw it. A hand
// raised in front of the face often hides it from the face detector for a
// moment — exactly when the hand model is most likely to see a second,
// phantom "hand" on the face.
const FACE_HOLD_MS = 2000;
// A hand is treated as sitting on a face (and ignored) when at least this
// share of its 21 landmarks fall inside a face box. A real hand held next
// to or partly over the face sticks out of the box and is kept.
const FACE_OVERLAP_SHARE = 0.6;
// The hand model's left/right classification score doubles as a "how sure
// is this a hand" signal; phantom hands usually score lower.
const MIN_HANDEDNESS_SCORE = 0.8;

const PALETTE = [
  "#ff2d95", // pink
  "#ff7a00", // orange
  "#ffe600", // yellow
  "#39ff14", // lime
  "#00e5ff", // cyan
  "#3d5afe", // blue
  "#b026ff", // purple
  "#ffffff", // white
];
// Palette slot index used for the "wipe the wall" swatch.
const CLEAR_SLOT = PALETTE.length;

// Pinch detection uses MediaPipe's *world* landmarks (3D, metric, centered
// on the hand), so the thumb-to-index distance doesn't shrink when the hand
// turns sideways or moves away from the camera the way 2D image distances
// do. It's divided by the palm's own 3D size so big and small hands behave
// the same. The "down" threshold comes from the sensitivity slider; the
// stroke only ends once the fingers open past it by PINCH_HYSTERESIS, so
// noise near the boundary can't chop a line into dashes.
const PINCH_HYSTERESIS = 0.18;
// The pen state only flips after this many consecutive frames agree, which
// removes the one-frame false pinches that left stray dots on the wall.
const DOWN_FRAMES = 3;
const UP_FRAMES = 4;

// A detection farther than this (fraction of the shorter screen side) from
// every known pen starts a new pen instead of continuing one.
const PEN_MATCH_FACTOR = 0.25;
// A pen not seen for this long is forgotten.
const PEN_FORGET_MS = 800;
// A pen's cursor stays on the wall this long after its last camera frame
// (the display refreshes faster than the camera delivers frames).
const PEN_VISIBLE_MS = 150;
// A pen that reappears within this gap keeps its stroke going; after a
// longer dropout the stroke restarts rather than jumping across the wall.
const STROKE_GAP_MS = 160;

// Hand mode: how long to keep pinching on a swatch to pick it, and on the
// ✕ to wipe the wall. Color mode has no pinch, so the pen has to rest on a
// swatch a bit longer (PICK_DWELL_S) to pick it.
const PICK_HOLD_S = 0.35;
const PICK_DWELL_S = 1;
const CLEAR_HOLD_S = 1.5;

// Spray dabs are stamped every DAB_SPACING * radius along the stroke.
const DAB_SPACING = 0.28;
// A pen dwelling below this speed (px/s) soaks the wall and starts dripping.
const DRIP_SPEED = 420;
const DRIP_WETNESS = 0.45;
const MAX_DRIPS = 80;

// Hands smaller than this in the camera image (wrist to middle knuckle, as
// a fraction of frame height) track poorly; the wall says so.
const MIN_HAND_SIZE = 0.05;
// The how-to card fades in once no hand has been seen for this long.
const IDLE_GUIDE_DELAY_MS = 1500;

// Color-tracking mode works on a downsampled camera frame for speed.
const COLOR_SAMPLE_W = 160;
const COLOR_SAMPLE_H = 120;
const COLOR_MIN_PIXELS = 8;

// Auto-calibration downsamples camera frames to this size, and waits this
// long after flashing the wall black/white for the camera to catch up.
const CALIB_W = 320;
const CALIB_H = 180;
const CALIB_SETTLE_MS = 900;

const CORNERS_STORAGE_KEY = "graffiti-wall:corners";

interface Point {
  x: number;
  y: number;
}

type TrackingMode = "hand" | "color";
type Status = "idle" | "loading-model" | "starting-camera" | "running" | "error";
type PreviewMode = null | "calibrate" | "pick";
type FlashPhase = null | "black" | "white";

interface Detection {
  x: number; // screen px
  y: number;
  // Hand mode: 3D pinch ratio for pen up/down. Color mode: null (the tip
  // being visible at all means the pen is on the wall).
  pinchRatio: number | null;
  handSize: number;
}

interface Pen {
  // Smoothed position (the cursor) and the raw detection it came from.
  x: number;
  y: number;
  rawX: number;
  rawY: number;
  // Where the paint actually is: trails the cursor on a short leash.
  brush: Point | null;
  filterX: OneEuroFilter;
  filterY: OneEuroFilter;
  down: boolean;
  // Pinched, but not allowed to paint until the hand opens again (just
  // picked a color, or the pinch started on the palette).
  locked: boolean;
  flipFrames: number;
  // Consecutive camera frames this pen has been seen; it only counts as a
  // real hand once this reaches CONFIRM_FRAMES.
  seenFrames: number;
  closeness: number;
  handSize: number;
  color: number;
  lastSeen: number;
  speed: number;
  wetness: number;
  hoverSlot: number | null;
  hoverTime: number;
}

interface Drip {
  x: number;
  y: number;
  vy: number;
  width: number;
  remaining: number;
  color: string;
}

// What the camera saw last frame, for the camera view.
interface CameraDebug {
  hands: { landmarks: NormalizedLandmark[]; pinched: boolean; rejected: string | null }[];
  faces: { x: number; y: number; w: number; h: number }[];
  colorMask: Point[];
  colorTip: Point | null;
}

// Corners of the projected image as the camera sees it, in normalized
// camera coordinates, ordered top-left, top-right, bottom-right,
// bottom-left *of the projection*. The default assumes the camera points
// at the wall from next to the projector and sees the whole frame.
const WALL_FACING_CORNERS: Point[] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

function loadCorners(): Point[] {
  try {
    const raw = localStorage.getItem(CORNERS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (
        Array.isArray(parsed) &&
        parsed.length === 4 &&
        parsed.every((p) => typeof p?.x === "number" && typeof p?.y === "number")
      ) {
        return parsed;
      }
    }
  } catch {
    // Storage unavailable or corrupt: fall back to the default.
  }
  return WALL_FACING_CORNERS;
}

// Solves for the 3x3 homography H (h33 = 1) mapping each src[i] to dst[i],
// via the standard 8x8 linear system and Gaussian elimination. Returns null
// for degenerate input (e.g. three corners on a line).
function computeHomography(src: Point[], dst: Point[]): number[] | null {
  const a: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  const n = 8;
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    }
    if (Math.abs(a[pivot][col]) < 1e-10) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = a[r][col] / a[col][col];
      for (let c = col; c <= n; c++) a[r][c] -= f * a[col][c];
    }
  }
  const h = a.map((row, i) => row[n] / row[i]);
  return [...h, 1];
}

function applyHomography(h: number[], p: Point): Point | null {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  if (Math.abs(w) < 1e-9) return null;
  return {
    x: (h[0] * p.x + h[1] * p.y + h[2]) / w,
    y: (h[3] * p.x + h[4] * p.y + h[5]) / w,
  };
}

const UNIT_SQUARE: Point[] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max === 0 ? 0 : d / max, max / 255];
}

function dist3(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number }
) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

// Sanity-checks a detected hand's 3D skeleton (world landmarks): finger
// lengths and palm width have to be in human-hand proportions relative to
// the palm length. When the model hallucinates a hand on something else,
// the skeleton it fits is usually distorted enough to fail this.
function isPlausibleHand(world: { x: number; y: number; z: number }[]): boolean {
  const palmLen = dist3(world[0], world[9]);
  if (palmLen < 1e-4) return false;
  const palmWidth = dist3(world[5], world[17]) / palmLen;
  if (palmWidth < 0.35 || palmWidth > 1.3) return false;
  const fingers = [
    [5, 6, 7, 8],
    [9, 10, 11, 12],
    [13, 14, 15, 16],
    [17, 18, 19, 20],
  ];
  for (const f of fingers) {
    const len =
      (dist3(world[f[0]], world[f[1]]) +
        dist3(world[f[1]], world[f[2]]) +
        dist3(world[f[2]], world[f[3]])) /
      palmLen;
    if (len < 0.35 || len > 1.6) return false;
  }
  return true;
}

// Intersection-over-union of two axis-aligned boxes.
function boxOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number }
): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

// Groups the set pixels of a w*h mask into 4-connected blobs.
function connectedComponents(mask: Uint8Array, w: number, h: number): number[][] {
  const seen = new Uint8Array(mask.length);
  const blobs: number[][] = [];
  const stack: number[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    const blob: number[] = [];
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      blob.push(i);
      const x = i % w;
      const y = (i - x) / w;
      const neighbors = [
        x > 0 ? i - 1 : -1,
        x < w - 1 ? i + 1 : -1,
        y > 0 ? i - w : -1,
        y < h - 1 ? i + w : -1,
      ];
      for (const nb of neighbors) {
        if (nb >= 0 && mask[nb] && !seen[nb]) {
          seen[nb] = 1;
          stack.push(nb);
        }
      }
    }
    blobs.push(blob);
  }
  return blobs;
}

// A soft round spray sprite per color, stamped (scaled) along strokes.
// Pre-rendering it once avoids building a radial gradient per dab.
const spriteCache = new Map<string, HTMLCanvasElement>();
function getSpraySprite(color: string): HTMLCanvasElement {
  const cached = spriteCache.get(color);
  if (cached) return cached;
  const size = 128;
  const sprite = document.createElement("canvas");
  sprite.width = size;
  sprite.height = size;
  const ctx = sprite.getContext("2d")!;
  const [r, g, b] = hexToRgb(color);
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, `rgba(${r},${g},${b},0.55)`);
  grad.addColorStop(0.45, `rgba(${r},${g},${b},0.3)`);
  grad.addColorStop(0.8, `rgba(${r},${g},${b},0.07)`);
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  spriteCache.set(color, sprite);
  return sprite;
}

const HAND_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

/**
 * Graffiti Wall
 *
 * A live projection-mapped spray-paint wall. A camera next to the
 * projector watches the wall; whoever holds a pen up to it sprays paint
 * where the pen is. Two ways to find the pen:
 *
 * - Hand mode: MediaPipe hand tracking. A pen grip brings the thumb and
 *   index fingertips together, so "holding a pen" reads as a pinch and the
 *   paint comes out between those fingertips. Up to four hands at once.
 * - Color mode: click the pen's tip (a bright cap, sticker or LED) in the
 *   camera preview and the wall tracks that color instead.
 *
 * Auto-calibration flashes the wall black then white and finds the
 * projection in the camera image, giving a homography from camera to
 * wall, so paint lands right where the pen is. Instructions, a pinch
 * meter and hints ("come closer", "pinch to spray") are projected on the
 * wall itself, so people at the wall know what to do without the laptop.
 */
const GraffitiWall = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const paintCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const cameraViewRef = useRef<HTMLCanvasElement>(null);
  const previewBoxRef = useRef<HTMLDivElement>(null);
  const sampleCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number | null>(null);
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const sizeRef = useRef({ width: 0, height: 0, dpr: 1 });
  const pensRef = useRef<Pen[]>([]);
  const dripsRef = useRef<Drip[]>([]);
  const penCountRef = useRef(0);
  const lastHandSeenRef = useRef(0);
  const cameraDebugRef = useRef<CameraDebug>({
    hands: [],
    faces: [],
    colorMask: [],
    colorTip: null,
  });
  const flashPhaseRef = useRef<FlashPhase>(null);
  const currentColorRef = useRef(0);
  const lastColorTipRef = useRef<Point | null>(null);
  const lastVideoTimeRef = useRef(-1);
  const lastFrameTimeRef = useRef<number | null>(null);
  const handsOutsideRef = useRef(0);
  const faceDetectorRef = useRef<FaceDetector | null>(null);
  const frameCountRef = useRef(0);
  const facesRef = useRef<{ box: CameraDebug["faces"][number]; seen: number }[]>([]);

  const [mode, setMode] = useState<TrackingMode>("hand");
  const [corners, setCorners] = useState<Point[]>(loadCorners);
  const [brushSize, setBrushSize] = useState(50);
  const [pinchSensitivity, setPinchSensitivity] = useState(50);
  const [steadiness, setSteadiness] = useState(40);
  const [maxHands, setMaxHands] = useState(2);
  const [ignoreFaces, setIgnoreFaces] = useState(true);
  const [faceFilterStatus, setFaceFilterStatus] = useState<"loading" | "ready" | "unavailable">(
    "loading"
  );
  const [dripsOn, setDripsOn] = useState(true);
  const [showPalette, setShowPalette] = useState(true);
  const [showGuide, setShowGuide] = useState(true);
  const [targetColor, setTargetColor] = useState<string | null>(null);
  const [tolerance, setTolerance] = useState(35);

  const modeRef = useRef(mode);
  const cornersRef = useRef(corners);
  const homographyRef = useRef<number[] | null>(null);
  const brushSizeRef = useRef(brushSize);
  const pinchSensitivityRef = useRef(pinchSensitivity);
  const steadinessRef = useRef(steadiness);
  const ignoreFacesRef = useRef(ignoreFaces);
  const maxHandsRef = useRef(maxHands);
  const dripsOnRef = useRef(dripsOn);
  const showPaletteRef = useRef(showPalette);
  const showGuideRef = useRef(showGuide);
  const targetHsvRef = useRef<[number, number, number] | null>(null);
  const toleranceRef = useRef(tolerance);
  const previewModeRef = useRef<PreviewMode>(null);

  useEffect(() => {
    modeRef.current = mode;
    pensRef.current = [];
    lastColorTipRef.current = null;
  }, [mode]);
  useEffect(() => {
    cornersRef.current = corners;
    homographyRef.current = computeHomography(corners, UNIT_SQUARE);
    try {
      localStorage.setItem(CORNERS_STORAGE_KEY, JSON.stringify(corners));
    } catch {
      // Not persisting calibration is fine.
    }
  }, [corners]);
  useEffect(() => {
    brushSizeRef.current = brushSize;
  }, [brushSize]);
  useEffect(() => {
    pinchSensitivityRef.current = pinchSensitivity;
  }, [pinchSensitivity]);
  useEffect(() => {
    steadinessRef.current = steadiness;
  }, [steadiness]);
  useEffect(() => {
    maxHandsRef.current = maxHands;
    void landmarkerRef.current?.setOptions({ numHands: maxHands });
  }, [maxHands]);
  useEffect(() => {
    ignoreFacesRef.current = ignoreFaces;
    if (!ignoreFaces) cameraDebugRef.current.faces = [];
  }, [ignoreFaces]);
  useEffect(() => {
    dripsOnRef.current = dripsOn;
  }, [dripsOn]);
  useEffect(() => {
    showPaletteRef.current = showPalette;
  }, [showPalette]);
  useEffect(() => {
    showGuideRef.current = showGuide;
  }, [showGuide]);
  useEffect(() => {
    targetHsvRef.current = targetColor ? rgbToHsv(...hexToRgb(targetColor)) : null;
    lastColorTipRef.current = null;
  }, [targetColor]);
  useEffect(() => {
    toleranceRef.current = tolerance;
  }, [tolerance]);

  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [projectorMode, setProjectorMode] = useState(false);
  const [showHint, setShowHint] = useState(true);
  const [penCount, setPenCount] = useState(0);
  const [penDownCount, setPenDownCount] = useState(0);
  const [previewMode, setPreviewMode] = useState<PreviewMode>(null);
  const [autoCalibrating, setAutoCalibrating] = useState(false);
  const [calibrated, setCalibrated] = useState(() => {
    try {
      return localStorage.getItem(CORNERS_STORAGE_KEY) !== null;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    previewModeRef.current = previewMode;
  }, [previewMode]);
  const penDownCountRef = useRef(0);

  const resizeCanvas = useCallback(() => {
    const paint = paintCanvasRef.current;
    const overlay = overlayCanvasRef.current;
    const container = containerRef.current;
    if (!paint || !overlay || !container) return;
    const width = container.clientWidth;
    const height = container.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const prev = sizeRef.current;
    if (prev.width === width && prev.height === height && prev.dpr === dpr) return;

    // Keep the painting across a resize (e.g. entering fullscreen) by
    // stretching the old pixels onto the new canvas.
    let snapshot: HTMLCanvasElement | null = null;
    if (paint.width > 0 && paint.height > 0) {
      snapshot = document.createElement("canvas");
      snapshot.width = paint.width;
      snapshot.height = paint.height;
      snapshot.getContext("2d")!.drawImage(paint, 0, 0);
    }
    for (const canvas of [paint, overlay]) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      canvas.getContext("2d")!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    if (snapshot) {
      const ctx = paint.getContext("2d")!;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(snapshot, 0, 0, paint.width, paint.height);
      ctx.restore();
    }
    sizeRef.current = { width, height, dpr };
  }, []);

  const clearWall = useCallback(() => {
    const paint = paintCanvasRef.current;
    if (!paint) return;
    const ctx = paint.getContext("2d")!;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, paint.width, paint.height);
    ctx.restore();
    dripsRef.current = [];
  }, []);

  const saveImage = useCallback(() => {
    const paint = paintCanvasRef.current;
    if (!paint) return;
    const out = document.createElement("canvas");
    out.width = paint.width;
    out.height = paint.height;
    const ctx = out.getContext("2d")!;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(paint, 0, 0);
    const link = document.createElement("a");
    link.download = `graffiti-${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
    link.href = out.toDataURL("image/png");
    link.click();
  }, []);

  const paletteLayout = useCallback((width: number, height: number) => {
    const r = Math.min(width, height) * 0.035;
    const gap = r * 2.8;
    const count = PALETTE.length + 1;
    const startX = width / 2 - ((count - 1) * gap) / 2;
    const y = height - r * 1.8;
    return Array.from({ length: count }, (_, i) => ({ x: startX + i * gap, y, r }));
  }, []);

  const grabFrame = useCallback((video: HTMLVideoElement, w: number, h: number) => {
    let canvas = sampleCanvasRef.current;
    if (!canvas) {
      canvas = document.createElement("canvas");
      sampleCanvasRef.current = canvas;
    }
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(video, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h).data;
  }, []);

  // Finds the pen tip by color. Matching pixels are grouped into connected
  // blobs; the blob nearest the tip's last position wins (so the pen
  // doesn't jump to a similar-colored object across the room), otherwise
  // the biggest one. Stray single pixels never form a big enough blob.
  const detectColorPen = useCallback(
    (video: HTMLVideoElement): Point | null => {
      const target = targetHsvRef.current;
      const debug = cameraDebugRef.current;
      debug.colorMask = [];
      debug.colorTip = null;
      if (!target) return null;
      const data = grabFrame(video, COLOR_SAMPLE_W, COLOR_SAMPLE_H);

      const tol = toleranceRef.current / 100;
      const hueTol = 6 + tol * 30;
      const satTol = 0.12 + tol * 0.4;
      const valTol = 0.18 + tol * 0.5;
      const [th, ts, tv] = target;
      // Low-saturation targets (white LEDs, etc.) can't be matched on hue,
      // only on brightness.
      const useHue = ts > 0.25;

      const mask = new Uint8Array(COLOR_SAMPLE_W * COLOR_SAMPLE_H);
      for (let i = 0; i < mask.length; i++) {
        const [h, s, v] = rgbToHsv(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
        if (useHue) {
          if (s < 0.2 || v < 0.15) continue;
          const dh = Math.min(Math.abs(h - th), 360 - Math.abs(h - th));
          if (dh > hueTol || Math.abs(s - ts) > satTol || Math.abs(v - tv) > valTol) continue;
        } else if (v < tv - valTol * 0.5 || s > ts + satTol * 0.5) {
          continue;
        }
        mask[i] = 1;
      }

      const blobs = connectedComponents(mask, COLOR_SAMPLE_W, COLOR_SAMPLE_H).filter(
        (b) => b.length >= COLOR_MIN_PIXELS
      );
      for (const blob of blobs) {
        for (const i of blob) {
          debug.colorMask.push({
            x: (i % COLOR_SAMPLE_W) / COLOR_SAMPLE_W,
            y: Math.floor(i / COLOR_SAMPLE_W) / COLOR_SAMPLE_H,
          });
        }
      }
      if (blobs.length === 0) {
        lastColorTipRef.current = null;
        return null;
      }

      const centroid = (blob: number[]) => {
        let sx = 0;
        let sy = 0;
        for (const i of blob) {
          sx += i % COLOR_SAMPLE_W;
          sy += Math.floor(i / COLOR_SAMPLE_W);
        }
        return {
          x: (sx / blob.length + 0.5) / COLOR_SAMPLE_W,
          y: (sy / blob.length + 0.5) / COLOR_SAMPLE_H,
        };
      };
      const candidates = blobs.map((b) => ({ size: b.length, c: centroid(b) }));
      const last = lastColorTipRef.current;
      let best = candidates.reduce((a, b) => (b.size > a.size ? b : a));
      if (last) {
        const near = candidates
          .map((cand) => ({ ...cand, d: Math.hypot(cand.c.x - last.x, cand.c.y - last.y) }))
          .filter((cand) => cand.d < 0.15)
          .sort((a, b) => a.d - b.d)[0];
        if (near) best = near;
      }
      lastColorTipRef.current = best.c;
      debug.colorTip = best.c;
      return best.c;
    },
    [grabFrame]
  );

  const sprayStroke = useCallback(
    (ctx: CanvasRenderingContext2D, from: Point, to: Point, radius: number, color: string) => {
      const sprite = getSpraySprite(color);
      const dist = Math.hypot(to.x - from.x, to.y - from.y);
      const step = Math.max(radius * DAB_SPACING, 1);
      const steps = Math.max(1, Math.ceil(dist / step));
      ctx.fillStyle = color;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const x = from.x + (to.x - from.x) * t;
        const y = from.y + (to.y - from.y) * t;
        ctx.globalAlpha = 1;
        ctx.drawImage(sprite, x - radius, y - radius, radius * 2, radius * 2);
        // Overspray: a few hard specks scattered past the soft core.
        for (let s = 0; s < 3; s++) {
          const a = Math.random() * Math.PI * 2;
          const d = radius * (0.7 + Math.random() * 0.8);
          const size = 0.6 + Math.random() * 1.4;
          ctx.globalAlpha = 0.25 + Math.random() * 0.45;
          ctx.fillRect(x + Math.cos(a) * d, y + Math.sin(a) * d, size, size);
        }
      }
      ctx.globalAlpha = 1;
    },
    []
  );

  // The camera view in the control panel: what the camera sees, the
  // calibrated wall outline, the tracked hands (pinching fingertips turn
  // green) or the color-tracking mask. It's the quickest way to see *why*
  // tracking is struggling.
  const drawCameraView = useCallback(() => {
    const canvas = cameraViewRef.current;
    const video = videoRef.current;
    if (!canvas || !video || !video.videoWidth) return;
    const w = canvas.clientWidth;
    const h = Math.round((w * video.videoHeight) / video.videoWidth);
    if (!w) return;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(video, 0, 0, w, h);
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(0, 0, w, h);

    const quad = (homographyRef.current ? cornersRef.current : []).map((c) => ({
      x: c.x * w,
      y: c.y * h,
    }));
    if (quad.length === 4) {
      ctx.strokeStyle = "#ff2d95";
      ctx.lineWidth = 2;
      ctx.beginPath();
      quad.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.stroke();
    }

    const debug = cameraDebugRef.current;
    ctx.font = "600 11px Inter, system-ui, sans-serif";
    for (const f of debug.faces) {
      ctx.strokeStyle = "#00e5ff";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(f.x * w, f.y * h, f.w * w, f.h * h);
      ctx.fillStyle = "#00e5ff";
      ctx.fillText("face — ignored", f.x * w + 3, f.y * h + 12);
    }
    for (const hand of debug.hands) {
      if (hand.rejected) {
        ctx.strokeStyle = "rgba(255,60,60,0.9)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (const [a, b] of HAND_CONNECTIONS) {
          ctx.moveTo(hand.landmarks[a].x * w, hand.landmarks[a].y * h);
          ctx.lineTo(hand.landmarks[b].x * w, hand.landmarks[b].y * h);
        }
        ctx.stroke();
        ctx.fillStyle = "rgba(255,60,60,0.95)";
        ctx.fillText(
          `not a hand (${hand.rejected})`,
          hand.landmarks[0].x * w + 4,
          hand.landmarks[0].y * h + 14
        );
        continue;
      }
      ctx.strokeStyle = "rgba(255,255,255,0.8)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (const [a, b] of HAND_CONNECTIONS) {
        ctx.moveTo(hand.landmarks[a].x * w, hand.landmarks[a].y * h);
        ctx.lineTo(hand.landmarks[b].x * w, hand.landmarks[b].y * h);
      }
      ctx.stroke();
      for (const tip of [4, 8]) {
        ctx.fillStyle = hand.pinched ? "#39ff14" : "#ffe600";
        ctx.beginPath();
        ctx.arc(hand.landmarks[tip].x * w, hand.landmarks[tip].y * h, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (debug.colorMask.length) {
      ctx.fillStyle = "rgba(255,45,149,0.8)";
      const px = Math.max(1, w / COLOR_SAMPLE_W);
      for (const p of debug.colorMask) ctx.fillRect(p.x * w, p.y * h, px, px);
    }
    if (debug.colorTip) {
      ctx.strokeStyle = "#39ff14";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(debug.colorTip.x * w, debug.colorTip.y * h, 8, 0, Math.PI * 2);
      ctx.stroke();
    }
  }, []);

  const loop = useCallback(
    (time: number) => {
      rafRef.current = requestAnimationFrame(loop);

      const video = videoRef.current;
      const paint = paintCanvasRef.current;
      const overlay = overlayCanvasRef.current;
      if (!video || !paint || !overlay) return;
      if (video.videoWidth === 0 || video.videoHeight === 0) return;

      const dt = lastTimeRef.current
        ? Math.min((time - lastTimeRef.current) / 1000, 1 / 20)
        : 1 / 60;
      lastTimeRef.current = time;

      const { width, height } = sizeRef.current;
      if (!width || !height) return;
      const octx = overlay.getContext("2d")!;

      // Auto-calibration takes over the whole projection with a flat
      // black or white frame; nothing else is drawn or tracked meanwhile.
      const flash = flashPhaseRef.current;
      if (flash) {
        octx.fillStyle = flash === "white" ? "#fff" : "#000";
        octx.fillRect(0, 0, width, height);
        return;
      }

      const H = homographyRef.current;
      const minSide = Math.min(width, height);
      const calibrating = previewModeRef.current !== null;
      const handMode = modeRef.current === "hand";
      const pinchDown = 0.25 + (pinchSensitivityRef.current / 100) * 0.35;
      const pinchUp = pinchDown + PINCH_HYSTERESIS;
      const swatches = paletteLayout(width, height);
      // Everything below this line is the palette band: no painting there.
      const paletteTop = showPaletteRef.current ? swatches[0].y - swatches[0].r * 2 : Infinity;
      const paintCtx = paint.getContext("2d")!;
      const baseRadius = minSide * (0.008 + (brushSizeRef.current / 100) * 0.03);
      // The lazy-brush leash: the brush only moves once the tracked point
      // pulls further than this from it, which swallows hand-tracking
      // jitter while still following deliberate motion exactly.
      const leash = minSide * (0.001 + (steadinessRef.current / 100) * 0.014);

      // The camera delivers ~30 frames/s but this loop runs at the
      // display's rate. Tracking only runs on a *new* camera frame:
      // re-processing the same image fed the smoothing filter alternating
      // "didn't move" / "moved twice as far" samples, which showed up as
      // jittery, imprecise lines.
      const newFrame = video.currentTime !== lastVideoTimeRef.current;
      let handsOutside = 0;
      if (newFrame) {
        lastVideoTimeRef.current = video.currentTime;
        const frameDt = lastFrameTimeRef.current
          ? Math.min((time - lastFrameTimeRef.current) / 1000, 0.1)
          : 1 / 30;
        lastFrameTimeRef.current = time;
        const tSec = time / 1000;

        // 1. Find pen tips in camera space and map them onto the wall.
        const toScreen = (p: Point): Point | null => {
          if (!H) return null;
          const q = applyHomography(H, p);
          if (!q) return null;
          // Slightly outside the projection still counts, so strokes can
          // reach the very edge; far outside is someone walking past.
          if (q.x < -0.05 || q.x > 1.05 || q.y < -0.05 || q.y > 1.05) return null;
          return { x: q.x * width, y: q.y * height };
        };

        const detections: Detection[] = [];
        const debug = cameraDebugRef.current;
        debug.hands = [];
        if (handMode) {
          debug.colorMask = [];
          debug.colorTip = null;
          const landmarker = landmarkerRef.current;
          if (landmarker) {
            const result: HandLandmarkerResult = landmarker.detectForVideo(video, time);
            const aspect = video.videoWidth / video.videoHeight;

            // Faces are the model's most common false "hand". Find them
            // with a dedicated face detector and drop any hand on one.
            const faceDetector = faceDetectorRef.current;
            if (ignoreFacesRef.current && faceDetector) {
              if (frameCountRef.current % FACE_EVERY_N_FRAMES === 0) {
                const found = faceDetector.detectForVideo(video, time).detections;
                for (const f of found) {
                  const b = f.boundingBox;
                  if (!b) continue;
                  const mx = b.width * FACE_BOX_MARGIN;
                  const my = b.height * FACE_BOX_MARGIN;
                  const box = {
                    x: (b.originX - mx) / video.videoWidth,
                    y: (b.originY - my) / video.videoHeight,
                    w: (b.width + mx * 2) / video.videoWidth,
                    h: (b.height + my * 2) / video.videoHeight,
                  };
                  // Same face as one we remember (boxes overlap) → refresh
                  // it; otherwise it's a new face.
                  const known = facesRef.current.find((k) => boxOverlap(k.box, box) > 0.2);
                  if (known) {
                    known.box = box;
                    known.seen = time;
                  } else {
                    facesRef.current.push({ box, seen: time });
                  }
                }
              }
              facesRef.current = facesRef.current.filter((f) => time - f.seen < FACE_HOLD_MS);
            } else {
              facesRef.current = [];
            }
            debug.faces = facesRef.current.map((f) => f.box);
            frameCountRef.current++;

            result.landmarks.forEach((lm, h) => {
              const world = result.worldLandmarks[h];
              const onFace = debug.faces.some((f) => {
                const inside = lm.filter(
                  (p) => p.x > f.x && p.x < f.x + f.w && p.y > f.y && p.y < f.y + f.h
                ).length;
                return inside / lm.length >= FACE_OVERLAP_SHARE;
              });
              const handednessScore = result.handedness[h]?.[0]?.score ?? 1;
              const rejected = onFace
                ? "face"
                : handednessScore < MIN_HANDEDNESS_SCORE
                ? "unsure"
                : world && world.length === 21 && !isPlausibleHand(world)
                ? "shape"
                : null;
              if (rejected) {
                debug.hands.push({ landmarks: lm, pinched: false, rejected });
                return;
              }
              let ratio: number;
              if (world && world.length === 21) {
                const palm = (dist3(world[0], world[5]) + dist3(world[0], world[17])) / 2 || 1;
                ratio = dist3(world[4], world[8]) / palm;
              } else {
                const palm = Math.hypot((lm[0].x - lm[9].x) * aspect, lm[0].y - lm[9].y) || 1;
                ratio = Math.hypot((lm[4].x - lm[8].x) * aspect, lm[4].y - lm[8].y) / palm;
              }
              const handSize = Math.hypot((lm[0].x - lm[9].x) * aspect, lm[0].y - lm[9].y);
              debug.hands.push({ landmarks: lm, pinched: ratio < pinchDown, rejected: null });
              // The paint comes from the index fingertip. The thumb/index
              // midpoint used before slid sideways every time the fingers
              // closed, so lines started (and wandered) off target.
              const tip = toScreen({ x: lm[8].x, y: lm[8].y });
              if (tip) detections.push({ ...tip, pinchRatio: ratio, handSize });
              else handsOutside++;
            });
          }
        } else {
          const tip = detectColorPen(video);
          if (tip) {
            const screen = toScreen(tip);
            if (screen) detections.push({ ...screen, pinchRatio: null, handSize: 1 });
            else handsOutside++;
          }
        }
        if (detections.length || handsOutside) lastHandSeenRef.current = time;
        handsOutsideRef.current = handsOutside;

        // 2. Match detections to known pens (nearest first) so each person
        // keeps their stroke from frame to frame.
        const pens = pensRef.current;
        const matchRadius = minSide * PEN_MATCH_FACTOR;
        const pairs: { d: number; di: number; pi: number }[] = [];
        detections.forEach((det, di) =>
          pens.forEach((pen, pi) => {
            const d = Math.hypot(det.x - pen.rawX, det.y - pen.rawY);
            if (d < matchRadius) pairs.push({ d, di, pi });
          })
        );
        pairs.sort((a, b) => a.d - b.d);
        const detToPen = new Map<number, number>();
        const usedPens = new Set<number>();
        for (const { di, pi } of pairs) {
          if (detToPen.has(di) || usedPens.has(pi)) continue;
          detToPen.set(di, pi);
          usedPens.add(pi);
        }
        detections.forEach((det, di) => {
          if (detToPen.has(di)) return;
          pens.push({
            x: det.x,
            y: det.y,
            rawX: det.x,
            rawY: det.y,
            brush: null,
            filterX: new OneEuroFilter(0.9, 0.006, 1),
            filterY: new OneEuroFilter(0.9, 0.006, 1),
            down: false,
            locked: false,
            flipFrames: 0,
            seenFrames: 0,
            closeness: 0,
            handSize: det.handSize,
            // New pens (including a hand that tracking briefly lost) use the
            // last color anyone picked, so colors never change on their own.
            color: currentColorRef.current,
            lastSeen: time,
            speed: 0,
            wetness: 0,
            hoverSlot: null,
            hoverTime: 0,
          });
          detToPen.set(di, pens.length - 1);
        });

        // 3. Advance each seen pen: smoothing, pen up/down, palette,
        // spraying, drips.
        detToPen.forEach((pi, di) => {
          const det = detections[di];
          const pen = pens[pi];
          const gap = time - pen.lastSeen;
          pen.lastSeen = time;
          pen.handSize = det.handSize;
          pen.seenFrames = gap > STROKE_GAP_MS ? 1 : pen.seenFrames + 1;
          pen.rawX = det.x;
          pen.rawY = det.y;
          const x = pen.filterX.filter(det.x, tSec);
          const y = pen.filterY.filter(det.y, tSec);
          const moved = Math.hypot(x - pen.x, y - pen.y);
          pen.speed = pen.speed * 0.6 + (moved / frameDt) * 0.4;
          pen.x = x;
          pen.y = y;
          const inPalette = y > paletteTop;
          if (pen.seenFrames < CONFIRM_FRAMES && det.pinchRatio !== null) return;

          const wasDown = pen.down;
          const wantDown =
            det.pinchRatio === null
              ? true
              : pen.down
              ? det.pinchRatio < pinchUp
              : det.pinchRatio < pinchDown;
          if (wantDown === pen.down) {
            pen.flipFrames = 0;
          } else if (++pen.flipFrames >= (wantDown ? DOWN_FRAMES : UP_FRAMES)) {
            pen.down = wantDown;
            pen.flipFrames = 0;
          }
          if (!pen.down) {
            // Opening the hand always releases the lock.
            pen.locked = false;
          } else if (!wasDown && inPalette) {
            // A pinch that starts in the palette band is a button press,
            // never the start of a stroke.
            pen.locked = true;
          }
          if (det.pinchRatio === null && !inPalette && pen.hoverSlot === null) {
            // Color mode has no "open hand": leaving the palette unlocks.
            pen.locked = false;
          }
          // 0 = fingers wide open, 1 = pinched: drives the meter on the wall.
          pen.closeness =
            det.pinchRatio === null
              ? 1
              : Math.max(0, Math.min(1, (pinchUp * 1.8 - det.pinchRatio) / (pinchUp * 1.8 - pinchDown)));

          // Palette: in hand mode a swatch is *pressed* — pinch on it and
          // hold briefly. An open hand passing over it does nothing, so
          // colors can't change by accident. In color mode (pen always
          // "down") resting on the swatch a little longer picks it.
          let hover: number | null = null;
          // (A pinch that started on the wall and was dragged down here is
          // a stroke, not a press, so it only counts while locked.)
          if (inPalette && !calibrating && (!handMode || (pen.down && pen.locked))) {
            swatches.forEach((s, i) => {
              if (Math.hypot(x - s.x, y - s.y) < s.r * 1.5) hover = i;
            });
          }
          if (hover !== pen.hoverSlot) {
            pen.hoverSlot = hover;
            pen.hoverTime = 0;
          } else if (hover !== null) {
            pen.hoverTime += frameDt;
            const hold =
              hover === CLEAR_SLOT ? CLEAR_HOLD_S : handMode ? PICK_HOLD_S : PICK_DWELL_S;
            if (pen.hoverTime >= hold) {
              if (hover === CLEAR_SLOT) {
                clearWall();
              } else {
                pen.color = hover;
                currentColorRef.current = hover;
              }
              // Nothing is painted until the hand opens again (or, in color
              // mode, the pen leaves the palette).
              pen.locked = true;
              pen.hoverTime = -Infinity; // fire once per press
            }
          }

          if (!pen.down || pen.locked || inPalette || calibrating) {
            pen.brush = null;
            pen.wetness = 0;
            return;
          }

          // Lazy brush: drag the brush behind the tracked point on a short
          // leash. A stroke restarts after a tracking dropout instead of
          // drawing a straight line across the gap.
          if (!pen.brush || gap > STROKE_GAP_MS) pen.brush = { x, y };
          const from = { ...pen.brush };
          const pull = Math.hypot(x - from.x, y - from.y);
          if (pull > leash) {
            const k = (pull - leash) / pull;
            pen.brush.x += (x - from.x) * k;
            pen.brush.y += (y - from.y) * k;
          }
          const to = pen.brush;

          const color = PALETTE[pen.color];
          // Fast strokes spray thinner, slow ones fatter — like a real can.
          const speedFactor = Math.max(0.55, Math.min(1.3, 1.3 - pen.speed / 2500));
          const radius = baseRadius * speedFactor;
          sprayStroke(paintCtx, from, to, radius, color);

          if (dripsOnRef.current) {
            pen.wetness += frameDt * Math.max(0, 1 - pen.speed / DRIP_SPEED);
            if (pen.wetness > DRIP_WETNESS && dripsRef.current.length < MAX_DRIPS) {
              pen.wetness = -Math.random() * 0.4;
              dripsRef.current.push({
                x: to.x + (Math.random() - 0.5) * radius * 0.9,
                y: to.y + radius * 0.35,
                vy: 35 + Math.random() * 45,
                width: radius * (0.12 + Math.random() * 0.12),
                remaining: radius * (1.5 + Math.random() * 5),
                color,
              });
            }
          }
        });

        pensRef.current = pens.filter((pen) => time - pen.lastSeen < PEN_FORGET_MS);
      }
      handsOutside = handsOutsideRef.current;

      const visiblePens = pensRef.current.filter(
        (p) =>
          time - p.lastSeen < PEN_VISIBLE_MS &&
          (p.seenFrames >= CONFIRM_FRAMES || !handMode)
      );
      if (visiblePens.length !== penCountRef.current) {
        penCountRef.current = visiblePens.length;
        setPenCount(visiblePens.length);
      }
      const downCount = visiblePens.filter((p) => p.down).length;
      if (downCount !== penDownCountRef.current) {
        penDownCountRef.current = downCount;
        setPenDownCount(downCount);
      }

      // 4. Drips run down the wall and slow as they dry out.
      paintCtx.lineCap = "round";
      dripsRef.current = dripsRef.current.filter((drip) => {
        const dy = Math.min(drip.vy * dt, drip.remaining);
        const nx = drip.x + (Math.random() - 0.5) * 0.4;
        paintCtx.strokeStyle = drip.color;
        paintCtx.lineWidth = drip.width;
        paintCtx.beginPath();
        paintCtx.moveTo(drip.x, drip.y);
        paintCtx.lineTo(nx, drip.y + dy);
        paintCtx.stroke();
        drip.x = nx;
        drip.y += dy;
        drip.remaining -= dy;
        drip.vy *= 0.993;
        drip.width *= 0.9985;
        if (drip.remaining <= 0.5 || drip.vy < 4) {
          paintCtx.fillStyle = drip.color;
          paintCtx.beginPath();
          paintCtx.arc(drip.x, drip.y, drip.width * 0.85, 0, Math.PI * 2);
          paintCtx.fill();
          return false;
        }
        return true;
      });

      // 5. Overlay: calibration markers, palette, guide, pen cursors.
      octx.clearRect(0, 0, width, height);
      const fontSize = Math.max(14, minSide * 0.028);
      const label = (text: string, x: number, y: number, size = fontSize, alpha = 0.9) => {
        octx.font = `600 ${size}px Inter, system-ui, sans-serif`;
        octx.textAlign = "center";
        octx.textBaseline = "middle";
        octx.fillStyle = `rgba(255,255,255,${alpha})`;
        octx.fillText(text, x, y);
      };

      if (calibrating) {
        // Bright corner brackets so the projection's corners are easy to
        // spot in the camera preview while dragging the handles.
        const len = minSide * 0.12;
        octx.strokeStyle = "#fff";
        octx.lineWidth = minSide * 0.012;
        const inset = octx.lineWidth / 2;
        const cornersPx: [number, number, number, number][] = [
          [inset, inset, 1, 1],
          [width - inset, inset, -1, 1],
          [width - inset, height - inset, -1, -1],
          [inset, height - inset, 1, -1],
        ];
        for (const [cx, cy, sx, sy] of cornersPx) {
          octx.beginPath();
          octx.moveTo(cx + sx * len, cy);
          octx.lineTo(cx, cy);
          octx.lineTo(cx, cy + sy * len);
          octx.stroke();
        }
        octx.lineWidth = 2;
        octx.strokeRect(1, 1, width - 2, height - 2);
      }

      const guide = showGuideRef.current && !calibrating;

      if (showPaletteRef.current && !calibrating) {
        // Marks off the palette band, where nothing gets painted.
        octx.strokeStyle = "rgba(255,255,255,0.18)";
        octx.lineWidth = 1;
        octx.setLineDash([6, 8]);
        octx.beginPath();
        octx.moveTo(swatches[0].x - swatches[0].r * 2, paletteTop);
        octx.lineTo(swatches[swatches.length - 1].x + swatches[0].r * 2, paletteTop);
        octx.stroke();
        octx.setLineDash([]);
        if (guide && !pensRef.current.some((p) => p.hoverSlot !== null)) {
          label(
            handMode ? "pinch a color to pick it" : "rest the pen on a color to pick it",
            width / 2,
            paletteTop - fontSize * 0.7,
            fontSize * 0.6,
            0.5
          );
        }
        swatches.forEach((s, i) => {
          octx.beginPath();
          octx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
          if (i === CLEAR_SLOT) {
            octx.strokeStyle = "rgba(255,255,255,0.7)";
            octx.lineWidth = 2;
            octx.stroke();
            const k = s.r * 0.45;
            octx.beginPath();
            octx.moveTo(s.x - k, s.y - k);
            octx.lineTo(s.x + k, s.y + k);
            octx.moveTo(s.x + k, s.y - k);
            octx.lineTo(s.x - k, s.y + k);
            octx.stroke();
          } else {
            octx.fillStyle = PALETTE[i];
            octx.fill();
            if (i === currentColorRef.current) {
              octx.strokeStyle = "rgba(255,255,255,0.9)";
              octx.lineWidth = 3;
              octx.beginPath();
              octx.arc(s.x, s.y, s.r * 1.25, 0, Math.PI * 2);
              octx.stroke();
            }
          }
        });
        for (const pen of pensRef.current) {
          if (pen.hoverSlot === null || pen.hoverTime <= 0) continue;
          const s = swatches[pen.hoverSlot];
          const isClear = pen.hoverSlot === CLEAR_SLOT;
          const hold = isClear ? CLEAR_HOLD_S : handMode ? PICK_HOLD_S : PICK_DWELL_S;
          const progress = Math.min(pen.hoverTime / hold, 1);
          octx.strokeStyle = "#fff";
          octx.lineWidth = 4;
          octx.beginPath();
          octx.arc(s.x, s.y, s.r * 1.6, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
          octx.stroke();
          label(isClear ? "keep holding to wipe the wall" : "picking…", s.x, s.y - s.r * 2.6, fontSize * 0.8);
        }
      }


      // The how-to card, shown on the wall whenever nobody is drawing.
      if (guide && time - lastHandSeenRef.current > IDLE_GUIDE_DELAY_MS) {
        const fade = Math.min(1, (time - lastHandSeenRef.current - IDLE_GUIDE_DELAY_MS) / 600);
        const lines = handMode
          ? [
              "1 · Hold your hand up in front of the wall",
              "2 · Pinch thumb + index together (like holding a pen) to spray",
              "3 · Open your hand to stop",
              "4 · Pinch a color at the bottom to switch · pinch and hold ✕ to wipe",
            ]
          : [
              "1 · Hold the pen up to the wall, tip toward the camera",
              "2 · Wherever the tip goes, paint follows",
              "3 · Cover the tip or turn it away to stop",
            ];
        const top = height * 0.18;
        label("Grab a pen & draw", width / 2, top, fontSize * 1.8, fade);
        lines.forEach((line, i) =>
          label(line, width / 2, top + fontSize * (2.6 + i * 1.6), fontSize * 0.85, 0.8 * fade)
        );
      }
      if (guide && handsOutside > 0 && visiblePens.length === 0) {
        label("Move your hand inside the drawing area", width / 2, height * 0.08, fontSize, 0.85);
      }

      for (const pen of visiblePens) {
        const color = PALETTE[pen.color];
        const r = baseRadius * 0.8 + 6;
        // Pinch meter: the ring closes as the fingers come together and
        // turns solid when the pen is down.
        octx.lineWidth = 3;
        octx.strokeStyle = "rgba(255,255,255,0.25)";
        octx.beginPath();
        octx.arc(pen.x, pen.y, r, 0, Math.PI * 2);
        octx.stroke();
        octx.strokeStyle = color;
        octx.beginPath();
        octx.arc(pen.x, pen.y, r, -Math.PI / 2, -Math.PI / 2 + (pen.down ? 1 : pen.closeness) * Math.PI * 2);
        octx.stroke();
        if (!pen.down) {
          octx.fillStyle = color;
          octx.beginPath();
          octx.arc(pen.x, pen.y, 3, 0, Math.PI * 2);
          octx.fill();
        }
        if (!guide || pen.hoverSlot !== null) continue;
        const hint =
          handMode && pen.handSize < MIN_HAND_SIZE
            ? "hand looks small to the camera — move it closer"
            : handMode && pen.locked
            ? "open your hand, then pinch to draw"
            : handMode && !pen.down
            ? "pinch to spray"
            : null;
        if (hint) label(hint, pen.x, pen.y - r - fontSize * 0.9, fontSize * 0.75, 0.85);
      }

      if (cameraViewRef.current) drawCameraView();
    },
    [clearWall, detectColorPen, drawCameraView, paletteLayout, sprayStroke]
  );

  const ensureLandmarker = useCallback(async () => {
    if (landmarkerRef.current) return landmarkerRef.current;
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
    );
    const options = {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
      },
      runningMode: "VIDEO" as const,
      numHands: maxHandsRef.current,
      // Stricter than MediaPipe's 0.5 defaults: fewer false hands, at the
      // cost of needing a clearly visible hand.
      minHandDetectionConfidence: 0.75,
      minHandPresenceConfidence: 0.75,
      minTrackingConfidence: 0.6,
    };
    let landmarker: HandLandmarker;
    try {
      landmarker = await HandLandmarker.createFromOptions(vision, {
        ...options,
        baseOptions: { ...options.baseOptions, delegate: "GPU" },
      });
    } catch {
      landmarker = await HandLandmarker.createFromOptions(vision, {
        ...options,
        baseOptions: { ...options.baseOptions, delegate: "CPU" },
      });
    }
    landmarkerRef.current = landmarker;

    // The face filter is a nice-to-have: if its model can't load, hand
    // tracking still works without it.
    try {
      faceDetectorRef.current = await FaceDetector.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite",
        },
        runningMode: "VIDEO",
        minDetectionConfidence: 0.35,
      });
      setFaceFilterStatus("ready");
    } catch {
      faceDetectorRef.current = null;
      setFaceFilterStatus("unavailable");
    }
    return landmarker;
  }, []);

  const stopCamera = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    lastTimeRef.current = null;
    lastVideoTimeRef.current = -1;
    lastFrameTimeRef.current = null;
    pensRef.current = [];
    penCountRef.current = 0;
    penDownCountRef.current = 0;
    flashPhaseRef.current = null;
    setPenCount(0);
    setPenDownCount(0);
    setPreviewMode(null);
    setAutoCalibrating(false);
    const overlay = overlayCanvasRef.current;
    if (overlay) {
      const ctx = overlay.getContext("2d")!;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, overlay.width, overlay.height);
      ctx.restore();
    }
    setStatus("idle");
  }, []);

  const startCamera = useCallback(async () => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("error");
      setError("This browser doesn't support camera access.");
      return;
    }
    try {
      // Color mode needs no model, so it also works offline.
      if (modeRef.current === "hand") {
        setStatus("loading-model");
        await ensureLandmarker();
      }

      setStatus("starting-camera");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play();

      resizeCanvas();
      lastTimeRef.current = null;
      lastHandSeenRef.current = 0;
      setStatus("running");
      rafRef.current = requestAnimationFrame(loop);
    } catch (e) {
      setStatus("error");
      setError(
        e instanceof Error && e.name === "NotAllowedError"
          ? "Camera access was denied. Allow camera permissions and try again."
          : "Couldn't load the hand-tracking model or start the camera. Check your connection and try again."
      );
    }
  }, [ensureLandmarker, loop, resizeCanvas]);

  // Switching to hand mode mid-session loads the model on demand.
  useEffect(() => {
    if (status !== "running" || mode !== "hand") return;
    ensureLandmarker().catch(() =>
      setError("Couldn't load the hand-tracking model. Check your connection and try again.")
    );
  }, [ensureLandmarker, mode, status]);

  // Auto-calibration: project solid black, grab a camera frame, project
  // solid white, grab another. The pixels that got much brighter are the
  // projection; its four extreme points (by x+y and x−y) are the corners.
  // This assumes the camera looks at the wall from roughly the projector's
  // side, so left/right and up/down aren't swapped.
  const autoCalibrate = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    setNotice(null);
    setPreviewMode(null);
    setAutoCalibrating(true);
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const luminance = (data: Uint8ClampedArray) => {
      const out = new Float32Array(CALIB_W * CALIB_H);
      for (let i = 0; i < out.length; i++) {
        out[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
      }
      return out;
    };
    try {
      flashPhaseRef.current = "black";
      await wait(CALIB_SETTLE_MS);
      const dark = luminance(grabFrame(video, CALIB_W, CALIB_H));
      flashPhaseRef.current = "white";
      await wait(CALIB_SETTLE_MS);
      const bright = luminance(grabFrame(video, CALIB_W, CALIB_H));
      flashPhaseRef.current = null;

      const diff = new Float32Array(dark.length);
      let maxDiff = 0;
      for (let i = 0; i < diff.length; i++) {
        diff[i] = bright[i] - dark[i];
        if (diff[i] > maxDiff) maxDiff = diff[i];
      }
      if (maxDiff < 25) {
        throw new Error(
          "The camera didn't see the wall change. Point the camera at the projection and try again."
        );
      }
      const mask = new Uint8Array(diff.length);
      for (let i = 0; i < diff.length; i++) mask[i] = diff[i] > maxDiff * 0.4 ? 1 : 0;
      const blobs = connectedComponents(mask, CALIB_W, CALIB_H);
      const blob = blobs.reduce((a, b) => (b.length > a.length ? b : a), [] as number[]);
      if (blob.length < CALIB_W * CALIB_H * 0.01) {
        throw new Error("The projection looks too small to the camera. Move the camera closer.");
      }
      let tl = blob[0];
      let tr = blob[0];
      let br = blob[0];
      let bl = blob[0];
      const xy = (i: number) => ({ x: i % CALIB_W, y: Math.floor(i / CALIB_W) });
      for (const i of blob) {
        const { x, y } = xy(i);
        const s = x + y;
        const d = x - y;
        if (s < xy(tl).x + xy(tl).y) tl = i;
        if (s > xy(br).x + xy(br).y) br = i;
        if (d > xy(tr).x - xy(tr).y) tr = i;
        if (d < xy(bl).x - xy(bl).y) bl = i;
      }
      const norm = (i: number) => {
        const { x, y } = xy(i);
        return { x: (x + 0.5) / CALIB_W, y: (y + 0.5) / CALIB_H };
      };
      const found = [norm(tl), norm(tr), norm(br), norm(bl)];
      if (!computeHomography(found, UNIT_SQUARE)) {
        throw new Error("Couldn't make sense of the projection's shape. Try manual calibration.");
      }
      setCorners(found);
      setCalibrated(true);
      setNotice("Calibrated! Check the pink outline in the camera view matches the projection.");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Auto-calibration failed.");
    } finally {
      flashPhaseRef.current = null;
      setAutoCalibrating(false);
    }
  }, [grabFrame]);

  // Manual calibration handles and color picking both work on the camera
  // preview, in normalized camera coordinates (0..1, not mirrored).
  const draggingRef = useRef<number | null>(null);
  const previewPoint = (e: React.PointerEvent): Point | null => {
    const box = previewBoxRef.current;
    if (!box) return null;
    const rect = box.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    };
  };

  const pickColorAt = (p: Point) => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(video, 0, 0);
    const half = 3;
    const cx = Math.round(p.x * canvas.width);
    const cy = Math.round(p.y * canvas.height);
    const { data } = ctx.getImageData(cx - half, cy - half, half * 2 + 1, half * 2 + 1);
    let r = 0;
    let g = 0;
    let b = 0;
    const n = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
    }
    const hex = (v: number) => Math.round(v / n).toString(16).padStart(2, "0");
    setTargetColor(`#${hex(r)}${hex(g)}${hex(b)}`);
    setPreviewMode(null);
  };

  const onPreviewPointerDown = (e: React.PointerEvent) => {
    const p = previewPoint(e);
    if (!p) return;
    if (previewMode === "pick") {
      pickColorAt(p);
      return;
    }
    const rect = previewBoxRef.current!.getBoundingClientRect();
    let best: number | null = null;
    let bestDist = 40; // px grab radius
    corners.forEach((c, i) => {
      const d = Math.hypot((c.x - p.x) * rect.width, (c.y - p.y) * rect.height);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    if (best !== null) {
      draggingRef.current = best;
      (e.target as Element).setPointerCapture?.(e.pointerId);
    }
  };
  const onPreviewPointerMove = (e: React.PointerEvent) => {
    const i = draggingRef.current;
    if (i === null) return;
    const p = previewPoint(e);
    if (!p) return;
    setCorners((prev) => prev.map((c, k) => (k === i ? p : c)));
    setCalibrated(true);
  };
  const onPreviewPointerUp = () => {
    draggingRef.current = null;
  };

  useEffect(() => {
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    return () => window.removeEventListener("resize", resizeCanvas);
  }, [resizeCanvas]);

  useEffect(() => {
    const handler = () => {
      setProjectorMode(!!document.fullscreenElement);
      resizeCanvas();
    };
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, [resizeCanvas]);

  useEffect(() => {
    if (!projectorMode) return;
    setShowHint(true);
    const timer = setTimeout(() => setShowHint(false), 5000);
    return () => clearTimeout(timer);
  }, [projectorMode]);

  useEffect(() => {
    return () => {
      stopCamera();
      landmarkerRef.current?.close();
      landmarkerRef.current = null;
      faceDetectorRef.current?.close();
      faceDetectorRef.current = null;
    };
  }, [stopCamera]);

  const toggleProjectorMode = useCallback(async () => {
    const el = containerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      setPreviewMode(null);
      await el.requestFullscreen?.();
    } else {
      await document.exitFullscreen?.();
    }
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      const key = e.key.toLowerCase();
      if (key === "p") toggleProjectorMode();
      else if (key === "c") clearWall();
      else if (key === "s") saveImage();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [clearWall, saveImage, toggleProjectorMode]);

  const isRunning = status === "running";
  const isBusy = status === "loading-model" || status === "starting-camera";
  const cornerLabels = ["TL", "TR", "BR", "BL"];
  const tested = penDownCount > 0;

  const step = (n: number, done: boolean, title: string) => (
    <div className="flex items-center gap-2">
      <span
        className={`flex h-5 w-5 flex-none items-center justify-center rounded-full text-[11px] font-bold ${
          done ? "bg-[#39ff14] text-black" : "bg-white/15 text-white"
        }`}
      >
        {done ? "✓" : n}
      </span>
      <span className={done ? "text-white/60" : "font-medium"}>{title}</span>
    </div>
  );

  return (
    <div ref={containerRef} className="relative h-screen w-full overflow-hidden bg-black">
      <canvas ref={paintCanvasRef} className="absolute inset-0 block" />
      <canvas ref={overlayCanvasRef} className="absolute inset-0 block" />

      {/* Camera preview for manual calibration / color picking. The video
          element always stays mounted here so the stream never restarts. */}
      <div
        className={
          previewMode
            ? "absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 p-6"
            : "hidden"
        }
      >
        <div
          ref={previewBoxRef}
          className="relative w-[min(70vw,calc(70vh*16/9))] cursor-crosshair touch-none select-none overflow-hidden rounded-lg ring-1 ring-white/30"
          onPointerDown={onPreviewPointerDown}
          onPointerMove={onPreviewPointerMove}
          onPointerUp={onPreviewPointerUp}
          onPointerCancel={onPreviewPointerUp}
        >
          <video ref={videoRef} className="block w-full opacity-80" muted playsInline />
          {previewMode === "calibrate" && (
            <>
              <svg
                className="pointer-events-none absolute inset-0 h-full w-full"
                viewBox="0 0 1 1"
                preserveAspectRatio="none"
              >
                <polygon
                  points={corners.map((c) => `${c.x},${c.y}`).join(" ")}
                  fill="rgba(255,45,149,0.12)"
                  stroke="#ff2d95"
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
              {corners.map((c, i) => (
                <div
                  key={i}
                  className="pointer-events-none absolute flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-[#ff2d95] text-[10px] font-bold text-white"
                  style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%` }}
                >
                  {cornerLabels[i]}
                </div>
              ))}
            </>
          )}
        </div>
        <div className="max-w-xl rounded-lg bg-black/70 px-4 py-3 text-center text-sm text-white/80">
          {previewMode === "calibrate" ? (
            <>
              Drag each handle onto the matching white corner of the projection
              as the camera sees it (TL = the projection's top-left).
              <div className="mt-3 flex justify-center gap-2">
                <button
                  onClick={() => setCorners(WALL_FACING_CORNERS)}
                  className="rounded-md bg-white/10 px-3 py-1.5 hover:bg-white/20"
                >
                  Reset
                </button>
                <button
                  onClick={() => setPreviewMode(null)}
                  className="rounded-md bg-white px-3 py-1.5 font-medium text-black hover:bg-white/90"
                >
                  Done
                </button>
              </div>
            </>
          ) : (
            <>
              Hold the pen up to the camera and click right on its tip.
              <div className="mt-3">
                <button
                  onClick={() => setPreviewMode(null)}
                  className="rounded-md bg-white/10 px-3 py-1.5 hover:bg-white/20"
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {!projectorMode && !previewMode && !autoCalibrating && (
        <div className="absolute top-4 left-4 z-10 max-h-[calc(100vh-2rem)] w-80 space-y-3 overflow-y-auto rounded-xl bg-black/70 p-4 text-sm text-white backdrop-blur">
          <h2 className="text-lg font-semibold">Graffiti Wall</h2>

          <div className="space-y-2 rounded-md bg-white/5 p-3">
            {step(1, isRunning, "Start the camera")}
            {!isRunning ? (
              <button
                onClick={startCamera}
                disabled={isBusy}
                className="ml-7 w-[calc(100%-1.75rem)] rounded-md bg-white px-3 py-2 font-medium text-black hover:bg-white/90 disabled:opacity-60"
              >
                {status === "loading-model"
                  ? "Loading hand model…"
                  : status === "starting-camera"
                  ? "Starting camera…"
                  : "Start Camera"}
              </button>
            ) : (
              <p className="ml-7 text-xs text-white/60">
                Put the camera next to the projector, pointing at the wall, so
                it sees the whole projection and people's hands in front of it.
              </p>
            )}

            {step(2, isRunning && calibrated, "Line the camera up with the wall")}
            <div className="ml-7 flex gap-2">
              <button
                onClick={autoCalibrate}
                disabled={!isRunning}
                className="flex-1 rounded-md bg-white/15 px-3 py-1.5 font-medium hover:bg-white/25 disabled:opacity-50"
              >
                Auto-calibrate
              </button>
              <button
                onClick={() => setPreviewMode("calibrate")}
                disabled={!isRunning}
                className="rounded-md bg-white/10 px-3 py-1.5 hover:bg-white/20 disabled:opacity-50"
              >
                Manual
              </button>
            </div>
            <p className="ml-7 text-xs text-white/50">
              The wall flashes black and white while the camera finds it. Keep
              people out of the way for those 2 seconds.
            </p>

            {step(3, tested, mode === "hand" ? "Test: pinch in front of the wall" : "Test: pen on the wall")}
            <p className="ml-7 text-xs text-white/60">
              {mode === "hand"
                ? "Thumb and index fingertips touching = spraying. Watch the fingertip dots below turn green."
                : "The tip should be circled green in the camera view below."}
            </p>

            {step(4, projectorMode, "Go fullscreen on the projector")}
            <button
              onClick={toggleProjectorMode}
              className="ml-7 w-[calc(100%-1.75rem)] rounded-md bg-white/10 px-3 py-1.5 font-medium hover:bg-white/20"
            >
              Enter Projector Mode (P)
            </button>
          </div>

          {error && <p className="text-red-400">{error}</p>}
          {notice && <p className="text-amber-300">{notice}</p>}

          {isRunning && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-white/60">
                <span>Camera view</span>
                <span>
                  {mode === "hand" ? "hands" : "pens"}: <span className="text-white">{penCount}</span>
                  {" · "}spraying: <span className="text-white">{penDownCount}</span>
                </span>
              </div>
              <canvas ref={cameraViewRef} className="block w-full rounded-md bg-black" />
            </div>
          )}

          <fieldset className="space-y-1">
            <legend className="mb-1 text-white/60">Track the pen by</legend>
            <label className="flex items-center gap-2">
              <input type="radio" checked={mode === "hand"} onChange={() => setMode("hand")} />
              Hand pinch (recommended)
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" checked={mode === "color"} onChange={() => setMode("color")} />
              Pen tip color
            </label>
          </fieldset>

          {mode === "hand" ? (
            <div className="space-y-2">
              <label className="block">
                Pinch sensitivity
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={pinchSensitivity}
                  onChange={(e) => setPinchSensitivity(Number(e.target.value))}
                  className="w-full"
                />
                <span className="text-xs text-white/50">
                  Higher = sprays with the fingers further apart (try this if
                  holding a thick pen doesn't trigger).
                </span>
              </label>
              <label className="flex items-center justify-between gap-2">
                Hands at once
                <select
                  value={maxHands}
                  onChange={(e) => setMaxHands(Number(e.target.value))}
                  className="rounded bg-white/10 px-2 py-1"
                >
                  {Array.from({ length: MAX_HANDS }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n} className="bg-black">
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={ignoreFaces}
                  onChange={(e) => setIgnoreFaces(e.target.checked)}
                />
                Ignore faces (stops faces counting as hands)
              </label>
              {ignoreFaces && isRunning && (
                <p
                  className={`text-xs ${
                    faceFilterStatus === "unavailable" ? "text-amber-300" : "text-white/60"
                  }`}
                >
                  Face filter:{" "}
                  {faceFilterStatus === "ready"
                    ? "active"
                    : faceFilterStatus === "loading"
                    ? "loading…"
                    : "unavailable — its model didn't load, so faces may still count as hands"}
                </p>
              )}
              <p className="text-xs text-white/50">
                In the camera view, faces get a blue box and anything rejected
                as "not a hand" is drawn red.
              </p>
            </div>
          ) : (
            <div className="space-y-2 rounded-md bg-white/5 p-2">
              <div className="flex items-center gap-2">
                <span
                  className="h-5 w-5 rounded-full ring-1 ring-white/40"
                  style={{ background: targetColor ?? "transparent" }}
                />
                <button
                  onClick={() => setPreviewMode("pick")}
                  disabled={!isRunning}
                  className="flex-1 rounded-md bg-white/10 px-3 py-1.5 hover:bg-white/20 disabled:opacity-50"
                >
                  {targetColor ? "Re-pick pen color" : "Pick pen color"}
                </button>
              </div>
              <label className="block">
                Color tolerance
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={tolerance}
                  onChange={(e) => setTolerance(Number(e.target.value))}
                  className="w-full"
                />
              </label>
              <p className="text-xs text-white/50">
                Pink in the camera view = everything matching the pen color. If
                other things light up, lower the tolerance. Avoid a pen color
                you're painting with — the camera sees the projected paint too.
              </p>
            </div>
          )}

          <label className="block">
            Steadiness
            <input
              type="range"
              min={0}
              max={100}
              value={steadiness}
              onChange={(e) => setSteadiness(Number(e.target.value))}
              className="w-full"
            />
            <span className="text-xs text-white/50">
              Higher = smoother, straighter lines that trail the hand a little.
              Lower = follows every tiny movement.
            </span>
          </label>
          <label className="block">
            Spray size
            <input
              type="range"
              min={0}
              max={100}
              value={brushSize}
              onChange={(e) => setBrushSize(Number(e.target.value))}
              className="w-full"
            />
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={dripsOn} onChange={(e) => setDripsOn(e.target.checked)} />
            Paint drips
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={showPalette}
              onChange={(e) => setShowPalette(e.target.checked)}
            />
            Color palette on the wall
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={showGuide} onChange={(e) => setShowGuide(e.target.checked)} />
            Instructions on the wall
          </label>

          <div className="flex gap-2">
            <button
              onClick={clearWall}
              className="flex-1 rounded-md bg-white/10 px-3 py-2 font-medium hover:bg-white/20"
            >
              Clear (C)
            </button>
            <button
              onClick={saveImage}
              className="flex-1 rounded-md bg-white/10 px-3 py-2 font-medium hover:bg-white/20"
            >
              Save PNG (S)
            </button>
            {isRunning && (
              <button
                onClick={stopCamera}
                className="rounded-md bg-white/10 px-3 py-2 font-medium hover:bg-white/20"
              >
                Stop
              </button>
            )}
          </div>
        </div>
      )}

      {projectorMode && showHint && (
        <div className="absolute top-6 left-1/2 z-10 -translate-x-1/2 rounded-full bg-black/50 px-4 py-2 text-xs text-white/70">
          Press P or Esc to exit projector mode
        </div>
      )}
    </div>
  );
};

export default GraffitiWall;
