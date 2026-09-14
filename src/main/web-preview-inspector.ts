import {
  session,
  webContents,
  type BrowserWindow,
  type IpcMainInvokeEvent,
  type WebContents,
} from "electron";

const INSPECTOR_WORLD_ID = 1_001;
const MAX_SELECTOR_LENGTH = 4_096;

export interface WebPreviewInspectionSelection {
  selector: string;
  rect: { left: number; top: number; width: number; height: number };
}

export const WEB_PREVIEW_INSPECTOR_SOURCE = String.raw`
new Promise(function(resolve) {
  if (typeof globalThis.__hermesWebPreviewInspectorCleanup === 'function') {
    globalThis.__hermesWebPreviewInspectorCleanup();
  }

  let settled = false;
  const overlay = document.createElement('div');
  const label = document.createElement('div');
  let hoveredElement = null;

  Object.assign(overlay.style, {
    position: 'fixed',
    pointerEvents: 'none',
    zIndex: '2147483646',
    backgroundColor: 'rgba(59, 130, 246, 0.3)',
    border: '2px solid rgba(59, 130, 246, 0.9)',
    borderRadius: '4px',
    boxSizing: 'border-box',
    transition: 'all 0.05s ease-out',
    display: 'none'
  });

  Object.assign(label.style, {
    position: 'fixed',
    pointerEvents: 'none',
    zIndex: '2147483647',
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

  (document.body || document.documentElement).appendChild(overlay);
  (document.body || document.documentElement).appendChild(label);

  function finish(value) {
    if (settled) return;
    settled = true;
    resolve(value);
  }

  function escapeCssIdentifier(value) {
    if (globalThis.CSS && typeof globalThis.CSS.escape === 'function') {
      return globalThis.CSS.escape(value);
    }
    return value.replace(/[^a-zA-Z0-9_-]/g, function(char) {
      return '\\' + char.codePointAt(0).toString(16) + ' ';
    });
  }

  function uniqueSelector(element) {
    if (element.id) {
      const idSelector = '#' + escapeCssIdentifier(element.id);
      if (idSelector.length <= 4096 && document.querySelectorAll(idSelector).length === 1) {
        return idSelector;
      }
    }

    const segments = [];
    let current = element;
    let depth = 0;
    while (current && current.nodeType === Node.ELEMENT_NODE && depth < 128) {
      const tagName = current.tagName.toLowerCase();
      let segment = tagName.length <= 64 ? tagName : '*';
      const classes = Array.from(current.classList || [])
        .filter(function(className) {
          return className && className.length <= 64 && !className.startsWith('__hermes');
        })
        .slice(0, 3)
        .map(escapeCssIdentifier);
      if (classes.length) segment += '.' + classes.join('.');

      const parent = current.parentElement;
      if (parent) {
        if (segment.startsWith('*')) {
          segment += ':nth-child(' + (Array.from(parent.children).indexOf(current) + 1) + ')';
        } else {
          const sameTagSiblings = Array.from(parent.children).filter(function(sibling) {
            return sibling.tagName === current.tagName;
          });
          if (sameTagSiblings.length > 1) {
            segment += ':nth-of-type(' + (sameTagSiblings.indexOf(current) + 1) + ')';
          }
        }
      }

      segments.unshift(segment);
      const candidate = segments.join(' > ');
      if (candidate.length > 4096) return null;
      if (document.querySelectorAll(candidate).length === 1) return candidate;
      current = parent;
      depth += 1;
    }
    return null;
  }

  function updateOverlay(element) {
    const rect = element.getBoundingClientRect();
    overlay.style.left = rect.left + 'px';
    overlay.style.top = rect.top + 'px';
    overlay.style.width = rect.width + 'px';
    overlay.style.height = rect.height + 'px';
    overlay.style.display = 'block';
    return rect;
  }

  function blockPointerEvent(event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  function elementAtPoint(x, y) {
    const element = document.elementFromPoint(x, y);
    if (!element || !element.isConnected || element === overlay || element === label || element === document.body || element === document.documentElement) {
      return null;
    }
    return element;
  }

  function onMouseMove(event) {
    if (!event.isTrusted) return;
    const element = elementAtPoint(event.clientX, event.clientY);
    if (!element) {
      overlay.style.display = 'none';
      label.style.display = 'none';
      hoveredElement = null;
      return;
    }

    if (hoveredElement !== element) {
      hoveredElement = element;
      const rect = updateOverlay(element);
      let labelText = uniqueSelector(element) || element.tagName.toLowerCase();
      if (labelText.length > 50) labelText = labelText.slice(0, 47) + '...';
      label.textContent = labelText;
      label.style.display = 'block';

      const labelRect = label.getBoundingClientRect();
      let labelTop = rect.top - labelRect.height - 4;
      if (labelTop < 0) labelTop = rect.bottom + 4;
      let labelLeft = rect.left;
      if (labelLeft + labelRect.width > window.innerWidth) {
        labelLeft = window.innerWidth - labelRect.width - 8;
      }
      label.style.top = labelTop + 'px';
      label.style.left = Math.max(8, labelLeft) + 'px';
    }
  }

  function cleanup() {
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('pointerdown', blockPointerEvent, true);
    document.removeEventListener('pointerup', blockPointerEvent, true);
    document.removeEventListener('mousedown', blockPointerEvent, true);
    document.removeEventListener('mouseup', blockPointerEvent, true);
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    if (label.parentNode) label.parentNode.removeChild(label);
    if (globalThis.__hermesWebPreviewInspectorCleanup === cleanup) {
      delete globalThis.__hermesWebPreviewInspectorCleanup;
    }
    finish(null);
  }

  function onClick(event) {
    if (!event.isTrusted) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    const selectedElement = elementAtPoint(event.clientX, event.clientY);
    if (!selectedElement) {
      cleanup();
      return;
    }

    const selector = uniqueSelector(selectedElement);
    if (!selector) {
      cleanup();
      return;
    }
    const rect = selectedElement.getBoundingClientRect();
    finish({
      selector: selector,
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
    });
    cleanup();
  }

  function onKeyDown(event) {
    if (event.isTrusted && event.key === 'Escape') cleanup();
  }

  document.addEventListener('mousemove', onMouseMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('pointerdown', blockPointerEvent, true);
  document.addEventListener('pointerup', blockPointerEvent, true);
  document.addEventListener('mousedown', blockPointerEvent, true);
  document.addEventListener('mouseup', blockPointerEvent, true);
  globalThis.__hermesWebPreviewInspectorCleanup = cleanup;
})
`;

