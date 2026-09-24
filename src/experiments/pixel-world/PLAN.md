# tio.ist Pixel World: plan

An isometric, pixel-art 3D diorama of the tio.ist coworking space, built as
one more experiment in this repo (route `/experiments/pixel-world`).

## Module layout

```
src/experiments/pixel-world/
  index.tsx            page: <Canvas> + HUD overlay
  palette.ts           every color, as hand-tuned ramps (dark -> light)
  render/
    config.ts          pixel pipeline + camera tuning (target height, px/m, thresholds)
    PixelPipeline.tsx  takes over R3F rendering: low-res color/normal passes,
                       composite (outline, dither, palette quantize), integer blit
    shaders.ts         composite + blit + normal-pass shaders
    IsoCameraRig.tsx   true-isometric ortho camera driven by the view store
    useCameraControls  Q/E rotate, wheel/+/- zoom, drag pan
  world/
    layout.ts          all dimensions of the space, in meters (placeholder until
                       a real floor plan arrives)
    worldStore.ts      serializable world state + actions (phase 4+)
    kit/               reusable furniture components (phase 3)
  pathfinding/         grid generation from layout, A* across floors (phase 4)
  avatars/             sprite generator, avatar store/actions, billboards (phase 5)
  ui/                  view store (camera, toggles) + HUD / sidebar
```

## Pixel pipeline (the look)

1. **Color pass.** The scene renders to a low-res target (about 320x240, set
   by `targetHeight`) with a depth texture. Materials are flat Lambert, with
   hard shadows from one directional light.
2. **Normal pass.** The same scene renders again at the same low res with a
   swapped-in normal material. Alpha carries a surface tag: the material's
   palette ramp id and a "dither me" bit, so dithering can be limited to walls
   and floor.
3. **Composite pass (low res).**
   - A depth discontinuity gives a 1px dark outline on the near side of the
     edge.
   - A normal crease gives a softer 1px darkening.
   - A 4x4 Bayer dither plus a sparse halftone dot lattice apply to flagged
     surfaces. Both can be toggled.
   - Palette quantization is ramp-locked. Each surface snaps, by OKLab
     lightness, to a shade of its own ramp in `palette.ts`. Light tint can
     then never push lit concrete into cream. Untagged pixels (id 0) and
     outlines snap to the nearest color in the whole palette.
4. **Blit.** Nearest-neighbor, integer upscale to the screen.

**Zoom** changes the integer upscale factor, and the low-res buffer shrinks to
match, so every zoom level stays pixel-perfect. **Pan** snaps the render camera
to whole low-res pixels, which stops the shimmer. The sub-pixel remainder
becomes a whole-screen-pixel offset on the blit, so dragging still feels
smooth.

The R3F default camera stays the "true", unsnapped view camera, so pointer
events and raycasts line up with what is on screen.

## Camera

- True isometric: yaw 45 degrees plus k times 90 degrees, pitch
  atan(1/sqrt(2)), orthographic.
- Q and E rotate in 90 degree steps with a short tween.
- Walls whose outward normal faces the camera are hidden (the cutaway).
  Each floor can be toggled on or off.

## World model (serializable, action-driven)

State is plain JSON in zustand stores and only changes through named actions.
That keeps it ready for PartyKit or Supabase realtime later, where the same
actions get broadcast.

- **World:** `layout.ts` gives rooms, floors, openings, furniture placements
  and seats.
- **Grid:** 0.5m cells per floor, derived from the layout. Cells are
  `walkable`, `blocked`, or `seat` (with a facing direction). The stair cells
  link the two floors.
- **Pathfinding:** A* over (floor, x, z), with the stair connector as an edge
  between the floor grids.
- **Avatars:** `{ id, name, appearance, position: {floor, cell}, state,
  target?, homeSeat? }`. The layers are body, hair, top, bottom and
  accessory. The sprites are generated on a canvas and sit behind a
  `SpriteSource` interface, so hand-drawn sheets can replace them later.
- **Persistence:** localStorage (v1).

## Phases

1. Scaffold + pixel pipeline: grey-box room, camera, rotation and zoom,
   low-res, outline and quantize passes. **(this phase)**
2. Space blockout from `layout.ts`: ground floor, mezzanine, stairs, palette.
3. Furniture kit + dressing to match `inside2.jpeg`.
4. Walkable grid + A* + debug overlay.
5. Avatars: sprites, drag placement, click-to-move, sitting.
6. Autonomy, persistence, day/night, pendant glow, polish.
