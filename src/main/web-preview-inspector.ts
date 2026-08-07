import {
  session,
  webContents,
  type BrowserWindow,
  type IpcMainInvokeEvent,
  type WebContents,
} from "electron";

const INSPECTOR_WORLD_ID = 1_001;
const MAX_SELECTOR_LENGTH = 4_096;
const MAX_TRACKED_SELECTIONS = 100;
const MAX_EDIT_TEXT_LENGTH = 20_000;
const MAX_EDIT_STYLE_VALUE_LENGTH = 512;
const EDIT_STYLE_PROPERTIES = [
  "color",
  "font-family",
  "font-size",
  "font-weight",
  "letter-spacing",
  "line-height",
  "text-align",
] as const;

type WebPreviewEditStyleProperty = (typeof EDIT_STYLE_PROPERTIES)[number];

export interface WebPreviewInspectionSelection {
  annotationId: number;
  selector: string;
  rect: { left: number; top: number; width: number; height: number };
}

export interface WebPreviewSelectionMeasurement {
  annotationId: number;
  rect: WebPreviewInspectionSelection["rect"] | null;
}

export interface WebPreviewElementEditState {
  textContent: string;
  canEditText: boolean;
  styles: {
    color: string;
    fontFamily: string;
    fontSize: number;
    fontWeight: string;
    letterSpacing: number;
    lineHeight: number;
    textAlign: string;
  };
  inlineStyles: Record<WebPreviewEditStyleProperty, string | null>;
}

export interface WebPreviewElementEditPatch {
  textContent?: string;
  styles?: Partial<Record<WebPreviewEditStyleProperty, string | null>>;
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

    let selections = globalThis.__hermesWebPreviewSelectedElements;
    if (!(selections instanceof Map)) {
      selections = new Map();
      globalThis.__hermesWebPreviewSelectedElements = selections;
    }

    let annotationId = null;
    for (const entry of selections.entries()) {
      if (entry[1] === selectedElement) {
        annotationId = entry[0];
        break;
      }
    }
    if (annotationId === null) {
      if (selections.size >= ${MAX_TRACKED_SELECTIONS}) {
        cleanup();
        return;
      }
      const previousCounter = Number.isSafeInteger(globalThis.__hermesWebPreviewSelectionCounter)
        ? globalThis.__hermesWebPreviewSelectionCounter
        : 0;
      annotationId = previousCounter + 1;
      globalThis.__hermesWebPreviewSelectionCounter = annotationId;
      selections.set(annotationId, selectedElement);
    }

