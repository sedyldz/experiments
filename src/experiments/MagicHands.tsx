import { useCallback, useEffect, useRef, useState } from "react";
import {
  FilesetResolver,
  HandLandmarker,
  type HandLandmarkerResult,
} from "@mediapipe/tasks-vision";

type EffectId = "water" | "fire" | "arcane";
type Status = "idle" | "loading-model" | "starting-camera" | "running" | "error";

const EFFECTS: { id: EffectId; label: string; blurb: string }[] = [
  {
    id: "water",
    label: "Water",
    blurb:
      "A swirling orb of water that bends the camera image like a lens. Close your fist to squeeze it, flick your hand to splash, hold up two hands to stretch a stream between them.",
  },
  {
    id: "fire",
    label: "Fire",
    blurb:
      "Flames lick up from your fingertips and palm, with heat haze warping the world behind them.",
  },
  {
    id: "arcane",
    label: "Arcane",
    blurb:
      "Sparks of magic leap off your fingertips and settle into a glowing ring orbiting your hand.",
  },
];

const EFFECT_MODE: Record<EffectId, number> = { water: 0, fire: 1, arcane: 2 };

const MAX_HANDS = 2;
// Must match MAX_PARTICLES in the fragment shader.
const MAX_PARTICLES = 96;
const WATER_COUNT = 72;
// Longest side of the WebGL drawing buffer. The shader loops over every
// particle for every pixel, so capping resolution keeps it smooth.
const MAX_BUFFER_SIDE = 1600;

const FINGERTIPS = [4, 8, 12, 16, 20];
const PALM_LANDMARKS = [0, 5, 9, 13, 17];

// One Euro Filter (Casiez, Roussel & Vogel, 2012), same as Hand Push:
// heavy smoothing when a landmark is still, little lag when it moves fast.
class OneEuroFilter {
  private xPrev: number | null = null;
  private dxPrev = 0;
  private tPrev: number | null = null;

  constructor(
    private minCutoff = 1,
    private beta = 0,
    private dCutoff = 1
  ) {}

  private static alpha(cutoff: number, dt: number) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  filter(x: number, t: number): number {
    if (this.tPrev === null || this.xPrev === null) {
      this.tPrev = t;
      this.xPrev = x;
      return x;
    }
    const dt = Math.max(t - this.tPrev, 1e-6);
    this.tPrev = t;
    const dx = (x - this.xPrev) / dt;
    const aD = OneEuroFilter.alpha(this.dCutoff, dt);
    this.dxPrev = aD * dx + (1 - aD) * this.dxPrev;
    const a = OneEuroFilter.alpha(
      this.minCutoff + this.beta * Math.abs(this.dxPrev),
      dt
    );
    this.xPrev = a * x + (1 - a) * this.xPrev;
    return this.xPrev;
  }
}

interface Vec2 {
  x: number;
  y: number;
}

interface Hand {
  key: string;
  points: Vec2[];
  palm: Vec2;
  // Wrist to middle knuckle, in buffer pixels: the hand's own ruler.
  size: number;
  // 0 = closed fist, 1 = fully open hand.
  openness: number;
  vel: Vec2;
}

interface TrackedHand {
  filters: { x: OneEuroFilter; y: OneEuroFilter }[];
  lastPalm: Vec2 | null;
  lastTime: number;
  vel: Vec2;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  // Metaball radius in buffer pixels, before `scale`.
  baseRadius: number;
  radius: number;
  energy: number;
  age: number;
  life: number;
  alive: boolean;
  // Per-particle randomness, fixed for the particle's lifetime.
  seed: number;
  seed2: number;
  seed3: number;
  phase: number;
  // Water: seconds left detached from the hand (dripping or splashing).
  free: number;
  // Water: 0..1 visibility; grows when bound, shrinks while falling.
  scale: number;
  handKey: string;
}

function createParticles(): Particle[] {
  return Array.from({ length: MAX_PARTICLES }, () => ({
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    baseRadius: 0,
    radius: 0,
    energy: 0,
    age: 0,
    life: 1,
    alive: false,
    seed: Math.random(),
    seed2: Math.random(),
    seed3: Math.random(),
    phase: Math.random() * Math.PI * 2,
    free: 0,
    scale: 0,
    handKey: "",
  }));
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));
const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

