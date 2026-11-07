import { useCallback, useEffect, useRef, useState } from "react";
import {
  FilesetResolver,
  HandLandmarker,
  type HandLandmarkerResult,
} from "@mediapipe/tasks-vision";

// Card is laid out in its own 600x800 coordinate space and scaled to fit.
const CW = 600;
const CH = 800;
// The foil layer is rendered at 2x for crisper scratch edges.
const FOIL_SCALE = 2;
// A coin edge, not a paintbrush: narrow, and each dab only takes off a thin
// layer of foil, so a spot needs several passes before it is really clear.
const BRUSH_RADIUS = 10;
const DAB_ALPHA = 0.07;
// Fraction of a cell's foil that must be gone before it counts as revealed.
const REVEAL_THRESHOLD = 0.82;
const COVERAGE_CHECK_MS = 140;

// Pinching thumb and index together = holding a pen. Ratios are against the
// hand's own size (wrist to middle knuckle), with hysteresis so the pen
// doesn't flicker on and off around the threshold.
const PINCH_ON = 0.45;
const PINCH_OFF = 0.7;
// Only the central part of the camera frame maps to the screen, so you don't
// have to reach to the very edge of the camera view to hit the card's corners.
const CAM_MARGIN = 0.1;

const GATHER_MS = 1500;
const TYPE_CPS = 38;
const AUTO_NEXT_MS = 14000;

type Group = "luck" | "treasure" | "sweet" | "night";

interface Sign {
  name: string;
  glyph: string;
  group: Group;
}

const SIGNS: Sign[] = [
  { name: "Clover", glyph: "\u{1F340}", group: "luck" },
  { name: "Ladybug", glyph: "\u{1F41E}", group: "luck" },
  { name: "Star", glyph: "\u2B50", group: "luck" },
  { name: "Diamond", glyph: "\u{1F48E}", group: "treasure" },
  { name: "Crown", glyph: "\u{1F451}", group: "treasure" },
  { name: "Key", glyph: "\u{1F511}", group: "treasure" },
  { name: "Cherry", glyph: "\u{1F352}", group: "sweet" },
  { name: "Lemon", glyph: "\u{1F34B}", group: "sweet" },
  { name: "Balloon", glyph: "\u{1F388}", group: "sweet" },
  { name: "Moon", glyph: "\u{1F319}", group: "night" },
  { name: "Crystal", glyph: "\u{1F52E}", group: "night" },
  { name: "Owl", glyph: "\u{1F989}", group: "night" },
];

const GROUP_ORDER: Group[] = ["luck", "treasure", "sweet", "night"];

const GROUP_LABEL: Record<Group, string> = {
  luck: "Lucky",
  treasure: "Treasure",
  sweet: "Sweet",
  night: "Night",
};

const GROUP_COLOR: Record<Group, string> = {
  luck: "#9be58f",
  treasure: "#ffd45c",
  sweet: "#ff9ec4",
  night: "#8f9bff",
};

const FORTUNES: Record<Group, string[]> = {
  luck: [
    "Luck is already on your side. Say yes to the thing that scares you a little this week.",
    "A small coincidence turns into a big opportunity. Pay attention to the second \"what a coincidence\".",
    "Someone is waiting for you to go first. Your courage gives them permission.",
  ],
  treasure: [
    "Something you thought was ordinary turns out to be valuable. Keep it close.",
    "A door you forgot about opens. You already have the key.",
    "You will find exactly what you need right where you are standing.",
  ],
  sweet: [
    "A sweet surprise is on its way, probably from someone who thinks of you often.",
    "Treat yourself without explaining why. This week it counts double.",
    "A small joy turns your whole day around. Notice it when it shows up.",
  ],
  night: [
    "Trust the feeling you keep brushing aside. It knows something your head does not yet.",
    "An idea you have late at night deserves to be written down today.",
    "News arrives sideways, from someone you did not expect. Answer it.",
  ],
};

