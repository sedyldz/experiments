import { createElement, type ComponentType } from "react";
import { layout } from "./layout";
import { Cutaway, CutawayWall } from "./CutawayWall";
import { flat } from "./materials";
import { kit, type Placement } from "./kit";
import { Box } from "./kit/primitives";
import { GlassFacade } from "./kit/structure";
import { useViewStore } from "../ui/viewStore";

function Placed({ p }: { p: Placement }) {
  const { kind, floor: _floor, ...props } = p;
  return createElement(kit[kind] as ComponentType<typeof props>, props);
}

type Rect = [number, number, number, number]; // x0, x1, z0, z1

/** The upper floor as rectangles, each with the stair opening cut out. */
function deckMinusHole(): Rect[] {
  const { decks, hole } = layout.mezzanine;
  const out: Rect[] = [];
  for (const [x0, x1, z0, z1] of decks) {
    const hx0 = Math.max(x0, hole.x0);
    const hx1 = Math.min(x1, hole.x1);
    const hz0 = Math.max(z0, hole.z0);
    const hz1 = Math.min(z1, hole.z1);
    if (hx0 >= hx1 || hz0 >= hz1) {
      out.push([x0, x1, z0, z1]);
      continue;
    }
    if (hz1 < z1) out.push([x0, x1, hz1, z1]);
    if (hz0 > z0) out.push([x0, x1, z0, hz0]);
    if (hx0 > x0) out.push([x0, hx0, hz0, hz1]);
    if (hx1 < x1) out.push([hx1, x1, hz0, hz1]);
  }
  return out;
}

/** The whole tio.ist space: the shell, the mezzanine, and every placement from layout.ts. */
export function Space() {
  const { width, depth, height, wallThickness: t, floorThickness, cutawayStubHeight } = layout.room;
  const mz = layout.mezzanine;
  const floors = useViewStore((s) => s.floors);

  const ground = layout.placements.filter((p) => p.floor === "ground");
  const mezz = layout.placements.filter((p) => p.floor === "mezzanine");
  const deckPieces = deckMinusHole();

  return (
    <group>
      {/* Floor slab. Its top sits at y = 0. */}
      <Box size={[width + 2 * t, floorThickness, depth + 2 * t]} at={[0, -floorThickness / 2, 0]} m={flat("concrete")} dither shadow={false} />

      {/* Back wall: white, like the rest (see the photos) */}
      <CutawayWall position={[0, 0, -depth / 2 - t / 2]} size={[width + 2 * t, height, t]} normal={[0, -1]} material={flat("cream", 4)} />
      {/* Right wall: behind the desk row */}
      <CutawayWall position={[width / 2 + t / 2, 0, 0]} size={[depth, height, t]} normal={[1, 0]} material={flat("cream", 4)} />
      {/* Left wall */}
      <CutawayWall position={[-width / 2 - t / 2, 0, 0]} size={[depth, height, t]} normal={[-1, 0]} material={flat("cream", 4)} />
      {/* Front: the glass shopfront */}
      <group position={[0, 0, depth / 2 + t / 2]}>
        <Cutaway
          normal={[0, 1]}
          full={<GlassFacade position={[0, 0, 0]} width={width + 2 * t} height={height} door={layout.facade.door} />}
          stub={<Box size={[width + 2 * t, cutawayStubHeight, t]} at={[0, cutawayStubHeight / 2, 0]} m={flat("cobalt", 1)} shadow={false} />}
        />
      </group>

      <group visible={floors.ground}>
        {ground.map((p, i) => (
          <Placed key={i} p={p} />
        ))}
      </group>

      <group visible={floors.mezzanine}>
        {/* The deck: a white slab with a concrete top, minus the stair opening */}
        {deckPieces.map(([x0, x1, z0, z1]) => (
          <group key={`${x0}:${z0}`}>
            <Box size={[x1 - x0, mz.thickness - 0.03, z1 - z0]} at={[(x0 + x1) / 2, mz.level - 0.03 - (mz.thickness - 0.03) / 2, (z0 + z1) / 2]} m={flat("cream", 3)} />
            <Box size={[x1 - x0, 0.03, z1 - z0]} at={[(x0 + x1) / 2, mz.level - 0.015, (z0 + z1) / 2]} m={flat("concrete", 3)} dither />
          </group>
        ))}
        {mezz.map((p, i) => (
          <Placed key={i} p={p} />
        ))}
      </group>
    </group>
  );
}
