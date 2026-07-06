import { useState, useEffect, useRef, memo } from "react";
import {
  X,
  ArrowLeft,
  ArrowRight,
  RotateCw,
  ExternalLink,
  Globe,
  MousePointerClick,
} from "lucide-react";
import { useI18n } from "../../components/useI18n";

interface WebPreviewPanelProps {
  initialUrl: string;
  onClose: () => void;
  onInspectElement?: (payload: {
    tagName: string;
    id: string;
    className: string;
    outerHTML: string;
  }) => void;
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
  executeJavaScript: (script: string) => Promise<unknown>;
}

// Injected inspector script template
const INSPECTOR_SCRIPT = `
(function() {
  if (window.__hermesCleanupInspector) {
    window.__hermesCleanupInspector();
  }

  const overlay = document.createElement('div');
  overlay.id = '__hermes_inspector_overlay';
  Object.assign(overlay.style, {
    position: 'fixed',
    pointerEvents: 'none',
    zIndex: '999999',
    backgroundColor: 'rgba(59, 130, 246, 0.3)',
    border: '2px solid rgba(59, 130, 246, 0.85)',
    borderRadius: '4px',
    boxSizing: 'border-box',
    transition: 'all 0.05s ease-out',
    display: 'none'
  });

  const label = document.createElement('div');
  label.id = '__hermes_inspector_label';
  Object.assign(label.style, {
    position: 'fixed',
    pointerEvents: 'none',
    zIndex: '1000000',
    backgroundColor: 'rgba(17, 24, 39, 0.95)',
    color: '#ffffff',
    padding: '4px 8px',
    borderRadius: '4px',
    fontSize: '11px',
    fontFamily: 'monospace',
    whiteSpace: 'nowrap',
    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    display: 'none'
  });

  document.body.appendChild(overlay);
  document.body.appendChild(label);

  let hoveredElement = null;

  function onMouseMove(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === overlay || el === label || el === document.body || el === document.documentElement) {
      overlay.style.display = 'none';
      label.style.display = 'none';
      hoveredElement = null;
      return;
    }

    if (hoveredElement !== el) {
      hoveredElement = el;
      const rect = el.getBoundingClientRect();
      
      overlay.style.left = rect.left + 'px';
      overlay.style.top = rect.top + 'px';
      overlay.style.width = rect.width + 'px';
      overlay.style.height = rect.height + 'px';
      overlay.style.display = 'block';

      let labelText = el.tagName.toLowerCase();
      if (el.id) labelText += '#' + el.id;
      
      const classAttr = el.getAttribute('class');
      if (classAttr && typeof classAttr === 'string') {
        const classes = classAttr.split(/\\s+/).filter(c => c && !c.startsWith('__hermes')).join('.');
        if (classes) labelText += '.' + classes;
      }
      
      if (labelText.length > 50) labelText = labelText.substring(0, 47) + '...';
      label.textContent = labelText;
      label.style.display = 'block';

      const labelRect = label.getBoundingClientRect();
      let labelTop = rect.top - labelRect.height - 4;
      if (labelTop < 0) {
        labelTop = rect.bottom + 4;
      }
      let labelLeft = rect.left;
      if (labelLeft + labelRect.width > window.innerWidth) {
        labelLeft = window.innerWidth - labelRect.width - 8;
      }
      label.style.top = labelTop + 'px';
      label.style.left = Math.max(8, labelLeft) + 'px';
    }
  }

  function onClick(e) {
    e.preventDefault();
    e.stopPropagation();

    if (hoveredElement) {
      const payload = {
        tagName: hoveredElement.tagName.toLowerCase(),
        id: hoveredElement.id || '',
        className: hoveredElement.getAttribute('class') || '',
        outerHTML: hoveredElement.outerHTML
      };
      console.log('__HERMES_INSPECT_RESULT__:' + JSON.stringify(payload));
    } else {
      console.log('__HERMES_INSPECT_CANCELLED__');
    }
    cleanup();
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      console.log('__HERMES_INSPECT_CANCELLED__');
      cleanup();
    }
  }

  function cleanup() {
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKeyDown, true);
    
    const currentOverlay = document.getElementById('__hermes_inspector_overlay');
    const currentLabel = document.getElementById('__hermes_inspector_label');
    if (currentOverlay && currentOverlay.parentNode) currentOverlay.parentNode.removeChild(currentOverlay);
    if (currentLabel && currentLabel.parentNode) currentLabel.parentNode.removeChild(currentLabel);
    
    window.__hermesCleanupInspector = null;
  }

  document.addEventListener('mousemove', onMouseMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKeyDown, true);

  window.__hermesCleanupInspector = cleanup;
})();
`;

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
  const isInspectingRef = useRef(isInspecting);
  useEffect(() => {
    isInspectingRef.current = isInspecting;
  }, [isInspecting]);

  // Sync initialUrl prop to internal state when it changes from parent
  useEffect(() => {
    setCurrentUrl(initialUrl);
    setInputUrl(initialUrl);
    if (webviewRef.current) {
      webviewRef.current.src = initialUrl;
    }
  }, [initialUrl]);

  // Inject or clean up the inspector script based on isInspecting state
  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview || !isDomReady) return;

    if (isInspecting) {
      webview.executeJavaScript(INSPECTOR_SCRIPT).catch((err) => {
        console.error("Failed to inject inspector script:", err);
      });
    } else {
      webview
        .executeJavaScript(
          "if (window.__hermesCleanupInspector) window.__hermesCleanupInspector();",
        )
        .catch(() => {});
    }
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
      setIsInspecting(false);
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
      setIsInspecting(false);
      setIsDomReady(false);
    };

    const handleDidNavigateInPage = (e: Event): void => {
      const url = (e as unknown as { url: string }).url;
      setCurrentUrl(url);
      setInputUrl(url);
      updateNavigationState();
      setIsInspecting(false);
      setIsDomReady(false);
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

    const handleConsoleMessage = (e: Event): void => {
      const ev = e as unknown as {
        message: string;
        sourceId: string;
        line: number;
      };
      const message = ev.message || "";
      if (message.startsWith("__HERMES_INSPECT_RESULT__:")) {
        if (!isInspectingRef.current) return;
        const jsonStr = message.slice("__HERMES_INSPECT_RESULT__:".length);
        try {
          const payload = JSON.parse(jsonStr);
          onInspectElement?.(payload);
        } catch (err) {
          console.error("Failed to parse inspect result:", err);
        }
        setIsInspecting(false);
        return;
      }
      if (message === "__HERMES_INSPECT_CANCELLED__") {
        if (!isInspectingRef.current) return;
        setIsInspecting(false);
        return;
      }
      console.log(`[WEBVIEW CONSOLE] ${message} (${ev.sourceId}:${ev.line})`);
    };

    webview.addEventListener("did-start-loading", handleDidStartLoading);
    webview.addEventListener("did-stop-loading", handleDidStopLoading);
    webview.addEventListener("dom-ready", handleDomReady);
    webview.addEventListener("did-navigate", handleDidNavigate);
    webview.addEventListener("did-navigate-in-page", handleDidNavigateInPage);
    webview.addEventListener("did-fail-load", handleDidFailLoad);
    webview.addEventListener("console-message", handleConsoleMessage);

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
      webview.removeEventListener("console-message", handleConsoleMessage);
    };
  }, [onInspectElement]);

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
        <button
          type="button"
          className={`web-preview-btn ${isInspecting ? "web-preview-btn-active" : ""}`}
          onClick={() => setIsInspecting((prev) => !prev)}
          title="Inspect Element"
        >
          <MousePointerClick size={16} />
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
      </div>
    </div>
  );
});
