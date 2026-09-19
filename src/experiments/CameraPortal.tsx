import { useCallback, useEffect, useRef, useState } from "react";

// Square working resolution used for motion analysis and the portal's video
// texture. Kept small on purpose: the per-pixel diff loop below runs on the
// main thread every frame, so this is the main lever for performance.
const SQUARE_SIZE = 200;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  maxAge: number;
  hue: number;
  size: number;
}

/**
 * Camera Portal
 *
 * A projection-mapping sketch: point a webcam at the space in front of a
 * projector, run this fullscreen on the projected surface, and movement in
 * front of the camera appears live as glowing trails inside a "portal" ring,
 * with particles bursting outward the more the viewer moves.
 *
 * Everything happens in two canvases:
 *  - an offscreen square canvas holds the mirrored webcam frame and a
 *    persistent "trail" buffer that brightens on motion and fades otherwise
 *  - the visible canvas clips that trail buffer into a circle and layers a
 *    glowing rim + particle system driven by how much motion was detected
 */
const CameraPortal = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const mainCanvasRef = useRef<HTMLCanvasElement>(null);
  const workCanvasRef = useRef<HTMLCanvasElement>(null);
  const trailCanvasRef = useRef<HTMLCanvasElement>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number | null>(null);
  const prevFrameRef = useRef<Uint8ClampedArray | null>(null);
  const trailImageDataRef = useRef<ImageData | null>(null);
  const particlesRef = useRef<Particle[]>([]);
  const particleAccumulatorRef = useRef(0);
  const energyRef = useRef(0);
  const radiusRef = useRef(0);
  const hueDriftRef = useRef(0);
  const sizeRef = useRef({ width: 0, height: 0 });

  // Live-tunable settings, mirrored into refs so the animation loop always
  // reads the latest value without needing to be re-created every render.
  const [sensitivity, setSensitivity] = useState(55);
  const [persistence, setPersistence] = useState(90);
  const [hue, setHue] = useState(190);
  const [mirror, setMirror] = useState(true);
  const sensitivityRef = useRef(sensitivity);
  const persistenceRef = useRef(persistence);
  const hueRef = useRef(hue);
  const mirrorRef = useRef(mirror);
  useEffect(() => {
    sensitivityRef.current = sensitivity;
  }, [sensitivity]);
  useEffect(() => {
    persistenceRef.current = persistence;
  }, [persistence]);
  useEffect(() => {
    hueRef.current = hue;
  }, [hue]);
  useEffect(() => {
    mirrorRef.current = mirror;
  }, [mirror]);

  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projectorMode, setProjectorMode] = useState(false);
  const [showHint, setShowHint] = useState(true);

  const resizeCanvas = useCallback(() => {
    const canvas = mainCanvasRef.current;
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
  }, []);

  // Crops+draws the current video frame into a square, optionally mirrored,
  // so the working resolution matches the circular portal we clip it into.
  const drawVideoToSquare = (
    ctx: CanvasRenderingContext2D,
    video: HTMLVideoElement,
    size: number,
    flip: boolean
  ) => {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return;
    const cropSize = Math.min(vw, vh);
    const sx = (vw - cropSize) / 2;
    const sy = (vh - cropSize) / 2;
    ctx.save();
    if (flip) {
      ctx.translate(size, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, sx, sy, cropSize, cropSize, 0, 0, size, size);
    ctx.restore();
  };

  const drawScene = useCallback((dt: number) => {
    const canvas = mainCanvasRef.current;
    const trailCanvas = trailCanvasRef.current;
    if (!canvas || !trailCanvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { width, height } = sizeRef.current;
    if (!width || !height) return;

    ctx.fillStyle = "rgba(0, 0, 0, 0.18)";
    ctx.fillRect(0, 0, width, height);

    const cx = width / 2;
    const cy = height / 2;
    const baseRadius = Math.min(width, height) * 0.32;
    const targetRadius = baseRadius * (1 + energyRef.current * 0.35);
    radiusRef.current += (targetRadius - radiusRef.current) * 0.1;
    const radius = radiusRef.current;

    hueDriftRef.current = (hueDriftRef.current + dt * 0.25) % 360;
    const displayHue = (hueRef.current + hueDriftRef.current) % 360;

    // Portal window: the trail buffer clipped into a circle.
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = "#000";
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
    ctx.drawImage(
      trailCanvas,
      0,
      0,
      SQUARE_SIZE,
      SQUARE_SIZE,
      cx - radius,
      cy - radius,
      radius * 2,
      radius * 2
    );
    const vignette = ctx.createRadialGradient(
      cx,
      cy,
      radius * 0.35,
      cx,
      cy,
      radius
    );
    vignette.addColorStop(0, "rgba(0,0,0,0)");
    vignette.addColorStop(1, "rgba(0,0,0,0.45)");
    ctx.fillStyle = vignette;
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
    ctx.restore();

    // Glowing rim.
    ctx.save();
    ctx.lineWidth = 3;
    for (let k = 0; k < 3; k++) {
      const rr = radius + 4 + k * 6;
      ctx.strokeStyle = `hsla(${displayHue}, 90%, ${60 - k * 12}%, ${
        0.55 - k * 0.15 + energyRef.current * 0.3
      })`;
      ctx.shadowColor = `hsla(${displayHue}, 90%, 60%, 0.9)`;
      ctx.shadowBlur = 18;
      ctx.beginPath();
      ctx.arc(cx, cy, rr, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    // Spawn particles proportional to how much motion is currently detected.
    const spawnRate = energyRef.current * 90;
    particleAccumulatorRef.current += spawnRate * dt;
    while (particleAccumulatorRef.current >= 1) {
      particleAccumulatorRef.current -= 1;
      const angle = Math.random() * Math.PI * 2;
      const speed = 1 + Math.random() * 2.5;
      particlesRef.current.push({
        x: cx + Math.cos(angle) * radius,
        y: cy + Math.sin(angle) * radius,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        age: 0,
        maxAge: 40 + Math.random() * 35,
        hue: displayHue + (Math.random() * 40 - 20),
        size: 1.5 + Math.random() * 2.5,
      });
    }
    if (particlesRef.current.length > 400) {
      particlesRef.current.splice(0, particlesRef.current.length - 400);
    }

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    particlesRef.current = particlesRef.current.filter((p) => {
      p.age += dt;
      if (p.age >= p.maxAge) return false;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.98;
      p.vy *= 0.98;
      const alpha = 1 - p.age / p.maxAge;
      ctx.fillStyle = `hsla(${p.hue}, 95%, 65%, ${alpha})`;
      ctx.shadowColor = `hsla(${p.hue}, 95%, 65%, ${alpha})`;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.6 + alpha * 0.6), 0, Math.PI * 2);
      ctx.fill();
      return true;
    });
    ctx.restore();
  }, []);

  const loop = useCallback(
    (time: number) => {
      rafRef.current = requestAnimationFrame(loop);

      const video = videoRef.current;
      const workCanvas = workCanvasRef.current;
      const trailCanvas = trailCanvasRef.current;
      const trailImageData = trailImageDataRef.current;
      if (!video || !workCanvas || !trailCanvas || !trailImageData) return;
      if (video.videoWidth === 0 || video.videoHeight === 0) return;

      const dt = lastTimeRef.current
        ? Math.min((time - lastTimeRef.current) / 16.6667, 3)
        : 1;
      lastTimeRef.current = time;

      const workCtx = workCanvas.getContext("2d", { willReadFrequently: true });
      if (!workCtx) return;
      drawVideoToSquare(workCtx, video, SQUARE_SIZE, mirrorRef.current);
      const currentFrame = workCtx.getImageData(0, 0, SQUARE_SIZE, SQUARE_SIZE);
      const cur = currentFrame.data;
      const prev = prevFrameRef.current;
      const trailData = trailImageData.data;
      // Sensitivity 0-100 maps to a channel-sum diff threshold; lower
      // threshold means smaller movements register as motion.
      const threshold = 260 - sensitivityRef.current * 2.2;
      const fade = 0.85 + (persistenceRef.current / 100) * 0.13;

      let motionCount = 0;
      const totalPixels = SQUARE_SIZE * SQUARE_SIZE;

      if (prev) {
        for (let i = 0; i < cur.length; i += 4) {
          const diff =
            Math.abs(cur[i] - prev[i]) +
            Math.abs(cur[i + 1] - prev[i + 1]) +
            Math.abs(cur[i + 2] - prev[i + 2]);
          if (diff > threshold) {
            motionCount++;
            trailData[i] = Math.min(255, Math.max(trailData[i], cur[i] * 1.5));
            trailData[i + 1] = Math.min(
              255,
              Math.max(trailData[i + 1], cur[i + 1] * 1.5)
            );
            trailData[i + 2] = Math.min(
              255,
              Math.max(trailData[i + 2], cur[i + 2] * 1.5)
            );
            trailData[i + 3] = 255;
          } else {
            trailData[i] *= fade;
            trailData[i + 1] *= fade;
            trailData[i + 2] *= fade;
          }
        }
      }
      prevFrameRef.current = cur;

      const trailCtx = trailCanvas.getContext("2d");
      trailCtx?.putImageData(trailImageData, 0, 0);

      const motionEnergy = prev ? motionCount / totalPixels : 0;
      energyRef.current += (motionEnergy - energyRef.current) * 0.15;

      drawScene(dt);
    },
    [drawScene]
  );

  const stopCamera = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    lastTimeRef.current = null;
    prevFrameRef.current = null;
    particlesRef.current = [];
    setIsRunning(false);
  }, []);

  const startCamera = useCallback(async () => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser doesn't support camera access.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play();

      const workCanvas = workCanvasRef.current;
      const trailCanvas = trailCanvasRef.current;
      if (workCanvas && trailCanvas) {
        workCanvas.width = SQUARE_SIZE;
        workCanvas.height = SQUARE_SIZE;
        trailCanvas.width = SQUARE_SIZE;
        trailCanvas.height = SQUARE_SIZE;
        const trailCtx = trailCanvas.getContext("2d");
        const imageData = trailCtx?.createImageData(SQUARE_SIZE, SQUARE_SIZE);
        if (imageData) {
          for (let i = 3; i < imageData.data.length; i += 4) {
            imageData.data[i] = 255;
          }
          trailImageDataRef.current = imageData;
        }
      }

      prevFrameRef.current = null;
      particlesRef.current = [];
      energyRef.current = 0;
      resizeCanvas();
      setIsRunning(true);
      lastTimeRef.current = null;
      rafRef.current = requestAnimationFrame(loop);
    } catch {
      setError(
        "Camera access was denied or no camera is available. Allow camera permissions and try again."
      );
    }
  }, [loop, resizeCanvas]);

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

  useEffect(() => stopCamera, [stopCamera]);

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

  return (
    <div
      ref={containerRef}
      className="relative h-screen w-full overflow-hidden bg-black"
    >
      <video ref={videoRef} className="hidden" muted playsInline />
      <canvas ref={workCanvasRef} className="hidden" />
      <canvas ref={trailCanvasRef} className="hidden" />
      <canvas ref={mainCanvasRef} className="absolute inset-0 block" />

      {!projectorMode && (
        <div className="absolute top-4 left-4 z-10 w-72 space-y-3 rounded-xl bg-black/60 p-4 text-sm text-white backdrop-blur">
          <h2 className="text-lg font-semibold">Camera Portal</h2>
          <p className="text-white/70">
            A motion-reactive portal for projection mapping. Move in front of
            your camera and the motion appears live inside the ring.
          </p>

          {!isRunning ? (
            <button
              onClick={startCamera}
              className="w-full rounded-md bg-white px-3 py-2 font-medium text-black hover:bg-white/90"
            >
              Start Camera
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

          <label className="block">
            Sensitivity
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
            Trail persistence
            <input
              type="range"
              min={0}
              max={100}
              value={persistence}
              onChange={(e) => setPersistence(Number(e.target.value))}
              className="w-full"
            />
          </label>
          <label className="block">
            Color
            <input
              type="range"
              min={0}
              max={360}
              value={hue}
              onChange={(e) => setHue(Number(e.target.value))}
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

          <button
            onClick={toggleProjectorMode}
            className="w-full rounded-md bg-white/10 px-3 py-2 font-medium hover:bg-white/20"
          >
            Enter Projector Mode
          </button>
          <p className="text-xs text-white/50">
            Aim a projector at your wall/screen, run this fullscreen, and
            position the camera to see the audience. Press{" "}
            <kbd className="rounded bg-white/10 px-1">P</kbd> to toggle
            projector mode.
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

export default CameraPortal;
