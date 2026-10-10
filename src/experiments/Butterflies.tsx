import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import * as THREE from "three";
import {
  FilesetResolver,
  HandLandmarker,
  type HandLandmarkerResult,
} from "@mediapipe/tasks-vision";
import { createLandmarkFilters, type LandmarkFilter } from "../lib/OneEuroFilter";

const MAX_HANDS = 4;
const LANDMARKS_PER_HAND = 21;
const DEFAULT_COUNT = 14;

const LAYOUT_STORAGE_KEY = "butterflies.layout.v1";
const CALIBRATION_STORAGE_KEY = "butterflies.calibration.v1";

// Where the four calibration targets are drawn on the projection, in
// normalized screen coordinates (inset from the edges so they're easy to see
// and click in the camera image). The homography extrapolates past them.
const CALIBRATION_TARGETS: Point[] = [
  { x: 0.1, y: 0.1 },
  { x: 0.9, y: 0.1 },
  { x: 0.9, y: 0.9 },
  { x: 0.1, y: 0.9 },
];
const CALIBRATION_LABELS = ["top-left", "top-right", "bottom-right", "bottom-left"];

// Wing outline, in units of one wing length. The right-hand wings extend
// toward +x from the body (which runs along +y, head forward); the left
// wings are the same shapes mirrored.
const WING_BOUNDS = { minX: 0, maxX: 1.1, minY: -0.85, maxY: 0.85 };

interface Point {
  x: number;
  y: number;
}

interface LayoutEntry {
  id: number;
  // Normalized screen position (0..1, origin top-left).
  x: number;
  y: number;
  species: number;
  // Which way the butterfly faces while resting, in radians.
  heading: number;
}

type FlightState = "resting" | "fleeing" | "away" | "returning" | "landing";

interface Butterfly {
  id: number;
  group: THREE.Group;
  leftFore: THREE.Group;
  leftHind: THREE.Group;
  rightFore: THREE.Group;
  rightHind: THREE.Group;
  state: FlightState;
  stateTime: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  heading: number;
  pitch: number;
  bank: number;
  flapPhase: number;
  flapFreq: number;
  wingOpen: number;
  restPhase: number;
  restSpeed: number;
  seeds: number[];
  speedJitter: number;
  awayTimer: number;
  exitTarget: THREE.Vector3;
  exitDir: number;
  // A startle passed on from a neighbour that took off: fires at this time.
  scareAt: number | null;
  scareFrom: Point | null;
  landFrom: { pos: THREE.Vector3; heading: number; pitch: number; bank: number; wing: number };
}

type Status = "idle" | "loading-model" | "starting-camera" | "running" | "error";

interface WingPalette {
  name: string;
  inner: string;
  outer: string;
  vein: string;
  edge: string;
  border: number;
  spot: string;
  extra?: (ctx: CanvasRenderingContext2D, isFore: boolean, toCanvas: (x: number, y: number) => Point) => void;
}

