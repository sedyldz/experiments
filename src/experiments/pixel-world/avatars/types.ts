// Serializable avatar data. Everything here is plain JSON, so it can be
// persisted or broadcast (PartyKit / Supabase Realtime) as-is.

export type HairStyle = "short" | "long" | "bun" | "curly" | "cap" | "bald";
export type Accessory = "none" | "glasses" | "headphones" | "tote";

/** Colors are palette hex values (see palette.ts), one per sprite layer. */
export interface Appearance {
  skin: string;
  hair: string;
  hairStyle: HairStyle;
  top: string;
  sleeves: "short" | "long";
  bottom: string;
  shoes: string;
  accessory: Accessory;
  accessoryColor: string;
}

export interface Avatar {
  id: string;
  name: string;
  appearance: Appearance;
  /** Index into the seat list: this avatar's own desk. */
  homeSeat?: number;
}