    const rect = selectedElement.getBoundingClientRect();
    finish({
      annotationId: annotationId,
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

export const WEB_PREVIEW_SELECTION_RECTS_SOURCE = `
(() => {
  const selections = globalThis.__hermesWebPreviewSelectedElements;
  if (!(selections instanceof Map)) return [];
  const measurements = [];
  for (const entry of selections.entries()) {
    const annotationId = entry[0];
    const element = entry[1];
    if (!element || !element.isConnected) {
      selections.delete(annotationId);
      measurements.push({ annotationId: annotationId, rect: null });
      continue;
    }
    const rect = element.getBoundingClientRect();
    measurements.push({
      annotationId: annotationId,
      rect: {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height
      }
    });
  }
  return measurements;
})()
`;

const WEB_PREVIEW_INSPECTOR_CANCEL_SOURCE = `
if (typeof globalThis.__hermesWebPreviewInspectorCleanup === "function") {
  globalThis.__hermesWebPreviewInspectorCleanup();
}
`;

const WEB_PREVIEW_SELECTIONS_CLEAR_SOURCE = `
if (typeof globalThis.__hermesWebPreviewInspectorCleanup === "function") {
  globalThis.__hermesWebPreviewInspectorCleanup();
}
if (globalThis.__hermesWebPreviewSelectedElements instanceof Map) {
  globalThis.__hermesWebPreviewSelectedElements.clear();
}
delete globalThis.__hermesWebPreviewSelectedElements;
delete globalThis.__hermesWebPreviewSelectionCounter;
delete globalThis.__hermesWebPreviewSelectedElement;
`;

function webPreviewElementEditStateSource(annotationId: number): string {
  return `
(() => {
  const selections = globalThis.__hermesWebPreviewSelectedElements;
  const element = selections instanceof Map ? selections.get(${annotationId}) : null;
  if (!element || !element.isConnected) return null;
  const computed = globalThis.getComputedStyle(element);
  const fontSize = Number.parseFloat(computed.fontSize) || 16;
  const parsedLineHeight = Number.parseFloat(computed.lineHeight);
  const parsedLetterSpacing = Number.parseFloat(computed.letterSpacing);
  return {
    textContent: element.textContent || "",
    canEditText: element.childElementCount === 0,
    styles: {
      color: computed.color,
      fontFamily: computed.fontFamily,
      fontSize: fontSize,
      fontWeight: computed.fontWeight,
      letterSpacing: Number.isFinite(parsedLetterSpacing) ? parsedLetterSpacing : 0,
      lineHeight: Number.isFinite(parsedLineHeight) ? parsedLineHeight : fontSize * 1.2,
      textAlign: computed.textAlign
    },
    inlineStyles: {
      color: element.style.getPropertyValue("color") || null,
      "font-family": element.style.getPropertyValue("font-family") || null,
      "font-size": element.style.getPropertyValue("font-size") || null,
      "font-weight": element.style.getPropertyValue("font-weight") || null,
      "letter-spacing": element.style.getPropertyValue("letter-spacing") || null,
      "line-height": element.style.getPropertyValue("line-height") || null,
      "text-align": element.style.getPropertyValue("text-align") || null
    }
  };
})()
`;
}

function webPreviewElementEditApplySource(
  annotationId: number,
  patch: WebPreviewElementEditPatch,
): string {
  const encodedPatch = Buffer.from(JSON.stringify(patch), "utf8").toString(
    "base64",
  );
  const styleProperties = JSON.stringify(EDIT_STYLE_PROPERTIES);
  return `
(() => {
  const selections = globalThis.__hermesWebPreviewSelectedElements;
  const element = selections instanceof Map ? selections.get(${annotationId}) : null;
  if (!element || !element.isConnected) return false;
  const binary = globalThis.atob("${encodedPatch}");
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const patch = JSON.parse(new TextDecoder().decode(bytes));
  if (Object.prototype.hasOwnProperty.call(patch, "textContent")) {
    element.textContent = patch.textContent;
  }
  for (const property of ${styleProperties}) {
    if (!patch.styles || !Object.prototype.hasOwnProperty.call(patch.styles, property)) continue;
    const value = patch.styles[property];
    if (value === null) {
      element.style.removeProperty(property);
    } else if (!globalThis.CSS || globalThis.CSS.supports(property, value)) {
      element.style.setProperty(property, value);
    }
  }
  return true;
})()
`;
}

function normalizeAnnotationId(value: unknown, errorMessage: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(errorMessage);
  }
  return value;
}

function normalizeRect(
  value: unknown,
  errorMessage: string,
): WebPreviewInspectionSelection["rect"] | null {
  if (value === null) return null;
  if (!value || typeof value !== "object") throw new Error(errorMessage);
  const rect = value as Record<string, unknown>;
  const values = [rect.left, rect.top, rect.width, rect.height];
  if (
    !values.every(
      (entry) => typeof entry === "number" && Number.isFinite(entry),
    ) ||
    (rect.width as number) < 0 ||
    (rect.height as number) < 0 ||
    values.some((entry) => Math.abs(entry as number) > 1_000_000)
  ) {
    throw new Error(errorMessage);
  }
  return {
    left: rect.left as number,
    top: rect.top as number,
    width: rect.width as number,
    height: rect.height as number,
  };
}

function normalizeSelection(
  value: unknown,
): WebPreviewInspectionSelection | null {
  if (value === null) return null;
  if (!value || typeof value !== "object") {
    throw new Error("Invalid web preview inspection result");
  }
  const candidate = value as {
    annotationId?: unknown;
    selector?: unknown;
    rect?: unknown;
  };
  if (
    typeof candidate.annotationId !== "number" ||
    typeof candidate.selector !== "string" ||
    candidate.selector.trim().length === 0 ||
    candidate.selector.length > MAX_SELECTOR_LENGTH ||
    !candidate.rect ||
    typeof candidate.rect !== "object"
  ) {
    throw new Error("Invalid web preview inspection result");
  }
  const rect = normalizeRect(
    candidate.rect,
    "Invalid web preview inspection result",
  );
  if (!rect) throw new Error("Invalid web preview inspection result");
  return {
    annotationId: normalizeAnnotationId(
      candidate.annotationId,
      "Invalid web preview inspection result",
    ),
    selector: candidate.selector,
    rect,
  };
}

function normalizeMeasurements(
  value: unknown,
): WebPreviewSelectionMeasurement[] {
  if (!Array.isArray(value) || value.length > MAX_TRACKED_SELECTIONS) {
    throw new Error("Invalid web preview selection measurements");
  }

  const seen = new Set<number>();
  return value.map((entry) => {
    if (!entry || typeof entry !== "object") {
      throw new Error("Invalid web preview selection measurements");
    }
    const candidate = entry as { annotationId?: unknown; rect?: unknown };
    const annotationId = normalizeAnnotationId(
      candidate.annotationId,
      "Invalid web preview selection measurements",
    );
    if (seen.has(annotationId)) {
      throw new Error("Invalid web preview selection measurements");
    }
    seen.add(annotationId);
    return {
      annotationId,
      rect: normalizeRect(
        candidate.rect,
        "Invalid web preview selection measurements",
      ),
    };
  });
}

function validEditString(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length <= maxLength &&
    !value.includes("\0")
  );
}

function normalizeElementEditState(
  value: unknown,
): WebPreviewElementEditState | null {
  if (value === null) return null;
  if (!value || typeof value !== "object") {
    throw new Error("Invalid web preview element edit state");
  }
  const candidate = value as {
    textContent?: unknown;
    canEditText?: unknown;
    styles?: unknown;
    inlineStyles?: unknown;
  };
  if (
    !validEditString(candidate.textContent, MAX_EDIT_TEXT_LENGTH) ||
    typeof candidate.canEditText !== "boolean" ||
    !candidate.styles ||
    typeof candidate.styles !== "object" ||
    !candidate.inlineStyles ||
    typeof candidate.inlineStyles !== "object"
  ) {
    throw new Error("Invalid web preview element edit state");
  }

  const styles = candidate.styles as Record<string, unknown>;
  const inlineStyles = candidate.inlineStyles as Record<string, unknown>;
  const numericValues = [
    styles.fontSize,
    styles.letterSpacing,
    styles.lineHeight,
  ];
  if (
    !validEditString(styles.color, MAX_EDIT_STYLE_VALUE_LENGTH) ||
    !validEditString(styles.fontFamily, MAX_EDIT_STYLE_VALUE_LENGTH) ||
    !validEditString(styles.fontWeight, MAX_EDIT_STYLE_VALUE_LENGTH) ||
    !validEditString(styles.textAlign, MAX_EDIT_STYLE_VALUE_LENGTH) ||
    !numericValues.every(
      (entry) =>
        typeof entry === "number" &&
        Number.isFinite(entry) &&
        Math.abs(entry) <= 1_000_000,
    )
  ) {
    throw new Error("Invalid web preview element edit state");
  }

  const normalizedInlineStyles = {} as Record<
    WebPreviewEditStyleProperty,
    string | null
  >;
  for (const property of EDIT_STYLE_PROPERTIES) {
    const entry = inlineStyles[property];
    if (
      entry !== null &&
      !validEditString(entry, MAX_EDIT_STYLE_VALUE_LENGTH)
    ) {
      throw new Error("Invalid web preview element edit state");
    }
    normalizedInlineStyles[property] = entry;
  }

  return {
    textContent: candidate.textContent,
    canEditText: candidate.canEditText,
    styles: {
      color: styles.color,
      fontFamily: styles.fontFamily,
      fontSize: styles.fontSize as number,
      fontWeight: styles.fontWeight,
      letterSpacing: styles.letterSpacing as number,
      lineHeight: styles.lineHeight as number,
      textAlign: styles.textAlign,
    },
    inlineStyles: normalizedInlineStyles,
  };
}

function normalizeElementEditPatch(value: unknown): WebPreviewElementEditPatch {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid web preview element edit patch");
  }
  const candidate = value as { textContent?: unknown; styles?: unknown };
  const normalized: WebPreviewElementEditPatch = {};

