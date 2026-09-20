import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import * as CANNON from "cannon-es";
import {
  FilesetResolver,
  HandLandmarker,
  type HandLandmarkerResult,
} from "@mediapipe/tasks-vision";

const OBJECT_COUNT = 16;
const MAX_HANDS = 2;

// Thumb-tip-to-index-tip distance, as a fraction of the hand's own size
// (wrist-to-middle-knuckle), below which the hand counts as pinching.
const PINCH_RATIO_THRESHOLD = 0.45;
// How close a pinch has to start to a ball to grab it, as a fraction of the
// shorter screen dimension.
const GRAB_RADIUS_FACTOR = 0.07;

// Real-world-ish rigid body tuning. Units are pixels/seconds, not meters —
// there's no true physical scale on screen, so these are picked by feel
// (see the physics-tune scripts used during development) rather than derived.
const GRAVITY = 1400;
const BALL_FRICTION = 0.45;
const BALL_RESTITUTION = 0.25;
const LINEAR_DAMPING = 0.35;
const ANGULAR_DAMPING = 0.5;
const SOLVER_ITERATIONS = 20;
const PUSH_FORCE_SCALE = 26000;
// Caps the velocity a pinch-dragged ball can report to the physics engine,
// so a noisy hand-tracking frame (a sudden jump) can't inject a burst of
// energy into whatever it's dropped on top of.
const MAX_DRAG_SPEED = 4000;

// A stable, low-jitter stand-in for "palm center": the wrist plus the four
// finger MCP knuckles, averaged.
const PALM_LANDMARKS = [0, 5, 9, 13, 17];

// Which 21 landmarks form each of the 5 fingers, always starting at the
// wrist so all five tubes converge there like a real hand.
const FINGER_LANDMARKS: number[][] = [
  [0, 1, 2, 3, 4], // thumb
  [0, 5, 6, 7, 8], // index
  [0, 9, 10, 11, 12], // middle
  [0, 13, 14, 15, 16], // ring
  [0, 17, 18, 19, 20], // pinky
];
// Tube radius at each of those landmarks (wide at the wrist, tapering to
// the fingertip), same order/length as FINGER_LANDMARKS.
const FINGER_RADII: number[][] = [
  [10, 9, 7, 5, 3],
  [10, 8, 6, 4.5, 3],
  [10, 8, 6, 4.5, 3],
  [10, 7, 5.5, 4, 2.8],
  [9, 6, 4.5, 3.5, 2.5],
];
// Wrist + all five knuckles, in hand order (thumb side to pinky side): a
// flat fan filling the palm between the finger tubes.
const PALM_PATCH_LANDMARKS = [0, 1, 5, 9, 13, 17];
const PALM_PATCH_INDICES = new Uint16Array([0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 5]);

const FINGER_TUBULAR_SEGMENTS = 20;
const FOREARM_TUBULAR_SEGMENTS = 8;
const TUBE_RADIAL_SEGMENTS = 10;
// How far beyond the last real landmark a finger's tube tapers to a point,
// and the (near-zero) radius it tapers to — gives a rounded fingertip
// instead of a flat cut-off cylinder end.
const TIP_EXTENSION = 0.4;
const TIP_RADIUS = 1.2;

// The hand-tracking pipeline works in screen-pixel space (origin top-left,
// y down); the physics/render world is centered on screen with y up. These
// two helpers convert between them.
function toWorldX(x: number, width: number) {
  return x - width / 2;
}
function toWorldY(y: number, height: number) {
  return height / 2 - y;
}

function buildTubeIndices(tubularSegments: number, radialSegments: number): Uint16Array {
  const indices: number[] = [];
  for (let i = 0; i < tubularSegments; i++) {
    for (let j = 0; j < radialSegments; j++) {
      const a = i * radialSegments + j;
      const b = i * radialSegments + ((j + 1) % radialSegments);
      const c = (i + 1) * radialSegments + ((j + 1) % radialSegments);
      const d = (i + 1) * radialSegments + j;
      indices.push(a, b, d, b, c, d);
    }
  }
  return new Uint16Array(indices);
}

function createTubeGeometry(tubularSegments: number, radialSegments: number): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const vertexCount = (tubularSegments + 1) * radialSegments;
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3));
  geometry.setIndex(new THREE.BufferAttribute(buildTubeIndices(tubularSegments, radialSegments), 1));
  return geometry;
}

