import { Link } from "react-router-dom";
import { useViewStore } from "./viewStore";

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
          ? "bg-[#e6d7b8] text-[#14151f] border-[#14151f]"
          : "bg-transparent text-[#e6d7b8] border-[#e6d7b8]/50"
      }`}
    >
      {label}
    </button>
  );
}

/** The overlay: camera and render toggles plus key hints. */
export function Hud() {
  const s = useViewStore();
  return (
    <div
      className="pointer-events-none absolute inset-0 flex flex-col justify-between p-3 text-[#e6d7b8]"
      style={pixelFont}
    >
      <div className="pointer-events-auto flex items-center gap-3">
        <Link to="/" className="text-xs uppercase underline">
          ← back
        </Link>
        <span className="text-sm font-bold tracking-widest">
          TIO.IST PIXEL WORLD
        </span>
        <span className="text-xs opacity-70">phase 1 · pipeline</span>
      </div>

      <div className="pointer-events-auto flex flex-wrap items-end gap-2">
        <Toggle label="outline" on={s.outline} onClick={() => s.toggle("outline")} />
        <Toggle label="dither" on={s.dither} onClick={() => s.toggle("dither")} />
        <Toggle label="palette" on={s.quantize} onClick={() => s.toggle("quantize")} />
        <span className="mx-2 h-5 w-px bg-[#e6d7b8]/40" />
        <Toggle label="⟲ Q" on={false} onClick={() => s.rotate(-1)} />
        <Toggle label="E ⟳" on={false} onClick={() => s.rotate(1)} />
        <Toggle label="−" on={false} onClick={() => s.zoom(-1)} />
        <span className="w-10 text-center text-xs">×{s.pixelScale ?? "-"}</span>
        <Toggle label="+" on={false} onClick={() => s.zoom(1)} />
        <span className="ml-auto text-[10px] opacity-60">
          drag to pan · wheel / +− to zoom · Q/E to rotate
        </span>
      </div>
    </div>
  );
}
