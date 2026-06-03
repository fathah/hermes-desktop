// TweaksPanel.tsx — real settings panel. Keeps the prototype's glass .twk-* visual
// (tweaks-panel.jsx) but drops the omelette host postMessage protocol: values read
// and write the Zustand tweaks slice (persisted) instead of the EDITMODE block.
import { useRef, useState, useEffect, type ReactNode } from "react";
import { useStore } from "../store";
import { ACCENTS, type Tweaks, setSkinVars } from "../lib/theme";
import { skinToSpsVars } from "../lib/skin";
import { getActiveSkinId, setActiveSkinId } from "../../../utils/skin";
import type { LoadedSkin } from "../../../../../shared/skins";

// ── styles (ported verbatim from tweaks-panel.jsx __TWEAKS_STYLE) ──────────────
const TWEAKS_STYLE = `
  .twk-panel{position:fixed;right:16px;bottom:16px;z-index:2147483646;width:280px;
    max-height:calc(100vh - 32px);display:flex;flex-direction:column;
    background:rgba(250,249,247,.78);color:#29261b;
    -webkit-backdrop-filter:blur(24px) saturate(160%);backdrop-filter:blur(24px) saturate(160%);
    border:.5px solid rgba(255,255,255,.6);border-radius:14px;
    box-shadow:0 1px 0 rgba(255,255,255,.5) inset,0 12px 40px rgba(0,0,0,.18);
    font:11.5px/1.4 ui-sans-serif,system-ui,-apple-system,sans-serif;overflow:hidden}
  [data-theme="dark"] .twk-panel{background:rgba(28,27,22,.82);color:#ECE7D8;
    border:.5px solid rgba(255,255,255,.12);
    box-shadow:0 1px 0 rgba(255,255,255,.06) inset,0 12px 40px rgba(0,0,0,.5)}
  .twk-hd{display:flex;align-items:center;justify-content:space-between;
    padding:10px 8px 10px 14px;cursor:move;user-select:none}
  .twk-hd b{font-size:12px;font-weight:600;letter-spacing:.01em}
  .twk-x{appearance:none;border:0;background:transparent;color:rgba(41,38,27,.55);
    width:22px;height:22px;border-radius:6px;cursor:pointer;font-size:13px;line-height:1}
  [data-theme="dark"] .twk-x{color:rgba(236,231,216,.55)}
  .twk-x:hover{background:rgba(0,0,0,.06);color:#29261b}
  .twk-body{padding:2px 14px 14px;display:flex;flex-direction:column;gap:10px;
    overflow-y:auto;overflow-x:hidden;min-height:0}
  .twk-row{display:flex;flex-direction:column;gap:5px}
  .twk-row-h{flex-direction:row;align-items:center;justify-content:space-between;gap:10px}
  .twk-lbl{display:flex;justify-content:space-between;align-items:baseline;color:rgba(41,38,27,.72)}
  [data-theme="dark"] .twk-lbl{color:rgba(236,231,216,.72)}
  .twk-lbl>span:first-child{font-weight:500}
  .twk-sect{font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;
    color:rgba(41,38,27,.45);padding:10px 0 0}
  [data-theme="dark"] .twk-sect{color:rgba(236,231,216,.4)}
  .twk-sect:first-child{padding-top:0}
  .twk-field{appearance:none;box-sizing:border-box;width:100%;min-width:0;height:26px;padding:0 8px;
    border:.5px solid rgba(0,0,0,.1);border-radius:7px;
    background:rgba(255,255,255,.6);color:inherit;font:inherit;outline:none}
  [data-theme="dark"] .twk-field{border-color:rgba(255,255,255,.14);background:rgba(255,255,255,.06)}
  .twk-seg{position:relative;display:flex;padding:2px;border-radius:8px;background:rgba(0,0,0,.06);user-select:none}
  [data-theme="dark"] .twk-seg{background:rgba(255,255,255,.08)}
  .twk-seg-thumb{position:absolute;top:2px;bottom:2px;border-radius:6px;
    background:rgba(255,255,255,.9);box-shadow:0 1px 2px rgba(0,0,0,.12);
    transition:left .15s cubic-bezier(.3,.7,.4,1),width .15s}
  [data-theme="dark"] .twk-seg-thumb{background:rgba(255,255,255,.16)}
  .twk-seg button{appearance:none;position:relative;z-index:1;flex:1;border:0;
    background:transparent;color:inherit;font:inherit;font-weight:500;min-height:22px;
    border-radius:6px;cursor:pointer;padding:4px 6px;line-height:1.2;text-transform:capitalize}
  .twk-toggle{position:relative;width:32px;height:18px;border:0;border-radius:999px;
    background:rgba(0,0,0,.15);transition:background .15s;cursor:pointer;padding:0}
  [data-theme="dark"] .twk-toggle{background:rgba(255,255,255,.18)}
  .twk-toggle[data-on="1"]{background:#34c759}
  .twk-toggle i{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;
    background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25);transition:transform .15s}
  .twk-toggle[data-on="1"] i{transform:translateX(14px)}
  .twk-chips{display:flex;gap:6px}
  .twk-chip{position:relative;appearance:none;flex:1;min-width:0;height:30px;
    padding:0;border:0;border-radius:6px;overflow:hidden;cursor:pointer;
    box-shadow:0 0 0 .5px rgba(0,0,0,.12),0 1px 2px rgba(0,0,0,.06);transition:transform .12s,box-shadow .12s}
  .twk-chip:hover{transform:translateY(-1px)}
  .twk-chip[data-on="1"]{box-shadow:0 0 0 1.5px rgba(0,0,0,.85),0 2px 6px rgba(0,0,0,.15)}
  [data-theme="dark"] .twk-chip[data-on="1"]{box-shadow:0 0 0 1.5px rgba(255,255,255,.9),0 2px 6px rgba(0,0,0,.4)}
`;

