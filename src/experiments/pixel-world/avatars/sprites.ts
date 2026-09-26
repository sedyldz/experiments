import * as THREE from "three";
import { palette } from "../palette";
import type { Appearance } from "./types";

// Procedural pixel sprites. Each avatar gets one atlas texture: the columns
// are frames, the rows are facings. Everything is drawn with plain rects on a
// canvas, so no art is needed yet. A hand-drawn sheet in the same layout
// (see SpriteSource) can replace it later.

export const FRAME_W = 20;
export const FRAME_H = 52;
/** Sprite texels per world meter. Matches the render's pixels-per-meter, so one texel is about one screen pixel. */
export const TEXELS_PER_METER = 30;

export const FRAMES = { idle0: 0, idle1: 1, walk0: 2, walk1: 3, walk2: 4, walk3: 5, sit: 6 } as const;
export const FRAME_COUNT = 7;
export type Facing = "front" | "back" | "left" | "right";
export const FACINGS: Facing[] = ["front", "back", "left", "right"];
/** The sit frame's hip line, in texels up from the sprite's bottom edge. */
export const SIT_HIP = 18;

/** Anything that can hand over an atlas in this layout: procedural now, hand-drawn later. */
export interface SpriteSource {
  atlas(appearance: Appearance): HTMLCanvasElement;
}

type Px = (x: number, y: number, w: number, h: number, color: string) => void;

const ink = palette.ink.ramp[0];

function drawFrame(px: Px, a: Appearance, facing: Facing, frame: number) {
  const side = facing === "left" || facing === "right";
  const back = facing === "back";
  const sit = frame === FRAMES.sit;
  const walk = frame >= FRAMES.walk0 && frame <= FRAMES.walk3 ? frame - FRAMES.walk0 : -1;
  const bob = walk === 1 || walk === 3 ? 1 : 0; // body rises on the passing frames
  const breathe = frame === FRAMES.idle1 ? 1 : 0;
  const top = 0 + bob; // everything above the hips shifts with the bob
  const sleeveLong = a.sleeves === "long";

  // Legs and shoes (drawn first, so the torso overlaps them)
  if (sit) {
    if (side) {
      px(9, 34, 7, 4, a.bottom); // thigh forward
      px(13, 38, 3, 9, a.bottom); // shin down
      px(13, 47, 5, 2, a.shoes);
    } else {
      px(6, 34, 8, 4, a.bottom);
      px(6, 38, 3, 8, a.bottom);
      px(11, 38, 3, 8, a.bottom);
      px(5, 46, 4, 2, a.shoes);
      px(11, 46, 4, 2, a.shoes);
    }
  } else if (side) {
    // Stride: legs apart on frames 0 and 2, together on the passing frames
    const apart = walk === 0 || walk === 2;
    if (apart) {
      px(6, 34, 3, 14, a.bottom);
      px(11, 34, 3, 14, a.bottom);
      px(5, 48, 4, 2, a.shoes);
      px(11, 48, 4, 2, a.shoes);
    } else {
      px(8, 34, 4, 14, a.bottom);
      px(8, 48, 5, 2, a.shoes);
    }
  } else {
    const lLift = walk === 0 ? 2 : 0;
    const rLift = walk === 2 ? 2 : 0;
    px(6, 34, 4, 14 - lLift, a.bottom);
    px(10, 34, 4, 14 - rLift, a.bottom);
    px(5, 48 - lLift, 5, 2, a.shoes);
    px(10, 48 - rLift, 5, 2, a.shoes);
  }

  // Torso
  const tx = side ? 7 : 5;
  const tw = side ? 6 : 10;
  px(tx, 19 + top - breathe, tw, 15 - top + breathe, a.top);
  // Neck
  px(side ? 9 : 9, 17 + top, 2, 2, a.skin);

  // Arms
  const armLen = 12;
  const sleeve = sleeveLong ? armLen - 2 : 4;
  if (side) {
    const swing = walk === 0 ? 2 : walk === 2 ? -2 : 0;
    const ax = 9 + swing;
    px(ax, 20 + top, 2, sleeve, a.top);
    px(ax, 20 + top + sleeve, 2, armLen - sleeve, a.skin);
  } else {
    const lSwing = walk === 0 ? -1 : walk === 2 ? 1 : 0;
    px(3, 20 + top + lSwing, 2, sleeve, a.top);
    px(3, 20 + top + lSwing + sleeve, 2, armLen - sleeve, a.skin);
    px(15, 20 + top - lSwing, 2, sleeve, a.top);
    px(15, 20 + top - lSwing + sleeve, 2, armLen - sleeve, a.skin);
  }

  // Head
  const hx = side ? 7 : 6;
  const hw = side ? 7 : 8;
  px(hx, 6 + top, hw, 11, a.skin);
  if (side) px(14, 11 + top, 1, 2, a.skin); // nose

  // Hair
  const hs = a.hairStyle;
  if (hs !== "bald") {
    if (hs === "cap") {
      px(hx - 1, 4 + top, hw + 2, 4, a.accessoryColor);
      if (!back) px(side ? 12 : hx, 8 + top, side ? 4 : hw, 1, a.accessoryColor); // brim
      px(hx, 8 + top, side ? 2 : 1, 4, a.hair);
    } else {
      const wide = hs === "curly" ? 1 : 0;
      px(hx - wide, 4 + top, hw + 2 * wide, 4 + wide, a.hair);
      if (back) {
        px(hx - wide, 8 + top, hw + 2 * wide, hs === "long" ? 16 : 8, a.hair);
      } else if (side) {
        px(hx - wide, 8 + top, 3 + wide, hs === "long" ? 16 : 5, a.hair);
      } else {
        px(hx - wide, 8 + top, 1 + wide, hs === "long" ? 16 : 4, a.hair);
        px(hx + hw - 1, 8 + top, 1 + wide, hs === "long" ? 16 : 4, a.hair);
      }
      if (hs === "bun") px(hx + (side ? 0 : 2), 1 + top, 4, 3, a.hair);
    }
  }

  // Face
  if (!back) {
    if (side) {
      px(12, 10 + top, 1, 2, ink);
    } else {
      px(8, 10 + top, 1, 2, ink);
      px(11, 10 + top, 1, 2, ink);
    }
  }

  // Accessory
  if (a.accessory === "glasses" && !back) {
    if (side) px(11, 10 + top, 3, 1, ink);
    else px(7, 10 + top, 6, 1, ink);
  } else if (a.accessory === "headphones") {
    px(hx - 1, 3 + top, hw + 2, 1, ink);
    if (side) px(9, 9 + top, 2, 3, a.accessoryColor);
    else {
      px(hx - 1, 9 + top, 2, 3, a.accessoryColor);
      px(hx + hw - 1, 9 + top, 2, 3, a.accessoryColor);
    }
  } else if (a.accessory === "tote" && !sit) {
    const bx = side ? (facing === "right" ? 5 : 11) : 15;
    px(bx, 27 + top, 4, 7, a.accessoryColor);
    px(bx + 1, 22 + top, 1, 5, a.accessoryColor);
  }
}