function buildHand(key: string, points: Vec2[], vel: Vec2): Hand {
  const palm = { x: 0, y: 0 };
  PALM_LANDMARKS.forEach((i) => {
    palm.x += points[i].x / PALM_LANDMARKS.length;
    palm.y += points[i].y / PALM_LANDMARKS.length;
  });
  const size = Math.max(dist(points[0], points[9]), 1);
  // Fingertip reach relative to hand size: ~0.8 for a fist, ~1.7 open.
  let reach = 0;
  for (const tip of [8, 12, 16, 20]) reach += dist(points[tip], palm) / 4;
  const openness = clamp((reach / size - 0.85) / 0.8, 0, 1);
  return { key, points, palm, size, openness, vel };
}

// A stand-in hand for before the camera starts: follows the pointer, or
// drifts around the center, so the effect is visible straight away.
function demoPoints(palm: Vec2, size: number): Vec2[] {
  const pts: Vec2[] = Array.from({ length: 21 }, () => ({ ...palm }));
  pts[0] = { x: palm.x, y: palm.y + size * 0.75 };
  [5, 9, 13, 17].forEach((i, k) => {
    pts[i] = { x: palm.x + (k - 1.5) * size * 0.28, y: palm.y - size * 0.3 };
  });
  const tipAngles = [-2.6, -1.95, -1.6, -1.25, -0.95];
  const tipReach = [1.15, 1.6, 1.7, 1.6, 1.35];
  FINGERTIPS.forEach((i, k) => {
    pts[i] = {
      x: palm.x + Math.cos(tipAngles[k]) * size * tipReach[k],
      y: palm.y + Math.sin(tipAngles[k]) * size * tipReach[k],
    };
  });
  return pts;
}

// ---------------------------------------------------------------------------
// Particle behaviours
// ---------------------------------------------------------------------------

interface WaterTarget {
  x: number;
  y: number;
  radius: number;
  hand: Hand;
  tip: boolean;
}

function waterTarget(p: Particle, hands: Hand[], t: number): WaterTarget {
  if (hands.length >= 2 && p.seed < 0.3) {
    // A wobbling stream stretched between the two palms.
    const [a, b] = hands;
    const u = 0.5 + 0.5 * Math.sin(t * 0.7 + p.phase);
    const dx = b.palm.x - a.palm.x;
    const dy = b.palm.y - a.palm.y;
    const len = Math.max(Math.hypot(dx, dy), 1);
    const size = (a.size + b.size) / 2;
    const wave =
      Math.sin(u * Math.PI * 2 + t * 5 + p.seed2 * 2) *
      Math.sin(u * Math.PI) *
      size *
      0.18;
    return {
      x: a.palm.x + dx * u + (-dy / len) * wave,
      y: a.palm.y + dy * u + (dx / len) * wave,
      radius: size * (0.1 + 0.04 * p.seed3),
      hand: p.seed2 < 0.5 ? a : b,
      tip: false,
    };
  }

  const hand = hands.length >= 2 && p.seed2 >= 0.5 ? hands[1] : hands[0];
  const { size, palm } = hand;

  if (p.seed3 < 0.16) {
    // A few droplets clinging to each fingertip.
    const tip = hand.points[FINGERTIPS[Math.floor(p.seed * 5) % 5]];
    return {
      x: tip.x + Math.sin(t * 4 + p.phase) * size * 0.02,
      y: tip.y + Math.cos(t * 3 + p.phase) * size * 0.02,
      radius: size * 0.07 * (0.8 + 0.5 * p.seed2),
      hand,
      tip: true,
    };
  }

  // The orb: particles swirl around the palm on rings of varying radius.
  // An open hand spreads the orb out; a fist squeezes it small.
  const orbRadius = size * (0.16 + 0.32 * hand.openness);
  const ring = orbRadius * (0.3 + 0.7 * Math.sqrt(p.seed2));
  const angle = p.phase + t * (1.0 + p.seed * 1.6);
  const wobble = Math.sin(t * 3 + p.phase * 2) * size * 0.03;
  return {
    x: palm.x + Math.cos(angle) * (ring + wobble),
    y: palm.y + Math.sin(angle) * (ring + wobble) * 0.85,
    radius: size * (0.13 + 0.07 * p.seed3),
    hand,
    tip: false,
  };
}