  if (Object.prototype.hasOwnProperty.call(candidate, "textContent")) {
    if (!validEditString(candidate.textContent, MAX_EDIT_TEXT_LENGTH)) {
      throw new Error("Invalid web preview element edit patch");
    }
    normalized.textContent = candidate.textContent;
  }

  if (Object.prototype.hasOwnProperty.call(candidate, "styles")) {
    if (
      !candidate.styles ||
      typeof candidate.styles !== "object" ||
      Array.isArray(candidate.styles)
    ) {
      throw new Error("Invalid web preview element edit patch");
    }
    const rawStyles = candidate.styles as Record<string, unknown>;
    const allowedProperties = new Set<string>(EDIT_STYLE_PROPERTIES);
    if (Object.keys(rawStyles).some((key) => !allowedProperties.has(key))) {
      throw new Error("Invalid web preview element edit patch");
    }
    const styles: WebPreviewElementEditPatch["styles"] = {};
    for (const property of EDIT_STYLE_PROPERTIES) {
      if (!Object.prototype.hasOwnProperty.call(rawStyles, property)) continue;
      const entry = rawStyles[property];
      if (
        entry !== null &&
        !validEditString(entry, MAX_EDIT_STYLE_VALUE_LENGTH)
      ) {
        throw new Error("Invalid web preview element edit patch");
      }
      styles[property] = entry;
    }
    normalized.styles = styles;
  }