// Rebuilds a tube's vertex positions in place from a chain of control points
// and per-point radii (same length), using Frenet frames so the tube twists
// smoothly along the curve instead of each ring facing a fixed axis.
function updateTubeGeometry(
  geometry: THREE.BufferGeometry,
  points: THREE.Vector3[],
  radii: number[],
  tubularSegments: number,
  radialSegments: number
) {
  const curve = new THREE.CatmullRomCurve3(points, false, "catmullrom", 0.4);
  const frames = curve.computeFrenetFrames(tubularSegments, false);
  const posAttr = geometry.getAttribute("position") as THREE.BufferAttribute;
  const arr = posAttr.array as Float32Array;
  const segCount = points.length - 1;

  for (let i = 0; i <= tubularSegments; i++) {
    const u = i / tubularSegments;
    const center = curve.getPointAt(u);
    // Radius interpolated piecewise-linearly over the control points; not
    // exact arc-length matching, but close enough for this stylized mesh.
    const scaled = u * segCount;
    const segIdx = Math.min(Math.floor(scaled), segCount - 1);
    const localT = scaled - segIdx;
    const radius = radii[segIdx] + (radii[segIdx + 1] - radii[segIdx]) * localT;
    const normal = frames.normals[i];
    const binormal = frames.binormals[i];

    for (let j = 0; j < radialSegments; j++) {
      const angle = (j / radialSegments) * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const idx = (i * radialSegments + j) * 3;
      arr[idx] = center.x + (normal.x * cos + binormal.x * sin) * radius;
      arr[idx + 1] = center.y + (normal.y * cos + binormal.y * sin) * radius;
      arr[idx + 2] = center.z + (normal.z * cos + binormal.z * sin) * radius;
    }
  }
  posAttr.needsUpdate = true;
  geometry.computeVertexNormals();
}

function createPalmGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const vertexCount = PALM_PATCH_LANDMARKS.length;
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3));
  geometry.setIndex(new THREE.BufferAttribute(PALM_PATCH_INDICES, 1));
  return geometry;
}

function updatePalmGeometry(geometry: THREE.BufferGeometry, points: THREE.Vector3[]) {
  const posAttr = geometry.getAttribute("position") as THREE.BufferAttribute;
  const arr = posAttr.array as Float32Array;
  points.forEach((p, i) => {
    arr[i * 3] = p.x;
    arr[i * 3 + 1] = p.y;
    arr[i * 3 + 2] = p.z;
  });
  posAttr.needsUpdate = true;
  geometry.computeVertexNormals();
}

// Extrapolates one extra point past the last landmark so a finger's tube
// tapers to a rounded point instead of ending in a flat cut-off cylinder.
function withTaperedTip(points: THREE.Vector3[]): THREE.Vector3[] {
  const last = points[points.length - 1];
  const prev = points[points.length - 2];
  const dir = new THREE.Vector3().subVectors(last, prev);
  return [...points, last.clone().addScaledVector(dir, TIP_EXTENSION)];
}

interface Point {
  x: number;
  y: number;
}

interface Landmark3D extends Point {
  z: number;
}

interface Ball {
  body: CANNON.Body;
  mesh: THREE.Mesh;
  radius: number;
  hue: number;
  grabbedBy: number | null;
}

interface PinchState {
  pinching: boolean;
  grabbedIndex: number | null;
}

interface HandMeshPart {
  geometry: THREE.BufferGeometry;
  wireMesh: THREE.Mesh;
  fillMesh: THREE.Mesh;
}

type Status = "idle" | "loading-model" | "starting-camera" | "running" | "error";

/**
 * Hand Push
 *
 * A projection-mapping sketch: real hand tracking (MediaPipe's
 * HandLandmarker, running fully client-side) drives a little rigid-body
 * physics scene (Three.js + cannon-es). A grid of balls drops under gravity
 * and settles on the floor. An open hand shoves nearby balls away; a pinch
 * (thumb and index tip together) grabs the nearest ball, drags it 1:1 with
 * your fingers, and lets real physics take over the instant you let go —
 * it falls, collides, and can pile up with the others.
 */
