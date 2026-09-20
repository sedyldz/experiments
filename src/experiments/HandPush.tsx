import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import {
  FilesetResolver,
  HandLandmarker,
  type HandLandmarkerResult,
} from "@mediapipe/tasks-vision";

const OBJECT_COUNT = 16;
const OBJECT_COLS = 4;
const MAX_HANDS = 2;
// How far each ball idly wanders from its resting grid slot when nothing is
// pushing it, as a fraction of the shorter screen dimension.
const ORBIT_RADIUS_FACTOR = 0.035;

// Skeleton connections between MediaPipe's 21 hand landmarks, used to build
// the bone cylinders of the 3D hand mesh.
const HAND_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

// Rough per-bone thickness (wider near the palm, tapering toward fingertips),
// same order/length as HAND_CONNECTIONS.
const BONE_RADII = [
  7, 6, 5, 4,
  8, 6, 5, 4,
  7, 6, 5, 4,
  7, 6, 5, 4,
  6, 5, 4, 3,
  8,
];

// A stable, low-jitter stand-in for "palm center": the wrist plus the four
// finger MCP knuckles, averaged.
const PALM_LANDMARKS = [0, 5, 9, 13, 17];

const UP = new THREE.Vector3(0, 1, 0);

interface Point {
  x: number;
  y: number;
}

