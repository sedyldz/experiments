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

/** The whole tio.ist space: the shell, the mezzanine, and every placement from layout.ts. */
export function Space() {
  const { width, depth, height, wallThickness: t, floorThickness, cutawayStubHeight } = layout.room;
  const mz = layout.mezzanine;
  const floors = useViewStore((s) => s.floors);

  const ground = layout.placements.filter((p) => p.floor === "ground");
  const mezz = layout.placements.filter((p) => p.floor === "mezzanine");
  const mzDepth = mz.zTo - mz.zFrom;

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
        {/* The deck: a pale blue slab with a concrete top */}
        <Box size={[width, mz.thickness - 0.03, mzDepth]} at={[0, mz.level - 0.03 - (mz.thickness - 0.03) / 2, mz.zFrom + mzDepth / 2]} m={flat("wallBlue", 3)} />
        <Box size={[width, 0.03, mzDepth]} at={[0, mz.level - 0.015, mz.zFrom + mzDepth / 2]} m={flat("concrete", 3)} dither />
        {mezz.map((p, i) => (
          <Placed key={i} p={p} />
        ))}
      </group>
    </group>
  );
}
