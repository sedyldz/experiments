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

/**
 * The deck as rectangles [x0, x1, z0, z1] around the stair opening, which
 * sits against the back wall.
 */
function deckMinusHole(): [number, number, number, number][] {
  const { width } = layout.room;
  const { zFrom, zTo, hole } = layout.mezzanine;
  const X0 = -width / 2;
  const X1 = width / 2;
  const pieces: [number, number, number, number][] = [[X0, X1, hole.z1, zTo]];
  if (hole.x0 > X0) pieces.push([X0, hole.x0, zFrom, hole.z1]);
  if (hole.x1 < X1) pieces.push([hole.x1, X1, zFrom, hole.z1]);
  return pieces;
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

      {/* Back wall: pale blue, like the reference cutaway */}
      <CutawayWall position={[0, 0, -depth / 2 - t / 2]} size={[width + 2 * t, height, t]} normal={[0, -1]} material={flat("wallBlue", 3)} />
      {/* Right wall: cream, behind the desk row */}
      <CutawayWall position={[width / 2 + t / 2, 0, 0]} size={[depth, height, t]} normal={[1, 0]} material={flat("cream")} />
      {/* Left wall */}
      <CutawayWall position={[-width / 2 - t / 2, 0, 0]} size={[depth, height, t]} normal={[-1, 0]} material={flat("cream")} />
      {/* Front: the glass shopfront */}
      <group position={[0, 0, depth / 2 + t / 2]}>
        <Cutaway
          normal={[0, 1]}
          full={<GlassFacade position={[0, 0, 0]} width={width + 2 * t} height={height} door={layout.facade.door} />}
          stub={<Box size={[width + 2 * t, cutawayStubHeight, t]} at={[0, cutawayStubHeight / 2, 0]} m={flat("cobalt", 3)} shadow={false} />}
        />
      </group>

      <group visible={floors.ground}>
        {ground.map((p, i) => (
          <Placed key={i} p={p} />
        ))}
      </group>

      <group visible={floors.mezzanine}>
        {/* The deck: a pale blue slab with a concrete top, minus the stair opening */}
        {deckPieces.map(([x0, x1, z0, z1]) => (
          <group key={`${x0}:${z0}`}>
            <Box size={[x1 - x0, mz.thickness - 0.03, z1 - z0]} at={[(x0 + x1) / 2, mz.level - 0.03 - (mz.thickness - 0.03) / 2, (z0 + z1) / 2]} m={flat("wallBlue", 3)} />
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
