// OcrStatus.tsx — persistent OCR indicator + controls (item 2, P2/P3). Shows
// active page progress while draining, or a "N queued" state with Run-now when
// jobs are deferred to the overnight window. An "Overnight" toggle defers future
// (and pending) OCR to the configured time. Hidden when idle with nothing queued.
import { useStore } from "../store";
import { getOcrTime } from "../lib/ocrSchedule";
import { Icon } from "./Icon";

export function OcrStatus() {
  const active = useStore((s) => s.ocrActive);
  const pending = useStore((s) => s.ocrPending);
  const defer = useStore((s) => s.ocrDefer);
  const runNow = useStore((s) => s.ocrRunNow);
  const setDefer = useStore((s) => s.ocrSetDefer);
  if (!active && pending === 0) return null;

  const queuedBehind = Math.max(0, pending - (active ? 1 : 0));
  let status: string;
  if (active) {
    const pg =
      active.page > 0 ? `page ${active.page}/${active.pages}` : "starting…";
    status = `OCR “${active.title}” — ${pg}${queuedBehind > 0 ? ` · ${queuedBehind} queued` : ""}`;
  } else if (defer) {
    status = `${pending} scan${pending > 1 ? "s" : ""} queued for OCR tonight (${getOcrTime()})`;
  } else {
    status = `${pending} scan${pending > 1 ? "s" : ""} queued for OCR`;
  }

  return (
    <div
      className="ocr-status"
      style={{
        position: "fixed",
        left: 16,
        bottom: 16,
        zIndex: 60,
        display: "flex",
        alignItems: "center",
        gap: 10,
        maxWidth: 420,
        padding: "8px 12px",
        borderRadius: 8,
        fontSize: 13,
        background: "var(--bg-2, #2a2a2a)",
        color: "var(--tx-1, #eee)",
        border: "1px solid var(--bd, rgba(255,255,255,0.12))",
        boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
      }}
      title="OCR runs offline, in the background. Scheduled runs only fire while the app is open."
    >
      <Icon name="clock" size={14} />
      <span
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {status}
      </span>
      {!active && pending > 0 && (
        <button
          type="button"
          onClick={() => runNow()}
          style={{
            border: "none",
            background: "var(--accent, #4a7)",
            color: "#fff",
            borderRadius: 6,
            padding: "3px 9px",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          Run now
        </button>
      )}
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          cursor: "pointer",
          opacity: 0.85,
        }}
        title="Defer OCR to the overnight window instead of running now"
      >
        <input
          type="checkbox"
          checked={defer}
          onChange={(e) => setDefer(e.target.checked)}
        />
        Overnight
      </label>
    </div>
  );
}