interface Cell {
  x: number;
  y: number;
  w: number;
  h: number;
  sign: Sign;
  revealed: boolean;
  revealAt: number;
}

interface CardState {
  cells: Cell[];
  fortune: string;
  bonus: string;
  group: Group;
}

const SPOT_R = 76;
const spot = (c: { x: number; y: number; w: number; h: number }) => ({
  cx: c.x + c.w / 2,
  cy: c.y + c.h / 2 - 14,
});

const COLS = 3;
const CELL_W = 172;
const CELL_H = 200;
const GAP_X = 17;
const GAP_Y = 22;
const GRID_X = (CW - (COLS * CELL_W + (COLS - 1) * GAP_X)) / 2;
const GRID_Y = 250;

const pick = <T,>(items: T[]): T => items[Math.floor(Math.random() * items.length)];

function newCard(): CardState {
  const cells: Cell[] = [];
  for (let i = 0; i < 6; i++) {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    cells.push({
      x: GRID_X + col * (CELL_W + GAP_X),
      y: GRID_Y + row * (CELL_H + GAP_Y),
      w: CELL_W,
      h: CELL_H,
      sign: pick(SIGNS),
      revealed: false,
      revealAt: 0,
    });
  }

  // The combination decides the fortune: the most common group wins
  // (ties follow the order luck, treasure, sweet, night).
  const counts: Record<Group, number> = { luck: 0, treasure: 0, sweet: 0, night: 0 };
  cells.forEach((c) => counts[c.sign.group]++);
  const group = GROUP_ORDER.reduce((best, e) => (counts[e] > counts[best] ? e : best));

  const bySign = new Map<string, number>();
  cells.forEach((c) => bySign.set(c.sign.name, (bySign.get(c.sign.name) ?? 0) + 1));
  const repeated = [...bySign.entries()].sort((a, b) => b[1] - a[1])[0];
  let bonus: string;
  if (repeated[1] >= 3) {
    bonus = `Triple ${repeated[0]}! A rare spread. Expect that one to show up again, loudly.`;
  } else if (repeated[1] === 2) {
    bonus = `${repeated[0]} showed up twice: lucky doubles, say yes twice.`;
  } else {
    bonus = "Six different symbols: a week full of surprises.";
  }

  return { cells, fortune: pick(FORTUNES[group]), bonus, group };
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - Math.min(Math.max(t, 0), 1), 3);
const easeInOut = (t: number) => {
  const c = Math.min(Math.max(t, 0), 1);
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
};

function buildFoil(cells: Cell[]): HTMLCanvasElement {
  const foil = document.createElement("canvas");
  foil.width = CW * FOIL_SCALE;
  foil.height = CH * FOIL_SCALE;
  const ctx = foil.getContext("2d", { willReadFrequently: true })!;
  ctx.scale(FOIL_SCALE, FOIL_SCALE);
  for (const c of cells) {
    const { cx, cy } = spot(c);
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, SPOT_R, 0, Math.PI * 2);
    ctx.clip();
    const g = ctx.createLinearGradient(cx - SPOT_R, cy - SPOT_R, cx + SPOT_R, cy + SPOT_R);
    g.addColorStop(0, "#b9bcc4");
    g.addColorStop(0.5, "#9a9ea8");
    g.addColorStop(1, "#b0b3bb");
    ctx.fillStyle = g;
    ctx.fillRect(cx - SPOT_R, cy - SPOT_R, SPOT_R * 2, SPOT_R * 2);
    // Speckle grain, like the real latex foil.
    for (let i = 0; i < 420; i++) {
      ctx.fillStyle = Math.random() < 0.5 ? "rgba(255,255,255,0.35)" : "rgba(60,70,90,0.22)";
      ctx.fillRect(cx - SPOT_R + Math.random() * SPOT_R * 2, cy - SPOT_R + Math.random() * SPOT_R * 2, 1.6, 1.6);
    }
    ctx.restore();
  }
  return foil;
}