function stepWater(
  ps: Particle[],
  hands: Hand[],
  dt: number,
  t: number,
  unit: number
) {
  const gravity = 1700 * unit;
  for (let i = 0; i < WATER_COUNT; i++) {
    const p = ps[i];
    const target = hands.length ? waterTarget(p, hands, t) : null;
    if (p.free > 0) p.free = Math.max(0, p.free - dt);

    if (!target || p.free > 0) {
      // Detached: fall, drift, and slowly evaporate.
      p.vy += gravity * dt;
      p.vx *= 1 - 0.4 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.scale = Math.max(0, p.scale - dt * (target ? 0.9 : 0.6));
    } else {
      if (p.scale <= 0.02) {
        // Fully evaporated: re-form in place on the hand.
        p.x = target.x;
        p.y = target.y;
        p.vx = target.hand.vel.x;
        p.vy = target.hand.vel.y;
      }
      // Under-damped spring: the water lags and sloshes behind the hand.
      const k = 70;
      const c = 9;
      p.vx += (k * (target.x - p.x) - c * p.vx) * dt;
      p.vy += (k * (target.y - p.y) - c * p.vy) * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.scale = Math.min(1, p.scale + dt * 2.5);
      p.baseRadius = target.radius;

      if (target.tip && Math.random() < dt * 0.35) {
        // Drip.
        p.free = 1.2 + Math.random();
        p.vx = target.hand.vel.x * 0.3;
        p.vy = target.hand.vel.y * 0.3;
      } else {
        // Fling the hand fast enough and water splashes off.
        const speed = Math.hypot(target.hand.vel.x, target.hand.vel.y);
        const splashSpeed = 1500 * unit;
        if (
          speed > splashSpeed &&
          Math.random() < dt * 4 * (speed / splashSpeed - 1)
        ) {
          p.free = 0.8 + Math.random() * 0.8;
          p.vx = target.hand.vel.x * (0.6 + Math.random() * 0.5);
          p.vy = target.hand.vel.y * (0.6 + Math.random() * 0.5);
        }
      }
    }
    p.radius = p.baseRadius * p.scale;
    p.energy = 1;
  }
}

function spawn(ps: Particle[]): Particle | null {
  for (const p of ps) if (!p.alive) return p;
  return null;
}

function stepFire(
  ps: Particle[],
  hands: Hand[],
  dt: number,
  unit: number,
  spawnDebt: Map<string, number>
) {
  for (const hand of hands) {
    const s = hand.size / 100;
    let debt = (spawnDebt.get(hand.key) ?? 0) + dt * 120;
    while (debt >= 1) {
      debt -= 1;
      const p = spawn(ps);
      if (!p) break;
      const fromTip = Math.random() < 0.75;
      const src = fromTip
        ? hand.points[FINGERTIPS[Math.floor(Math.random() * 5)]]
        : {
            x: hand.palm.x + (Math.random() - 0.5) * hand.size * 0.5,
            y: hand.palm.y + (Math.random() - 0.5) * hand.size * 0.5,
          };
      p.alive = true;
      p.age = 0;
      p.life = 0.45 + Math.random() * 0.5;
      p.x = src.x + (Math.random() - 0.5) * hand.size * 0.08;
      p.y = src.y + (Math.random() - 0.5) * hand.size * 0.08;
      p.vx = hand.vel.x * 0.25 + (Math.random() - 0.5) * 60 * s;
      p.vy = hand.vel.y * 0.25 - (120 + Math.random() * 160) * s;
      p.baseRadius =
        hand.size * (0.12 + Math.random() * 0.08) * (fromTip ? 1 : 1.4);
      p.phase = Math.random() * Math.PI * 2;
    }
    spawnDebt.set(hand.key, debt);
  }

  for (const p of ps) {
    if (!p.alive) continue;
    p.age += dt;
    if (p.age >= p.life) {
      p.alive = false;
      continue;
    }
    const lt = p.age / p.life;
    p.vy -= 700 * unit * dt; // buoyancy: flames rise and accelerate
    p.vx += Math.sin(p.age * 12 + p.phase) * 160 * unit * dt;
    p.vx *= 1 - 2 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.radius = p.baseRadius * Math.min(1, lt * 6) * (1 - 0.55 * lt);
    p.energy = Math.pow(1 - lt, 1.2);
  }
}

