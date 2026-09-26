import { create } from "zustand";
import { palette } from "../palette";
import type { Accessory, Appearance, Avatar, HairStyle } from "./types";

// The avatar roster. It is plain serializable data changed only through
// actions, so it can be persisted or synced later. The runtime motion state
// (paths, timers) lives in the simulation, not here.

const pick = <T,>(arr: readonly T[], r: number) => arr[Math.floor(r * arr.length) % arr.length];

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HAIR = [palette.charcoal.ramp[0], palette.oak.ramp[0], palette.oak.ramp[1], palette.mustard.ramp[1], palette.terracotta.ramp[1], palette.ink.ramp[0]];
const TOPS = [palette.cobalt.ramp[2], palette.cobalt.ramp[3], palette.mustard.ramp[2], palette.red.ramp[1], palette.white.ramp[3], palette.green.ramp[3], palette.navy.ramp[1], palette.orange.ramp[2], palette.pink.ramp[1], palette.cream.ramp[2], palette.charcoal.ramp[1]];
const BOTTOMS = [palette.navy.ramp[1], palette.charcoal.ramp[1], palette.oak.ramp[1], palette.cobalt.ramp[1], palette.cream.ramp[1], palette.charcoal.ramp[2]];
const SHOES = [palette.white.ramp[3], palette.charcoal.ramp[0], palette.oak.ramp[0]];
const STYLES: HairStyle[] = ["short", "long", "bun", "curly", "cap", "short", "long", "bald"];
const ACCESSORIES: Accessory[] = ["none", "none", "glasses", "headphones", "tote", "none", "glasses"];
const ACCENTS = [palette.cobalt.ramp[3], palette.mustard.ramp[2], palette.red.ramp[1], palette.white.ramp[3], palette.pink.ramp[1]];

export function randomAppearance(seed: number): Appearance {
  const r = rng(seed);
  return {
    skin: pick(palette.skin.ramp, r()),
    hair: pick(HAIR, r()),
    hairStyle: pick(STYLES, r()),
    top: pick(TOPS, r()),
    sleeves: r() < 0.5 ? "short" : "long",
    bottom: pick(BOTTOMS, r()),
    shoes: pick(SHOES, r()),
    accessory: pick(ACCESSORIES, r()),
    accessoryColor: pick(ACCENTS, r()),
  };
}

const NAMES = ["Deniz", "Ece", "Mert", "Zeynep", "Can", "Elif", "Emre", "Selin", "Burak", "Ayşe", "Kaan", "Defne", "Arda", "Nil"];

interface AvatarState {
  avatars: Avatar[];
  /** Whether avatars wander on their own. */
  autonomy: boolean;
  add: (name?: string) => void;
  remove: (id: string) => void;
  rename: (id: string, name: string) => void;
  setAutonomy: (on: boolean) => void;
}

const initial: Avatar[] = NAMES.slice(0, 12).map((name, i) => ({
  id: `a${i + 1}`,
  name,
  appearance: randomAppearance(1000 + i * 77),
}));

export const useAvatarStore = create<AvatarState>((set) => ({
  avatars: initial,
  autonomy: true,
  add: (name) =>
    set((s) => {
      const n = s.avatars.length;
      const id = `a${Date.now().toString(36)}`;
      return { avatars: [...s.avatars, { id, name: name ?? NAMES[n % NAMES.length], appearance: randomAppearance(Date.now()) }] };
    }),
  remove: (id) => set((s) => ({ avatars: s.avatars.filter((a) => a.id !== id) })),
  rename: (id, name) => set((s) => ({ avatars: s.avatars.map((a) => (a.id === id ? { ...a, name } : a)) })),
  setAutonomy: (on) => set({ autonomy: on }),
}));
