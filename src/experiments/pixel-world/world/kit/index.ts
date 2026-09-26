import type { ComponentProps } from "react";
import {
  Bench,
  Books,
  Desk,
  DiningChair,
  DiningTable,
  Frame,
  HighTable,
  KitchenCounter,
  Laptop,
  OfficeChair,
  Rug,
  ShelvingUnit,
  Stool,
  WallShelf,
} from "./furniture";
import { CoffeeStation, FireExtinguisher, FloorPlate, FuseBox, TrashBin, WallPanel, WallWindow } from "./coffee";
import { BranchPlant, Climber, HangingPothos, Monstera, Palm, RubberPlant, Schefflera, ShelfTrailer, SmallTree } from "./plants";
import { LogoSign, MerchWall, Mirror, PosterBoard } from "./merch";
import { ArmChair, Basin, Kilim, KitchenIsland, KitchenRun, MetalStool, Partition, Toilet, WcSign } from "./upstairs";
import { Curtain, Doorway, LinearLamp, PendantLamp, Pipe, Railing, SpiralStair, Stair } from "./structure";

/** Every kit component that `layout.ts` can place, by name. */
export const kit = {
  desk: Desk,
  highTable: HighTable,
  stool: Stool,
  officeChair: OfficeChair,
  laptop: Laptop,
  books: Books,
  wallShelf: WallShelf,
  shelvingUnit: ShelvingUnit,
  diningTable: DiningTable,
  diningChair: DiningChair,
  bench: Bench,
  rug: Rug,
  frame: Frame,
  kitchenCounter: KitchenCounter,
  monstera: Monstera,
  schefflera: Schefflera,
  smallTree: SmallTree,
  palm: Palm,
  hangingPothos: HangingPothos,
  shelfTrailer: ShelfTrailer,
  pipe: Pipe,
  railing: Railing,
  curtain: Curtain,
  stair: Stair,
  spiralStair: SpiralStair,
  doorway: Doorway,
  pendantLamp: PendantLamp,
  linearLamp: LinearLamp,
  coffeeStation: CoffeeStation,
  trashBin: TrashBin,
  fireExtinguisher: FireExtinguisher,
  floorPlate: FloorPlate,
  wallPanel: WallPanel,
  wallWindow: WallWindow,
  fuseBox: FuseBox,
  rubberPlant: RubberPlant,
  climber: Climber,
  branchPlant: BranchPlant,
  merchWall: MerchWall,
  posterBoard: PosterBoard,
  mirror: Mirror,
  logoSign: LogoSign,
  kitchenRun: KitchenRun,
  kitchenIsland: KitchenIsland,
  metalStool: MetalStool,
  kilim: Kilim,
  partition: Partition,
  toilet: Toilet,
  basin: Basin,
  wcSign: WcSign,
  armChair: ArmChair,
};

export type Kit = typeof kit;
export type KitKind = keyof Kit;

/** One placed kit piece: its kind, the floor it belongs to, and its props. */
export type Placement = {
  [K in KitKind]: { kind: K; floor: "ground" | "mezzanine" } & ComponentProps<Kit[K]>;
}[KitKind];