function stepArcane(
  ps: Particle[],
  hands: Hand[],
  dt: number,
  spawnDebt: Map<string, number>
) {
  for (const hand of hands) {
    const s = hand.size / 100;
    let debt = (spawnDebt.get(hand.key) ?? 0) + dt * 60;
    while (debt >= 1) {
      debt -= 1;
      const p = spawn(ps);
      if (!p) break;
      const tip = hand.points[FINGERTIPS[Math.floor(Math.random() * 5)]];
      const a = Math.random() * Math.PI * 2;
      p.alive = true;
      p.age = 0;
      p.life = 1.4 + Math.random() * 1.0;
      p.x = tip.x;
      p.y = tip.y;
      p.vx = Math.cos(a) * 90 * s + hand.vel.x * 0.3;
      p.vy = Math.sin(a) * 90 * s + hand.vel.y * 0.3;
      p.baseRadius = hand.size * (0.035 + Math.random() * 0.03);
      p.phase = Math.random() * Math.PI * 2;
      p.handKey = hand.key;
    }
    spawnDebt.set(hand.key, debt);
  }

  for (const p of ps) {
    if (!p.alive) continue;
    p.age += dt;
    if (p.age >= p.life) {
      p.alive = false;
      continue;
    }
    const hand = hands.find((h) => h.key === p.handKey);
    if (hand) {
      // Pull each spark onto a ring around the palm, then push it
      // sideways so it orbits.
      const dx = hand.palm.x - p.x;
      const dy = hand.palm.y - p.y;
      const d = Math.max(Math.hypot(dx, dy), 1);
      const s = hand.size / 100;
      const radial = (d - hand.size * 1.05) / hand.size;
      p.vx += ((dx / d) * radial * 1600 * s + (-dy / d) * 900 * s) * dt;
      p.vy += ((dy / d) * radial * 1600 * s + (dx / d) * 900 * s) * dt;
    }
    p.vx *= 1 - 1.8 * dt;
    p.vy *= 1 - 1.8 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    const lt = p.age / p.life;
    p.radius =
      p.baseRadius * (0.65 + 0.35 * Math.sin(p.age * 18 + p.phase)) *
      Math.min(1, lt * 8);
    p.energy = Math.sin(Math.PI * lt);
  }
}

// ---------------------------------------------------------------------------
// Rendering: one full-screen fragment shader. Every particle is a metaball;
// the shader sums their fields per pixel and shades the result as water,
// fire or arcane energy on top of the live camera image.
// ---------------------------------------------------------------------------

const VERTEX_SHADER = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;

#define MAX_PARTICLES ${MAX_PARTICLES}

uniform sampler2D uVideo;
uniform vec2 uRes;
uniform vec4 uCover;     // camera image placement: offset.xy, size.xy (px)
uniform float uMirror;
uniform float uShowVideo;
uniform float uTime;
uniform float uScale;    // buffer height / 720, for pixel-sized constants
uniform int uMode;       // 0 water, 1 fire, 2 arcane
uniform int uCount;
uniform vec4 uP[MAX_PARTICLES]; // x, y, radius, energy (px, top-left origin)

out vec4 outColor;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = p * 2.03 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return v;
}