type Status = "idle" | "loading-model" | "starting-camera" | "running" | "error";

const ScratchCard = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  const cardRef = useRef<CardState>(newCard());
  const foilRef = useRef<HTMLCanvasElement>(buildFoil(cardRef.current.cells));
  const phaseRef = useRef<{ name: "scratch" | "gather" | "fortune"; since: number }>({
    name: "scratch",
    since: 0,
  });
  const allDoneAtRef = useRef<number | null>(null);
  const lastCheckRef = useRef(0);
  const lastVideoTimeRef = useRef(-1);
  const cardCountRef = useRef(1);
  const flakesRef = useRef<
    { x: number; y: number; vx: number; vy: number; life: number; size: number; rot: number }[]
  >([]);
  const lastFrameRef = useRef(0);

  // Pen state: hand (pinch) takes priority over the mouse.
  const handPenRef = useRef<{ x: number; y: number; down: boolean; seen: boolean }>({
    x: 0,
    y: 0,
    down: false,
    seen: false,
  });
  const mousePenRef = useRef<{ x: number; y: number; down: boolean }>({
    x: 0,
    y: 0,
    down: false,
  });
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const smoothRef = useRef<{ x: number; y: number } | null>(null);

  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [handSeen, setHandSeen] = useState(false);
  const [showNext, setShowNext] = useState(false);
  const [cardNo, setCardNo] = useState(1);
  const [panelOpen, setPanelOpen] = useState(true);

  const nextCard = useCallback(() => {
    cardRef.current = newCard();
    foilRef.current = buildFoil(cardRef.current.cells);
    phaseRef.current = { name: "scratch", since: performance.now() };
    allDoneAtRef.current = null;
    lastPointRef.current = null;
    flakesRef.current = [];
    cardCountRef.current += 1;
    setCardNo(cardCountRef.current);
    setShowNext(false);
  }, []);

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
        numHands: 1,
      });
    } catch {
      landmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: { ...baseOptions, delegate: "CPU" },
        runningMode: "VIDEO",
        numHands: 1,
      });
    }
    landmarkerRef.current = landmarker;
    return landmarker;
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    handPenRef.current = { x: 0, y: 0, down: false, seen: false };
    setHandSeen(false);
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

  // Main loop: hand tracking, scratching, reveal checks, drawing.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const stars = Array.from({ length: 90 }, () => ({
      x: Math.random(),
      y: Math.random(),
      r: 0.5 + Math.random() * 1.6,
      p: Math.random() * Math.PI * 2,
    }));

    const resize = () => {
      const box = containerRef.current!;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = box.clientWidth * dpr;
      canvas.height = box.clientHeight * dpr;
      canvas.style.width = `${box.clientWidth}px`;
      canvas.style.height = `${box.clientHeight}px`;
    };
    resize();
    window.addEventListener("resize", resize);

    const layout = () => {
      const s = Math.min(canvas.width / CW, canvas.height / CH) * 0.96;
      return { s, ox: (canvas.width - CW * s) / 2, oy: (canvas.height - CH * s) / 2 };
    };

    const updateHand = (now: number) => {
      const video = videoRef.current;
      const landmarker = landmarkerRef.current;
      if (!video || !landmarker || !streamRef.current) return;
      if (video.readyState < 2 || video.currentTime === lastVideoTimeRef.current) return;
      lastVideoTimeRef.current = video.currentTime;
      const result: HandLandmarkerResult = landmarker.detectForVideo(video, now);
      const lm = result.landmarks[0];
      const pen = handPenRef.current;
      if (!lm) {
        if (pen.seen) setHandSeen(false);
        pen.seen = false;
        pen.down = false;
        smoothRef.current = null;
        return;
      }
      if (!pen.seen) setHandSeen(true);
      pen.seen = true;

      const vw = video.videoWidth || 640;
      const vh = video.videoHeight || 480;
      const d = (a: number, b: number) =>
        Math.hypot((lm[a].x - lm[b].x) * vw, (lm[a].y - lm[b].y) * vh);
      const handSize = d(0, 9) || 1;
      const ratio = d(4, 8) / handSize;
      if (!pen.down && ratio < PINCH_ON) pen.down = true;
      else if (pen.down && ratio > PINCH_OFF) pen.down = false;

      // Pen tip is the midpoint of thumb and index tips; mirrored so moving
      // your hand right moves the pen right on screen.
      const mx = 1 - (lm[4].x + lm[8].x) / 2;
      const my = (lm[4].y + lm[8].y) / 2;
      const nx = Math.min(Math.max((mx - CAM_MARGIN) / (1 - 2 * CAM_MARGIN), 0), 1);
      const ny = Math.min(Math.max((my - CAM_MARGIN) / (1 - 2 * CAM_MARGIN), 0), 1);
      const tx = nx * canvas.width;
      const ty = ny * canvas.height;
      const prev = smoothRef.current;
      // Light smoothing; stronger when the pen is nearly still to kill jitter.
      const sx = prev ? prev.x + (tx - prev.x) * 0.55 : tx;
      const sy = prev ? prev.y + (ty - prev.y) * 0.55 : ty;
      smoothRef.current = { x: sx, y: sy };
      pen.x = sx;
      pen.y = sy;
    };

    const isOnFoil = (x: number, y: number) =>
      cardRef.current.cells.some((c) => {
        const sp = spot(c);
        return Math.hypot(x - sp.cx, y - sp.cy) < SPOT_R;
      });

    const scratch = (px: number, py: number, down: boolean) => {
      if (phaseRef.current.name !== "scratch") {
        lastPointRef.current = null;
        return;
      }
      const { s, ox, oy } = layout();
      const x = (px - ox) / s;
      const y = (py - oy) / s;
      if (!down) {
        lastPointRef.current = null;
        return;
      }
      const f = foilRef.current.getContext("2d")!;
      const last = lastPointRef.current;
      // No contact stroke without movement: pressing and holding doesn't
      // scratch, you have to drag the coin across the foil.
      if (last) {
        const dist = Math.hypot(x - last.x, y - last.y);
        const step = BRUSH_RADIUS * 0.5;
        const n = Math.max(1, Math.ceil(dist / step));
        f.save();
        f.globalCompositeOperation = "destination-out";
        for (let i = 1; i <= n; i++) {
          const px2 = last.x + ((x - last.x) * i) / n + (Math.random() - 0.5) * 3;
          const py2 = last.y + ((y - last.y) * i) / n + (Math.random() - 0.5) * 3;
          f.globalAlpha = DAB_ALPHA * (0.6 + Math.random() * 0.8);
          f.fillStyle = "#000";
          f.beginPath();
          f.arc(px2, py2, BRUSH_RADIUS * (0.75 + Math.random() * 0.35), 0, Math.PI * 2);
          f.fill();
          if (Math.random() < 0.35 && flakesRef.current.length < 220 && isOnFoil(px2, py2)) {
            const ang = Math.random() * Math.PI * 2;
            flakesRef.current.push({
              x: px2,
              y: py2,
              vx: Math.cos(ang) * (20 + Math.random() * 60),
              vy: -40 - Math.random() * 70,
              life: 0,
              size: 1.5 + Math.random() * 2.5,
              rot: Math.random() * Math.PI,
            });
          }
        }
        f.restore();
      }
      lastPointRef.current = { x, y };
    };

    const checkCoverage = (now: number) => {
      if (phaseRef.current.name !== "scratch" || now - lastCheckRef.current < COVERAGE_CHECK_MS) return;
      lastCheckRef.current = now;
      const f = foilRef.current.getContext("2d", { willReadFrequently: true })!;
      const card = cardRef.current;
      for (const c of card.cells) {
        if (c.revealed) continue;
        const { cx, cy } = spot(c);
        const side = Math.ceil(SPOT_R * 2 * FOIL_SCALE);
        const sx = Math.floor((cx - SPOT_R) * FOIL_SCALE);
        const sy = Math.floor((cy - SPOT_R) * FOIL_SCALE);
        const data = f.getImageData(sx, sy, side, side).data;
        const rr = SPOT_R * FOIL_SCALE;
        let total = 0;
        let cleared = 0;
        for (let yy = 4; yy < side - 4; yy += 6) {
          for (let xx = 4; xx < side - 4; xx += 6) {
            if (Math.hypot(xx - rr, yy - rr) > rr - 6) continue;
            total++;
            if (data[(yy * side + xx) * 4 + 3] < 128) cleared++;
          }
        }
        if (total && cleared / total > REVEAL_THRESHOLD) {
          c.revealed = true;
          c.revealAt = now;
        }
      }
      if (card.cells.every((c) => c.revealed) && allDoneAtRef.current === null) {
        allDoneAtRef.current = now;
      }
    };

    const drawCardFace = (now: number, alpha: number, hideGlyphs: boolean) => {
      const card = cardRef.current;
      ctx.save();
      ctx.globalAlpha = alpha;
      // Retro carnival card: red frame, yellow sunburst, marquee title.
      ctx.fillStyle = "#d62f3a";
      roundRect(ctx, 0, 0, CW, CH, 28);
      ctx.fill();
      ctx.save();
      roundRect(ctx, 14, 14, CW - 28, CH - 28, 20);
      ctx.clip();
      ctx.fillStyle = "#ffc933";
      ctx.fillRect(0, 0, CW, CH);
      ctx.translate(CW / 2, 430);
      for (let i = 0; i < 18; i++) {
        ctx.rotate((Math.PI * 2) / 18);
        ctx.fillStyle = "rgba(255,150,40,0.45)";
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-60, -900);
        ctx.lineTo(60, -900);
        ctx.fill();
      }
      ctx.restore();
      // Light bulbs around the frame.
      for (let i = 0; i < 22; i++) {
        const lit = Math.floor(now / 350) % 2 === i % 2;
        ctx.fillStyle = lit ? "#fffbe0" : "#f6a8a8";
        const bx = 30 + (i * (CW - 60)) / 21;
        for (const by of [24, CH - 24]) {
          ctx.beginPath();
          ctx.arc(bx, by, 4, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Marquee title.
      ctx.fillStyle = "#1c3fa8";
      roundRect(ctx, 50, 38, CW - 100, 190, 22);
      ctx.fill();
      ctx.lineWidth = 6;
      ctx.strokeStyle = "#f2f2f2";
      ctx.stroke();
      ctx.textAlign = "center";
      ctx.lineJoin = "round";
      ctx.font = "900 44px 'Arial Black', Impact, sans-serif";
      ctx.fillStyle = "#ffe14a";
      ctx.fillText("\u2605 SCRATCH \u2605", CW / 2, 92);
      ctx.font = "900 108px 'Arial Black', Impact, sans-serif";
      ctx.strokeStyle = "#0a1f66";
      ctx.lineWidth = 12;
      ctx.strokeText("LUCKY", CW / 2, 196);
      const title = ctx.createLinearGradient(0, 110, 0, 200);
      title.addColorStop(0, "#ffffff");
      title.addColorStop(1, "#8ad1ff");
      ctx.fillStyle = title;
      ctx.fillText("LUCKY", CW / 2, 196);

      // Cells: white panels with a round grey scratch spot and a sign label.
      for (const c of card.cells) {
        ctx.fillStyle = "#fff8e8";
        roundRect(ctx, c.x, c.y, c.w, c.h, 18);
        ctx.fill();
        ctx.lineWidth = 5;
        ctx.strokeStyle = "#1c3fa8";
        ctx.stroke();
        if (hideGlyphs) continue;
        const { cx, cy } = spot(c);
        const pop = c.revealed ? easeOutCubic((now - c.revealAt) / 350) : 1;
        const sc = c.revealed ? 0.7 + 0.3 * pop : 1;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(sc, sc);
        ctx.fillStyle = "#1c3fa8";
        ctx.font = "92px 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(c.sign.glyph, 0, 0);
        ctx.restore();
        ctx.fillStyle = "#d62f3a";
        ctx.font = "900 19px 'Arial Black', Impact, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        ctx.fillText(c.sign.name.toUpperCase(), c.x + c.w / 2, c.y + c.h - 16);
      }
      ctx.fillStyle = "#1c3fa8";
      ctx.font = "900 20px 'Arial Black', Impact, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("PINCH LIKE HOLDING A COIN \u2014 SCRATCH ALL SIX", CW / 2, 742);
      ctx.restore();
    };

    const draw = (now: number) => {
      const W = canvas.width;
      const H = canvas.height;
      ctx.setTransform(1, 0, 0, 1, 0, 0);

      // Night sky background.
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, "#090624");
      bg.addColorStop(1, "#1a0f45");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);
      for (const st of stars) {
        ctx.globalAlpha = 0.4 + 0.6 * Math.abs(Math.sin(now / 900 + st.p));
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(st.x * W, st.y * H, st.r * (W / 1200 + 0.5), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      const { s, ox, oy } = layout();
      const card = cardRef.current;
      const phase = phaseRef.current;

      // Phase transitions.
      if (phase.name === "scratch" && allDoneAtRef.current !== null && now - allDoneAtRef.current > 600) {
        phaseRef.current = { name: "gather", since: now };
      } else if (phase.name === "gather" && now - phase.since > GATHER_MS) {
        phaseRef.current = { name: "fortune", since: now };
      }
      const cur = phaseRef.current;

      ctx.save();
      ctx.translate(ox, oy);
      ctx.scale(s, s);

      if (cur.name === "scratch") {
        drawCardFace(now, 1, false);
        ctx.drawImage(foilRef.current, 0, 0, CW, CH);
        const dt = Math.min((now - (lastFrameRef.current || now)) / 1000, 0.05);
        flakesRef.current = flakesRef.current.filter((fl) => fl.life < 0.9);
        for (const fl of flakesRef.current) {
          fl.life += dt;
          fl.vy += 520 * dt;
          fl.x += fl.vx * dt;
          fl.y += fl.vy * dt;
          fl.rot += dt * 8;
          ctx.save();
          ctx.globalAlpha = Math.max(0, 1 - fl.life / 0.9);
          ctx.translate(fl.x, fl.y);
          ctx.rotate(fl.rot);
          ctx.fillStyle = "#a4a8b2";
          ctx.fillRect(-fl.size, -fl.size * 0.5, fl.size * 2, fl.size);
          ctx.restore();
        }
      } else {
        const t = cur.name === "gather" ? easeInOut((now - cur.since) / GATHER_MS) : 1;
        drawCardFace(now, 1 - t, true);

        // The six symbols fly to the front, bigger, in a row.
        for (let i = 0; i < card.cells.length; i++) {
          const c = card.cells[i];
          const col = i % 3;
          const row = Math.floor(i / 3);
          const fromX = c.x + c.w / 2;
          const fromY = spot(c).cy;
          const toX = CW / 2 + (col - 1) * 190;
          const toY = 235 + row * 170;
          const x = fromX + (toX - fromX) * t;
          const y = fromY + (toY - fromY) * t;
          const size = 92 + 36 * t;
          const bob = cur.name === "fortune" ? Math.sin(now / 500 + i) * 4 : 0;
          ctx.save();
          ctx.shadowColor = GROUP_COLOR[c.sign.group];
          ctx.shadowBlur = 30 * t;
          ctx.fillStyle = t > 0.05 ? "#fff6d8" : "#2b1a6b";
          ctx.font = `${size}px 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(c.sign.glyph, x, y + bob);
          ctx.restore();
          if (t > 0.6) {
            ctx.fillStyle = `rgba(255,255,255,${(t - 0.6) / 0.4 * 0.8})`;
            ctx.font = "bold 18px 'Helvetica Neue', Arial, sans-serif";
            ctx.textAlign = "center";
            ctx.fillText(c.sign.name.toUpperCase(), x, y + size * 0.66);
          }
        }

        if (cur.name === "fortune") {
          const ft = now - cur.since;
          const fade = easeOutCubic(ft / 700);
          ctx.globalAlpha = fade;
          ctx.textAlign = "center";
          ctx.fillStyle = GROUP_COLOR[card.group];
          ctx.font = "bold 22px 'Helvetica Neue', Arial, sans-serif";
          ctx.fillText(`${GROUP_LABEL[card.group].toUpperCase()} ENERGY`, CW / 2, 555);
          ctx.fillStyle = "#fff6d8";
          ctx.font = "italic bold 44px Georgia, serif";
          ctx.fillText("your fortune", CW / 2, 605);

          const typed = Math.floor((ft / 1000) * TYPE_CPS);
          const full = `${card.fortune}`;
          const shown = full.slice(0, typed);
          ctx.font = "26px Georgia, serif";
          ctx.fillStyle = "#fff";
          const lines = wrapText(ctx, full, CW - 90);
          let used = 0;
          lines.forEach((line, i) => {
            const take = Math.max(0, Math.min(line.length, shown.length - used));
            used += line.length + 1;
            ctx.fillText(line.slice(0, take), CW / 2, 650 + i * 34);
          });
          if (typed > full.length + 6) {
            ctx.font = "italic 22px Georgia, serif";
            ctx.fillStyle = "#f4c95d";
            const bl = wrapText(ctx, card.bonus, CW - 90);
            bl.forEach((line, i) => ctx.fillText(line, CW / 2, 650 + lines.length * 34 + 22 + i * 28));
          }
          ctx.globalAlpha = 1;
        }
      }
      ctx.restore();
      lastFrameRef.current = now;

      // Camera preview, mirrored, bottom-left.
      const video = videoRef.current;
      if (streamRef.current && video && video.readyState >= 2) {
        const pw = Math.min(W * 0.18, 220);
        const ph = pw * 0.75;
        ctx.save();
        ctx.globalAlpha = 0.75;
        ctx.translate(16 + pw, H - 16 - ph);
        ctx.scale(-1, 1);
        ctx.drawImage(video, 0, 0, pw, ph);
        ctx.restore();
      }

      // Pen cursor.
      const hand = handPenRef.current;
      const mouse = mousePenRef.current;
      const useHand = hand.seen;
      const pen = useHand ? hand : mouse;
      if (useHand || mouse.x || mouse.y) {
        // A gold coin held by its edge: the scratching point is the lower-left
        // rim, the coin sits up and to the right of it, tilted.
        const R = Math.max(BRUSH_RADIUS * s * 2.6, 22);
        ctx.save();
        ctx.translate(pen.x + R * 0.62, pen.y - R * 0.62);
        ctx.rotate(-0.5);
        ctx.scale(1, pen.down ? 0.78 : 0.92);
        ctx.shadowColor = "rgba(0,0,0,0.35)";
        ctx.shadowBlur = 12;
        ctx.shadowOffsetY = pen.down ? 3 : 8;
        const cg = ctx.createLinearGradient(-R, -R, R, R);
        cg.addColorStop(0, "#fff0a0");
        cg.addColorStop(0.45, "#e6b83a");
        cg.addColorStop(1, "#a97a14");
        ctx.fillStyle = cg;
        ctx.beginPath();
        ctx.arc(0, 0, R, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowColor = "transparent";
        ctx.lineWidth = Math.max(R * 0.08, 2);
        ctx.strokeStyle = "#8a6210";
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, 0, R * 0.78, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(138,98,16,0.7)";
        ctx.stroke();
        ctx.fillStyle = "rgba(138,98,16,0.8)";
        ctx.font = `900 ${R}px Georgia, serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("\u2605", 0, R * 0.04);
        ctx.restore();
      }
    };

    const loop = (now: number) => {
      updateHand(now);
      const hand = handPenRef.current;
      const mouse = mousePenRef.current;
      if (hand.seen) scratch(hand.x, hand.y, hand.down);
      else scratch(mouse.x, mouse.y, mouse.down);
      checkCoverage(now);
      draw(now);

      // Show the "next person" button / auto-advance once the fortune is up.
      const ph = phaseRef.current;
      if (ph.name === "fortune") {
        const since = now - ph.since;
        setShowNext((v) => (v ? v : since > 2500));
        if (since > AUTO_NEXT_MS) nextCard();
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    phaseRef.current.since = performance.now();
    rafRef.current = requestAnimationFrame(loop);

    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === "n") nextCard();
      if (k === "h") setPanelOpen((v) => !v);
    };
    window.addEventListener("keydown", onKey);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", onKey);
    };
  }, [nextCard]);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      landmarkerRef.current?.close();
      landmarkerRef.current = null;
    };
  }, []);

  const setMouse = (e: React.PointerEvent, down?: boolean) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const k = canvasRef.current!.width / rect.width;
    mousePenRef.current.x = (e.clientX - rect.left) * k;
    mousePenRef.current.y = (e.clientY - rect.top) * k;
    if (down !== undefined) mousePenRef.current.down = down;
  };

  const busy = status === "loading-model" || status === "starting-camera";

  return (
    <div ref={containerRef} className="fixed inset-0 z-50 overflow-hidden bg-black">
      <video ref={videoRef} className="hidden" muted playsInline />
      <canvas
        ref={canvasRef}
        className="absolute inset-0 block touch-none"
        onPointerDown={(e) => setMouse(e, true)}
        onPointerMove={(e) => setMouse(e)}
        onPointerUp={(e) => setMouse(e, false)}
        onPointerLeave={(e) => setMouse(e, false)}
      />

      {panelOpen && (
      <div className="absolute top-4 left-4 z-10 w-64 space-y-3 rounded-xl bg-black/60 p-4 text-sm text-white backdrop-blur">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Kazı Kazan</h2>
          <button
            onClick={() => setPanelOpen(false)}
            className="rounded px-2 text-white/60 hover:text-white"
            aria-label="Hide panel"
          >
            &times;
          </button>
        </div>
        <p className="text-white/70">
          Hold your thumb and index finger together like a pen and scratch the foil. Mouse works too.
        </p>
        {status !== "running" ? (
          <button
            onClick={startCamera}
            disabled={busy}
            className="w-full rounded-md bg-white px-3 py-2 font-medium text-black hover:bg-white/90 disabled:opacity-60"
          >
            {status === "loading-model"
              ? "Loading hand tracking…"
              : status === "starting-camera"
              ? "Starting camera…"
              : "Start camera"}
          </button>
        ) : (
          <button
            onClick={stopCamera}
            className="w-full rounded-md bg-white/10 px-3 py-2 font-medium hover:bg-white/20"
          >
            Stop camera
          </button>
        )}
        {error && <p className="text-red-400">{error}</p>}
        {status === "running" && (
          <p className="text-white/60">
            Hand: <span className="text-white">{handSeen ? "detected" : "not seen"}</span>
          </p>
        )}
        <p className="text-white/60">Card #{cardNo}</p>
        <p className="text-xs text-white/50">
          <kbd className="rounded bg-white/10 px-1">N</kbd> new card,{" "}
          <kbd className="rounded bg-white/10 px-1">H</kbd> hide this panel.
        </p>
      </div>
      )}

      {showNext && (
        <button
          onClick={nextCard}
          className="absolute bottom-6 left-1/2 z-10 -translate-x-1/2 rounded-full bg-white px-6 py-3 font-semibold text-black shadow-lg hover:bg-white/90"
        >
          Next person &rarr;
        </button>
      )}
    </div>
  );
};

export default ScratchCard;
