// TweaksPanel.tsx — real settings panel. Keeps the prototype's glass .twk-* visual
// (tweaks-panel.jsx) but drops the omelette host postMessage protocol: values read
// and write the Zustand tweaks slice (persisted) instead of the EDITMODE block.
import {
  useRef,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { useStore } from "../store";
import { SECTION_ORDER, type SectionId } from "../store/storeTypes";
import { ACCENTS, type Tweaks, setSkinVars } from "../lib/theme";
import { skinToSpsVars } from "../lib/skin";
import { getActiveSkinId, setActiveSkinId } from "../../../utils/skin";
import { getStorageMode, type StorageMode } from "../lib/storageMode";
import { toggleStorageMode, getLastBackup } from "../lib/storageActions";
import { workspaceParity, type ParityReport } from "../editor/workspaceVault";
import type { Workspace } from "../types";
import type { LoadedSkin } from "../../../../../shared/skins";

function Section({ label }: { label: string }) {
  return <div className="twk-sect">{label}</div>;
}

const SECTION_LABELS: Record<SectionId, string> = {
  meetings: "Meetings",
  recents: "Recents",
  agents: "Agents",
  shared: "Shared",
  private: "Private",
  apps: "Notion apps",
};

/** Toggle individual sidebar sections on/off (Notion 3.1 "customize sidebar"). */
function SidebarSections() {
  const enabled = useStore((s) => s.sectionsEnabled);
  const setSectionEnabled = useStore((s) => s.setSectionEnabled);
  return (
    <>
      <Section label="Sidebar sections" />
      {SECTION_ORDER.map((id) => (
        <Toggle
          key={id}
          label={SECTION_LABELS[id]}
          value={enabled[id]}
          onChange={(v) => setSectionEnabled(id, v)}
        />
      ))}
    </>
  );
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
  labels,
  onChange,
}: {
  label: string;
  value: T;
  options: T[];
  labels?: Record<T, string>;
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
            {labels && labels[o] ? labels[o] : o}
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

// Storage settings (F5): a discoverable home for the markdown-vault cutover —
// current mode, a parity readout, the migrate/rollback control (shared with the
// command palette via lib/storageActions), and the last JSON-blob backup path.
function StorageSettings() {
  const tree = useStore((s) => s.tree);
  const flash = useStore((s) => s.flash);
  const [mode, setMode] = useState<StorageMode>(() => getStorageMode());
  const [parity, setParity] = useState<ParityReport | null>(null);
  const [backup, setBackup] = useState<string | null>(() => getLastBackup());
  const [busy, setBusy] = useState(false);
  const [vault, setVault] = useState<{
    dir: string;
    isDefault: boolean;
    default: string;
  } | null>(null);

  useEffect(() => {
    window.hermesAPI
      .spsGetVaultLocation?.()
      .then(setVault)
      .catch(() => {});
  }, []);

  const chooseVault = async (): Promise<void> => {
    const dir = await window.hermesAPI.spsPickVaultDir?.();
    if (!dir) return;
    const res = await window.hermesAPI.spsSetVaultLocation?.(dir);
    if (res?.ok && res.location) {
      setVault(res.location);
      flash(
        res.nonEmpty
          ? "Vault repointed — existing files in that folder are now indexed."
          : "Vault location updated.",
      );
    } else if (res?.error) {
      flash(res.error);
    }
  };

  const resetVault = async (): Promise<void> => {
    const loc = await window.hermesAPI.spsResetVaultLocation?.();
    if (loc) {
      setVault(loc);
      flash("Vault location reset to default.");
    }
  };

  const snapshot = (): Workspace => {
    const s = useStore.getState();
    return {
      tree: s.tree,
      meta: s.meta,
      docs: s.docs,
      comments: s.comments,
      trash: s.trash,
      page: s.page,
    };
  };

  const refreshParity = useCallback(() => {
    setParity(workspaceParity(snapshot()));
  }, []);

  // Recompute when the panel mounts and whenever the page tree changes.
  useEffect(() => {
    refreshParity();
  }, [refreshParity, tree]);

  const onToggle = async (): Promise<void> => {
    setBusy(true);
    const res = await toggleStorageMode(snapshot());
    setMode(res.mode);
    setBackup(getLastBackup());
    flash(res.message);
    refreshParity();
    setBusy(false);
  };

  const parityText = !parity
    ? "—"
    : parity.ok
      ? `Ready · ${parity.pages.length} page${parity.pages.length === 1 ? "" : "s"}`
      : `${parity.pages.filter((p) => !p.contentOk || !p.metaOk).length} page(s) differ`;

  return (
    <>
      <Section label="Storage" />
      <div className="twk-row twk-row-h">
        <span className="twk-lbl" style={{ flex: 1 }}>
          <span>Mode</span>
        </span>
        <span>{mode === "vault" ? "Markdown vault" : "JSON blob"}</span>
      </div>
      <div className="twk-row twk-row-h">
        <span className="twk-lbl" style={{ flex: 1 }}>
          <span>Parity</span>
        </span>
        <span>{parityText}</span>
      </div>
      <button
        className="twk-field"
        style={{ cursor: busy ? "default" : "pointer" }}
        disabled={busy}
        onClick={() => void onToggle()}
      >
        {mode === "blob"
          ? "Switch to markdown storage"
          : "Switch to JSON storage"}
      </button>
      {backup && (
        <div className="twk-row">
          <span className="twk-lbl">
            <span>Last backup</span>
          </span>
          <span
            style={{
              fontSize: 10.5,
              opacity: 0.7,
              wordBreak: "break-all",
              fontFamily: "var(--font-mono)",
            }}
          >
            {backup}
          </span>
        </div>
      )}
      {vault && (
        <>
          <div className="twk-row">
            <span className="twk-lbl">
              <span>Vault location</span>
            </span>
            <span
              style={{
                fontSize: 10.5,
                opacity: 0.7,
                wordBreak: "break-all",
                fontFamily: "var(--font-mono)",
              }}
            >
              {vault.dir}
              {vault.isDefault ? "  (default)" : ""}
            </span>
          </div>
          <button
            className="twk-field"
            style={{ cursor: "pointer" }}
            onClick={() => void chooseVault()}
          >
            Point at an Obsidian vault folder…
          </button>
          {!vault.isDefault && (
            <button
              className="twk-field"
              style={{ cursor: "pointer" }}
              onClick={() => void resetVault()}
            >
              Reset to default location
            </button>
          )}
        </>
      )}
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
    <div ref={ref} className="twk-panel">
      <div className="twk-hd" onMouseDown={onDragStart}>
        <b>Tweaks</b>
        <button
          className="twk-x"
          aria-label="Close tweaks"
          // Stop the header's drag handler from claiming this press — otherwise
          // a pixel of jitter moves the panel and the click misses the button.
          onMouseDown={(e) => e.stopPropagation()}
          onClick={onClose}
        >
          ✕
        </button>
      </div>
      <div className="twk-body">{children}</div>
    </div>
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
      {t.dark && (
        <Segmented<Tweaks["darkSkin"]>
          label="Dark palette"
          value={t.darkSkin}
          options={["black", "warm", "terminal"]}
          onChange={(v) => setTweak("darkSkin", v)}
        />
      )}
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
      <Select<Tweaks["homeSurface"]>
        label="Home page"
        value={t.homeSurface ?? "doc"}
        options={["doc", "cockpit", "chats", "inbox"]}
        labels={{
          doc: "Document Editor",
          cockpit: "Cockpit Dashboard",
          chats: "AI Chats",
          inbox: "Inbox Review",
        }}
        onChange={(v) => setTweak("homeSurface", v)}
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
      <SidebarSections />
      <StorageSettings />
    </Shell>
  );
}