const HandPush = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const worldRef = useRef<CANNON.World | null>(null);
  const wallsRef = useRef<CANNON.Body[]>([]);
  const ballsRef = useRef<Ball[]>([]);
  const initializedLayoutRef = useRef(false);

  const fingerPartsRef = useRef<HandMeshPart[][]>([]); // [hand][finger]
  const palmPartsRef = useRef<HandMeshPart[]>([]); // [hand]
  const forearmPartsRef = useRef<HandMeshPart[]>([]); // [hand]
  const ringPoolRef = useRef<THREE.Mesh[]>([]);
  const pinchIndicatorPoolRef = useRef<THREE.Mesh[]>([]);

  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number | null>(null);
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const handsRef = useRef<{
    points: Point[];
    landmarks: Landmark3D[][];
    pinch: (Point | null)[];
  }>({
    points: [],
    landmarks: [],
    pinch: [],
  });
  const pinchStateRef = useRef<PinchState[]>(
    Array.from({ length: MAX_HANDS }, () => ({ pinching: false, grabbedIndex: null }))
  );
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

  // Sets up the Three.js scene and the cannon-es physics world once:
  // renderer, camera, lights, static floor/walls, the balls (body + mesh
  // per ball), and pools of reusable meshes for up to MAX_HANDS hand
  // skeletons.
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

    const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -GRAVITY, 0) });
    world.broadphase = new CANNON.NaiveBroadphase();
    (world.solver as CANNON.GSSolver).iterations = SOLVER_ITERATIONS;
    world.allowSleep = true;
    worldRef.current = world;

    const ballMaterial = new CANNON.Material("ball");
    const wallMaterial = new CANNON.Material("wall");
    world.addContactMaterial(
      new CANNON.ContactMaterial(ballMaterial, ballMaterial, {
        friction: BALL_FRICTION,
        restitution: BALL_RESTITUTION,
      })
    );
    world.addContactMaterial(
      new CANNON.ContactMaterial(ballMaterial, wallMaterial, {
        friction: BALL_FRICTION,
        restitution: 0.3,
      })
    );

    const makeWall = (axis: CANNON.Vec3, angle: number) => {
      const body = new CANNON.Body({ mass: 0, material: wallMaterial });
      body.addShape(new CANNON.Plane());
      body.quaternion.setFromAxisAngle(axis, angle);
      world.addBody(body);
      return body;
    };
    // Floor, ceiling, left wall, right wall — an invisible box containing
    // the balls, sized to the screen in resizeCanvas. The scene is confined
    // to the z=0 plane (see each ball's linearFactor/angularFactor below),
    // so no front/back wall is needed.
    wallsRef.current = [
      makeWall(new CANNON.Vec3(1, 0, 0), -Math.PI / 2),
      makeWall(new CANNON.Vec3(1, 0, 0), Math.PI / 2),
      makeWall(new CANNON.Vec3(0, 1, 0), Math.PI / 2),
      makeWall(new CANNON.Vec3(0, 1, 0), -Math.PI / 2),
    ];

    const ballGeometry = new THREE.SphereGeometry(1, 20, 20);
    const balls: Ball[] = [];
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
      const mesh = new THREE.Mesh(ballGeometry, material);
      scene.add(mesh);

      const radius = 14 + (i % 3) * 5;
      const body = new CANNON.Body({
        mass: radius * radius * 0.02,
        shape: new CANNON.Sphere(radius),
        material: ballMaterial,
        linearDamping: LINEAR_DAMPING,
        angularDamping: ANGULAR_DAMPING,
        // Confine the simulation to the camera-facing plane: no z motion,
        // only spin around z (so a ball rolling sideways visibly rotates).
        linearFactor: new CANNON.Vec3(1, 1, 0),
        angularFactor: new CANNON.Vec3(0, 0, 1),
      });
      // Placeholder position; resizeCanvas's first call scatters these
      // properly once the container's real size is known.
      body.position.set(0, 0, 0);
      world.addBody(body);

      balls.push({ body, mesh, radius, hue, grabbedBy: null });
    }
    ballsRef.current = balls;

    // The hand is a continuous mesh (finger tubes + a palm patch + a
    // forearm stub) rather than discrete joints/bones: a bright wireframe
    // plus a faint solid fill sharing the same (per-frame-updated) geometry,
    // for a look closer to a real hand-tracking mesh render.
    const handWireColor = new THREE.Color(0xcdeeff);
    const handWireMaterial = new THREE.MeshBasicMaterial({
      color: handWireColor,
      wireframe: true,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
    });
    const handFillMaterial = new THREE.MeshStandardMaterial({
      color: 0x1c3a52,
      emissive: handWireColor,
      emissiveIntensity: 0.15,
      transparent: true,
      opacity: 0.15,
      roughness: 0.6,
      metalness: 0.1,
      side: THREE.DoubleSide,
    });

    const fingerParts: HandMeshPart[][] = [];
    const palmParts: HandMeshPart[] = [];
    const forearmParts: HandMeshPart[] = [];
    for (let h = 0; h < MAX_HANDS; h++) {
      const handFingers: HandMeshPart[] = [];
      for (let f = 0; f < FINGER_LANDMARKS.length; f++) {
        const geometry = createTubeGeometry(FINGER_TUBULAR_SEGMENTS, TUBE_RADIAL_SEGMENTS);
        const wireMesh = new THREE.Mesh(geometry, handWireMaterial);
        const fillMesh = new THREE.Mesh(geometry, handFillMaterial);
        wireMesh.visible = false;
        fillMesh.visible = false;
        scene.add(wireMesh, fillMesh);
        handFingers.push({ geometry, wireMesh, fillMesh });
      }
      fingerParts.push(handFingers);

      const palmGeometry = createPalmGeometry();
      const palmWire = new THREE.Mesh(palmGeometry, handWireMaterial);
      const palmFill = new THREE.Mesh(palmGeometry, handFillMaterial);
      palmWire.visible = false;
      palmFill.visible = false;
      scene.add(palmWire, palmFill);
      palmParts.push({ geometry: palmGeometry, wireMesh: palmWire, fillMesh: palmFill });

      const forearmGeometry = createTubeGeometry(FOREARM_TUBULAR_SEGMENTS, TUBE_RADIAL_SEGMENTS);
      const forearmWire = new THREE.Mesh(forearmGeometry, handWireMaterial);
      const forearmFill = new THREE.Mesh(forearmGeometry, handFillMaterial);
      forearmWire.visible = false;
      forearmFill.visible = false;
      scene.add(forearmWire, forearmFill);
      forearmParts.push({ geometry: forearmGeometry, wireMesh: forearmWire, fillMesh: forearmFill });
    }
    fingerPartsRef.current = fingerParts;
    palmPartsRef.current = palmParts;
    forearmPartsRef.current = forearmParts;

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

    const pinchGeometry = new THREE.SphereGeometry(1, 16, 16);
    const pinchColor = new THREE.Color(0xffffff);
    const pinchMaterial = new THREE.MeshStandardMaterial({
      color: pinchColor,
      emissive: pinchColor,
      emissiveIntensity: 1.6,
      roughness: 0.2,
      metalness: 0.1,
    });
    const pinchIndicators: THREE.Mesh[] = [];
    for (let h = 0; h < MAX_HANDS; h++) {
      const mesh = new THREE.Mesh(pinchGeometry, pinchMaterial);
      mesh.visible = false;
      scene.add(mesh);
      pinchIndicators.push(mesh);
    }
    pinchIndicatorPoolRef.current = pinchIndicators;

    return () => {
      renderer.dispose();
      ballGeometry.dispose();
      ringGeometry.dispose();
      pinchGeometry.dispose();
      balls.forEach((ball) => (ball.mesh.material as THREE.Material).dispose());
      handWireMaterial.dispose();
      handFillMaterial.dispose();
      ringMaterial.dispose();
      pinchMaterial.dispose();
      fingerParts.forEach((hand) => hand.forEach((part) => part.geometry.dispose()));
      palmParts.forEach((part) => part.geometry.dispose());
      forearmParts.forEach((part) => part.geometry.dispose());
    };
  }, []);

  const resizeCanvas = useCallback(() => {
    const container = containerRef.current;
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    if (!container) return;
    const { width, height } = container.getBoundingClientRect();
    sizeRef.current = { width, height };
    if (width <= 0 || height <= 0) return;

    if (renderer && camera) {
      renderer.setSize(width, height);
      camera.aspect = width / height;
      const fovRad = (camera.fov * Math.PI) / 180;
      const cameraZ = height / (2 * Math.tan(fovRad / 2));
      camera.position.z = cameraZ;
      camera.far = cameraZ * 4;
      camera.updateProjectionMatrix();
    }

    const [floor, ceiling, left, right] = wallsRef.current;
    if (floor) {
      floor.position.set(0, -height / 2, 0);
      ceiling.position.set(0, height / 2, 0);
      left.position.set(-width / 2, 0, 0);
      right.position.set(width / 2, 0, 0);
    }

    // Scatter the balls near the top once, the first time we know the real
    // screen size. They fall and settle under gravity as soon as the
    // simulation starts stepping.
    if (!initializedLayoutRef.current) {
      initializedLayoutRef.current = true;
      const cols = 4;
      ballsRef.current.forEach((ball, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = -width * 0.3 + col * ((width * 0.6) / (cols - 1)) + (Math.random() - 0.5) * 10;
        const y = height * 0.3 + row * 50;
        ball.body.position.set(x, y, 0);
        ball.body.velocity.set(0, 0, 0);
        ball.body.angularVelocity.set(0, 0, 0);
      });
    }
  }, []);

  const renderScene = useCallback((width: number, height: number) => {
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (!renderer || !scene || !camera) return;

    ballsRef.current.forEach((ball) => {
      const { body, mesh, radius, grabbedBy } = ball;
      const grabbed = grabbedBy !== null;
      mesh.position.set(body.position.x, body.position.y, body.position.z);
      mesh.quaternion.set(
        body.quaternion.x,
        body.quaternion.y,
        body.quaternion.z,
        body.quaternion.w
      );
      mesh.scale.setScalar(radius * (grabbed ? 1.15 : 1));
      const material = mesh.material as THREE.MeshStandardMaterial;
      material.emissiveIntensity = grabbed ? 1.7 : 0.9;
    });

    const fingerParts = fingerPartsRef.current;
    const palmParts = palmPartsRef.current;
    const forearmParts = forearmPartsRef.current;
    const rings = ringPoolRef.current;
    const pinchIndicators = pinchIndicatorPoolRef.current;
    const landmarksByHand = handsRef.current.landmarks;
    const palmPoints = handsRef.current.points;
    const pinchPoints = handsRef.current.pinch;
    const pushRadius = Math.min(width, height) * 0.24;
    const showSkeleton = showSkeletonRef.current;

    const setPartVisible = (part: HandMeshPart, visible: boolean) => {
      part.wireMesh.visible = visible;
      part.fillMesh.visible = visible;
    };

    for (let h = 0; h < MAX_HANDS; h++) {
      const landmarks = landmarksByHand[h];
      const handFingers = fingerParts[h];
      const palmPart = palmParts[h];
      const forearmPart = forearmParts[h];
      const ring = rings[h];

      if (!landmarks || !showSkeleton) {
        handFingers.forEach((part) => setPartVisible(part, false));
        setPartVisible(palmPart, false);
        setPartVisible(forearmPart, false);
      } else {
        const worldPts = landmarks.map(
          (lm) =>
            new THREE.Vector3(toWorldX(lm.x, width), toWorldY(lm.y, height), lm.z)
        );

        FINGER_LANDMARKS.forEach((indices, f) => {
          const controlPoints = withTaperedTip(indices.map((idx) => worldPts[idx]));
          const radii = [...FINGER_RADII[f], TIP_RADIUS];
          updateTubeGeometry(
            handFingers[f].geometry,
            controlPoints,
            radii,
            FINGER_TUBULAR_SEGMENTS,
            TUBE_RADIAL_SEGMENTS
          );
          setPartVisible(handFingers[f], true);
        });

        updatePalmGeometry(
          palmPart.geometry,
          PALM_PATCH_LANDMARKS.map((idx) => worldPts[idx])
        );
        setPartVisible(palmPart, true);

        // A short stub extending from the wrist away from the fingers, so
        // the hand doesn't look like it ends abruptly at the wrist.
        const wrist = worldPts[0];
        const knuckleCenter = new THREE.Vector3();
        for (const idx of PALM_LANDMARKS) knuckleCenter.add(worldPts[idx]);
        knuckleCenter.divideScalar(PALM_LANDMARKS.length);
        const handSize = wrist.distanceTo(knuckleCenter) || 1;
        const forearmDir = new THREE.Vector3().subVectors(wrist, knuckleCenter).normalize();
        const forearmEnd = wrist.clone().addScaledVector(forearmDir, handSize * 2.4);
        updateTubeGeometry(
          forearmPart.geometry,
          [wrist, forearmEnd],
          [10, 13],
          FOREARM_TUBULAR_SEGMENTS,
          TUBE_RADIAL_SEGMENTS
        );
        setPartVisible(forearmPart, true);
      }

      const palm = palmPoints[h];
      if (!landmarks || !palm) {
        ring.visible = false;
      } else {
        ring.visible = true;
        ring.position.set(toWorldX(palm.x, width), toWorldY(palm.y, height), -1);
        ring.scale.set(pushRadius, pushRadius, 1);
      }

      const pinchIndicator = pinchIndicators[h];
      const pinch = pinchPoints[h];
      if (!pinch) {
        pinchIndicator.visible = false;
      } else {
        pinchIndicator.visible = true;
        pinchIndicator.position.set(
          toWorldX(pinch.x, width),
          toWorldY(pinch.y, height),
          20
        );
        pinchIndicator.scale.setScalar(10);
      }
    }

    renderer.render(scene, camera);
  }, []);

  const loop = useCallback(
    (time: number) => {
      rafRef.current = requestAnimationFrame(loop);

      const video = videoRef.current;
      const landmarker = landmarkerRef.current;
      const world = worldRef.current;
      if (!video || !landmarker || !world) return;
      if (video.videoWidth === 0 || video.videoHeight === 0) return;

      const dt = lastTimeRef.current
        ? Math.min((time - lastTimeRef.current) / 1000, 1 / 30)
        : 1 / 60;
      lastTimeRef.current = time;

      const { width, height } = sizeRef.current;
      if (!width || !height) return;

      const result: HandLandmarkerResult = landmarker.detectForVideo(video, time);
      const mirrorOn = mirrorRef.current;

      const points: Point[] = [];
      const landmarksOnScreen: Landmark3D[][] = [];
      const pinchPointsScreen: (Point | null)[] = [];
      const grabRadius = Math.min(width, height) * GRAB_RADIUS_FACTOR;

      result.landmarks.forEach((landmarks, h) => {
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
        const palmScreen = { x: sx / PALM_LANDMARKS.length, y: sy / PALM_LANDMARKS.length };
        points.push({ x: toWorldX(palmScreen.x, width), y: toWorldY(palmScreen.y, height) });

        if (h >= MAX_HANDS) {
          pinchPointsScreen.push(null);
          return;
        }

        // Pinch = thumb tip and index tip close together, relative to the
        // hand's own size (wrist-to-middle-knuckle) so it works regardless
        // of how far the hand is from the camera.
        const thumbTip = mapped[4];
        const indexTip = mapped[8];
        const wrist = mapped[0];
        const middleMcp = mapped[9];
        const pinchDist = Math.hypot(thumbTip.x - indexTip.x, thumbTip.y - indexTip.y);
        const handSize = Math.hypot(wrist.x - middleMcp.x, wrist.y - middleMcp.y) || 1;
        const isPinching = pinchDist / handSize < PINCH_RATIO_THRESHOLD;
        const pinchScreen = { x: (thumbTip.x + indexTip.x) / 2, y: (thumbTip.y + indexTip.y) / 2 };
        pinchPointsScreen.push(pinchScreen);
        const pinchWorld = {
          x: toWorldX(pinchScreen.x, width),
          y: toWorldY(pinchScreen.y, height),
        };

        const state = pinchStateRef.current[h];
        const balls = ballsRef.current;

        if (isPinching && !state.pinching) {
          // Pinch just started: grab the nearest free ball within reach.
          let nearestIdx: number | null = null;
          let nearestDist = grabRadius;
          balls.forEach((ball, i) => {
            if (ball.grabbedBy !== null) return;
            const d = Math.hypot(
              ball.body.position.x - pinchWorld.x,
              ball.body.position.y - pinchWorld.y
            );
            if (d < nearestDist) {
              nearestDist = d;
              nearestIdx = i;
            }
          });
          if (nearestIdx !== null) {
            const ball = balls[nearestIdx];
            ball.grabbedBy = h;
            ball.body.type = CANNON.Body.KINEMATIC;
            ball.body.velocity.set(0, 0, 0);
            ball.body.angularVelocity.set(0, 0, 0);
            state.grabbedIndex = nearestIdx;
          }
        } else if (!isPinching && state.pinching && state.grabbedIndex !== null) {
          // Fingers opened: hand the ball back to the physics simulation
          // right where it is, carrying whatever velocity it was just
          // dragged with so letting go mid-motion gives it a little toss.
          const ball = balls[state.grabbedIndex];
          if (ball && ball.grabbedBy === h) {
            ball.grabbedBy = null;
            ball.body.type = CANNON.Body.DYNAMIC;
            ball.body.wakeUp();
          }
          state.grabbedIndex = null;
        }
        state.pinching = isPinching;

        if (isPinching && state.grabbedIndex !== null) {
          const ball = balls[state.grabbedIndex];
          if (ball) {
            const body = ball.body;
            const prevX = body.position.x;
            const prevY = body.position.y;
            let vx = (pinchWorld.x - prevX) / dt;
            let vy = (pinchWorld.y - prevY) / dt;
            const speed = Math.hypot(vx, vy);
            if (speed > MAX_DRAG_SPEED) {
              const scale = MAX_DRAG_SPEED / speed;
              vx *= scale;
              vy *= scale;
            }
            // Kinematic bodies still get `position += velocity * dt` applied
            // during world.step, so setting velocity alone is enough to
            // reach the pinch point each frame — also setting position
            // directly here would apply that displacement twice and send
            // the ball racing ahead of your fingers.
            body.velocity.set(vx, vy, 0);
          }
        }
      });

      // A hand that's no longer in frame can't still be pinching.
      for (let h = result.landmarks.length; h < MAX_HANDS; h++) {
        const state = pinchStateRef.current[h];
        if (state.grabbedIndex !== null) {
          const ball = ballsRef.current[state.grabbedIndex];
          if (ball && ball.grabbedBy === h) {
            ball.grabbedBy = null;
            ball.body.type = CANNON.Body.DYNAMIC;
            ball.body.wakeUp();
          }
        }
        state.pinching = false;
        state.grabbedIndex = null;
      }

      handsRef.current = { points, landmarks: landmarksOnScreen, pinch: pinchPointsScreen };
      if (points.length !== handCountRef.current) {
        handCountRef.current = points.length;
        setHandCount(points.length);
      }

      // Open-hand push: an un-grabbed ball near a palm gets shoved away.
      // Real force (not scaled by mass), so heavier/bigger balls resist it
      // more, same as a real shove would.
      const pushRadius = Math.min(width, height) * 0.24;
      const pushForce = (pushStrengthRef.current / 100) * PUSH_FORCE_SCALE;
      for (const ball of ballsRef.current) {
        if (ball.grabbedBy !== null) continue;
        for (const hand of points) {
          const dx = ball.body.position.x - hand.x;
          const dy = ball.body.position.y - hand.y;
          const dist = Math.hypot(dx, dy);
          if (dist >= pushRadius) continue;
          const falloff = 1 - dist / pushRadius;
          const mag = pushForce * falloff * falloff;
          if (dist < 1) {
            const angle = ball.hue * (Math.PI / 180);
            ball.body.applyForce(new CANNON.Vec3(Math.cos(angle) * mag, Math.sin(angle) * mag, 0));
          } else {
            ball.body.applyForce(new CANNON.Vec3((dx / dist) * mag, (dy / dist) * mag, 0));
          }
          ball.body.wakeUp();
        }
      }

      world.step(1 / 60, dt, 5);

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
    handsRef.current = { points: [], landmarks: [], pinch: [] };
    handCountRef.current = 0;
    setHandCount(0);
    ballsRef.current.forEach((ball) => {
      if (ball.grabbedBy !== null) {
        ball.grabbedBy = null;
        ball.body.type = CANNON.Body.DYNAMIC;
        ball.body.wakeUp();
      }
    });
    pinchStateRef.current.forEach((state) => {
      state.pinching = false;
      state.grabbedIndex = null;
    });
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
            Real hand tracking drives a real rigid-body physics scene. The
            balls drop, collide, and settle under gravity. An open hand
            shoves them; pinch (thumb and index together) to grab one, drag
            it, and let go to drop it — physics takes over from there.
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
