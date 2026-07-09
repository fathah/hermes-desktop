// LiveNotePanel.tsx — configure / run a Live Note for the current page.
import { useCallback, useEffect, useState } from "react";
import type {
  LiveNoteItem,
  LiveNoteTriggers,
} from "../../../../../shared/liveNotes";
import { LIVE_NOTE_KIND } from "../../../../../shared/liveNotes";
import { Icon } from "../components/Icon";
import { useStore } from "../store";

type Props = {
  open: boolean;
  onClose: () => void;
  pageId: string;
  profile?: string;
};

export function LiveNotePanel({ open, onClose, pageId, profile }: Props) {
  const setPMeta = useStore((s) => s.setPMeta);
  const [item, setItem] = useState<LiveNoteItem | null>(null);
  const [objective, setObjective] = useState("");
  const [cronExpr, setCronExpr] = useState("");
  const [windowStart, setWindowStart] = useState("09:00");
  const [windowEnd, setWindowEnd] = useState("12:00");
  const [useWindow, setUseWindow] = useState(false);
  const [keywords, setKeywords] = useState("");
  const [fromIncludes, setFromIncludes] = useState("");
  const [autoApply, setAutoApply] = useState(true);
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const api = window.hermesAPI;
    if (!api?.spsLiveNoteGet) return;
    const current = await api.spsLiveNoteGet(pageId, profile);
    setItem(current);
    if (current) {
      setObjective(current.objective);
      setCronExpr(current.triggers.cronExpr ?? "");
      const w = current.triggers.windows?.[0];
      setUseWindow(!!w);
      if (w) {
        setWindowStart(w.startTime);
        setWindowEnd(w.endTime);
      }
      setKeywords((current.triggers.eventMatch?.keywords ?? []).join(", "));
      setFromIncludes(
        (current.triggers.eventMatch?.fromIncludes ?? []).join(", "),
      );
      setAutoApply(current.autoApply);
      setActive(current.active);
    } else {
      setObjective("");
      setCronExpr("");
      setUseWindow(false);
      setKeywords("");
      setFromIncludes("");
      setAutoApply(true);
      setActive(true);
    }
  }, [pageId, profile]);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const api = window.hermesAPI;
    if (!api?.onLiveNoteRunStatus) return;
    return api.onLiveNoteRunStatus((payload) => {
      const p = payload as {
        pageId?: string;
        summary?: string;
        error?: string;
        action?: string;
      };
      if (p.pageId !== pageId) return;
      if (p.error) setError(p.error);
      else setStatus(p.summary ?? p.action ?? "done");
      void load();
    });
  }, [open, pageId, load]);

  function buildTriggers(): LiveNoteTriggers {
    const triggers: LiveNoteTriggers = {};
    const cron = cronExpr.trim();
    if (cron) triggers.cronExpr = cron;
    if (useWindow) {
      triggers.windows = [{ startTime: windowStart, endTime: windowEnd }];
    }
    const kw = keywords
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const from = fromIncludes
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (kw.length || from.length) {
      triggers.eventMatch = {
        ...(kw.length ? { keywords: kw } : {}),
        ...(from.length ? { fromIncludes: from } : {}),
      };
    }
    return triggers;
  }

  async function save(): Promise<boolean> {
    const api = window.hermesAPI;
    if (!api?.spsLiveNoteUpsert) {
      setError("Live notes API unavailable.");
      return false;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.spsLiveNoteUpsert(
        {
          pageId,
          objective,
          active,
          autoApply,
          triggers: buildTriggers(),
        },
        profile,
      );
      if (!res.ok) {
        setError(res.error ?? "Save failed.");
        return false;
      }
      setItem(res.item ?? null);
      // Blob-correct marker: kind on the page via store.
      setPMeta({
        properties: {
          ...(useStore.getState().meta[pageId]?.properties ?? {}),
          kind: LIVE_NOTE_KIND,
        },
      });
      setStatus("Saved.");
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function runNow() {
    const api = window.hermesAPI;
    if (!api?.spsLiveNoteRun) return;
    const ok = item ? true : await save();
    if (!ok && !item) return;
    setBusy(true);
    setError(null);
    setStatus("Running…");
    try {
      if (!item) {
        // save just created it
      }
      const res = await api.spsLiveNoteRun(pageId, profile);
      if (!res.ok) setError(res.error ?? "Run failed.");
      else setStatus(res.summary ?? res.action ?? "done");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function makePassive() {
    const api = window.hermesAPI;
    if (!api?.spsLiveNoteDelete) return;
    setBusy(true);
    try {
      await api.spsLiveNoteDelete(pageId, profile);
      setItem(null);
      setStatus("Made passive.");
      const props = {
        ...(useStore.getState().meta[pageId]?.properties ?? {}),
      };
      delete props.kind;
      setPMeta({ properties: props });
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="live-note-panel"
      role="dialog"
      aria-label="Live note"
      style={{
        position: "fixed",
        top: 56,
        right: 16,
        width: 360,
        maxHeight: "calc(100vh - 80px)",
        overflow: "auto",
        zIndex: 40,
        background: "var(--bg, #fff)",
        border: "1px solid var(--border, #ddd)",
        borderRadius: 10,
        padding: 14,
        boxShadow: "0 8px 28px rgba(0,0,0,0.12)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 10,
        }}
      >
        <strong style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <Icon name="sparkle" size={15} /> Live note
        </strong>
        <button type="button" className="cover-btn" onClick={onClose}>
          <Icon name="x" size={14} />
        </button>
      </div>

      <label style={{ display: "block", fontSize: 12, marginBottom: 4 }}>
        Objective
      </label>
      <textarea
        value={objective}
        onChange={(e) => setObjective(e.target.value)}
        rows={4}
        style={{ width: "100%", marginBottom: 10, resize: "vertical" }}
        placeholder="Keep this page current: open issues, coverage, client asks…"
      />

      <label style={{ display: "block", fontSize: 12, marginBottom: 4 }}>
        Cron (optional, 5 fields)
      </label>
      <input
        value={cronExpr}
        onChange={(e) => setCronExpr(e.target.value)}
        placeholder="0 7 * * *"
        style={{ width: "100%", marginBottom: 10 }}
      />

      <label
        style={{
          display: "flex",
          gap: 6,
          alignItems: "center",
          fontSize: 12,
          marginBottom: 6,
        }}
      >
        <input
          type="checkbox"
          checked={useWindow}
          onChange={(e) => setUseWindow(e.target.checked)}
        />
        Daily window
      </label>
      {useWindow && (
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <input
            value={windowStart}
            onChange={(e) => setWindowStart(e.target.value)}
            style={{ flex: 1 }}
          />
          <input
            value={windowEnd}
            onChange={(e) => setWindowEnd(e.target.value)}
            style={{ flex: 1 }}
          />
        </div>
      )}

      <label style={{ display: "block", fontSize: 12, marginBottom: 4 }}>
        Email keywords (comma-separated)
      </label>
      <input
        value={keywords}
        onChange={(e) => setKeywords(e.target.value)}
        placeholder="linking, gate 2"
        style={{ width: "100%", marginBottom: 10 }}
      />

      <label style={{ display: "block", fontSize: 12, marginBottom: 4 }}>
        Email from includes (comma-separated)
      </label>
      <input
        value={fromIncludes}
        onChange={(e) => setFromIncludes(e.target.value)}
        placeholder="client.com"
        style={{ width: "100%", marginBottom: 10 }}
      />

      <label
        style={{
          display: "flex",
          gap: 6,
          alignItems: "center",
          fontSize: 12,
          marginBottom: 6,
        }}
      >
        <input
          type="checkbox"
          checked={autoApply}
          onChange={(e) => setAutoApply(e.target.checked)}
        />
        Auto-apply updates
      </label>
      <label
        style={{
          display: "flex",
          gap: 6,
          alignItems: "center",
          fontSize: 12,
          marginBottom: 12,
        }}
      >
        <input
          type="checkbox"
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
        />
        Active
      </label>

      {item?.lastRunSummary && (
        <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 8 }}>
          Last: {item.lastRunSummary}
          {item.lastRunAt
            ? ` · ${new Date(item.lastRunAt).toLocaleString()}`
            : ""}
        </div>
      )}
      {item?.lastRunError && (
        <div style={{ fontSize: 12, color: "#b00020", marginBottom: 8 }}>
          Error: {item.lastRunError}
        </div>
      )}
      {status && (
        <div style={{ fontSize: 12, marginBottom: 8, opacity: 0.85 }}>
          {status}
        </div>
      )}
      {error && (
        <div style={{ fontSize: 12, color: "#b00020", marginBottom: 8 }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button
          type="button"
          className="gs-chip"
          disabled={busy}
          onClick={() => void save()}
        >
          Save
        </button>
        <button
          type="button"
          className="gs-chip"
          disabled={busy || !objective.trim()}
          onClick={() => void runNow()}
        >
          <Icon name="play" size={13} /> Update now
        </button>
        {item && (
          <button
            type="button"
            className="gs-chip"
            disabled={busy}
            onClick={() => void makePassive()}
          >
            Make passive
          </button>
        )}
      </div>
    </div>
  );
}
