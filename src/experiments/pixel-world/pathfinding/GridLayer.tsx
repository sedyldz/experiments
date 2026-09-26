import { useEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { flat } from "../world/materials";
import { layout } from "../world/layout";
import { useViewStore } from "../ui/viewStore";
import { useGridStore } from "./gridStore";
import { CELL, buildWalkGrid, cellCenter, type FloorGrid } from "./grid";

/** Builds the walkable grid once the scene has mounted. */
export function GridBuilder() {
  const scene = useThree((s) => s.scene);
  const setGrid = useGridStore((s) => s.setGrid);
  useEffect(() => {
    // Two frames in, so every placement (and its procedural geometry) is in the scene
    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => {
        const grid = buildWalkGrid(scene);
        if (import.meta.env.DEV) (window as unknown as { __grid: unknown }).__grid = grid;
        setGrid(grid);
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [scene, setGrid]);
  return null;
}

const _m = new THREE.Matrix4();

function FloorCells({ g, walkable, visible }: { g: FloorGrid; walkable: boolean; visible: boolean }) {
  const mz = layout.mezzanine;
  const mesh = useMemo(() => {
    const cells: [number, number][] = [];
    for (let iz = 0; iz < g.nz; iz++) {
      for (let ix = 0; ix < g.nx; ix++) {
        const w = g.walkable[iz * g.nx + ix] === 1;
        if (w !== walkable) continue;
        const [x, z] = cellCenter(g, ix, iz);
        // Blocked cells upstairs only matter where there is a floor
        if (!walkable && g.floor === "mezzanine") {
          const onDeck = mz.decks.some(([x0, x1, z0, z1]) => x > x0 && x < x1 && z > z0 && z < z1);
          if (!onDeck) continue;
        }
        cells.push([x, z]);
      }
    }
    const geo = new THREE.PlaneGeometry(CELL * 0.8, CELL * 0.8).rotateX(-Math.PI / 2);
    const im = new THREE.InstancedMesh(geo, walkable ? flat("green", 5) : flat("red", 2), Math.max(1, cells.length));
    cells.forEach(([x, z], i) => im.setMatrixAt(i, _m.makeTranslation(x, g.y + 0.03, z)));
    im.count = cells.length;
    return im;
  }, [g, walkable, mz.decks]);
  useEffect(() => () => mesh.geometry.dispose(), [mesh]);
  return <primitive object={mesh} visible={visible} />;
}

/** The debug overlay: walkable cells in green, blocked ones in red. */
export function GridOverlay() {
  const grid = useGridStore((s) => s.grid);
  const show = useGridStore((s) => s.showGrid);
  const floors = useViewStore((s) => s.floors);
  if (!grid || !show) return null;
  return (
    <>
      {(["ground", "mezzanine"] as const).map((f) => (
        <group key={f}>
          <FloorCells g={grid.floors[f]} walkable visible={floors[f]} />
          <FloorCells g={grid.floors[f]} walkable={false} visible={floors[f]} />
        </group>
      ))}
    </>
  );
}
