import { Canvas } from "@react-three/fiber";
import { PixelPipeline } from "./render/PixelPipeline";
import { IsoCameraRig } from "./render/IsoCameraRig";
import { Lighting } from "./render/Lighting";
import { useCameraControls } from "./render/useCameraControls";
import { renderConfig } from "./render/config";
import { GreyboxRoom } from "./world/GreyboxRoom";
import { Hud } from "./ui/Hud";
import { base } from "./palette";

function Controls() {
  useCameraControls();
  return null;
}

export default function PixelWorld() {
  return (
    <div
      className="fixed inset-0 overflow-hidden"
      style={{ background: base("background") }}
    >
      <Canvas
        // One canvas pixel per CSS pixel. The pipeline does its own integer
        // upscale, and `pixelated` keeps HiDPI screens from smoothing it.
        dpr={1}
        flat
        orthographic
        camera={{ manual: true, near: renderConfig.near, far: renderConfig.far }}
        shadows="basic"
        gl={{ antialias: false, powerPreference: "high-performance" }}
        style={{ imageRendering: "pixelated", touchAction: "none" }}
      >
        <IsoCameraRig />
        <Controls />
        <Lighting />
        <GreyboxRoom />
        <PixelPipeline />
      </Canvas>
      <Hud />
    </div>
  );
}
