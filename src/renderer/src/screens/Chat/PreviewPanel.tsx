import { memo } from "react";
import { PanelRight, X } from "lucide-react";
import { useI18n } from "../../components/useI18n";
import type { PreviewItem } from "./previewSelect";

interface PreviewPanelProps {
  item: PreviewItem;
  /** Live tool-progress string while a turn streams (e.g. "browser …"). */
  toolProgress: string | null;
  onClose: () => void;
}

/**
 * Side-by-side preview pane (WS2). Surfaces the most recent visual tool output
 * — a captured screenshot (image) or an agent-generated HTML document — next
 * to the conversation instead of buried in an inline tool-result row.
 *
 * Security: the image is the data: URL the agent already captured; the HTML is
 * rendered in a fully-sandboxed iframe (`sandbox=""` → no scripts, no
 * same-origin, no top-navigation). We never live-load a remote URL here, so
 * the main-process SSRF/webview hardening is untouched. Mirrors the
 * WorktreePanel layout so it slots into `.chat-body` the same way.
 */
export const PreviewPanel = memo(function PreviewPanel({
  item,
  toolProgress,
  onClose,
}: PreviewPanelProps): React.JSX.Element {
  const { t } = useI18n();

  return (
    <div className="preview-panel">
      <div className="preview-header">
        <PanelRight size={16} className="preview-header-icon" />
        <span className="preview-header-title" title={item.toolName}>
          {item.toolName}
        </span>
        <button
          className="btn-ghost preview-close"
          onClick={onClose}
          title={t("chat.hidePreview")}
        >
          <X size={14} />
        </button>
      </div>
      {toolProgress && (
        <div className="preview-progress" title={toolProgress}>
          {toolProgress}
        </div>
      )}
      <div className="preview-content">
        {item.mode === "image" ? (
          <img className="preview-image" src={item.src} alt={item.alt} />
        ) : (
          <iframe
            className="preview-frame"
            title={item.toolName}
            sandbox=""
            srcDoc={item.html}
          />
        )}
      </div>
    </div>
  );
});