// Light-heavy palettes: a projector can only add light, so anything painted
// "black" just shows the bare surface underneath. Bright, saturated regions
// are what read on a lit surface (especially a coloured one, like a yellow
// duct, which swallows most blue).
const PALETTES: WingPalette[] = [
  {
    name: "Monarch",
    inner: "#ffc04a",
    outer: "#f06a12",
    vein: "#1c0f06",
    edge: "#150a04",
    border: 0.11,
    spot: "#fff4dc",
  },
  {
    name: "Admiral",
    inner: "#3a2228",
    outer: "#21141a",
    vein: "#120a0d",
    edge: "#0e0709",
    border: 0.06,
    spot: "#ffffff",
    extra: (ctx, isFore, toCanvas) => {
      ctx.fillStyle = "#ff3a2a";
      ctx.beginPath();
      if (isFore) {
        const a = toCanvas(0.35, 0.62);
        const b = toCanvas(0.62, 0.78);
        const c = toCanvas(0.82, 0.32);
        const d = toCanvas(0.6, 0.18);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.lineTo(c.x, c.y);
        ctx.lineTo(d.x, d.y);
      } else {
        const a = toCanvas(0.45, -0.1);
        const b = toCanvas(0.9, -0.25);
        const c = toCanvas(0.62, -0.78);
        const d = toCanvas(0.3, -0.62);
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo(b.x, b.y, c.x, c.y);
        ctx.lineTo(d.x, d.y);
        ctx.quadraticCurveTo(toCanvas(0.62, -0.45).x, toCanvas(0.62, -0.45).y, a.x, a.y);
      }
      ctx.fill();
      if (isFore) {
        ctx.fillStyle = "#ffffff";
        for (const [x, y, r] of [
          [0.84, 0.66, 0.035],
          [0.75, 0.71, 0.03],
          [0.88, 0.55, 0.025],
        ]) {
          const p = toCanvas(x, y);
          ctx.beginPath();
          ctx.arc(p.x, p.y, r * 300, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    },
  },
  {
    name: "Morpho",
    inner: "#9cf6ff",
    outer: "#2a7dff",
    vein: "#0b2f86",
    edge: "#061538",
    border: 0.12,
    spot: "#e8fbff",
  },
  {
    name: "Rose",
    inner: "#ffd6f5",
    outer: "#ff3fb0",
    vein: "#5c0f46",
    edge: "#3a0830",
    border: 0.08,
    spot: "#ffffff",
  },
  {
    name: "Cabbage white",
    inner: "#ffffff",
    outer: "#f4f2e6",
    vein: "#cfc9ac",
    edge: "#333333",
    border: 0.035,
    spot: "#ffffff",
    extra: (ctx, isFore, toCanvas) => {
      if (!isFore) return;
      ctx.fillStyle = "#2a2a2a";
      const tip = toCanvas(0.92, 0.7);
      ctx.beginPath();
      ctx.arc(tip.x, tip.y, 0.16 * 300, 0, Math.PI * 2);
      ctx.fill();
      const dot = toCanvas(0.6, 0.38);
      ctx.beginPath();
      ctx.arc(dot.x, dot.y, 0.05 * 300, 0, Math.PI * 2);
      ctx.fill();
    },
  },
];

function createForewingShape() {
  const s = new THREE.Shape();
  s.moveTo(0.02, 0.03);
  s.bezierCurveTo(0.22, 0.42, 0.55, 0.8, 0.95, 0.8);
  s.bezierCurveTo(1.07, 0.62, 0.98, 0.36, 0.82, 0.2);
  s.bezierCurveTo(0.58, 0.04, 0.28, -0.03, 0.02, -0.04);
  s.closePath();
  return s;
}

function createHindwingShape() {
  const s = new THREE.Shape();
  s.moveTo(0.02, -0.02);
  s.bezierCurveTo(0.35, 0.06, 0.78, -0.02, 0.82, -0.3);
  s.bezierCurveTo(0.86, -0.56, 0.58, -0.8, 0.3, -0.72);
  s.bezierCurveTo(0.12, -0.62, 0.04, -0.36, 0.02, -0.06);
  s.closePath();
  return s;
}

// ShapeGeometry's default UVs are the raw shape coordinates; remap them into
// the 0..1 square the wing texture is painted in (see paintWingTexture).
function createWingGeometry(shape: THREE.Shape) {
  const geometry = new THREE.ShapeGeometry(shape, 24);
  const pos = geometry.getAttribute("position") as THREE.BufferAttribute;
  const uv = geometry.getAttribute("uv") as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(
      i,
      (pos.getX(i) - WING_BOUNDS.minX) / (WING_BOUNDS.maxX - WING_BOUNDS.minX),
      (pos.getY(i) - WING_BOUNDS.minY) / (WING_BOUNDS.maxY - WING_BOUNDS.minY)
    );
  }
  uv.needsUpdate = true;
  return geometry;
}

// Paints both wings of one species into a single texture, in the same
// coordinate space as createWingGeometry's UVs: a radial gradient from the
// body, dark veins fanning out from the wing root, a dark border, and pale
// spots just inside the outer edge.
function paintWingTexture(palette: WingPalette, fore: THREE.Shape, hind: THREE.Shape) {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const toCanvas = (x: number, y: number): Point => ({
    x: ((x - WING_BOUNDS.minX) / (WING_BOUNDS.maxX - WING_BOUNDS.minX)) * size,
    y: (1 - (y - WING_BOUNDS.minY) / (WING_BOUNDS.maxY - WING_BOUNDS.minY)) * size,
  });
  const unit = size / (WING_BOUNDS.maxX - WING_BOUNDS.minX);

  const paint = (shape: THREE.Shape, isFore: boolean) => {
    const pts = shape.getPoints(48).map((p) => toCanvas(p.x, p.y));
    const tracePath = () => {
      ctx.beginPath();
      pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.closePath();
    };

    ctx.save();
    tracePath();
    ctx.clip();

    const root = toCanvas(0, 0);
    const gradient = ctx.createRadialGradient(root.x, root.y, 0, root.x, root.y, unit * 0.95);
    gradient.addColorStop(0, palette.inner);
    gradient.addColorStop(1, palette.outer);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    palette.extra?.(ctx, isFore, toCanvas);

    // Veins: from the root out to evenly spaced points on the outer edge.
    ctx.strokeStyle = palette.vein;
    ctx.lineCap = "round";
    const outerStart = Math.floor(pts.length * 0.12);
    const outerEnd = Math.floor(pts.length * 0.88);
    for (let i = outerStart; i <= outerEnd; i += 5) {
      const p = pts[i];
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(root.x, root.y);
      ctx.quadraticCurveTo((root.x + p.x) / 2 + 6, (root.y + p.y) / 2 - 6, p.x, p.y);
      ctx.stroke();
    }

    ctx.strokeStyle = palette.edge;
    ctx.lineWidth = palette.border * unit * 2;
    tracePath();
    ctx.stroke();

    ctx.fillStyle = palette.spot;
    for (let i = outerStart + 2; i < outerEnd; i += 4) {
      const p = pts[i];
      const inset = palette.border * 0.55;
      const sx = p.x + (root.x - p.x) * inset;
      const sy = p.y + (root.y - p.y) * inset;
      ctx.beginPath();
      ctx.arc(sx, sy, Math.max(2, palette.border * unit * 0.22), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  };

  paint(fore, true);
  paint(hind, false);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

// Solves for the 3x3 perspective transform (h33 = 1) mapping 4 source points
// onto 4 destination points, by Gaussian elimination on the standard 8x8
// direct linear transform system.
function computeHomography(src: Point[], dst: Point[]): number[] | null {
  const a: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let r = col + 1; r < 8; r++) {
      if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    }
    if (Math.abs(a[pivot][col]) < 1e-10) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    for (let r = 0; r < 8; r++) {
      if (r === col) continue;
      const f = a[r][col] / a[col][col];
      for (let c = col; c < 9; c++) a[r][c] -= f * a[col][c];
    }
  }
  return a.map((row, i) => row[8] / row[i]);
}

function applyHomography(h: number[], x: number, y: number): Point {
  const w = h[6] * x + h[7] * y + 1;
  return { x: (h[0] * x + h[1] * y + h[2]) / w, y: (h[3] * x + h[4] * y + h[5]) / w };
}

function loadJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function saveJson(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked (private window etc.) — the layout just won't persist.
  }
}

let nextLayoutId = 1;
function makeEntry(x: number, y: number): LayoutEntry {
  return {
    id: nextLayoutId++,
    x,
    y,
    species: Math.floor(Math.random() * PALETTES.length),
    heading: Math.PI / 2 + (Math.random() - 0.5) * 1.6,
  };
}

function scatterLayout(count: number): LayoutEntry[] {
  const entries: LayoutEntry[] = [];
  let attempts = 0;
  while (entries.length < count && attempts < 2000) {
    attempts++;
    // A loose cluster around the middle of the screen (sqrt keeps the
    // density even across the ellipse instead of bunching at the center).
    const r = Math.sqrt(Math.random());
    const a = Math.random() * Math.PI * 2;
    const x = 0.5 + Math.cos(a) * r * 0.3;
    const y = 0.5 + Math.sin(a) * r * 0.3;
    if (entries.every((e) => Math.hypot(e.x - x, (e.y - y) * 0.6) > 0.07)) {
      entries.push(makeEntry(x, y));
    }
  }
  return entries;
}

function loadLayout(): LayoutEntry[] {
  const saved = loadJson<LayoutEntry[]>(LAYOUT_STORAGE_KEY);
  if (Array.isArray(saved)) {
    return saved
      .filter((e) => typeof e?.x === "number" && typeof e?.y === "number")
      .map((e) => ({
        ...makeEntry(e.x, e.y),
        species: Number.isInteger(e.species) ? e.species % PALETTES.length : 0,
        heading: typeof e.heading === "number" ? e.heading : Math.PI / 2,
      }));
  }
  return scatterLayout(DEFAULT_COUNT);
}

function lerpAngle(a: number, b: number, t: number) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function smoothstep(t: number) {
  return t * t * (3 - 2 * t);
}

interface SharedAssets {
  foreGeometry: THREE.BufferGeometry;
  hindGeometry: THREE.BufferGeometry;
  bodyGeometry: THREE.BufferGeometry;
  headGeometry: THREE.BufferGeometry;
  antennaGeometry: THREE.BufferGeometry;
  clubGeometry: THREE.BufferGeometry;
  wingMaterials: THREE.MeshStandardMaterial[];
  bodyMaterial: THREE.MeshStandardMaterial;
}

function createButterflyMesh(assets: SharedAssets, species: number) {
  const group = new THREE.Group();
  const wingMaterial = assets.wingMaterials[species % assets.wingMaterials.length];

  const body = new THREE.Mesh(assets.bodyGeometry, assets.bodyMaterial);
  body.position.y = -0.05;
  group.add(body);
  const head = new THREE.Mesh(assets.headGeometry, assets.bodyMaterial);
  head.position.y = 0.24;
  group.add(head);
  for (const side of [-1, 1]) {
    const antenna = new THREE.Mesh(assets.antennaGeometry, assets.bodyMaterial);
    antenna.scale.x = side;
    group.add(antenna);
    const club = new THREE.Mesh(assets.clubGeometry, assets.bodyMaterial);
    club.position.set(0.13 * side, 0.56, 0.08);
    group.add(club);
  }

  // Each wing hangs off its own hinge on the body's long axis, so flapping is
  // a rotation about local y. The left wings are mirrored copies.
  const makeWing = (geometry: THREE.BufferGeometry, side: number) => {
    const hinge = new THREE.Group();
    hinge.position.set(0.03 * side, 0.02, 0);
    const mesh = new THREE.Mesh(geometry, wingMaterial);
    mesh.scale.x = side;
    hinge.add(mesh);
    group.add(hinge);
    return hinge;
  };

  return {
    group,
    rightFore: makeWing(assets.foreGeometry, 1),
    rightHind: makeWing(assets.hindGeometry, 1),
    leftFore: makeWing(assets.foreGeometry, -1),
    leftHind: makeWing(assets.hindGeometry, -1),
  };
}

/**
 * Butterflies
 *
 * A projection-mapping sketch: 3D butterflies rest on whatever surface you
 * project onto. A webcam watches the same surface (MediaPipe's
 * HandLandmarker, fully client-side); when a hand reaches into a
 * butterfly's spot it takes off, startling its neighbours, flutters up and
 * out of the projection, and after a while flies back and lands exactly
 * where it was. Butterflies are placed by painting them onto the
 * projection in edit mode, and a 4-corner calibration maps the camera's
 * view onto the projected image so hands line up with the real surface.
 */
const Butterflies = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);

  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const assetsRef = useRef<SharedAssets | null>(null);
  const butterfliesRef = useRef<Map<number, Butterfly>>(new Map());
  const handPointsMeshRef = useRef<THREE.Points | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number | null>(null);
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const cameraRunningRef = useRef(false);
  const landmarkFiltersRef = useRef<LandmarkFilter[][]>(
    Array.from({ length: MAX_HANDS }, () => createLandmarkFilters(LANDMARKS_PER_HAND))
  );
  const handPointsRef = useRef<Point[]>([]); // world coords, all landmarks of all hands
  const mouseRef = useRef<Point | null>(null); // world coords
  const sizeRef = useRef({ width: 0, height: 0 });
  const handCountRef = useRef(0);

  const [layout, setLayout] = useState<LayoutEntry[]>(loadLayout);
  const layoutRef = useRef(layout);
  useEffect(() => {
    layoutRef.current = layout;
    saveJson(
      LAYOUT_STORAGE_KEY,
      layout.map(({ x, y, species, heading }) => ({ x, y, species, heading }))
    );
  }, [layout]);

  const [calibration, setCalibration] = useState<number[] | null>(
    () => loadJson<number[]>(CALIBRATION_STORAGE_KEY)
  );
  const calibrationRef = useRef(calibration);
  useEffect(() => {
    calibrationRef.current = calibration;
    saveJson(CALIBRATION_STORAGE_KEY, calibration);
  }, [calibration]);

  const [sizePct, setSizePct] = useState(100);
  const [sensitivity, setSensitivity] = useState(50);
  const [returnDelay, setReturnDelay] = useState(5);
  const [mirror, setMirror] = useState(true);
  const [showHand, setShowHand] = useState(false);
  const [mouseScares, setMouseScares] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const settingsRef = useRef({ sizePct, sensitivity, returnDelay, mirror, showHand, mouseScares, editMode });
  useEffect(() => {
    settingsRef.current = { sizePct, sensitivity, returnDelay, mirror, showHand, mouseScares, editMode };
  }, [sizePct, sensitivity, returnDelay, mirror, showHand, mouseScares, editMode]);

  const [calibrating, setCalibrating] = useState(false);
  const calibratingRef = useRef(false);
  useEffect(() => {
    calibratingRef.current = calibrating;
  }, [calibrating]);
  const [calibrationClicks, setCalibrationClicks] = useState<Point[]>([]);

  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [projectorMode, setProjectorMode] = useState(false);
  const [showHint, setShowHint] = useState(true);
  const [handCount, setHandCount] = useState(0);

  // Scene, lights and the geometry/material set every butterfly shares.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    // Pure black: on a projector that's "no light", so the real surface
    // shows through everywhere except the butterflies themselves.
    scene.background = new THREE.Color(0x000000);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(50, 1, 1, 5000);
    camera.position.set(0, 0, 800);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.6);
    keyLight.position.set(0.35, 0.6, 1);
    scene.add(keyLight);

    const foreShape = createForewingShape();
    const hindShape = createHindwingShape();
    const wingMaterials = PALETTES.map((palette) => {
      const map = paintWingTexture(palette, foreShape, hindShape);
      return new THREE.MeshStandardMaterial({
        map,
        emissiveMap: map,
        emissive: 0xffffff,
        emissiveIntensity: 0.35,
        roughness: 0.65,
        metalness: 0,
        side: THREE.DoubleSide,
      });
    });
    const antennaCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.02, 0.27, 0.02),
      new THREE.Vector3(0.07, 0.42, 0.06),
      new THREE.Vector3(0.13, 0.56, 0.08),
    ]);
    const assets: SharedAssets = {
      foreGeometry: createWingGeometry(foreShape),
      hindGeometry: createWingGeometry(hindShape),
      bodyGeometry: new THREE.CapsuleGeometry(0.045, 0.42, 4, 10),
      headGeometry: new THREE.SphereGeometry(0.06, 12, 10),
      antennaGeometry: new THREE.TubeGeometry(antennaCurve, 8, 0.008, 5, false),
      clubGeometry: new THREE.SphereGeometry(0.02, 8, 6),
      wingMaterials,
      bodyMaterial: new THREE.MeshStandardMaterial({
        color: 0x5a4030,
        emissive: 0x2a1a10,
        roughness: 0.9,
      }),
    };
    assetsRef.current = assets;

    const handGeometry = new THREE.BufferGeometry();
    handGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(MAX_HANDS * LANDMARKS_PER_HAND * 3), 3)
    );
    const handMaterial = new THREE.PointsMaterial({
      color: 0x9fe8ff,
      size: 7,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.8,
    });
    const handPoints = new THREE.Points(handGeometry, handMaterial);
    handPoints.frustumCulled = false;
    handPoints.visible = false;
    scene.add(handPoints);
    handPointsMeshRef.current = handPoints;

    const butterflies = butterfliesRef.current;
    return () => {
      butterflies.forEach((b) => scene.remove(b.group));
      butterflies.clear();
      renderer.dispose();
      assets.foreGeometry.dispose();
      assets.hindGeometry.dispose();
      assets.bodyGeometry.dispose();
      assets.headGeometry.dispose();
      assets.antennaGeometry.dispose();
      assets.clubGeometry.dispose();
      assets.bodyMaterial.dispose();
      wingMaterials.forEach((m) => {
        m.map?.dispose();
        m.dispose();
      });
      handGeometry.dispose();
      handMaterial.dispose();
      assetsRef.current = null;
    };
  }, []);

  // Keeps one live butterfly per layout entry: new entries get a fresh
  // butterfly resting at its spot, removed entries' butterflies are dropped.
  useEffect(() => {
    const scene = sceneRef.current;
    const assets = assetsRef.current;
    if (!scene || !assets) return;
    const butterflies = butterfliesRef.current;
    const ids = new Set(layout.map((e) => e.id));
    butterflies.forEach((b, id) => {
      if (!ids.has(id)) {
        scene.remove(b.group);
        butterflies.delete(id);
      }
    });
    for (const entry of layout) {
      if (butterflies.has(entry.id)) continue;
      const mesh = createButterflyMesh(assets, entry.species);
      scene.add(mesh.group);
      butterflies.set(entry.id, {
        id: entry.id,
        ...mesh,
        state: "resting",
        stateTime: 0,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        heading: entry.heading,
        pitch: 0,
        bank: 0,
        flapPhase: Math.random() * Math.PI * 2,
        flapFreq: 8 + Math.random() * 3,
        wingOpen: 0.3,
        restPhase: Math.random() * Math.PI * 2,
        restSpeed: 0.6 + Math.random() * 0.9,
        seeds: Array.from({ length: 4 }, () => Math.random() * 100),
        speedJitter: 0.85 + Math.random() * 0.3,
        awayTimer: 0,
        exitTarget: new THREE.Vector3(),
        exitDir: 0,
        scareAt: null,
        scareFrom: null,
        landFrom: { pos: new THREE.Vector3(), heading: 0, pitch: 0, bank: 0, wing: 0 },
      });
    }
  }, [layout]);

  const resizeCanvas = useCallback(() => {
    const container = containerRef.current;
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    if (!container) return;
    const { width, height } = container.getBoundingClientRect();
    sizeRef.current = { width, height };
    if (width <= 0 || height <= 0 || !renderer || !camera) return;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    // Place the camera so the z=0 plane (the projected surface) maps 1:1 to
    // screen pixels; anything that rises toward the camera grows in size.
    const fovRad = (camera.fov * Math.PI) / 180;
    const cameraZ = height / (2 * Math.tan(fovRad / 2));
    camera.position.z = cameraZ;
    camera.far = cameraZ * 4;
    camera.updateProjectionMatrix();
  }, []);

  // Turns raw camera-frame landmarks (normalized, as MediaPipe gives them)
  // into screen pixels: through the calibration homography when there is
  // one, otherwise by stretching the camera frame over the screen.
  const cameraToScreen = useCallback((x: number, y: number, width: number, height: number) => {
    const h = calibrationRef.current;
    if (h) {
      const p = applyHomography(h, x, y);
      return { x: p.x * width, y: p.y * height };
    }
    return { x: (settingsRef.current.mirror ? 1 - x : x) * width, y: y * height };
  }, []);

  const detectHands = useCallback(
    (time: number, width: number, height: number) => {
      const video = videoRef.current;
      const landmarker = landmarkerRef.current;
      if (!cameraRunningRef.current || !video || !landmarker) return;
      if (video.videoWidth === 0 || video.videoHeight === 0) return;

      if (calibratingRef.current) {
        const preview = previewRef.current;
        const ctx = preview?.getContext("2d");
        if (preview && ctx) {
          if (preview.width !== video.videoWidth) {
            preview.width = video.videoWidth;
            preview.height = video.videoHeight;
          }
          ctx.drawImage(video, 0, 0, preview.width, preview.height);
        }
      }

      const result: HandLandmarkerResult = landmarker.detectForVideo(video, time);
      const tSec = time / 1000;
      const points: Point[] = [];
      result.landmarks.slice(0, MAX_HANDS).forEach((landmarks, h) => {
        const filters = landmarkFiltersRef.current[h];
        landmarks.forEach((lm, li) => {
          const fx = filters[li].x.filter(lm.x, tSec);
          const fy = filters[li].y.filter(lm.y, tSec);
          const screen = cameraToScreen(fx, fy, width, height);
          points.push({ x: screen.x - width / 2, y: height / 2 - screen.y });
        });
      });
      handPointsRef.current = points;
      const count = Math.min(result.landmarks.length, MAX_HANDS);
      if (count !== handCountRef.current) {
        handCountRef.current = count;
        setHandCount(count);
      }
    },
    [cameraToScreen]
  );

  const loop = useCallback(
    (time: number) => {
      rafRef.current = requestAnimationFrame(loop);
      const renderer = rendererRef.current;
      const scene = sceneRef.current;
      const camera = cameraRef.current;
      if (!renderer || !scene || !camera) return;

      const dt = lastTimeRef.current ? Math.min((time - lastTimeRef.current) / 1000, 1 / 20) : 1 / 60;
      lastTimeRef.current = time;
      const t = time / 1000;
      const { width, height } = sizeRef.current;
      if (!width || !height) return;

      detectHands(time, width, height);

      const settings = settingsRef.current;
      const minDim = Math.min(width, height);
      const S = minDim / 800;
      const wingLen = minDim * 0.045 * (settings.sizePct / 100);
      const scareRadius = wingLen * 1.2 + minDim * 0.12 * (settings.sensitivity / 100);
      const cascadeRadius = wingLen * 5;
      const speed = 420 * S;
      const maxForce = 1500 * S;
      const camZ = camera.position.z;
      const tanHalf = Math.tan((camera.fov * Math.PI) / 360);

      const scarePoints: Point[] = [];
      if (!settings.editMode && !calibratingRef.current) {
        scarePoints.push(...handPointsRef.current);
        if (settings.mouseScares && mouseRef.current) scarePoints.push(mouseRef.current);
      }
      const nearestScare = (x: number, y: number, radius: number): Point | null => {
        let best: Point | null = null;
        let bestD = radius;
        for (const p of scarePoints) {
          const d = Math.hypot(p.x - x, p.y - y);
          if (d < bestD) {
            bestD = d;
            best = p;
          }
        }
        return best;
      };

      const homes = new Map<number, { x: number; y: number; heading: number }>();
      for (const e of layoutRef.current) {
        homes.set(e.id, { x: (e.x - 0.5) * width, y: (0.5 - e.y) * height, heading: e.heading });
      }

      const butterflies = butterfliesRef.current;

      const wander = (b: Butterfly, out: THREE.Vector3, amount: number) => {
        const [s0, s1, s2, s3] = b.seeds;
        return out.set(
          Math.sin(t * 1.3 + s0) + 0.6 * Math.sin(t * 3.1 + s1),
          Math.cos(t * 1.1 + s2) + 0.6 * Math.sin(t * 2.7 + s3),
          0.6 * Math.sin(t * 2.2 + s1)
        ).multiplyScalar(amount);
      };
      const steer = (b: Butterfly, desired: THREE.Vector3) => {
        const dv = desired.sub(b.vel);
        const maxDv = maxForce * dt;
        if (dv.length() > maxDv) dv.setLength(maxDv);
        b.vel.add(dv);
        b.pos.addScaledVector(b.vel, dt);
      };

      const takeOff = (b: Butterfly, from: Point | null) => {
        let dir: number;
        if (from) {
          const dx = b.pos.x - from.x;
          const dy = b.pos.y - from.y;
          dir = Math.hypot(dx, dy) > 1 ? Math.atan2(dy, dx) : Math.random() * Math.PI * 2;
        } else {
          dir = Math.random() * Math.PI * 2;
        }
        dir += (Math.random() - 0.5) * 1.2;
        b.exitDir = dir;
        const reach = Math.hypot(width, height) * 1.5;
        b.exitTarget.set(
          b.pos.x + Math.cos(dir) * reach,
          b.pos.y + Math.sin(dir) * reach,
          camZ * 0.3
        );
        if (b.state === "resting") {
          b.vel.set(Math.cos(dir) * speed * 0.35, Math.sin(dir) * speed * 0.35, speed * 0.6);
        }
        b.state = "fleeing";
        b.stateTime = 0;
        b.scareAt = null;
        b.scareFrom = null;
      };

      const tmpDesired = new THREE.Vector3();
      const tmpWander = new THREE.Vector3();
      const projected = new THREE.Vector3();

      butterflies.forEach((b) => {
        const home = homes.get(b.id);
        if (!home) return;
        b.stateTime += dt;

        if (settings.editMode) {
          b.state = "resting";
          b.scareAt = null;
          b.heading = home.heading;
          b.pitch = 0;
          b.bank = 0;
          b.vel.set(0, 0, 0);
        }

        // Anything near the surface (sitting, coming in, touching down)
        // gets spooked by a hand reaching into its spot.
        if (b.state === "resting" || b.state === "returning" || b.state === "landing") {
          const scare = nearestScare(b.pos.x, b.pos.y, scareRadius);
          const triggered = scare ?? (b.scareAt !== null && t >= b.scareAt ? b.scareFrom : null);
          if (scare || (b.scareAt !== null && t >= b.scareAt)) {
            const wasResting = b.state === "resting";
            takeOff(b, triggered);
            // A startled butterfly sets off the resting ones around it, a
            // beat later the further away they are.
            if (wasResting && scare) {
              butterflies.forEach((other) => {
                if (other === b || other.state !== "resting" || other.scareAt !== null) return;
                const d = Math.hypot(other.pos.x - b.pos.x, other.pos.y - b.pos.y);
                if (d > cascadeRadius) return;
                other.scareAt = t + 0.08 + d / (900 * S) + Math.random() * 0.25;
                other.scareFrom = scare;
              });
            }
          }
        }

        switch (b.state) {
          case "resting": {
            b.pos.set(home.x, home.y, 0);
            b.heading = home.heading;
            b.pitch = 0;
            b.bank = 0;
            b.restPhase += dt * b.restSpeed;
            // Mostly open and still, slowly folding up now and then.
            const fold = Math.pow(0.5 + 0.5 * Math.sin(b.restPhase), 5);
            b.wingOpen = 0.12 + 1.15 * fold;
            break;
          }
          case "fleeing": {
            tmpDesired.subVectors(b.exitTarget, b.pos).setLength(speed * 1.2 * b.speedJitter);
            tmpDesired.add(wander(b, tmpWander, speed * 0.5));
            steer(b, tmpDesired);
            projected.copy(b.pos).project(camera);
            const margin = 1 + (wingLen * 3) / minDim;
            if (Math.abs(projected.x) > margin || Math.abs(projected.y) > margin || projected.z > 1) {
              b.state = "away";
              b.stateTime = 0;
              b.awayTimer = settings.returnDelay * (0.7 + Math.random() * 0.6);
            }
            break;
          }
          case "away": {
            b.awayTimer -= dt;
            // Only come back once nobody's hand is hovering over the spot.
            if (b.awayTimer <= 0 && !nearestScare(home.x, home.y, scareRadius * 1.4)) {
              const z = camZ * 0.25;
              const halfH = (camZ - z) * tanHalf;
              const halfW = halfH * (width / height);
              const angle = b.exitDir + (Math.random() - 0.5) * 2;
              const cos = Math.cos(angle);
              const sin = Math.sin(angle);
              const edge = Math.min(
                Math.abs(cos) > 1e-3 ? halfW / Math.abs(cos) : Infinity,
                Math.abs(sin) > 1e-3 ? halfH / Math.abs(sin) : Infinity
              );
              const r = edge + wingLen * 3;
              b.pos.set(cos * r, sin * r, z);
              b.vel.set(-cos, -sin, 0).multiplyScalar(speed * 0.8);
              b.heading = Math.atan2(-sin, -cos);
              b.state = "returning";
              b.stateTime = 0;
            }
            break;
          }
          case "returning": {
            const dxy = Math.hypot(home.x - b.pos.x, home.y - b.pos.y);
            // Cruise in above the surface, dropping down on the final approach.
            const hover = Math.min(camZ * 0.22, dxy * 0.5);
            tmpDesired.set(home.x - b.pos.x, home.y - b.pos.y, hover - b.pos.z);
            const dist = tmpDesired.length();
            const arrive = THREE.MathUtils.clamp(dist / (wingLen * 10), 0.25, 1);
            tmpDesired.setLength(speed * b.speedJitter * arrive);
            tmpDesired.add(wander(b, tmpWander, speed * 0.45 * THREE.MathUtils.clamp(dist / (wingLen * 8), 0, 1)));
            steer(b, tmpDesired);
            if (dist < wingLen * 2.5 || b.stateTime > 15) {
              b.state = "landing";
              b.stateTime = 0;
              b.landFrom.pos.copy(b.pos);
              b.landFrom.heading = b.heading;
              b.landFrom.pitch = b.pitch;
              b.landFrom.bank = b.bank;
              b.landFrom.wing = b.wingOpen;
            }
            break;
          }
          case "landing": {
            const duration = 0.8;
            const u = Math.min(1, b.stateTime / duration);
            const e = smoothstep(u);
            b.pos.lerpVectors(b.landFrom.pos, new THREE.Vector3(home.x, home.y, 0), e);
            b.heading = lerpAngle(b.landFrom.heading, home.heading, e);
            b.pitch = b.landFrom.pitch * (1 - e);
            b.bank = b.landFrom.bank * (1 - e);
            b.vel.set(0, 0, 0);
            if (u >= 1) {
              b.state = "resting";
              b.stateTime = 0;
              b.restPhase = -Math.PI / 2;
            }
            break;
          }
        }

        const flying = b.state === "fleeing" || b.state === "returning";
        if (flying) {
          const sp = Math.hypot(b.vel.x, b.vel.y);
          if (sp > 5) {
            const target = Math.atan2(b.vel.y, b.vel.x);
            const prev = b.heading;
            b.heading = lerpAngle(b.heading, target, 1 - Math.exp(-8 * dt));
            const turnRate = lerpAngle(0, b.heading - prev, 1) / Math.max(dt, 1e-3);
            b.bank += (THREE.MathUtils.clamp(-turnRate * 0.12, -0.6, 0.6) - b.bank) * (1 - Math.exp(-6 * dt));
          }
          const climb = THREE.MathUtils.clamp(b.vel.z / speed, -1, 1);
          b.pitch += (0.25 + climb * 0.5 - b.pitch) * (1 - Math.exp(-5 * dt));
        }

        // Wings: fast flapping in the air, settling to the resting pose
        // over the landing glide.
        if (flying || b.state === "landing") {
          b.flapPhase += dt * Math.PI * 2 * b.flapFreq;
          const flap = 0.55 + 0.9 * Math.sin(b.flapPhase);
          if (b.state === "landing") {
            const e = smoothstep(Math.min(1, b.stateTime / 0.8));
            b.wingOpen = flap * (1 - e) + 0.3 * e;
          } else {
            b.wingOpen = flap;
          }
        }

        b.group.visible = b.state !== "away";
        const bob = flying ? Math.sin(b.flapPhase) * wingLen * 0.12 : 0;
        b.group.position.set(b.pos.x, b.pos.y, b.pos.z + bob + 0.5);
        b.group.rotation.set(b.pitch, b.bank, b.heading - Math.PI / 2, "ZXY");
        b.group.scale.setScalar(wingLen);
        const hindLag = flying ? 0.22 : 0;
        b.rightFore.rotation.y = -b.wingOpen;
        b.leftFore.rotation.y = b.wingOpen;
        b.rightHind.rotation.y = -(b.wingOpen - hindLag);
        b.leftHind.rotation.y = b.wingOpen - hindLag;
      });

      const handMesh = handPointsMeshRef.current;
      if (handMesh) {
        const pts = handPointsRef.current;
        handMesh.visible = settings.showHand && pts.length > 0;
        if (handMesh.visible) {
          const attr = handMesh.geometry.getAttribute("position") as THREE.BufferAttribute;
          const n = Math.min(pts.length, MAX_HANDS * LANDMARKS_PER_HAND);
          for (let i = 0; i < n; i++) attr.setXYZ(i, pts[i].x, pts[i].y, 1);
          attr.needsUpdate = true;
          handMesh.geometry.setDrawRange(0, n);
        }
      }

      renderer.render(scene, camera);
    },
    [detectHands]
  );

  // The scene animates from the moment the page opens (resting butterflies
  // breathe, the mouse can startle them); the camera just adds hands.
  useEffect(() => {
    resizeCanvas();
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lastTimeRef.current = null;
    };
  }, [loop, resizeCanvas]);

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
    cameraRunningRef.current = false;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    handPointsRef.current = [];
    handCountRef.current = 0;
    setHandCount(0);
    setCalibrating(false);
    setStatus("idle");
  }, []);

  const startCamera = useCallback(async () => {
    if (cameraRunningRef.current) return true;
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("error");
      setError("This browser doesn't support camera access.");
      return false;
    }
    try {
      setStatus("loading-model");
      await ensureLandmarker();

      setStatus("starting-camera");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) return false;
      video.srcObject = stream;
      await video.play();
      cameraRunningRef.current = true;
      setStatus("running");
      return true;
    } catch (e) {
      setStatus("error");
      setError(
        e instanceof Error && e.name === "NotAllowedError"
          ? "Camera access was denied. Allow camera permissions and try again."
          : "Couldn't load the hand-tracking model or start the camera. Check your connection and try again."
      );
      return false;
    }
  }, [ensureLandmarker]);

  const beginCalibration = useCallback(async () => {
    const ok = await startCamera();
    if (!ok) return;
    setEditMode(false);
    setCalibrationClicks([]);
    setCalibrating(true);
  }, [startCamera]);

  const handlePreviewClick = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const point = {
        x: (e.clientX - rect.left) / rect.width,
        y: (e.clientY - rect.top) / rect.height,
      };
      const clicks = [...calibrationClicks, point];
      if (clicks.length < 4) {
        setCalibrationClicks(clicks);
        return;
      }
      const h = computeHomography(clicks, CALIBRATION_TARGETS);
      setCalibrationClicks([]);
      setCalibrating(false);
      if (h) {
        setCalibration(h);
      } else {
        setError("Those four points don't form a usable shape — try calibrating again.");
      }
    },
    [calibrationClicks]
  );

  // Edit mode: press on an empty spot to place a butterfly (drag to paint a
  // row of them, e.g. along a pipe or ledge), press on one to remove it.
  const dragRef = useRef<{ mode: "paint" | "erase"; last: Point } | null>(null);
  const toNormalized = (e: ReactPointerEvent) => {
    const rect = containerRef.current!.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
  };
  const spacingPx = () => {
    const { width, height } = sizeRef.current;
    return Math.min(width, height) * 0.045 * (sizePct / 100) * 2.4;
  };
  const hitEntry = (p: Point, entries: LayoutEntry[]) => {
    const { width, height } = sizeRef.current;
    const radius = spacingPx() * 0.5;
    return entries.find((e) => Math.hypot((e.x - p.x) * width, (e.y - p.y) * height) < radius);
  };

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!editMode || e.target !== e.currentTarget) return;
    const p = toNormalized(e);
    const hit = hitEntry(p, layout);
    if (hit) {
      setLayout((prev) => prev.filter((entry) => entry.id !== hit.id));
      dragRef.current = { mode: "erase", last: p };
    } else {
      setLayout((prev) => [...prev, makeEntry(p.x, p.y)]);
      dragRef.current = { mode: "paint", last: p };
    }
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = toNormalized(e);
    const { width, height } = sizeRef.current;
    mouseRef.current = { x: (p.x - 0.5) * width, y: (0.5 - p.y) * height };
    const drag = dragRef.current;
    if (!editMode || !drag) return;
    if (drag.mode === "erase") {
      const hit = hitEntry(p, layoutRef.current);
      if (hit) setLayout((prev) => prev.filter((entry) => entry.id !== hit.id));
      return;
    }
    const dist = Math.hypot((p.x - drag.last.x) * width, (p.y - drag.last.y) * height);
    if (dist < spacingPx()) return;
    const entry = makeEntry(p.x, p.y);
    // Face along the stroke (either way), like a row of butterflies on a ledge.
    const along = Math.atan2(-(p.y - drag.last.y) * height, (p.x - drag.last.x) * width);
    entry.heading = along + (Math.random() < 0.5 ? Math.PI / 2 : -Math.PI / 2) + (Math.random() - 0.5) * 0.8;
    drag.last = p;
    setLayout((prev) => [...prev, entry]);
  };

  const handlePointerUp = () => {
    dragRef.current = null;
  };

  useEffect(() => {
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
    const timer = setTimeout(() => setShowHint(false), 7000);
    return () => clearTimeout(timer);
  }, [projectorMode]);

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
      else if (key === "e") setEditMode((v) => !v);
      else if (key === "c") beginCalibration();
      else if (key === "escape") setCalibrating(false);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [toggleProjectorMode, beginCalibration]);

  const isRunning = status === "running";
  const isBusy = status === "loading-model" || status === "starting-camera";
  const markerSize = Math.max(24, spacingPx());

  return (
    <div
      ref={containerRef}
      className={`fixed inset-0 z-50 overflow-hidden bg-black ${editMode ? "cursor-crosshair" : ""}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={() => {
        mouseRef.current = null;
      }}
    >
      <video ref={videoRef} className="hidden" muted playsInline />
      <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 block" />

      {editMode &&
        layout.map((entry) => (
          <div
            key={entry.id}
            className="pointer-events-none absolute rounded-full border-2 border-dashed border-white/80"
            style={{
              left: `${entry.x * 100}%`,
              top: `${entry.y * 100}%`,
              width: markerSize,
              height: markerSize,
              transform: "translate(-50%, -50%)",
            }}
          />
        ))}

      {calibrating && (
        <div className="absolute inset-0 z-20 bg-black">
          {CALIBRATION_TARGETS.map((target, i) => (
            <div
              key={i}
              className="absolute flex items-center justify-center"
              style={{ left: `${target.x * 100}%`, top: `${target.y * 100}%`, transform: "translate(-50%, -50%)" }}
            >
              <div
                className={`flex h-16 w-16 items-center justify-center rounded-full border-4 text-2xl font-bold ${
                  i === calibrationClicks.length
                    ? "border-white bg-white text-black"
                    : i < calibrationClicks.length
                    ? "border-white/30 text-white/30"
                    : "border-white text-white"
                }`}
              >
                {i + 1}
              </div>
            </div>
          ))}
          <div className="absolute left-1/2 top-1/2 w-[min(46vw,640px)] -translate-x-1/2 -translate-y-1/2 space-y-2 text-center text-sm text-white">
            <p>
              In the camera image, click target{" "}
              <span className="font-semibold">
                {calibrationClicks.length + 1} ({CALIBRATION_LABELS[calibrationClicks.length]})
              </span>{" "}
              where you see it projected on the surface.
            </p>
            <div className="relative">
              <canvas
                ref={previewRef}
                onPointerDown={handlePreviewClick}
                className="block w-full cursor-crosshair rounded border border-white/30"
              />
              {calibrationClicks.map((p, i) => (
                <div
                  key={i}
                  className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-pink-500 ring-2 ring-white"
                  style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
                />
              ))}
            </div>
            <button
              onClick={() => setCalibrating(false)}
              className="rounded-md bg-white/10 px-3 py-1.5 hover:bg-white/20"
            >
              Cancel (Esc)
            </button>
          </div>
        </div>
      )}

      {!projectorMode && !calibrating && (
        <div
          className="absolute top-4 left-4 z-10 max-h-[calc(100vh-2rem)] w-72 space-y-3 overflow-y-auto rounded-xl bg-black/70 p-4 text-sm text-white backdrop-blur"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <h2 className="text-lg font-semibold">Butterflies</h2>
          <p className="text-white/70">
            Butterflies rest on the projected surface. Reach a hand into
            their spot and they scatter, then drift back and land where they
            were once the coast is clear. The mouse works as a hand too.
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
              Hands detected: <span className="text-white">{handCount}</span>
            </p>
          )}

          <div className="space-y-2 rounded-lg bg-white/5 p-3">
            <div className="flex items-center justify-between">
              <span className="font-medium">Placement</span>
              <span className="text-white/50">{layout.length} butterflies</span>
            </div>
            <button
              onClick={() => setEditMode((v) => !v)}
              className={`w-full rounded-md px-3 py-2 font-medium ${
                editMode ? "bg-pink-500 text-white hover:bg-pink-400" : "bg-white/10 hover:bg-white/20"
              }`}
            >
              {editMode ? "Done placing" : "Place butterflies"}
            </button>
            {editMode && (
              <p className="text-xs text-white/60">
                Click to add one, drag to paint a row (e.g. along a pipe),
                click an existing one to remove it.
              </p>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => setLayout(scatterLayout(DEFAULT_COUNT))}
                className="flex-1 rounded-md bg-white/10 px-2 py-1.5 hover:bg-white/20"
              >
                Scatter
              </button>
              <button
                onClick={() => setLayout([])}
                className="flex-1 rounded-md bg-white/10 px-2 py-1.5 hover:bg-white/20"
              >
                Clear
              </button>
            </div>
          </div>

          <div className="space-y-2 rounded-lg bg-white/5 p-3">
            <div className="flex items-center justify-between">
              <span className="font-medium">Camera alignment</span>
              <span className="text-white/50">{calibration ? "calibrated" : "full frame"}</span>
            </div>
            <button
              onClick={beginCalibration}
              disabled={isBusy}
              className="w-full rounded-md bg-white/10 px-3 py-2 font-medium hover:bg-white/20 disabled:opacity-60"
            >
              Calibrate camera
            </button>
            {calibration && (
              <button
                onClick={() => setCalibration(null)}
                className="w-full rounded-md px-3 py-1 text-xs text-white/60 hover:text-white"
              >
                Reset calibration
              </button>
            )}
            <p className="text-xs text-white/50">
              Point the camera at the projected surface, then click the four
              projected targets in the camera image so a hand over a
              butterfly lines up with that butterfly.
            </p>
          </div>

          <label className="block">
            Size
            <input
              type="range"
              min={50}
              max={200}
              value={sizePct}
              onChange={(e) => setSizePct(Number(e.target.value))}
              className="w-full"
            />
          </label>
          <label className="block">
            Skittishness
            <input
              type="range"
              min={0}
              max={100}
              value={sensitivity}
              onChange={(e) => setSensitivity(Number(e.target.value))}
              className="w-full"
            />
          </label>
          <label className="block">
            Time away: {returnDelay}s
            <input
              type="range"
              min={1}
              max={20}
              value={returnDelay}
              onChange={(e) => setReturnDelay(Number(e.target.value))}
              className="w-full"
            />
          </label>
          {!calibration && (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={mirror} onChange={(e) => setMirror(e.target.checked)} />
              Mirror camera
            </label>
          )}
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={showHand} onChange={(e) => setShowHand(e.target.checked)} />
            Show tracked hand points
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={mouseScares}
              onChange={(e) => setMouseScares(e.target.checked)}
            />
            Mouse scares them too
          </label>

          <button
            onClick={toggleProjectorMode}
            className="w-full rounded-md bg-white/10 px-3 py-2 font-medium hover:bg-white/20"
          >
            Enter Projector Mode
          </button>
          <p className="text-xs text-white/50">
            Keys: <kbd className="rounded bg-white/10 px-1">P</kbd> projector
            mode, <kbd className="rounded bg-white/10 px-1">E</kbd> place
            butterflies, <kbd className="rounded bg-white/10 px-1">C</kbd>{" "}
            calibrate — all work in projector mode, so you can place them
            while watching where they land on the real surface.
          </p>
        </div>
      )}

      {projectorMode && showHint && !calibrating && (
        <div className="pointer-events-none absolute bottom-6 left-1/2 z-10 -translate-x-1/2 rounded-full bg-black/50 px-4 py-2 text-xs text-white/70">
          P / Esc exit · E place butterflies · C calibrate camera
        </div>
      )}
    </div>
  );
};

export default Butterflies;
