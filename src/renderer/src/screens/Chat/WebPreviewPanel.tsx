import { useState, useEffect, useRef, memo } from "react";
import {
  X,
  ArrowLeft,
  ArrowRight,
  RotateCw,
  ExternalLink,
  Globe,
  MousePointerClick,
  MessageCircle,
  ArrowUp,
} from "lucide-react";
import { useI18n } from "../../components/useI18n";

interface WebPreviewPanelProps {
  initialUrl: string;
  onClose: () => void;
  onInspectElement?: (payload: { selector: string; comment: string }) => void;
}

interface InspectionRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface InspectionSelection {
  selector: string;
  rect: InspectionRect;
}

const MAX_SELECTOR_LENGTH = 4_096;

function parseInspectionSelection(value: unknown): InspectionSelection | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { selector?: unknown; rect?: unknown };
  if (
    typeof candidate.selector !== "string" ||
    candidate.selector.trim().length === 0 ||
    candidate.selector.length > MAX_SELECTOR_LENGTH ||
    !candidate.rect ||
    typeof candidate.rect !== "object"
  ) {
    return null;
  }
  const rect = candidate.rect as Partial<InspectionRect>;
  const values = [rect.left, rect.top, rect.width, rect.height];
  if (
    !values.every(
      (entry) => typeof entry === "number" && Number.isFinite(entry),
    ) ||
    (rect.width as number) < 0 ||
    (rect.height as number) < 0 ||
    values.some((entry) => Math.abs(entry as number) > 1_000_000)
  ) {
    return null;
  }
  return {
    selector: candidate.selector,
    rect: rect as InspectionRect,
  };
}

function annotationLayout(
  rect: InspectionRect,
  viewportWidth: number,
  viewportHeight: number,
): { left: number; top: number; width: number; markerLeft: number } {
  const width = Math.min(360, Math.max(220, viewportWidth - 24));
  const height = 48;
  let left = rect.left + (rect.width - width) / 2;
  left = Math.max(12, Math.min(left, viewportWidth - width - 12));

  let top =
    rect.height >= 72
      ? rect.top + (rect.height - height) / 2
      : rect.top + rect.height + 8;
  if (top + height > viewportHeight - 8) top = rect.top - height - 8;
  top = Math.max(8, top);

  const markerLeft =
    left + width + 8 <= viewportWidth - 30
      ? left + width + 8
      : Math.max(8, left - 34);
  return { left, top, width, markerLeft };
}

// Resizable panel bounds. Min keeps the toolbar usable; max leaves room for
// the chat column. Width is persisted across sessions.
const MIN_PANEL_WIDTH = 320;
const WIDTH_STORAGE_KEY = "hermes:webPreviewWidth";
const maxPanelWidth = (): number =>
  Math.max(MIN_PANEL_WIDTH, window.innerWidth - 360);

// Custom interface for Electron Webview element
interface ElectronWebviewElement extends HTMLElement {
  src: string;
  canGoBack: () => boolean;
  canGoForward: () => boolean;
  goBack: () => void;
  goForward: () => void;
  reload: () => void;
  stop: () => void;
  getWebContentsId: () => number;
}