function Section({ label }: { label: string }) {
  return <div className="twk-sect">{label}</div>;
}

function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="twk-row twk-row-h">
      <span className="twk-lbl" style={{ flex: 1 }}>
        <span>{label}</span>
      </span>
      <button
        className="twk-toggle"
        data-on={value ? "1" : "0"}
        onClick={() => onChange(!value)}
        aria-label={label}
      >
        <i />
      </button>
    </div>
  );
}

function ColorChips({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="twk-row">
      <span className="twk-lbl">
        <span>{label}</span>
      </span>
      <div className="twk-chips">
        {options.map((c) => (
          <button
            key={c}
            className="twk-chip"
            data-on={value === c ? "1" : "0"}
            style={{ background: c }}
            onClick={() => onChange(c)}
            aria-label={c}
          />
        ))}
      </div>
    </div>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: T[];
  onChange: (v: T) => void;
}) {
  const i = Math.max(0, options.indexOf(value));
  const n = options.length;
  return (
    <div className="twk-row">
      <span className="twk-lbl">
        <span>{label}</span>
      </span>
      <div className="twk-seg">
        <div
          className="twk-seg-thumb"
          style={{
            left: `calc(${(i / n) * 100}% + 2px)`,
            width: `calc(${100 / n}% - 4px)`,
          }}
        />
        {options.map((o) => (
          <button key={o} onClick={() => onChange(o)}>
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}

function Select<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: T[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="twk-row twk-row-h">
      <span className="twk-lbl" style={{ flex: 1 }}>
        <span>{label}</span>
      </span>
      <select
        className="twk-field"
        style={{ width: 120 }}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );
}

// Skin selector (idea A6): lists skins found under <profileHome>/skins/ and
// applies the chosen one's variables onto the SPS scope. Hidden when none exist.
function SkinSelect() {
  const [skins, setSkins] = useState<LoadedSkin[]>([]);
  const [active, setActive] = useState<string>("");
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await window.hermesAPI.listSkins();
        if (cancelled) return;
        setSkins(list);
        setActive(getActiveSkinId() ?? "");
      } catch {
        /* no bridge / no skins */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  if (skins.length === 0) return null;
  const onChange = (id: string): void => {
    setActive(id);
    if (!id) {
      setActiveSkinId(undefined, null);
      setSkinVars({});
      return;
    }
    const skin = skins.find((s) => s.id === id);
    setActiveSkinId(undefined, id);
    setSkinVars(skinToSpsVars(skin?.skin ?? null));
  };
  return (
    <>
      <Section label="Skin" />
      <div className="twk-row twk-row-h">
        <span className="twk-lbl">
          <span>Skin</span>
        </span>
        <select
          className="twk-field"
          style={{ width: 120 }}
          value={active}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Default</option>
          {skins.map((s) => (
            <option key={s.id} value={s.id}>
              {s.skin.name}
            </option>
          ))}
        </select>
      </div>
    </>
  );
}

function Shell({
  children,
  onClose,
}: {
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onDragStart = (e: React.MouseEvent) => {
    const panel = ref.current;
    if (!panel) return;
    const r = panel.getBoundingClientRect();
    const sx = e.clientX;
    const sy = e.clientY;
    const startRight = window.innerWidth - r.right;
    const startBottom = window.innerHeight - r.bottom;
    const move = (ev: MouseEvent) => {
      const x = Math.max(8, startRight - (ev.clientX - sx));
      const y = Math.max(8, startBottom - (ev.clientY - sy));
      panel.style.right = x + "px";
      panel.style.bottom = y + "px";
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };
  return (
    <>
      <style>{TWEAKS_STYLE}</style>
      <div ref={ref} className="twk-panel">
        <div className="twk-hd" onMouseDown={onDragStart}>
          <b>Tweaks</b>
          <button className="twk-x" aria-label="Close tweaks" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="twk-body">{children}</div>
      </div>
    </>
  );
}

export function TweaksPanel() {
  const open = useStore((s) => s.tweaksOpen);
  const setOpen = useStore((s) => s.setTweaksOpen);
  const t = useStore((s) => s.t);
  const setTweak = useStore((s) => s.setTweak);
  if (!open) return null;
  return (
    <Shell onClose={() => setOpen(false)}>
      <Section label="Appearance" />
      <Toggle
        label="Dark mode"
        value={t.dark}
        onChange={(v) => setTweak("dark", v)}
      />
      <ColorChips
        label="Accent"
        value={t.accent}
        options={ACCENTS}
        onChange={(v) => setTweak("accent", v)}
      />
      <Section label="Layout" />
      <Segmented<Tweaks["sidebar"]>
        label="Sidebar"
        value={t.sidebar}
        options={["full", "icons", "hidden"]}
        onChange={(v) => setTweak("sidebar", v)}
      />
      <Select<Tweaks["width"]>
        label="Content width"
        value={t.width}
        options={["narrow", "comfortable", "wide", "full"]}
        onChange={(v) => setTweak("width", v)}
      />
      <Segmented<Tweaks["density"]>
        label="Density"
        value={t.density}
        options={["comfortable", "compact"]}
        onChange={(v) => setTweak("density", v)}
      />
      <Section label="Typography" />
      <Segmented<Tweaks["bodyfont"]>
        label="Body font"
        value={t.bodyfont}
        options={["sans", "serif", "mono"]}
        onChange={(v) => setTweak("bodyfont", v)}
      />
      <SkinSelect />
    </Shell>
  );
}
