// OcrStatus.tsx — a small, persistent indicator while OCR drains in the
// background (item 2, P2). Shows the active document + page progress and how
// many remain queued. Hidden when idle.
import { useStore } from "../store";
import { Icon } from "./Icon";

export function OcrStatus() {
  const active = useStore((s) => s.ocrActive);
  const pending = useStore((s) => s.ocrPending);
  if (!active) return null;
  const queuedBehind = Math.max(0, pending - 1);
  const pageText =
    active.page > 0 ? `page ${active.page}/${active.pages}` : "starting…";
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
        gap: 8,
        maxWidth: 360,
        padding: "8px 12px",
        borderRadius: 8,
        fontSize: 13,
        background: "var(--bg-2, #2a2a2a)",
        color: "var(--tx-1, #eee)",
        border: "1px solid var(--bd, rgba(255,255,255,0.12))",
        boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
      }}
      title="OCR runs offline, in the background"
    >
      <Icon name="clock" size={14} />
      <span
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        OCR “{active.title}” — {pageText}
        {queuedBehind > 0 ? ` · ${queuedBehind} queued` : ""}
      </span>
    </div>
  );
}