vec3 background(vec2 p) {
  vec2 uv = (p - uCover.xy) / uCover.zw;
  if (uMirror > 0.5) uv.x = 1.0 - uv.x;
  vec3 cam = texture(uVideo, clamp(uv, 0.0, 1.0)).rgb;
  float vignette = 1.0 - length(p / uRes - 0.5);
  vec3 dark = vec3(0.012, 0.018, 0.04) + vec3(0.01, 0.02, 0.05) * vignette;
  return mix(dark, cam, uShowVideo);
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);

  // Fire samples the particle field through upward-scrolling turbulence,
  // which stretches round blobs into flickering tongues of flame.
  vec2 fp = p;
  float turb = 0.0;
  if (uMode == 1) {
    vec2 np = p / (45.0 * uScale) + vec2(0.0, uTime * 2.2);
    turb = fbm(np);
    fp += (vec2(turb, fbm(np + 4.3)) - 0.5) * 60.0 * uScale;
  }

  // f: sharp metaball field (r^4/d^4) for surfaces.
  // glow: soft field (r^2/d^2) for halos.
  float f = 0.0;
  float heat = 0.0;
  float glow = 0.0;
  vec2 g = vec2(0.0);
  for (int i = 0; i < MAX_PARTICLES; i++) {
    if (i >= uCount) break;
    vec4 q = uP[i];
    if (q.z <= 0.5) continue;
    vec2 d = fp - q.xy;
    float d2 = dot(d, d) + 1.0;
    float s = q.z * q.z / d2;
    float k = s * s;
    f += k;
    g -= 4.0 * k / d2 * d;
    heat += k * q.w;
    glow += s * q.w;
  }

  vec3 base = background(p);
  if (glow < 0.004) {
    outColor = vec4(base, 1.0);
    return;
  }

  if (uMode == 0) {
    // ---- Water ----
    float inside = smoothstep(0.8, 1.2, f);
    // Surface slope from the field gradient: flat in the middle of the
    // blob, steep at its edges, like a drop of water.
    vec2 slope = g / max(f, 1e-3) * 22.0 * uScale;
    // Deep inside the blob the field spikes at each particle's center;
    // flatten the surface there so it reads as one body of water.
    slope *= 1.0 - smoothstep(1.4, 5.0, f);
    float sl = length(slope);
    if (sl > 1.6) slope *= 1.6 / sl;
    vec3 n = normalize(vec3(-slope, 1.0));

    // Refraction with a little chromatic dispersion.
    vec2 off = slope * 26.0 * uScale;
    vec3 refr = vec3(
      background(p + off * 1.1).r,
      background(p + off).g,
      background(p + off * 0.9).b
    );
    vec3 water = refr * vec3(0.62, 0.85, 1.05) + vec3(0.02, 0.1, 0.2);

    // Caustics: thin bright lines where two drifting noise fields meet.
    vec2 cp = p / (90.0 * uScale) + n.xy * 0.6;
    float cn = abs(
      noise(cp + vec2(uTime * 0.35, uTime * 0.2)) -
      noise(cp * 1.35 - vec2(uTime * 0.25, -uTime * 0.3) + 7.0)
    );
    float caustic = pow(1.0 - clamp(cn * 2.2, 0.0, 1.0), 7.0);
    water += caustic * vec3(0.45, 0.75, 0.95) * 0.5;

    float fres = pow(1.0 - n.z, 2.0);
    water = mix(water, vec3(0.7, 0.88, 1.0), fres * 0.45);

    vec3 key = normalize(normalize(vec3(-0.45, -0.65, 0.6)) + vec3(0.0, 0.0, 1.0));
    vec3 fill = normalize(normalize(vec3(0.5, 0.4, 0.8)) + vec3(0.0, 0.0, 1.0));
    water += pow(max(dot(n, key), 0.0), 90.0) * 1.3;
    water += pow(max(dot(n, fill), 0.0), 40.0) * 0.25 * vec3(0.6, 0.8, 1.0);

    float rim = smoothstep(0.8, 1.0, f) * (1.0 - smoothstep(1.0, 1.6, f));
    water += rim * vec3(0.25, 0.5, 0.7) * 0.5;

    vec3 halo = base + smoothstep(0.08, 0.8, f) * vec3(0.04, 0.16, 0.3) * 0.7;
    outColor = vec4(mix(halo, water, inside), 1.0);
    return;
  }

  if (uMode == 1) {
    // ---- Fire ----
    float amt = smoothstep(0.02, 0.6, glow);
    vec2 hp = p / (18.0 * uScale);
    vec2 haze = vec2(
      noise(hp + vec2(0.0, uTime * 4.0)),
      noise(hp + vec2(5.2, uTime * 4.0 + 3.1))
    ) - 0.5;
    vec3 bg = background(p + haze * 16.0 * uScale * amt);

    float I = glow * (0.45 + 0.9 * turb);
    vec3 fire = vec3(0.85, 0.1, 0.02) * smoothstep(0.35, 0.9, I);
    fire += vec3(0.7, 0.42, 0.05) * smoothstep(0.8, 1.8, I);
    fire += vec3(0.45, 0.45, 0.4) * smoothstep(1.8, 3.6, I);
    vec3 halo = vec3(1.0, 0.3, 0.04) * (1.0 - exp(-glow * 0.25)) * 0.35;

    outColor = vec4(bg * (1.0 - 0.25 * smoothstep(0.2, 1.0, I)) + fire + halo, 1.0);
    return;
  }

  // ---- Arcane ----
  float sw = 0.5 + 0.5 * sin(uTime * 1.3 + (p.x + p.y) / (160.0 * uScale));
  vec3 col = mix(vec3(0.55, 0.2, 1.0), vec3(0.1, 0.85, 1.0), sw);
  float swirl = fbm(p / (60.0 * uScale) + vec2(uTime * 0.5, -uTime * 0.4));
  float mist = (1.0 - exp(-glow * 0.5)) * (0.6 + 0.8 * swirl);
  float core = smoothstep(0.6, 2.2, heat);

  vec2 cell = floor(p / (9.0 * uScale));
  float h = hash(cell);
  vec2 star = (cell + 0.5 + (vec2(hash(cell + 3.1), hash(cell + 7.7)) - 0.5) * 0.6) * 9.0 * uScale;
  float pt = 1.0 - smoothstep(0.0, 1.6 * uScale, length(p - star));
  float twinkle = step(0.94, h) * pt * (0.5 + 0.5 * sin(uTime * 9.0 + h * 60.0));
  float spark = twinkle * smoothstep(0.15, 0.6, glow);

  vec3 c = base * (1.0 - 0.25 * mist) + col * mist * 0.9;
  c += mix(col, vec3(1.0), 0.7) * core + vec3(0.9, 0.95, 1.0) * spark;
  outColor = vec4(c, 1.0);
}
`;

interface GlState {
  gl: WebGL2RenderingContext;
  texture: WebGLTexture;
  uniforms: Record<string, WebGLUniformLocation | null>;
}

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) ?? "Shader compile failed");
  }
  return shader;
}

function initGl(canvas: HTMLCanvasElement): GlState {
  const gl = canvas.getContext("webgl2", { antialias: false, alpha: false });
  if (!gl) throw new Error("WebGL2 is not supported in this browser.");

  const program = gl.createProgram()!;
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) ?? "Program link failed");
  }
  gl.useProgram(program);

  // One oversized triangle covers the whole screen.
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 3, -1, -1, 3]),
    gl.STATIC_DRAW
  );
  const aPos = gl.getAttribLocation(program, "aPos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const texture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    1,
    1,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    new Uint8Array([0, 0, 0, 255])
  );

  const names = [
    "uVideo",
    "uRes",
    "uCover",
    "uMirror",
    "uShowVideo",
    "uTime",
    "uScale",
    "uMode",
    "uCount",
    "uP",
  ];
  const uniforms = Object.fromEntries(
    names.map((n) => [n, gl.getUniformLocation(program, n)])
  );
  gl.uniform1i(uniforms.uVideo, 0);
  return { gl, texture, uniforms };
}

// ---------------------------------------------------------------------------

const MagicHands = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const glRef = useRef<GlState | null>(null);
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [effect, setEffect] = useState<EffectId>("water");
  const [mirror, setMirror] = useState(true);
  const [showVideo, setShowVideo] = useState(true);
  const [handCount, setHandCount] = useState(0);
  const [panelOpen, setPanelOpen] = useState(true);

  const statusRef = useRef(status);
  const effectRef = useRef(effect);
  const mirrorRef = useRef(mirror);
  const showVideoRef = useRef(showVideo);
  useEffect(() => {
    statusRef.current = status;
    effectRef.current = effect;
    mirrorRef.current = mirror;
    showVideoRef.current = showVideo;
  }, [status, effect, mirror, showVideo]);

  const particlesRef = useRef<Particle[]>(createParticles());
  const spawnDebtRef = useRef(new Map<string, number>());
  const trackedRef = useRef(new Map<string, TrackedHand>());
  const handsRef = useRef<Hand[]>([]);
  const handCountRef = useRef(0);
  const lastVideoTimeRef = useRef(-1);
  const pointerRef = useRef<{ x: number; y: number; time: number } | null>(
    null
  );
  const demoRef = useRef<{ palm: Vec2 } | null>(null);

  // Reset the particles whenever the effect changes.
  useEffect(() => {
    particlesRef.current = createParticles();
    spawnDebtRef.current.clear();
  }, [effect]);

  const coverRect = useCallback((width: number, height: number) => {
    const video = videoRef.current;
    const vw = video?.videoWidth || 640;
    const vh = video?.videoHeight || 480;
    const s = Math.max(width / vw, height / vh);
    const w = vw * s;
    const h = vh * s;
    return { x: (width - w) / 2, y: (height - h) / 2, w, h };
  }, []);

  const detectHands = useCallback(
    (width: number, height: number) => {
      const video = videoRef.current;
      const landmarker = landmarkerRef.current;
      if (!video || !landmarker || video.readyState < 2) return;
      if (video.currentTime === lastVideoTimeRef.current) return;
      lastVideoTimeRef.current = video.currentTime;

      const now = performance.now();
      const result: HandLandmarkerResult = landmarker.detectForVideo(video, now);
      const t = now / 1000;
      const cover = coverRect(width, height);
      const mirrorOn = mirrorRef.current;
      const tracked = trackedRef.current;
      const seen = new Set<string>();
      const hands: Hand[] = [];

      result.landmarks.forEach((landmarks, i) => {
        let key = result.handedness[i]?.[0]?.categoryName ?? `hand${i}`;
        if (seen.has(key)) key = `${key}${i}`;
        seen.add(key);

        let track = tracked.get(key);
        if (!track) {
          track = {
            filters: landmarks.map(() => ({
              x: new OneEuroFilter(0.8, 1.5, 1),
              y: new OneEuroFilter(0.8, 1.5, 1),
            })),
            lastPalm: null,
            lastTime: t,
            vel: { x: 0, y: 0 },
          };
          tracked.set(key, track);
        }
        const filters = track.filters;
        const points = landmarks.map((lm, j) => {
          const fx = filters[j].x.filter(lm.x, t);
          const fy = filters[j].y.filter(lm.y, t);
          return {
            x: cover.x + (mirrorOn ? 1 - fx : fx) * cover.w,
            y: cover.y + fy * cover.h,
          };
        });
        const hand = buildHand(key, points, track.vel);
        if (track.lastPalm) {
          const dt = Math.max(t - track.lastTime, 1 / 120);
          // Lightly smoothed palm velocity, used for splashes and flings.
          track.vel = {
            x: track.vel.x * 0.5 + ((hand.palm.x - track.lastPalm.x) / dt) * 0.5,
            y: track.vel.y * 0.5 + ((hand.palm.y - track.lastPalm.y) / dt) * 0.5,
          };
          hand.vel = track.vel;
        }
        track.lastPalm = hand.palm;
        track.lastTime = t;
        hands.push(hand);
      });

      // Forget hands that left the frame so they don't smooth in from
      // their old position when they come back.
      for (const key of tracked.keys()) if (!seen.has(key)) tracked.delete(key);

      hands.sort((a, b) => a.palm.x - b.palm.x);
      handsRef.current = hands;
      if (hands.length !== handCountRef.current) {
        handCountRef.current = hands.length;
        setHandCount(hands.length);
      }
    },
    [coverRect]
  );

  const demoHand = useCallback(
    (width: number, height: number, t: number, dt: number): Hand[] => {
      const pointer = pointerRef.current;
      const usePointer = pointer && performance.now() - pointer.time < 2500;
      const palm = usePointer
        ? { x: pointer.x, y: pointer.y }
        : {
            x: width / 2 + Math.sin(t * 0.6) * width * 0.18,
            y: height / 2 + Math.sin(t * 1.1) * height * 0.1,
          };
      const prev = demoRef.current;
      const vel = prev
        ? {
            x: (palm.x - prev.palm.x) / Math.max(dt, 1e-3),
            y: (palm.y - prev.palm.y) / Math.max(dt, 1e-3),
          }
        : { x: 0, y: 0 };
      demoRef.current = { palm };
      const size = Math.min(width, height) * 0.13;
      return [buildHand("demo", demoPoints(palm, size), vel)];
    },
    []
  );

  // Render loop: runs for as long as the page is open. Hand tracking only
  // feeds into it once the camera is running.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      glRef.current = initGl(canvas);
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : "Couldn't start WebGL.");
      return;
    }
    const { gl, texture, uniforms } = glRef.current;
    const particleData = new Float32Array(MAX_PARTICLES * 4);
    let raf = 0;
    let last = performance.now();
    const start = last;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = clamp((now - last) / 1000, 0, 1 / 20);
      last = now;
      const t = (now - start) / 1000;

      // Keep the drawing buffer matched to the element size.
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      let bw = Math.round(canvas.clientWidth * ratio);
      let bh = Math.round(canvas.clientHeight * ratio);
      const shrink = Math.min(1, MAX_BUFFER_SIDE / Math.max(bw, bh, 1));
      bw = Math.max(1, Math.round(bw * shrink));
      bh = Math.max(1, Math.round(bh * shrink));
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
      }
      const unit = bh / 720;

      const running = statusRef.current === "running";
      let hands: Hand[];
      if (running) {
        detectHands(bw, bh);
        hands = handsRef.current;
      } else {
        hands = demoHand(bw, bh, t, dt);
      }

      const ps = particlesRef.current;
      const mode = effectRef.current;
      if (mode === "water") stepWater(ps, hands, dt, t, unit);
      else if (mode === "fire")
        stepFire(ps, hands, dt, unit, spawnDebtRef.current);
      else stepArcane(ps, hands, dt, spawnDebtRef.current);

      let count = 0;
      for (const p of ps) {
        if (p.radius <= 0.5 || (!p.alive && mode !== "water")) continue;
        particleData[count * 4] = p.x;
        particleData[count * 4 + 1] = p.y;
        particleData[count * 4 + 2] = p.radius;
        particleData[count * 4 + 3] = p.energy;
        count++;
      }

      const video = videoRef.current;
      const hasVideo = running && !!video && video.readyState >= 2;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      if (hasVideo) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
      }
      const cover = coverRect(bw, bh);

      gl.viewport(0, 0, bw, bh);
      gl.uniform2f(uniforms.uRes, bw, bh);
      gl.uniform4f(uniforms.uCover, cover.x, cover.y, cover.w, cover.h);
      gl.uniform1f(uniforms.uMirror, mirrorRef.current ? 1 : 0);
      gl.uniform1f(
        uniforms.uShowVideo,
        hasVideo && showVideoRef.current ? 1 : 0
      );
      gl.uniform1f(uniforms.uTime, t);
      gl.uniform1f(uniforms.uScale, unit);
      gl.uniform1i(uniforms.uMode, EFFECT_MODE[mode]);
      gl.uniform1i(uniforms.uCount, count);
      gl.uniform4fv(uniforms.uP, particleData);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [coverRect, demoHand, detectHands]);

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
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    handsRef.current = [];
    trackedRef.current.clear();
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
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play();
      lastVideoTimeRef.current = -1;
      setStatus("running");
    } catch (e) {
      setStatus("error");
      setError(
        e instanceof Error && e.name === "NotAllowedError"
          ? "Camera access was denied. Allow camera permissions and try again."
          : "Couldn't load the hand-tracking model or start the camera. Check your connection and try again."
      );
    }
  }, [ensureLandmarker]);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      landmarkerRef.current?.close();
    };
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    pointerRef.current = {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
      time: performance.now(),
    };
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen();
    else containerRef.current?.requestFullscreen?.();
  }, []);

  const isRunning = status === "running";
  const isBusy = status === "loading-model" || status === "starting-camera";
  const current = EFFECTS.find((e) => e.id === effect)!;

  return (
    <div
      ref={containerRef}
      className="relative h-screen w-full overflow-hidden bg-black"
      onPointerMove={handlePointerMove}
    >
      <video ref={videoRef} className="hidden" muted playsInline />
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" />

      <div className="absolute top-4 left-4 z-10 w-72 rounded-xl bg-black/60 text-sm text-white backdrop-blur">
        <button
          onClick={() => setPanelOpen((o) => !o)}
          className="flex w-full items-center justify-between px-4 py-3 text-left"
        >
          <span className="text-lg font-semibold">Magic Hands</span>
          <span className="text-white/60">{panelOpen ? "–" : "+"}</span>
        </button>

        {panelOpen && (
          <div className="space-y-3 px-4 pb-4">
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-white/10 p-1">
              {EFFECTS.map((e) => (
                <button
                  key={e.id}
                  onClick={() => setEffect(e.id)}
                  className={`rounded-md px-2 py-1.5 font-medium transition-colors ${
                    effect === e.id
                      ? "bg-white text-black"
                      : "text-white/80 hover:bg-white/10"
                  }`}
                >
                  {e.label}
                </button>
              ))}
            </div>
            <p className="text-white/70">{current.blurb}</p>

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
            {isRunning ? (
              <p className="text-white/60">
                Hands detected: <span className="text-white">{handCount}</span>
              </p>
            ) : (
              <p className="text-xs text-white/50">
                Until the camera starts, move your mouse over the page to
                play with the effect.
              </p>
            )}

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
                checked={showVideo}
                onChange={(e) => setShowVideo(e.target.checked)}
              />
              Show camera feed
            </label>
            <button
              onClick={toggleFullscreen}
              className="w-full rounded-md bg-white/10 px-3 py-2 font-medium hover:bg-white/20"
            >
              Toggle Fullscreen
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default MagicHands;