interface Landmark3D extends Point {
  z: number;
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
  phase: number;
  orbitSpeed: number;
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
 * HandLandmarker, running fully client-side) drives a little 3D physics
 * scene rendered with Three.js. Each hand is drawn as a lit skeletal mesh
 * (joints + tapered bones, using MediaPipe's real depth per landmark), and a
 * grid of glowing balls idly drifts near its resting spot, fleeing any hand
 * that gets close and springing back once it's gone.
 */
const HandPush = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const objectMeshesRef = useRef<THREE.Mesh[]>([]);
  const jointsPoolRef = useRef<THREE.Mesh[][]>([]);
  const bonesPoolRef = useRef<THREE.Mesh[][]>([]);
  const ringPoolRef = useRef<THREE.Mesh[]>([]);

  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number | null>(null);
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const objectsRef = useRef<SceneObject[]>([]);
  const handsRef = useRef<{ points: Point[]; landmarks: Landmark3D[][] }>({
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

  // Sets up the Three.js scene once: renderer, camera, lights, and pools of
  // reusable meshes for the balls and for up to MAX_HANDS hand skeletons.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x05050a);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(50, 1, 1, 5000);
    camera.position.set(0, 0, 800);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    scene.add(new THREE.AmbientLight(0xffffff, 0.4));
    scene.add(new THREE.HemisphereLight(0x88aaff, 0x140022, 0.5));
    const keyLight = new THREE.PointLight(0xffffff, 1.4, 0, 2);
    keyLight.position.set(0, 150, 500);
    scene.add(keyLight);

    const objectGeometry = new THREE.SphereGeometry(1, 20, 20);
    const objectMeshes: THREE.Mesh[] = [];
    for (let i = 0; i < OBJECT_COUNT; i++) {
      const hue = (i / OBJECT_COUNT) * 300;
      const color = new THREE.Color().setHSL(hue / 360, 0.75, 0.6);
      const material = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.9,
        roughness: 0.35,
        metalness: 0.1,
      });
      const mesh = new THREE.Mesh(objectGeometry, material);
      scene.add(mesh);
      objectMeshes.push(mesh);
    }
    objectMeshesRef.current = objectMeshes;

    const jointGeometry = new THREE.SphereGeometry(1, 12, 12);
    const jointColor = new THREE.Color().setHSL(0.56, 0.85, 0.65);
    const jointMaterial = new THREE.MeshStandardMaterial({
      color: jointColor,
      emissive: jointColor,
      emissiveIntensity: 1,
      roughness: 0.3,
      metalness: 0.2,
      transparent: true,
      opacity: 0.95,
    });
    const boneGeometry = new THREE.CylinderGeometry(1, 1, 1, 8);
    const boneMaterial = new THREE.MeshStandardMaterial({
      color: jointColor,
      emissive: jointColor,
      emissiveIntensity: 0.6,
      roughness: 0.4,
      metalness: 0.1,
      transparent: true,
      opacity: 0.75,
    });

    const joints: THREE.Mesh[][] = [];
    const bones: THREE.Mesh[][] = [];
    for (let h = 0; h < MAX_HANDS; h++) {
      const handJoints: THREE.Mesh[] = [];
      for (let j = 0; j < 21; j++) {
        const mesh = new THREE.Mesh(jointGeometry, jointMaterial);
        mesh.visible = false;
        scene.add(mesh);
        handJoints.push(mesh);
      }
      joints.push(handJoints);

      const handBones: THREE.Mesh[] = [];
      for (let b = 0; b < HAND_CONNECTIONS.length; b++) {
        const mesh = new THREE.Mesh(boneGeometry, boneMaterial);
        mesh.visible = false;
        scene.add(mesh);
        handBones.push(mesh);
      }
      bones.push(handBones);
    }
    jointsPoolRef.current = joints;
    bonesPoolRef.current = bones;

    const ringGeometry = new THREE.RingGeometry(0.96, 1, 64);
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.12,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const rings: THREE.Mesh[] = [];
    for (let h = 0; h < MAX_HANDS; h++) {
      const mesh = new THREE.Mesh(ringGeometry, ringMaterial);
      mesh.visible = false;
      scene.add(mesh);
      rings.push(mesh);
    }
    ringPoolRef.current = rings;

    return () => {
      renderer.dispose();
      objectGeometry.dispose();
      jointGeometry.dispose();
      boneGeometry.dispose();
      ringGeometry.dispose();
      objectMeshes.forEach((mesh) => (mesh.material as THREE.Material).dispose());
      jointMaterial.dispose();
      boneMaterial.dispose();
      ringMaterial.dispose();
    };
  }, []);

  const resizeCanvas = useCallback(() => {
    const container = containerRef.current;
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    if (!container) return;
    const { width, height } = container.getBoundingClientRect();
    sizeRef.current = { width, height };

    if (renderer && camera && width > 0 && height > 0) {
      renderer.setSize(width, height);
      camera.aspect = width / height;
      const fovRad = (camera.fov * Math.PI) / 180;
      const cameraZ = height / (2 * Math.tan(fovRad / 2));
      camera.position.z = cameraZ;
      camera.far = cameraZ * 4;
      camera.updateProjectionMatrix();
    }

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
        phase: prev ? prev.phase : Math.random() * Math.PI * 2,
        orbitSpeed: prev ? prev.orbitSpeed : 0.4 + Math.random() * 0.5,
      };
    });
  }, []);

  const renderScene = useCallback((width: number, height: number) => {
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (!renderer || !scene || !camera) return;

    const toWorldX = (x: number) => x - width / 2;
    const toWorldY = (y: number) => height / 2 - y;

    const objectMeshes = objectMeshesRef.current;
    objectsRef.current.forEach((obj, i) => {
      const mesh = objectMeshes[i];
      if (!mesh) return;
      mesh.position.set(toWorldX(obj.x), toWorldY(obj.y), 0);
      mesh.scale.setScalar(obj.radius);
    });

    const joints = jointsPoolRef.current;
    const bones = bonesPoolRef.current;
    const rings = ringPoolRef.current;
    const landmarksByHand = handsRef.current.landmarks;
    const palmPoints = handsRef.current.points;
    const pushRadius = Math.min(width, height) * 0.24;
    const showSkeleton = showSkeletonRef.current;

    for (let h = 0; h < MAX_HANDS; h++) {
      const landmarks = landmarksByHand[h];
      const handJoints = joints[h];
      const handBones = bones[h];
      const ring = rings[h];

      if (!landmarks || !showSkeleton) {
        handJoints.forEach((mesh) => (mesh.visible = false));
        handBones.forEach((mesh) => (mesh.visible = false));
      } else {
        const worldPts = landmarks.map(
          (lm) => new THREE.Vector3(toWorldX(lm.x), toWorldY(lm.y), lm.z)
        );
        handJoints.forEach((mesh, j) => {
          const p = worldPts[j];
          if (!p) {
            mesh.visible = false;
            return;
          }
          mesh.visible = true;
          mesh.position.copy(p);
          mesh.scale.setScalar(j === 0 ? 9 : 6);
        });
        handBones.forEach((mesh, b) => {
          const [ai, bi] = HAND_CONNECTIONS[b];
          const a = worldPts[ai];
          const bp = worldPts[bi];
          if (!a || !bp) {
            mesh.visible = false;
            return;
          }
          mesh.visible = true;
          const dir = new THREE.Vector3().subVectors(bp, a);
          const length = dir.length() || 0.001;
          const mid = new THREE.Vector3().addVectors(a, bp).multiplyScalar(0.5);
          mesh.position.copy(mid);
          const r = BONE_RADII[b];
          mesh.scale.set(r, length, r);
          mesh.quaternion.setFromUnitVectors(UP, dir.normalize());
        });
      }

      const palm = palmPoints[h];
      if (!landmarks || !palm) {
        ring.visible = false;
      } else {
        ring.visible = true;
        ring.position.set(toWorldX(palm.x), toWorldY(palm.y), -1);
        ring.scale.set(pushRadius, pushRadius, 1);
      }
    }

    renderer.render(scene, camera);
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
      const landmarksOnScreen: Landmark3D[][] = [];
      for (const landmarks of result.landmarks) {
        const mapped = landmarks.map((lm) => ({
          x: (mirrorOn ? 1 - lm.x : lm.x) * width,
          y: lm.y * height,
          // MediaPipe's z is depth relative to the wrist, in roughly the
          // same normalized scale as x/y, with smaller (more negative)
          // meaning closer to the camera. Flip and scale it into
          // screen-ish units so a hand reaching toward the lens visibly
          // pops toward the viewer in the 3D scene.
          z: -lm.z * width * 0.5,
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
      const orbitRadius = Math.min(width, height) * ORBIT_RADIUS_FACTOR;
      const t = time / 1000;

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

        // Idle wander: rather than spring to a fixed point, spring toward a
        // slowly orbiting target near home so the balls stay gently in
        // motion even when no hand is around.
        const targetX =
          obj.homeX + Math.cos(t * obj.orbitSpeed + obj.phase) * orbitRadius;
        const targetY =
          obj.homeY +
          Math.sin(t * obj.orbitSpeed * 0.8 + obj.phase) * orbitRadius;
        fx += (targetX - obj.x) * springK;
        fy += (targetY - obj.y) * springK;

        const dampFactor = Math.pow(damping, dt);
        obj.vx = (obj.vx + fx * dt) * dampFactor;
        obj.vy = (obj.vy + fy * dt) * dampFactor;
        obj.x += obj.vx * dt;
        obj.y += obj.vy * dt;
      }

      renderScene(width, height);
    },
    [renderScene]
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
            Real hand tracking, rendered as a 3D mesh, pushes these balls out
            of the way. They drift gently on their own and spring back to
            their resting spots once your hand is gone.
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
            Show hand mesh
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