const WEB_PREVIEW_INSPECTOR_CANCEL_SOURCE = `
if (typeof globalThis.__hermesWebPreviewInspectorCleanup === "function") {
  globalThis.__hermesWebPreviewInspectorCleanup();
}
`;

function normalizeSelection(
  value: unknown,
): WebPreviewInspectionSelection | null {
  if (value === null) return null;
  if (!value || typeof value !== "object") {
    throw new Error("Invalid web preview inspection result");
  }
  const candidate = value as { selector?: unknown; rect?: unknown };
  if (
    typeof candidate.selector !== "string" ||
    candidate.selector.trim().length === 0 ||
    candidate.selector.length > MAX_SELECTOR_LENGTH ||
    !candidate.rect ||
    typeof candidate.rect !== "object"
  ) {
    throw new Error("Invalid web preview inspection result");
  }
  const rect = candidate.rect as Record<string, unknown>;
  const values = [rect.left, rect.top, rect.width, rect.height];
  if (
    !values.every(
      (entry) => typeof entry === "number" && Number.isFinite(entry),
    ) ||
    (rect.width as number) < 0 ||
    (rect.height as number) < 0 ||
    values.some((entry) => Math.abs(entry as number) > 1_000_000)
  ) {
    throw new Error("Invalid web preview inspection result");
  }
  return {
    selector: candidate.selector,
    rect: {
      left: rect.left as number,
      top: rect.top as number,
      width: rect.width as number,
      height: rect.height as number,
    },
  };
}

function resolveWebPreview(
  event: IpcMainInvokeEvent,
  webContentsId: unknown,
  getMainWindow: () => BrowserWindow | null,
): WebContents {
  const mainWindow = getMainWindow();
  if (
    !mainWindow ||
    event.sender !== mainWindow.webContents ||
    event.senderFrame !== event.sender.mainFrame
  ) {
    throw new Error("Unauthorized web preview inspection request");
  }
  if (
    typeof webContentsId !== "number" ||
    !Number.isSafeInteger(webContentsId) ||
    webContentsId <= 0
  ) {
    throw new Error("Invalid web preview webContents ID");
  }

  const target = webContents.fromId(webContentsId);
  if (
    !target ||
    target.isDestroyed() ||
    target.getType() !== "webview" ||
    target.hostWebContents !== event.sender ||
    target.session !== session.fromPartition("web-preview")
  ) {
    throw new Error("Invalid web preview target");
  }
  return target;
}

export async function inspectWebPreview(
  event: IpcMainInvokeEvent,
  webContentsId: unknown,
  getMainWindow: () => BrowserWindow | null,
): Promise<WebPreviewInspectionSelection | null> {
  const target = resolveWebPreview(event, webContentsId, getMainWindow);
  const result = await target.executeJavaScriptInIsolatedWorld(
    INSPECTOR_WORLD_ID,
    [{ code: WEB_PREVIEW_INSPECTOR_SOURCE }],
  );
  return normalizeSelection(result);
}

export async function cancelWebPreviewInspection(
  event: IpcMainInvokeEvent,
  webContentsId: unknown,
  getMainWindow: () => BrowserWindow | null,
): Promise<void> {
  const target = resolveWebPreview(event, webContentsId, getMainWindow);
  await target.executeJavaScriptInIsolatedWorld(INSPECTOR_WORLD_ID, [
    { code: WEB_PREVIEW_INSPECTOR_CANCEL_SOURCE },
  ]);
}
