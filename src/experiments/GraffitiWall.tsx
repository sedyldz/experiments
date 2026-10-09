import { useCallback, useEffect, useRef, useState } from "react";
import {
  FilesetResolver,
  HandLandmarker,
  type HandLandmarkerResult,
} from "@mediapipe/tasks-vision";
import { OneEuroFilter } from "../lib/oneEuroFilter";

const MAX_HANDS = 4;

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

// Thumb-tip-to-index-tip distance relative to hand size (wrist to middle
// knuckle). Holding a pen puts these two fingertips together, so a pen grip
// reads as a pinch. Two thresholds give hysteresis: the stroke starts below
// PEN_DOWN_RATIO and only ends once the fingers open past PEN_UP_RATIO, so
// tracking noise near the boundary can't break a line into dashes.
const PEN_DOWN_RATIO = 0.42;
const PEN_UP_RATIO = 0.6;

// A detection farther than this (fraction of the shorter screen side) from
// every known pen starts a new pen instead of continuing one.
const PEN_MATCH_FACTOR = 0.25;
// A pen not seen for this long is forgotten (and its color slot freed).
const PEN_FORGET_MS = 600;
// A pen that reappears within this gap keeps its stroke going; after a
// longer dropout the stroke restarts rather than jumping across the wall.
const STROKE_GAP_MS = 160;

// How long the pen has to hover over a swatch to pick it (and to wipe).
const PICK_HOLD_S = 0.55;
const CLEAR_HOLD_S = 1.3;

// Spray dabs are stamped every DAB_SPACING * radius along the stroke.
const DAB_SPACING = 0.28;
// A pen dwelling below this speed (px/s) soaks the wall and starts dripping.
const DRIP_SPEED = 420;
const DRIP_WETNESS = 0.45;
const MAX_DRIPS = 80;

// Color-tracking mode works on a downsampled camera frame for speed.
const COLOR_SAMPLE_W = 160;
const COLOR_SAMPLE_H = 120;
const COLOR_MIN_PIXELS = 6;

const CORNERS_STORAGE_KEY = "graffiti-wall:corners";

interface Point {
  x: number;
  y: number;
}

type TrackingMode = "hand" | "color";
type Status = "idle" | "loading-model" | "starting-camera" | "running" | "error";
type PreviewMode = null | "calibrate" | "pick";

interface Detection {
  x: number; // screen px
  y: number;
  // Hand mode: pinch ratio for pen up/down. Color mode: null (the tip being
  // visible at all means the pen is on the wall).
  pinchRatio: number | null;
}

