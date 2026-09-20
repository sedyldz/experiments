import { useCallback, useEffect, useRef, useState } from "react";
import {
  FilesetResolver,
  HandLandmarker,
  type HandLandmarkerResult,
} from "@mediapipe/tasks-vision";

const OBJECT_COUNT = 16;
const OBJECT_COLS = 4;

// Skeleton connections between MediaPipe's 21 hand landmarks, used only to
// draw a debug overlay so the operator can see what the camera is tracking.
const HAND_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

// A stable, low-jitter stand-in for "palm center": the wrist plus the four
// finger MCP knuckles, averaged.
const PALM_LANDMARKS = [0, 5, 9, 13, 17];

interface Point {
  x: number;
  y: number;
}

interface SceneObject {
  homeX: number;
  homeY: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  hue: number;
}

type Status = "idle" | "loading-model" | "starting-camera" | "running" | "error";

function computeHomeLayout(width: number, height: number): Point[] {
  const rows = Math.ceil(OBJECT_COUNT / OBJECT_COLS);
  const marginX = width * 0.16;
  const marginY = height * 0.2;
  const cellW = OBJECT_COLS > 1 ? (width - marginX * 2) / (OBJECT_COLS - 1) : 0;
  const cellH = rows > 1 ? (height - marginY * 2) / (rows - 1) : 0;
  const positions: Point[] = [];
  for (let i = 0; i < OBJECT_COUNT; i++) {
    const col = i % OBJECT_COLS;
    const row = Math.floor(i / OBJECT_COLS);
    positions.push({ x: marginX + col * cellW, y: marginY + row * cellH });
  }
  return positions;
}

/**
 * Hand Push
 *
 * A projection-mapping sketch: real hand tracking (MediaPipe's
 * HandLandmarker, running fully client-side) drives a little physics scene.
 * Objects flee any hand that gets close to them and spring back to their
 * resting grid position once no hand is nearby.
 */