  return normalized;
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

export async function measureWebPreviewSelections(
  event: IpcMainInvokeEvent,
  webContentsId: unknown,
  getMainWindow: () => BrowserWindow | null,
): Promise<WebPreviewSelectionMeasurement[]> {
  const target = resolveWebPreview(event, webContentsId, getMainWindow);
  const result = await target.executeJavaScriptInIsolatedWorld(
    INSPECTOR_WORLD_ID,
    [{ code: WEB_PREVIEW_SELECTION_RECTS_SOURCE }],
  );
  return normalizeMeasurements(result);
}

export async function readWebPreviewElementEditState(
  event: IpcMainInvokeEvent,
  webContentsId: unknown,
  annotationId: unknown,
  getMainWindow: () => BrowserWindow | null,
): Promise<WebPreviewElementEditState | null> {
  const target = resolveWebPreview(event, webContentsId, getMainWindow);
  const safeAnnotationId = normalizeAnnotationId(
    annotationId,
    "Invalid web preview annotation ID",
  );
  const result = await target.executeJavaScriptInIsolatedWorld(
    INSPECTOR_WORLD_ID,
    [{ code: webPreviewElementEditStateSource(safeAnnotationId) }],
  );
  return normalizeElementEditState(result);
}

export async function applyWebPreviewElementEdit(
  event: IpcMainInvokeEvent,
  webContentsId: unknown,
  annotationId: unknown,
  patch: unknown,
  getMainWindow: () => BrowserWindow | null,
): Promise<boolean> {
  const target = resolveWebPreview(event, webContentsId, getMainWindow);
  const safeAnnotationId = normalizeAnnotationId(
    annotationId,
    "Invalid web preview annotation ID",
  );
  const safePatch = normalizeElementEditPatch(patch);
  const result = await target.executeJavaScriptInIsolatedWorld(
    INSPECTOR_WORLD_ID,
    [
      {
        code: webPreviewElementEditApplySource(safeAnnotationId, safePatch),
      },
    ],
  );
  if (typeof result !== "boolean") {
    throw new Error("Invalid web preview element edit result");
  }
  return result;
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

export async function releaseWebPreviewSelection(
  event: IpcMainInvokeEvent,
  webContentsId: unknown,
  annotationId: unknown,
  getMainWindow: () => BrowserWindow | null,
): Promise<void> {
  const target = resolveWebPreview(event, webContentsId, getMainWindow);
  const safeAnnotationId = normalizeAnnotationId(
    annotationId,
    "Invalid web preview annotation ID",
  );
  await target.executeJavaScriptInIsolatedWorld(INSPECTOR_WORLD_ID, [
    {
      code: `if (globalThis.__hermesWebPreviewSelectedElements instanceof Map) { globalThis.__hermesWebPreviewSelectedElements.delete(${safeAnnotationId}); }`,
    },
  ]);
}

export async function clearWebPreviewSelections(
  event: IpcMainInvokeEvent,
  webContentsId: unknown,
  getMainWindow: () => BrowserWindow | null,
): Promise<void> {
  const target = resolveWebPreview(event, webContentsId, getMainWindow);
  await target.executeJavaScriptInIsolatedWorld(INSPECTOR_WORLD_ID, [
    { code: WEB_PREVIEW_SELECTIONS_CLEAR_SOURCE },
  ]);
}