interface Pen {
  x: number;
  y: number;
  filterX: OneEuroFilter;
  filterY: OneEuroFilter;
  down: boolean;
  color: number;
  lastSeen: number;
  prev: Point | null;
  prevTime: number;
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

// Corners of the projected image as the camera sees it, in normalized
// camera coordinates, ordered top-left, top-right, bottom-right,
// bottom-left *of the projection*. The default is the whole camera frame,
// mirrored, which is right for a webcam facing the people drawing.
const DEFAULT_CORNERS: Point[] = [
  { x: 1, y: 0 },
  { x: 0, y: 0 },
  { x: 0, y: 1 },
  { x: 1, y: 1 },
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
  return DEFAULT_CORNERS;
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

/**
 * Graffiti Wall
 *
 * A live projection-mapped spray-paint wall. A camera watches the wall
 * where a projector throws a (black) canvas; whoever picks up a pen and
 * holds it against the wall sprays paint where the pen tip is. Two ways
 * to find the pen:
 *
 * - Hand mode: MediaPipe hand tracking. A pen grip brings the thumb and
 *   index fingertips together, so "holding a pen" reads as a pinch and the
 *   paint comes out between those fingertips. Up to four hands at once.
 * - Color mode: click the pen's tip (a bright cap, sticker or LED) in the
 *   camera preview and the wall tracks that color instead. More precise
 *   when the camera sees the wall from behind people's hands.
 *
 * A four-corner calibration (a homography) maps what the camera sees onto
 * the projected image, so paint lands right where the pen is. Colors are
 * picked — and the wall wiped — by hovering the pen over a palette that's
 * projected along the bottom of the wall.
 */
const GraffitiWall = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const paintCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
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

  const [mode, setMode] = useState<TrackingMode>("hand");
  const [corners, setCorners] = useState<Point[]>(loadCorners);
  const [brushSize, setBrushSize] = useState(50);
  const [dripsOn, setDripsOn] = useState(true);
  const [showPalette, setShowPalette] = useState(true);
  const [targetColor, setTargetColor] = useState<string | null>(null);
  const [tolerance, setTolerance] = useState(40);

  const modeRef = useRef(mode);
  const homographyRef = useRef<number[] | null>(null);
  const brushSizeRef = useRef(brushSize);
  const dripsOnRef = useRef(dripsOn);
  const showPaletteRef = useRef(showPalette);
  const targetHsvRef = useRef<[number, number, number] | null>(null);
  const toleranceRef = useRef(tolerance);
  const previewModeRef = useRef<PreviewMode>(null);

  useEffect(() => {
    modeRef.current = mode;
    pensRef.current = [];
  }, [mode]);
  useEffect(() => {
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
    dripsOnRef.current = dripsOn;
  }, [dripsOn]);
  useEffect(() => {
    showPaletteRef.current = showPalette;
  }, [showPalette]);
  useEffect(() => {
    targetHsvRef.current = targetColor ? rgbToHsv(...hexToRgb(targetColor)) : null;
  }, [targetColor]);
  useEffect(() => {
    toleranceRef.current = tolerance;
  }, [tolerance]);

  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [projectorMode, setProjectorMode] = useState(false);
  const [showHint, setShowHint] = useState(true);
  const [penCount, setPenCount] = useState(0);
  const [previewMode, setPreviewMode] = useState<PreviewMode>(null);
  useEffect(() => {
    previewModeRef.current = previewMode;
  }, [previewMode]);

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
    const r = Math.min(width, height) * 0.032;
    const gap = r * 2.7;
    const count = PALETTE.length + 1;
    const startX = width / 2 - ((count - 1) * gap) / 2;
    const y = height - r * 1.8;
    return Array.from({ length: count }, (_, i) => ({ x: startX + i * gap, y, r }));
  }, []);

  // Finds the pen tip by color: every downsampled pixel close to the target
  // in hue/saturation/value votes, then the centroid is refined around the
  // densest area so a few stray matches elsewhere don't drag it off.
  const detectColorPen = useCallback((video: HTMLVideoElement): Point | null => {
    const target = targetHsvRef.current;
    if (!target) return null;
    let canvas = sampleCanvasRef.current;
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.width = COLOR_SAMPLE_W;
      canvas.height = COLOR_SAMPLE_H;
      sampleCanvasRef.current = canvas;
    }
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(video, 0, 0, COLOR_SAMPLE_W, COLOR_SAMPLE_H);
    const { data } = ctx.getImageData(0, 0, COLOR_SAMPLE_W, COLOR_SAMPLE_H);

    const tol = toleranceRef.current / 100;
    const hueTol = 10 + tol * 40;
    const svTol = 0.15 + tol * 0.45;
    const [th, ts, tv] = target;
    // Low-saturation targets (white LEDs, etc.) can't be matched on hue.
    const useHue = ts > 0.25;

    const xs: number[] = [];
    const ys: number[] = [];
    for (let y = 0; y < COLOR_SAMPLE_H; y++) {
      for (let x = 0; x < COLOR_SAMPLE_W; x++) {
        const i = (y * COLOR_SAMPLE_W + x) * 4;
        const [h, s, v] = rgbToHsv(data[i], data[i + 1], data[i + 2]);
        if (useHue) {
          const dh = Math.min(Math.abs(h - th), 360 - Math.abs(h - th));
          if (dh > hueTol || Math.abs(s - ts) > svTol || Math.abs(v - tv) > svTol * 1.3) continue;
        } else if (Math.abs(s - ts) > svTol * 0.6 || Math.abs(v - tv) > svTol * 0.6) {
          continue;
        }
        xs.push(x);
        ys.push(y);
      }
    }
    if (xs.length < COLOR_MIN_PIXELS) return null;

    let cx = xs.reduce((a, b) => a + b, 0) / xs.length;
    let cy = ys.reduce((a, b) => a + b, 0) / ys.length;
    const radius = COLOR_SAMPLE_W * 0.08;
    for (let iter = 0; iter < 3; iter++) {
      let sx = 0;
      let sy = 0;
      let n = 0;
      for (let k = 0; k < xs.length; k++) {
        if (Math.hypot(xs[k] - cx, ys[k] - cy) <= radius * (3 - iter)) {
          sx += xs[k];
          sy += ys[k];
          n++;
        }
      }
      if (n === 0) break;
      cx = sx / n;
      cy = sy / n;
    }
    return { x: (cx + 0.5) / COLOR_SAMPLE_W, y: (cy + 0.5) / COLOR_SAMPLE_H };
  }, []);

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
      const H = homographyRef.current;
      const tSec = time / 1000;
      const minSide = Math.min(width, height);
      const calibrating = previewModeRef.current !== null;

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
      if (modeRef.current === "hand") {
        const landmarker = landmarkerRef.current;
        if (landmarker) {
          const result: HandLandmarkerResult = landmarker.detectForVideo(video, time);
          const aspect = video.videoWidth / video.videoHeight;
          for (const lm of result.landmarks) {
            const thumb = lm[4];
            const index = lm[8];
            const wrist = lm[0];
            const knuckle = lm[9];
            const pinch = Math.hypot((thumb.x - index.x) * aspect, thumb.y - index.y);
            const handSize = Math.hypot((wrist.x - knuckle.x) * aspect, wrist.y - knuckle.y) || 1;
            const tip = toScreen({ x: (thumb.x + index.x) / 2, y: (thumb.y + index.y) / 2 });
            if (tip) detections.push({ ...tip, pinchRatio: pinch / handSize });
          }
        }
      } else {
        const tip = detectColorPen(video);
        const screen = tip && toScreen(tip);
        if (screen) detections.push({ ...screen, pinchRatio: null });
      }

      // 2. Match detections to known pens (nearest first) so each person
      // keeps their color and stroke from frame to frame.
      const pens = pensRef.current;
      const matchRadius = minSide * PEN_MATCH_FACTOR;
      const pairs: { d: number; di: number; pi: number }[] = [];
      detections.forEach((det, di) =>
        pens.forEach((pen, pi) => {
          const d = Math.hypot(det.x - pen.x, det.y - pen.y);
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
        const taken = new Set(pens.map((p) => p.color));
        const color = PALETTE.findIndex((_, i) => !taken.has(i));
        pens.push({
          x: det.x,
          y: det.y,
          filterX: new OneEuroFilter(1.2, 0.015, 1),
          filterY: new OneEuroFilter(1.2, 0.015, 1),
          down: false,
          color: color === -1 ? Math.floor(Math.random() * PALETTE.length) : color,
          lastSeen: time,
          prev: null,
          prevTime: time,
          speed: 0,
          wetness: 0,
          hoverSlot: null,
          hoverTime: 0,
        });
        detToPen.set(di, pens.length - 1);
      });

      // 3. Advance each seen pen: smoothing, palette, spraying, drips.
      const paintCtx = paint.getContext("2d")!;
      const swatches = paletteLayout(width, height);
      const baseRadius = minSide * (0.008 + (brushSizeRef.current / 100) * 0.03);

      detToPen.forEach((pi, di) => {
        const det = detections[di];
        const pen = pens[pi];
        const gap = time - pen.lastSeen;
        pen.lastSeen = time;
        const x = pen.filterX.filter(det.x, tSec);
        const y = pen.filterY.filter(det.y, tSec);
        const moved = Math.hypot(x - pen.x, y - pen.y);
        pen.speed = pen.speed * 0.7 + (moved / dt) * 0.3;
        pen.x = x;
        pen.y = y;

        pen.down =
          det.pinchRatio === null
            ? true
            : pen.down
            ? det.pinchRatio < PEN_UP_RATIO
            : det.pinchRatio < PEN_DOWN_RATIO;

        // Palette: hovering a swatch (pen down or not) fills a ring; once
        // full it picks that color, or for the wipe swatch clears the wall.
        let hover: number | null = null;
        if (showPaletteRef.current && !calibrating) {
          swatches.forEach((s, i) => {
            if (Math.hypot(x - s.x, y - s.y) < s.r * 1.35) hover = i;
          });
        }
        if (hover !== pen.hoverSlot) {
          pen.hoverSlot = hover;
          pen.hoverTime = 0;
        } else if (hover !== null) {
          pen.hoverTime += dt;
          const hold = hover === CLEAR_SLOT ? CLEAR_HOLD_S : PICK_HOLD_S;
          if (pen.hoverTime >= hold) {
            if (hover === CLEAR_SLOT) clearWall();
            else pen.color = hover;
            pen.hoverTime = -Infinity; // fire once per hover
          }
        }

        if (!pen.down || hover !== null || calibrating) {
          pen.prev = null;
          pen.wetness = 0;
          return;
        }

        const color = PALETTE[pen.color];
        // Fast strokes spray thinner, slow ones fatter — like a real can.
        const speedFactor = Math.max(0.55, Math.min(1.3, 1.3 - pen.speed / 2500));
        const radius = baseRadius * speedFactor;
        const from = pen.prev && gap < STROKE_GAP_MS ? pen.prev : { x, y };
        sprayStroke(paintCtx, from, { x, y }, radius, color);
        pen.prev = { x, y };

        if (dripsOnRef.current) {
          pen.wetness += dt * Math.max(0, 1 - pen.speed / DRIP_SPEED);
          if (pen.wetness > DRIP_WETNESS && dripsRef.current.length < MAX_DRIPS) {
            pen.wetness = -Math.random() * 0.4;
            dripsRef.current.push({
              x: x + (Math.random() - 0.5) * radius * 0.9,
              y: y + radius * 0.35,
              vy: 35 + Math.random() * 45,
              width: radius * (0.12 + Math.random() * 0.12),
              remaining: radius * (1.5 + Math.random() * 5),
              color,
            });
          }
        }
      });

      pensRef.current = pens.filter((pen) => time - pen.lastSeen < PEN_FORGET_MS);
      const visiblePens = pensRef.current.filter((p) => p.lastSeen === time);
      if (visiblePens.length !== penCountRef.current) {
        penCountRef.current = visiblePens.length;
        setPenCount(visiblePens.length);
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

      // 5. Overlay: palette, pen cursors, calibration markers.
      const octx = overlay.getContext("2d")!;
      octx.clearRect(0, 0, width, height);

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

      if (showPaletteRef.current && !calibrating) {
        swatches.forEach((s, i) => {
          const selectedBy = pensRef.current.some((p) => p.color === i);
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
            if (selectedBy) {
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
          const hold = pen.hoverSlot === CLEAR_SLOT ? CLEAR_HOLD_S : PICK_HOLD_S;
          const progress = Math.min(pen.hoverTime / hold, 1);
          octx.strokeStyle = "#fff";
          octx.lineWidth = 4;
          octx.beginPath();
          octx.arc(s.x, s.y, s.r * 1.55, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
          octx.stroke();
        }
      }

      for (const pen of visiblePens) {
        const color = PALETTE[pen.color];
        const r = baseRadius * 0.6 + 4;
        octx.beginPath();
        octx.arc(pen.x, pen.y, r, 0, Math.PI * 2);
        octx.strokeStyle = color;
        octx.lineWidth = 2;
        octx.stroke();
        if (!pen.down) {
          octx.beginPath();
          octx.arc(pen.x, pen.y, 2.5, 0, Math.PI * 2);
          octx.fillStyle = color;
          octx.fill();
        }
      }
    },
    [clearWall, detectColorPen, paletteLayout, sprayStroke]
  );

  const ensureLandmarker = useCallback(async () => {
    if (landmarkerRef.current) return landmarkerRef.current;
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
    );
    const baseOptions = {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
    };
    let landmarker: HandLandmarker;
    try {
      landmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: { ...baseOptions, delegate: "GPU" },
        runningMode: "VIDEO",
        numHands: MAX_HANDS,
      });
    } catch {
      landmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: { ...baseOptions, delegate: "CPU" },
        runningMode: "VIDEO",
        numHands: MAX_HANDS,
      });
    }
    landmarkerRef.current = landmarker;
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
    pensRef.current = [];
    penCountRef.current = 0;
    setPenCount(0);
    setPreviewMode(null);
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

  // Calibration handles and color picking both work on the camera preview,
  // in normalized camera coordinates (0..1, not mirrored).
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
    const timer = setTimeout(() => setShowHint(false), 7000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    return () => {
      stopCamera();
      landmarkerRef.current?.close();
      landmarkerRef.current = null;
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

  return (
    <div ref={containerRef} className="relative h-screen w-full overflow-hidden bg-black">
      <canvas ref={paintCanvasRef} className="absolute inset-0 block" />
      <canvas ref={overlayCanvasRef} className="absolute inset-0 block" />

      {/* Camera preview for calibration / color picking. The video element
          always stays mounted here so the stream never restarts. */}
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
              as the camera sees it (TL = the projection's top-left). Paint
              then lands exactly under the pen.
              <div className="mt-3 flex justify-center gap-2">
                <button
                  onClick={() => setCorners(DEFAULT_CORNERS)}
                  className="rounded-md bg-white/10 px-3 py-1.5 hover:bg-white/20"
                >
                  Reset (camera facing people)
                </button>
                <button
                  onClick={() =>
                    setCorners([
                      { x: 0, y: 0 },
                      { x: 1, y: 0 },
                      { x: 1, y: 1 },
                      { x: 0, y: 1 },
                    ])
                  }
                  className="rounded-md bg-white/10 px-3 py-1.5 hover:bg-white/20"
                >
                  Reset (camera facing wall)
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
              Hold the pen up to the camera and click its tip (a bright cap,
              sticker or LED works best).
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

      {!projectorMode && !previewMode && (
        <div className="absolute top-4 left-4 z-10 max-h-[calc(100vh-2rem)] w-72 space-y-3 overflow-y-auto rounded-xl bg-black/60 p-4 text-sm text-white backdrop-blur">
          <h2 className="text-lg font-semibold">Graffiti Wall</h2>
          <p className="text-white/70">
            Project this on a wall and point a camera at it. Grab a pen and
            hold it to the wall to spray paint; linger and it drips. Hover the
            pen over a color at the bottom to switch colors, or over the ✕ to
            wipe the wall.
          </p>

          {!isRunning ? (
            <button
              onClick={startCamera}
              disabled={isBusy}
              className="w-full rounded-md bg-white px-3 py-2 font-medium text-black hover:bg-white/90 disabled:opacity-60"
            >
              {status === "loading-model"
                ? "Loading model…"
                : status === "starting-camera"
                ? "Starting camera…"
                : "Start Camera"}
            </button>
          ) : (
            <button
              onClick={stopCamera}
              className="w-full rounded-md bg-white/10 px-3 py-2 font-medium hover:bg-white/20"
            >
              Stop Camera
            </button>
          )}

          {error && <p className="text-red-400">{error}</p>}
          {isRunning && (
            <p className="text-white/60">
              Pens on the wall: <span className="text-white">{penCount}</span>
            </p>
          )}

          <fieldset className="space-y-1">
            <legend className="mb-1 text-white/60">Track the pen by</legend>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={mode === "hand"}
                onChange={() => setMode("hand")}
              />
              Hand grip (thumb + index together)
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={mode === "color"}
                onChange={() => setMode("color")}
              />
              Pen tip color
            </label>
          </fieldset>

          {mode === "color" && (
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
            </div>
          )}

          <button
            onClick={() => setPreviewMode("calibrate")}
            disabled={!isRunning}
            className="w-full rounded-md bg-white/10 px-3 py-2 font-medium hover:bg-white/20 disabled:opacity-50"
          >
            Calibrate Camera → Wall
          </button>

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
            <input
              type="checkbox"
              checked={dripsOn}
              onChange={(e) => setDripsOn(e.target.checked)}
            />
            Paint drips
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={showPalette}
              onChange={(e) => setShowPalette(e.target.checked)}
            />
            Show palette on the wall
          </label>

          <div className="flex gap-2">
            <button
              onClick={clearWall}
              className="flex-1 rounded-md bg-white/10 px-3 py-2 font-medium hover:bg-white/20"
            >
              Clear
            </button>
            <button
              onClick={saveImage}
              className="flex-1 rounded-md bg-white/10 px-3 py-2 font-medium hover:bg-white/20"
            >
              Save PNG
            </button>
          </div>

          <button
            onClick={toggleProjectorMode}
            className="w-full rounded-md bg-white/10 px-3 py-2 font-medium hover:bg-white/20"
          >
            Enter Projector Mode
          </button>
          <p className="text-xs text-white/50">
            Keys: <kbd className="rounded bg-white/10 px-1">P</kbd> projector
            mode, <kbd className="rounded bg-white/10 px-1">C</kbd> clear,{" "}
            <kbd className="rounded bg-white/10 px-1">S</kbd> save. Calibration
            is remembered in this browser. First start may take a few seconds
            while the hand-tracking model downloads.
          </p>
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