/** The procedural sprite source: draws a full atlas for an appearance. */
export const proceduralSprites: SpriteSource = {
  atlas(a: Appearance) {
    const c = document.createElement("canvas");
    c.width = FRAME_W * FRAME_COUNT;
    c.height = FRAME_H * FACINGS.length;
    const g = c.getContext("2d")!;
    FACINGS.forEach((facing, row) => {
      for (let f = 0; f < FRAME_COUNT; f++) {
        const ox = f * FRAME_W;
        const oy = row * FRAME_H;
        const mirror = facing === "left";
        const px: Px = (x, y, w, h, color) => {
          g.fillStyle = color;
          const xx = mirror ? FRAME_W - x - w : x;
          g.fillRect(ox + xx, oy + y, w, h);
        };
        drawFrame(px, a, facing === "left" ? "right" : facing, f);
      }
    });
    return c;
  },
};

export function atlasTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.repeat.set(1 / FRAME_COUNT, 1 / FACINGS.length);
  return t;
}

/** Points the atlas texture at one frame. */
export function setFrame(t: THREE.Texture, facing: Facing, frame: number) {
  const row = FACINGS.indexOf(facing);
  t.offset.set(frame / FRAME_COUNT, 1 - (row + 1) / FACINGS.length);
}

/** A small pixel label texture: a white pill with dark text. Also used for the "…" chat bubble. */
export function labelTexture(text: string): { texture: THREE.CanvasTexture; w: number; h: number } {
  const probe = document.createElement("canvas").getContext("2d")!;
  const font = "bold 8px ui-monospace, Menlo, Consolas, monospace";
  probe.font = font;
  const tw = Math.ceil(probe.measureText(text).width);
  const w = tw + 6;
  const h = 11;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  g.fillStyle = ink;
  g.fillRect(1, 0, w - 2, h);
  g.fillRect(0, 1, w, h - 2);
  g.fillStyle = palette.white.ramp[3];
  g.fillRect(1, 1, w - 2, h - 2);
  g.fillStyle = ink;
  g.font = font;
  g.textBaseline = "middle";
  g.fillText(text, 3, h / 2 + 0.5);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  return { texture: t, w, h };
}