export const WebPreviewPanel = memo(function WebPreviewPanel({
  initialUrl,
  onClose,
  onInspectElement,
}: WebPreviewPanelProps): React.JSX.Element {
  const { t } = useI18n();
  const [currentUrl, setCurrentUrl] = useState(initialUrl);
  const [inputUrl, setInputUrl] = useState(initialUrl);
  const [isLoading, setIsLoading] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [isInspecting, setIsInspecting] = useState(false);
  const [isDomReady, setIsDomReady] = useState(false);
  const [annotationSelection, setAnnotationSelection] =
    useState<InspectionSelection | null>(null);
  const [annotationComment, setAnnotationComment] = useState("");

  // Draggable panel width (px). Persisted so it survives reopen/restart.
  const [width, setWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem(WIDTH_STORAGE_KEY));
    return Number.isFinite(saved) && saved >= MIN_PANEL_WIDTH ? saved : 480;
  });
  const [isResizing, setIsResizing] = useState(false);

  const startResize = (e: React.PointerEvent): void => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    let nextWidth = startWidth;
    setIsResizing(true);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    const onMove = (ev: PointerEvent): void => {
      // Panel sits on the right edge, so dragging the handle left widens it.
      const delta = startX - ev.clientX;
      nextWidth = Math.min(
        maxPanelWidth(),
        Math.max(MIN_PANEL_WIDTH, startWidth + delta),
      );
      setWidth(nextWidth);
    };
    const onUp = (): void => {
      setIsResizing(false);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      localStorage.setItem(WIDTH_STORAGE_KEY, String(Math.round(nextWidth)));
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  };

  const webviewRef = useRef<ElectronWebviewElement>(null);
  const webviewContainerRef = useRef<HTMLDivElement>(null);
  const annotationInputRef = useRef<HTMLInputElement>(null);
  const isInspectingRef = useRef(isInspecting);
  const inspectionRequestRef = useRef(0);
  useEffect(() => {
    isInspectingRef.current = isInspecting;
  }, [isInspecting]);

  useEffect(() => {
    if (annotationSelection) annotationInputRef.current?.focus();
  }, [annotationSelection]);

  useEffect(() => {
    if (!isInspecting) {
      setAnnotationSelection(null);
      setAnnotationComment("");
    }
  }, [isInspecting]);

  // Sync initialUrl prop to internal state when it changes from parent
  useEffect(() => {
    setCurrentUrl(initialUrl);
    setInputUrl(initialUrl);
    if (webviewRef.current) {
      webviewRef.current.src = initialUrl;
    }
    setIsInspecting(false);
    setAnnotationSelection(null);
    setAnnotationComment("");
    isInspectingRef.current = false;
    inspectionRequestRef.current += 1;
  }, [initialUrl]);

  // Run picking in a dedicated Electron isolated world. The inspected page can
  // see its own DOM, but cannot spoof the structured result or read comments.
  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview || !isDomReady || !isInspecting) return;

    let webContentsId: number;
    try {
      webContentsId = webview.getWebContentsId();
    } catch (err) {
      console.error("Failed to identify web preview:", err);
      isInspectingRef.current = false;
      setIsInspecting(false);
      return;
    }

    let disposed = false;
    const requestId = ++inspectionRequestRef.current;
    void window.hermesAPI
      .inspectWebPreview(webContentsId)
      .then((value) => {
        if (
          disposed ||
          requestId !== inspectionRequestRef.current ||
          !isInspectingRef.current
        ) {
          return;
        }
        const selection = parseInspectionSelection(value);
        if (!selection) {
          isInspectingRef.current = false;
          setIsInspecting(false);
          setAnnotationSelection(null);
          setAnnotationComment("");
          return;
        }
        setAnnotationSelection(selection);
        setAnnotationComment("");
      })
      .catch((err) => {
        if (disposed || requestId !== inspectionRequestRef.current) return;
        console.error("Failed to inspect web preview:", err);
        isInspectingRef.current = false;
        setIsInspecting(false);
        setAnnotationSelection(null);
        setAnnotationComment("");
      });

    return () => {
      disposed = true;
      inspectionRequestRef.current += 1;
      void window.hermesAPI
        .cancelWebPreviewInspection(webContentsId)
        .catch(() => {});
    };
  }, [isInspecting, isDomReady]);

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return;

    const updateNavigationState = (): void => {
      try {
        setCanGoBack(webview.canGoBack());
        setCanGoForward(webview.canGoForward());
      } catch {
        // webview methods might not be ready yet
      }
    };

    const handleDidStartLoading = (): void => {
      setIsLoading(true);
      isInspectingRef.current = false;
      inspectionRequestRef.current += 1;
      setIsInspecting(false);
      setAnnotationSelection(null);
      setAnnotationComment("");
      setIsDomReady(false);
    };

    const handleDidStopLoading = (): void => {
      setIsLoading(false);
      updateNavigationState();
    };

    const handleDomReady = (): void => {
      setIsDomReady(true);
    };

    // Electron's <webview> dispatches DOM events whose Electron-specific fields
    // (url, errorCode, message…) aren't on the base `Event` type, so read them
    // through a narrow cast rather than `any`.
    const handleDidNavigate = (e: Event): void => {
      const url = (e as unknown as { url: string }).url;
      setCurrentUrl(url);
      setInputUrl(url);
      updateNavigationState();
      isInspectingRef.current = false;
      inspectionRequestRef.current += 1;
      setIsInspecting(false);
      setAnnotationSelection(null);
      setAnnotationComment("");
      setIsDomReady(false);
    };

    const handleDidNavigateInPage = (e: Event): void => {
      const url = (e as unknown as { url: string }).url;
      setCurrentUrl(url);
      setInputUrl(url);
      updateNavigationState();
      isInspectingRef.current = false;
      inspectionRequestRef.current += 1;
      setIsInspecting(false);
      setAnnotationSelection(null);
      setAnnotationComment("");
      // Same-document navigation (history.pushState/replaceState or a hash
      // change) keeps the current DOM alive and does not emit another
      // `dom-ready`. Marking it unready here permanently disabled inspector
      // injection on hydrating SPAs such as Next.js localhost dev servers.
    };

    const handleDidFailLoad = (e: Event): void => {
      const { validatedURL, errorCode, errorDescription } = e as unknown as {
        validatedURL: string;
        errorCode: number;
        errorDescription: string;
      };
      console.error(
        `[WEBVIEW ERROR] Failed to load: ${validatedURL}, Code: ${errorCode}, Description: ${errorDescription}`,
      );
    };

    webview.addEventListener("did-start-loading", handleDidStartLoading);
    webview.addEventListener("did-stop-loading", handleDidStopLoading);
    webview.addEventListener("dom-ready", handleDomReady);
    webview.addEventListener("did-navigate", handleDidNavigate);
    webview.addEventListener("did-navigate-in-page", handleDidNavigateInPage);
    webview.addEventListener("did-fail-load", handleDidFailLoad);

    return () => {
      webview.removeEventListener("did-start-loading", handleDidStartLoading);
      webview.removeEventListener("did-stop-loading", handleDidStopLoading);
      webview.removeEventListener("dom-ready", handleDomReady);
      webview.removeEventListener("did-navigate", handleDidNavigate);
      webview.removeEventListener(
        "did-navigate-in-page",
        handleDidNavigateInPage,
      );
      webview.removeEventListener("did-fail-load", handleDidFailLoad);
    };
  }, []);

  const handleBack = (): void => {
    if (webviewRef.current && canGoBack) {
      webviewRef.current.goBack();
    }
  };

  const handleForward = (): void => {
    if (webviewRef.current && canGoForward) {
      webviewRef.current.goForward();
    }
  };

  const handleReload = (): void => {
    if (webviewRef.current) {
      webviewRef.current.reload();
    }
  };

  const handleOpenExternal = (): void => {
    window.hermesAPI.openExternal(currentUrl);
  };

  const handleAddressSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    let targetUrl = inputUrl.trim();
    if (!targetUrl) return;

    // Auto-prepend https:// if missing schema, unless it is localhost/127.0.0.1 HTTP
    const isLocalhost =
      targetUrl.startsWith("localhost") ||
      targetUrl.startsWith("127.0.0.1") ||
      targetUrl.startsWith("http://localhost") ||
      targetUrl.startsWith("http://127.0.0.1");

    if (!/^https?:\/\//i.test(targetUrl)) {
      targetUrl = isLocalhost ? `http://${targetUrl}` : `https://${targetUrl}`;
    }

    setInputUrl(targetUrl);
    setCurrentUrl(targetUrl);
    if (webviewRef.current) {
      webviewRef.current.src = targetUrl;
    }
  };

  const cancelAnnotation = (): void => {
    isInspectingRef.current = false;
    inspectionRequestRef.current += 1;
    setIsInspecting(false);
    setAnnotationSelection(null);
    setAnnotationComment("");
  };

  const toggleAnnotation = (): void => {
    if (isInspecting) {
      cancelAnnotation();
      return;
    }
    inspectionRequestRef.current += 1;
    isInspectingRef.current = true;
    setAnnotationSelection(null);
    setAnnotationComment("");
    setIsInspecting(true);
  };

  const submitAnnotation = (e: React.FormEvent): void => {
    e.preventDefault();
    const comment = annotationComment.trim();
    if (!annotationSelection || !comment) return;
    onInspectElement?.({ selector: annotationSelection.selector, comment });
    cancelAnnotation();
  };

  const annotationPosition = annotationSelection
    ? annotationLayout(
        annotationSelection.rect,
        webviewContainerRef.current?.clientWidth ?? width,
        webviewContainerRef.current?.clientHeight ?? window.innerHeight,
      )
    : null;

  return (
    <div className="web-preview-panel" style={{ width }}>
      <div
        className={`web-preview-resize-handle ${
          isResizing ? "web-preview-resize-handle-active" : ""
        }`}
        onPointerDown={startResize}
        title="Drag to resize"
      />
      <div className="web-preview-header">
        <button
          type="button"
          className="web-preview-btn"
          onClick={handleBack}
          disabled={!canGoBack}
          title={t("common.back") || "Back"}
        >
          <ArrowLeft size={16} />
        </button>
        <button
          type="button"
          className="web-preview-btn"
          onClick={handleForward}
          disabled={!canGoForward}
          title={t("common.forward") || "Forward"}
        >
          <ArrowRight size={16} />
        </button>
        <button
          type="button"
          className="web-preview-btn"
          onClick={handleReload}
          title={t("common.reload") || "Reload"}
        >
          <RotateCw size={16} className={isLoading ? "animate-spin" : ""} />
        </button>
        <form
          className="web-preview-address-bar"
          onSubmit={handleAddressSubmit}
        >
          <Globe size={13} className="web-preview-globe-icon" />
          <input
            type="text"
            className="web-preview-address-input"
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            placeholder="Search or enter web address..."
          />
        </form>

        <div className="web-preview-actions">
          <button
            type="button"
            className={`web-preview-btn web-preview-annotate-btn ${isInspecting ? "web-preview-btn-active" : ""}`}
            onClick={toggleAnnotation}
            title={isInspecting ? "Stop annotating" : "Annotate page"}
            aria-pressed={isInspecting}
          >
            <MousePointerClick size={16} />
            {isInspecting && (
              <span className="web-preview-annotate-label">Annotating</span>
            )}
          </button>
          <button
            type="button"
            className="web-preview-btn"
            onClick={handleOpenExternal}
            title={t("worktree.open") || "Open in system browser"}
          >
            <ExternalLink size={15} />
          </button>
          <button
            type="button"
            className="web-preview-btn"
            onClick={onClose}
            title={t("worktree.closeFile") || "Close"}
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <div
        ref={webviewContainerRef}
        className="web-preview-webview-container"
        style={{ pointerEvents: isResizing ? "none" : "auto" }}
      >
        <webview
          ref={webviewRef as React.RefObject<ElectronWebviewElement>}
          src={currentUrl}
          {...({
            // `partition` is a real Electron <webview> attribute (unlike `name`),
            // so it is forwarded into the `will-attach-webview` params. The main
            // process uses it to identify this webview as the web preview and
            // permit remote HTTPS. It also isolates the preview's session.
            partition: "web-preview",
          } as Record<string, unknown>)}
          style={{ width: "100%", height: "100%" }}
        />
        {annotationSelection && annotationPosition && (
          <>
            <div
              className="web-preview-annotation-outline"
              style={{
                left: annotationSelection.rect.left,
                top: annotationSelection.rect.top,
                width: annotationSelection.rect.width,
                height: annotationSelection.rect.height,
              }}
              aria-hidden="true"
            />
            <div className="web-preview-annotation-shield" aria-hidden="true" />
            <form
              className="web-preview-annotation-composer"
              style={{
                left: annotationPosition.left,
                top: annotationPosition.top,
                width: annotationPosition.width,
              }}
              onSubmit={submitAnnotation}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  cancelAnnotation();
                }
              }}
              aria-label={`Comment on ${annotationSelection.selector}`}
            >
              <MessageCircle
                className="web-preview-annotation-icon"
                size={16}
                aria-hidden="true"
              />
              <input
                ref={annotationInputRef}
                className="web-preview-annotation-input"
                value={annotationComment}
                onChange={(e) => setAnnotationComment(e.target.value)}
                placeholder="Add a comment…"
                aria-label="Annotation comment"
                maxLength={2_000}
              />
              <button
                type="button"
                className="web-preview-annotation-cancel"
                onClick={cancelAnnotation}
                title="Cancel annotation"
                aria-label="Cancel annotation"
              >
                <X size={14} />
              </button>
              <button
                type="submit"
                className="web-preview-annotation-submit"
                disabled={!annotationComment.trim()}
                title="Add annotation to chat"
                aria-label="Add annotation to chat"
              >
                <ArrowUp size={15} />
              </button>
            </form>
            <span
              className="web-preview-annotation-marker"
              style={{
                left: annotationPosition.markerLeft,
                top: annotationPosition.top + 9,
              }}
              aria-hidden="true"
            >
              <MessageCircle size={15} />
            </span>
          </>
        )}
      </div>
    </div>
  );
});
