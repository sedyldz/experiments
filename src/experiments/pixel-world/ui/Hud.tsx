import { Link } from "react-router-dom";
import { useViewStore } from "./viewStore";
import { useAvatarStore } from "../avatars/store";
import { useGridStore } from "../pathfinding/gridStore";

const pixelFont = {
  fontFamily:
    'ui-monospace, "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace',
};

function Toggle({
  label,
  on,
  onClick,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-2 py-1 border-2 text-xs uppercase tracking-wider ${
        on
          ? "bg-[#1c2130] text-[#fbf7e9] border-[#1c2130]"
          : "bg-[#fbf7e9] text-[#1c2130] border-[#1c2130]/40"
      }`}
    >
      {label}
    </button>
  );
}

/** The overlay: camera and render toggles plus key hints. */
export function Hud() {
  const s = useViewStore();
  const autonomy = useAvatarStore((a) => a.autonomy);
  const setAutonomy = useAvatarStore((a) => a.setAutonomy);
  const showGrid = useGridStore((g) => g.showGrid);
  const toggleGrid = useGridStore((g) => g.toggleGrid);
  return (
    <div
      className="pointer-events-none absolute inset-0 flex flex-col justify-between p-3 text-[#1c2130]"
      style={pixelFont}
    >
      <div className="pointer-events-auto flex items-center gap-3">
        <Link to="/" className="text-xs uppercase underline">
          ← back
        </Link>
        <span className="text-sm font-bold tracking-widest">
          TIO.IST PIXEL WORLD
        </span>
        <span className="text-xs opacity-70">phase 4 · avatars</span>
      </div>

      <div className="pointer-events-auto flex flex-wrap items-end gap-2">
        <Toggle label="outline" on={s.outline} onClick={() => s.toggle("outline")} />
        <Toggle label="dither" on={s.dither} onClick={() => s.toggle("dither")} />
        <Toggle label="palette" on={s.quantize} onClick={() => s.toggle("quantize")} />
        <span className="mx-2 h-5 w-px bg-current opacity-40" />
        <Toggle label="ground" on={s.floors.ground} onClick={() => s.toggleFloor("ground")} />
        <Toggle label="mezzanine" on={s.floors.mezzanine} onClick={() => s.toggleFloor("mezzanine")} />
        <span className="mx-2 h-5 w-px bg-current opacity-40" />
        <Toggle label="wander" on={autonomy} onClick={() => setAutonomy(!autonomy)} />
        <Toggle label="grid" on={showGrid} onClick={toggleGrid} />
        <span className="mx-2 h-5 w-px bg-current opacity-40" />
        <Toggle label="⟲ Q" on={false} onClick={() => s.rotate(-1)} />
        <Toggle label="E ⟳" on={false} onClick={() => s.rotate(1)} />
        <Toggle label="−" on={false} onClick={() => s.zoomBy(1 / 1.25)} />
        <Toggle label="+" on={false} onClick={() => s.zoomBy(1.25)} />
        <Toggle label="iso" on={false} onClick={s.resetView} />
        <span className="mx-2 h-5 w-px bg-current opacity-40" />
        <span className="text-xs">px</span>
        <Toggle label="−" on={false} onClick={() => s.zoom(-1)} />
        <span className="w-6 text-center text-xs">×{s.pixelScale ?? "-"}</span>
        <Toggle label="+" on={false} onClick={() => s.zoom(1)} />
        <span className="ml-auto text-right text-[10px] leading-4 opacity-60">
          drag: pan · right-drag / shift-drag / arrows: orbit
          <br />
          wheel / pinch: zoom · Q/E: quarter turn · R: reset
        </span>
      </div>
    </div>
  );
}