const HandPush = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number | null>(null);
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const objectsRef = useRef<SceneObject[]>([]);
  const handsRef = useRef<{ points: Point[]; landmarks: Point[][] }>({
    points: [],
    landmarks: [],
  });
  const sizeRef = useRef({ width: 0, height: 0 });
  const handCountRef = useRef(0);

  const [pushStrength, setPushStrength] = useState(60);
  const [mirror, setMirror] = useState(true);
  const [showSkeleton, setShowSkeleton] = useState(true);
  const pushStrengthRef = useRef(pushStrength);
  const mirrorRef = useRef(mirror);
  const showSkeletonRef = useRef(showSkeleton);
  useEffect(() => {
    pushStrengthRef.current = pushStrength;
  }, [pushStrength]);
  useEffect(() => {
    mirrorRef.current = mirror;
  }, [mirror]);
  useEffect(() => {
    showSkeletonRef.current = showSkeleton;
  }, [showSkeleton]);

  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [projectorMode, setProjectorMode] = useState(false);
  const [showHint, setShowHint] = useState(true);
  const [handCount, setHandCount] = useState(0);

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = container.getBoundingClientRect();
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    sizeRef.current = { width, height };

    const homes = computeHomeLayout(width, height);
    const existing = objectsRef.current;
    objectsRef.current = homes.map((home, i) => {
      const prev = existing[i];
      return {
        homeX: home.x,
        homeY: home.y,
        x: prev ? prev.x : home.x,
        y: prev ? prev.y : home.y,
        vx: prev ? prev.vx : 0,
        vy: prev ? prev.vy : 0,
        radius: prev ? prev.radius : 14 + (i % 3) * 5,
        hue: prev ? prev.hue : (i / OBJECT_COUNT) * 300,
      };
    });
  }, []);

  const draw = useCallback((width: number, height: number) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "#050507";
    ctx.fillRect(0, 0, width, height);

    const pushRadius = Math.min(width, height) * 0.24;

    if (showSkeletonRef.current) {
      ctx.save();
      ctx.strokeStyle = "rgba(120, 200, 255, 0.45)";
      ctx.lineWidth = 2;
      ctx.fillStyle = "rgba(170, 225, 255, 0.9)";
      for (const landmarks of handsRef.current.landmarks) {
        for (const [a, b] of HAND_CONNECTIONS) {
          ctx.beginPath();
          ctx.moveTo(landmarks[a].x, landmarks[a].y);
          ctx.lineTo(landmarks[b].x, landmarks[b].y);
          ctx.stroke();
        }
        for (const p of landmarks) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    }

    ctx.save();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
    for (const hand of handsRef.current.points) {
      ctx.beginPath();
      ctx.arc(hand.x, hand.y, pushRadius, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const obj of objectsRef.current) {
      const glow = ctx.createRadialGradient(
        obj.x,
        obj.y,
        0,
        obj.x,
        obj.y,
        obj.radius * 2.4
      );
      glow.addColorStop(0, `hsla(${obj.hue}, 90%, 65%, 0.85)`);
      glow.addColorStop(1, `hsla(${obj.hue}, 90%, 55%, 0)`);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(obj.x, obj.y, obj.radius * 2.4, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = `hsla(${obj.hue}, 85%, 72%, 1)`;
      ctx.beginPath();
      ctx.arc(obj.x, obj.y, obj.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }, []);

  const loop = useCallback(
    (time: number) => {
      rafRef.current = requestAnimationFrame(loop);

      const video = videoRef.current;
      const landmarker = landmarkerRef.current;
      if (!video || !landmarker) return;
      if (video.videoWidth === 0 || video.videoHeight === 0) return;

      const dt = lastTimeRef.current
        ? Math.min((time - lastTimeRef.current) / 16.6667, 3)
        : 1;
      lastTimeRef.current = time;

      const { width, height } = sizeRef.current;
      if (!width || !height) return;

      const result: HandLandmarkerResult = landmarker.detectForVideo(video, time);
      const mirrorOn = mirrorRef.current;

      const points: Point[] = [];
      const landmarksOnScreen: Point[][] = [];
      for (const landmarks of result.landmarks) {
        const mapped = landmarks.map((lm) => ({
          x: (mirrorOn ? 1 - lm.x : lm.x) * width,
          y: lm.y * height,
        }));
        landmarksOnScreen.push(mapped);
        let sx = 0;
        let sy = 0;
        for (const idx of PALM_LANDMARKS) {
          sx += mapped[idx].x;
          sy += mapped[idx].y;
        }
        points.push({ x: sx / PALM_LANDMARKS.length, y: sy / PALM_LANDMARKS.length });
      }
      handsRef.current = { points, landmarks: landmarksOnScreen };
      if (points.length !== handCountRef.current) {
        handCountRef.current = points.length;
        setHandCount(points.length);
      }

      const pushRadius = Math.min(width, height) * 0.24;
      const pushForce = (pushStrengthRef.current / 100) * 16;
      const springK = 0.36;
      const damping = 0.9;

      for (const obj of objectsRef.current) {
        let fx = 0;
        let fy = 0;
        for (const hand of points) {
          const dx = obj.x - hand.x;
          const dy = obj.y - hand.y;
          const dist = Math.hypot(dx, dy);
          if (dist >= pushRadius) continue;
          const falloff = 1 - dist / pushRadius;
          const force = pushForce * falloff * falloff;
          if (dist < 1) {
            // Hand landed almost exactly on the object: dx/dy give no usable
            // direction, so escape along a stable per-object angle instead
            // of staying pinned in place.
            const angle = obj.hue * (Math.PI / 180);
            fx += Math.cos(angle) * force;
            fy += Math.sin(angle) * force;
          } else {
            fx += (dx / dist) * force;
            fy += (dy / dist) * force;
          }
        }
        fx += (obj.homeX - obj.x) * springK;
        fy += (obj.homeY - obj.y) * springK;

        const dampFactor = Math.pow(damping, dt);
        obj.vx = (obj.vx + fx * dt) * dampFactor;
        obj.vy = (obj.vy + fy * dt) * dampFactor;
        obj.x += obj.vx * dt;
        obj.y += obj.vy * dt;
      }

      draw(width, height);
    },
    [draw]
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
        numHands: 2,
      });
    } catch {
      landmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: { ...baseOptions, delegate: "CPU" },
        runningMode: "VIDEO",
        numHands: 2,
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
    handsRef.current = { points: [], landmarks: [] };
    handCountRef.current = 0;
    setHandCount(0);
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
      setStatus("loading-model");
      await ensureLandmarker();

      setStatus("starting-camera");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
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
      await el.requestFullscreen?.();
    } else {
      await document.exitFullscreen?.();
    }
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "p") toggleProjectorMode();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [toggleProjectorMode]);

  const isRunning = status === "running";
  const isBusy = status === "loading-model" || status === "starting-camera";

  return (
    <div
      ref={containerRef}
      className="relative h-screen w-full overflow-hidden bg-black"
    >
      <video ref={videoRef} className="hidden" muted playsInline />
      <canvas ref={canvasRef} className="absolute inset-0 block" />

      {!projectorMode && (
        <div className="absolute top-4 left-4 z-10 w-72 space-y-3 rounded-xl bg-black/60 p-4 text-sm text-white backdrop-blur">
          <h2 className="text-lg font-semibold">Hand Push</h2>
          <p className="text-white/70">
            Real hand tracking pushes these objects out of the way. Take your
            hand back and they spring back to their resting spots.
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

          <label className="block">
            Push strength
            <input
              type="range"
              min={0}
              max={100}
              value={pushStrength}
              onChange={(e) => setPushStrength(Number(e.target.value))}
              className="w-full"
            />
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={mirror}
              onChange={(e) => setMirror(e.target.checked)}
            />
            Mirror image
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={showSkeleton}
              onChange={(e) => setShowSkeleton(e.target.checked)}
            />
            Show hand skeleton
          </label>

          <button
            onClick={toggleProjectorMode}
            className="w-full rounded-md bg-white/10 px-3 py-2 font-medium hover:bg-white/20"
          >
            Enter Projector Mode
          </button>
          <p className="text-xs text-white/50">
            Aim a projector at your wall/floor, run this fullscreen, and
            position the camera to see the audience's hands. Press{" "}
            <kbd className="rounded bg-white/10 px-1">P</kbd> to toggle
            projector mode. First start may take a few seconds while the
            hand-tracking model downloads.
          </p>
        </div>
      )}

      {projectorMode && showHint && (
        <div className="absolute bottom-6 left-1/2 z-10 -translate-x-1/2 rounded-full bg-black/50 px-4 py-2 text-xs text-white/70">
          Press P or Esc to exit projector mode
        </div>
      )}
    </div>
  );
};

export default HandPush;
