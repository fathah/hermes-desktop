import {
  Fragment,
  useCallback,
  useState,
  useEffect,
  useRef,
  memo,
} from "react";
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
  Maximize2,
  Minimize2,
  Pencil,
  Check,
  ChevronDown,
} from "lucide-react";
import { useI18n } from "../../components/useI18n";
import {
  matchWebPreviewShortcut,
  webPreviewAriaKeyShortcut,
  webPreviewShortcutLabel,
  type WebPreviewShortcutAction,
} from "../../../../shared/web-preview-shortcuts";

interface WebPreviewPanelProps {
  initialUrl?: string;
  onClose: () => void;
  onExecuteAnnotations?: (payload: {
    url: string;
    annotations: Array<{ selector: string; comment: string }>;
  }) => void;
  onSaveElementEdit?: (payload: {
    url: string;
    selector: string;
    edit: WebPreviewElementEditDraft;
  }) => void;
}

export const DEFAULT_WEB_PREVIEW_URL = "https://nept.cloud";
export const WEB_PREVIEW_GUIDE_STORAGE_KEY = "hermes:webPreviewToolsGuide:v1";

interface InspectionRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface InspectionSelection {
  annotationId: number;
  selector: string;
  rect: InspectionRect;
}

interface PinnedAnnotation extends InspectionSelection {
  comment: string;
}

interface WebPreviewElementEditDraft {
  textContent: string;
  color: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: string;
  letterSpacing: number;
  lineHeight: number;
  textAlign: string;
}

interface WebPreviewElementEditState {
  textContent: string;
  canEditText: boolean;
  styles: Omit<WebPreviewElementEditDraft, "textContent">;
  inlineStyles: Record<
    | "color"
    | "font-family"
    | "font-size"
    | "font-weight"
    | "letter-spacing"
    | "line-height"
    | "text-align",
    string | null
  >;
}

const MAX_SELECTOR_LENGTH = 4_096;
const MAX_ANNOTATIONS = 50;
const ANNOTATION_TRACK_INTERVAL_MS = 100;
const ANNOTATION_COMPOSER_HEIGHT = 48;
const ANNOTATION_HORIZONTAL_GUTTER = 12;
const ANNOTATION_VERTICAL_GUTTER = 8;
const EDITOR_WIDTH = 360;
const EDITOR_HEIGHT = 490;
const EDITOR_GUTTER = 12;
const FONT_FAMILY_OPTIONS = [
  "Inter",
  "Arial",
  "Helvetica",
  "Verdana",
  "Tahoma",
  "Trebuchet MS",
  "Georgia",
  "Times New Roman",
  "Courier New",
  "system-ui",
  "sans-serif",
  "serif",
  "monospace",
] as const;

const WEB_PREVIEW_GUIDE_STEPS: Array<{
  title: string;
  body: string;
  shortcut: WebPreviewShortcutAction;
}> = [
  {
    title: "Edit elements",
    body: "Choose Edit, select text, and adjust its font, color, weight, or spacing. Save sends the exact change to the agent.",
    shortcut: "edit",
  },
  {
    title: "Comment on the page",
    body: "Choose Comment, select an element, write a note, and save the pin. Repeat to comment on as many elements as you need.",
    shortcut: "annotate",
  },
  {
    title: "Apply your comments",
    body: "When your pins are ready, choose Execute. Hermes sends the comments together and updates the UI in one pass.",
    shortcut: "commit",
  },
  {
    title: "Control the preview",
    body: "Use the address bar, reload, fullscreen, or external-browser tools. Hover any toolbar tool whenever you need its shortcut.",
    shortcut: "fullscreen",
  },
];

function FontFamilySelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const options = FONT_FAMILY_OPTIONS.includes(
    value as (typeof FONT_FAMILY_OPTIONS)[number],
  )
    ? [...FONT_FAMILY_OPTIONS]
    : [value, ...FONT_FAMILY_OPTIONS];

  useEffect(() => {
    if (!isOpen) return;
    const closeOnOutsideClick = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, [isOpen]);

  return (
    <div
      ref={rootRef}
      className="web-preview-edit-font-select"
      onKeyDown={(event) => {
        if (event.key === "Escape" && isOpen) {
          event.preventDefault();
          event.stopPropagation();
          setIsOpen(false);
        }
      }}
    >
      <button
        type="button"
        className="web-preview-edit-font-trigger"
        style={{ fontFamily: value }}
        onClick={() => setIsOpen((current) => !current)}
        aria-label="Font"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <span>{value}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {isOpen && (
        <div
          className="web-preview-edit-font-options"
          role="listbox"
          aria-label="Font options"
        >
          {options.map((fontFamily) => {
            const selected = fontFamily === value;
            const isCustom = !FONT_FAMILY_OPTIONS.includes(
              fontFamily as (typeof FONT_FAMILY_OPTIONS)[number],
            );
            return (
              <button
                key={fontFamily}
                type="button"
                role="option"
                aria-selected={selected}
                className={`web-preview-edit-font-option${selected ? " active" : ""}`}
                style={{ fontFamily }}
                onClick={() => {
                  onChange(fontFamily);
                  setIsOpen(false);
                }}
              >
                <span>
                  {fontFamily}
                  {isCustom ? " (current)" : ""}
                </span>
                <span className="web-preview-edit-font-sample">Aa</span>
                {selected && <Check size={13} aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function editDraftFromState(
  state: WebPreviewElementEditState,
): WebPreviewElementEditDraft {
  return { textContent: state.textContent, ...state.styles };
}

function editorLayout(
  rect: InspectionRect,
  viewportWidth: number,
  viewportHeight: number,
): { left: number; top: number; width: number; maxHeight: number } {
  const width = Math.min(
    EDITOR_WIDTH,
    Math.max(0, viewportWidth - EDITOR_GUTTER * 2),
  );
  const height = Math.min(
    EDITOR_HEIGHT,
    Math.max(0, viewportHeight - EDITOR_GUTTER * 2),
  );
  const clampedTop = Math.max(
    EDITOR_GUTTER,
    Math.min(rect.top, viewportHeight - height - EDITOR_GUTTER),
  );
  const right = rect.left + rect.width + EDITOR_GUTTER;
  if (right + width <= viewportWidth - EDITOR_GUTTER) {
    return { left: right, top: clampedTop, width, maxHeight: height };
  }

  const left = rect.left - width - EDITOR_GUTTER;
  if (left >= EDITOR_GUTTER) {
    return { left, top: clampedTop, width, maxHeight: height };
  }

  const centeredLeft = Math.max(
    EDITOR_GUTTER,
    Math.min(
      rect.left + (rect.width - width) / 2,
      viewportWidth - width - EDITOR_GUTTER,
    ),
  );
  const belowTop = rect.top + rect.height + EDITOR_GUTTER;
  const belowHeight = Math.max(0, viewportHeight - belowTop - EDITOR_GUTTER);
  const aboveHeight = Math.max(0, rect.top - EDITOR_GUTTER * 2);

  if (belowHeight >= aboveHeight) {
    return {
      left: centeredLeft,
      top: belowTop,
      width,
      maxHeight: Math.min(height, belowHeight),
    };
  }

  const maxHeight = Math.min(height, aboveHeight);
  return {
    left: centeredLeft,
    top: Math.max(EDITOR_GUTTER, rect.top - EDITOR_GUTTER - maxHeight),
    width,
    maxHeight,
  };
}

function parseInspectionSelection(value: unknown): InspectionSelection | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as {
    annotationId?: unknown;
    selector?: unknown;
    rect?: unknown;
  };
  if (
    typeof candidate.annotationId !== "number" ||
    !Number.isSafeInteger(candidate.annotationId) ||
    candidate.annotationId <= 0 ||
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
    annotationId: candidate.annotationId,
    selector: candidate.selector,
    rect: rect as InspectionRect,
  };
}

function annotationLayout(
  rect: InspectionRect,
  viewportWidth: number,
  viewportHeight: number,
  maxWidth = 360,
): { left: number; top: number; width: number; markerLeft: number } {
  const horizontalGutter =
    viewportWidth >= ANNOTATION_HORIZONTAL_GUTTER * 2
      ? ANNOTATION_HORIZONTAL_GUTTER
      : 0;
  const verticalGutter =
    viewportHeight >=
    ANNOTATION_COMPOSER_HEIGHT + ANNOTATION_VERTICAL_GUTTER * 2
      ? ANNOTATION_VERTICAL_GUTTER
      : 0;
  const width = Math.min(
    maxWidth,
    Math.max(0, viewportWidth - horizontalGutter * 2),
  );
  let left = rect.left + (rect.width - width) / 2;
  left = Math.max(
    horizontalGutter,
    Math.min(left, viewportWidth - width - horizontalGutter),
  );

  let top = rect.top + (rect.height - ANNOTATION_COMPOSER_HEIGHT) / 2;
  top = Math.max(
    verticalGutter,
    Math.min(top, viewportHeight - ANNOTATION_COMPOSER_HEIGHT - verticalGutter),
  );

  const preferredMarkerLeft =
    left + width + 8 <= viewportWidth - 30
      ? left + width + 8
      : Math.max(8, left - 34);
  const markerLeft = Math.max(
    0,
    Math.min(preferredMarkerLeft, viewportWidth - 30),
  );
  return { left, top, width, markerLeft };
}

function inspectionRectsEqual(a: InspectionRect, b: InspectionRect): boolean {
  return (
    a.left === b.left &&
    a.top === b.top &&
    a.width === b.width &&
    a.height === b.height
  );
}

// Resizable panel bounds. Min keeps the toolbar usable; max leaves room for
// the chat column. Width is persisted across sessions.
const MIN_PANEL_WIDTH = 320;
const WIDTH_STORAGE_KEY = "hermes:webPreviewWidth";
const maxPanelWidth = (availableWidth = window.innerWidth): number =>
  Math.max(MIN_PANEL_WIDTH, availableWidth - 360);
const clampPanelWidth = (
  value: number,
  availableWidth = window.innerWidth,
): number =>
  Math.min(maxPanelWidth(availableWidth), Math.max(MIN_PANEL_WIDTH, value));

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
  initialUrl = DEFAULT_WEB_PREVIEW_URL,
  onClose,
  onExecuteAnnotations,
  onSaveElementEdit,
}: WebPreviewPanelProps): React.JSX.Element {
  const { t } = useI18n();
  const isMac = navigator.userAgent.includes("Mac");
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
  const [annotations, setAnnotations] = useState<PinnedAnnotation[]>([]);
  const [inspectionCycle, setInspectionCycle] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editSelection, setEditSelection] =
    useState<InspectionSelection | null>(null);
  const [editOriginal, setEditOriginal] =
    useState<WebPreviewElementEditState | null>(null);
  const [editDraft, setEditDraft] = useState<WebPreviewElementEditDraft | null>(
    null,
  );
  const [editCycle, setEditCycle] = useState(0);
  const [guideStep, setGuideStep] = useState<number | null>(() => {
    try {
      return localStorage.getItem(WEB_PREVIEW_GUIDE_STORAGE_KEY) === "complete"
        ? null
        : 0;
    } catch {
      return 0;
    }
  });
  const annotationSelector = annotationSelection?.selector ?? null;
  const activeAnnotationId = annotationSelection?.annotationId;
  const trackedAnnotationIds = [
    ...annotations.map((annotation) => annotation.annotationId),
    ...(annotationSelection ? [annotationSelection.annotationId] : []),
    ...(editSelection ? [editSelection.annotationId] : []),
  ].join(",");

  // Draggable panel width (px). Persisted so it survives reopen/restart.
  const [width, setWidth] = useState<number>(() => {
    const savedValue = localStorage.getItem(WIDTH_STORAGE_KEY);
    const saved = Number(savedValue);
    return clampPanelWidth(
      savedValue !== null && Number.isFinite(saved) ? saved : 480,
    );
  });
  const [isResizing, setIsResizing] = useState(false);
  const [annotationViewport, setAnnotationViewport] = useState({
    width: 0,
    height: 0,
  });
  const panelRef = useRef<HTMLDivElement>(null);
  const addressInputRef = useRef<HTMLInputElement>(null);
  const webviewRef = useRef<ElectronWebviewElement>(null);
  const webviewContainerRef = useRef<HTMLDivElement>(null);
  const annotationInputRef = useRef<HTMLInputElement>(null);
  const isInspectingRef = useRef(isInspecting);
  const activeAnnotationIdRef = useRef(activeAnnotationId);
  const inspectionRequestRef = useRef(0);
  const editRequestRef = useRef(0);
  const isEditingRef = useRef(isEditing);
  const activeEditIdRef = useRef(editSelection?.annotationId);
  const editTextRef = useRef<HTMLTextAreaElement>(null);
  const editMutationQueueRef = useRef<Promise<void>>(Promise.resolve());

  const getWebContentsId = useCallback((): number | null => {
    const webview = webviewRef.current;
    if (!webview) return null;
    try {
      return webview.getWebContentsId();
    } catch {
      return null;
    }
  }, []);

  const releaseSelection = useCallback(
    (annotationId: number): void => {
      const webContentsId = getWebContentsId();
      if (webContentsId === null) return;
      void window.hermesAPI
        .releaseWebPreviewSelection(webContentsId, annotationId)
        .catch(() => {});
    },
    [getWebContentsId],
  );

  const queueElementMutation = useCallback(
    (operation: () => Promise<unknown>): Promise<void> => {
      const next = editMutationQueueRef.current
        .then(operation, operation)
        .then(() => undefined)
        .catch(() => undefined);
      editMutationQueueRef.current = next;
      return next;
    },
    [],
  );

  const applyElementEdit = useCallback(
    (
      annotationId: number,
      draft: WebPreviewElementEditDraft,
      canEditText: boolean,
    ): Promise<void> => {
      const webContentsId = getWebContentsId();
      if (webContentsId === null) return Promise.resolve();
      return queueElementMutation(() =>
        window.hermesAPI.applyWebPreviewElementEdit(
          webContentsId,
          annotationId,
          {
            ...(canEditText ? { textContent: draft.textContent } : {}),
            styles: {
              color: draft.color,
              "font-family": draft.fontFamily,
              "font-size": `${draft.fontSize}px`,
              "font-weight": draft.fontWeight,
              "letter-spacing": `${draft.letterSpacing}px`,
              "line-height": `${draft.lineHeight}px`,
              "text-align": draft.textAlign,
            },
          },
        ),
      );
    },
    [getWebContentsId, queueElementMutation],
  );

  const restoreElementEdit = useCallback(
    (
      selection: InspectionSelection,
      original: WebPreviewElementEditState,
    ): Promise<void> => {
      const webContentsId = getWebContentsId();
      if (webContentsId === null) return Promise.resolve();
      return queueElementMutation(() =>
        window.hermesAPI.applyWebPreviewElementEdit(
          webContentsId,
          selection.annotationId,
          {
            ...(original.canEditText
              ? { textContent: original.textContent }
              : {}),
            styles: original.inlineStyles,
          },
        ),
      );
    },
    [getWebContentsId, queueElementMutation],
  );

  const closeElementEditor = useCallback(
    (release = true): void => {
      editRequestRef.current += 1;
      isEditingRef.current = false;
      setIsEditing(false);
      setEditSelection((selection) => {
        if (
          release &&
          selection &&
          !annotations.some(
            (annotation) => annotation.annotationId === selection.annotationId,
          )
        ) {
          releaseSelection(selection.annotationId);
        }
        return null;
      });
      setEditOriginal(null);
      setEditDraft(null);
    },
    [annotations, releaseSelection],
  );

  const cancelElementEdit = useCallback(async (): Promise<void> => {
    if (editSelection && editOriginal) {
      await restoreElementEdit(editSelection, editOriginal);
    }
    closeElementEditor();
  }, [closeElementEditor, editOriginal, editSelection, restoreElementEdit]);

  const resetAnnotationWorkflow = useCallback((): void => {
    isInspectingRef.current = false;
    inspectionRequestRef.current += 1;
    setIsInspecting(false);
    setAnnotationSelection(null);
    setAnnotationComment("");
    setAnnotations([]);
    editRequestRef.current += 1;
    isEditingRef.current = false;
    setIsEditing(false);
    setEditSelection(null);
    setEditOriginal(null);
    setEditDraft(null);
    const webContentsId = getWebContentsId();
    if (webContentsId === null) return;
    void window.hermesAPI
      .clearWebPreviewSelections(webContentsId)
      .catch(() => {});
  }, [getWebContentsId]);

  useEffect(() => {
    const container = webviewContainerRef.current;
    if (!container) return;
    const updateViewport = (): void => {
      setAnnotationViewport((current) => {
        const next = {
          width: container.clientWidth,
          height: container.clientHeight,
        };
        return current.width === next.width && current.height === next.height
          ? current
          : next;
      });
    };
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(updateViewport);
    resizeObserver?.observe(container);
    window.addEventListener("resize", updateViewport);
    updateViewport();
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateViewport);
    };
  }, []);

  useEffect(() => {
    const parent = panelRef.current?.parentElement;
    const clampToAvailableWidth = (): void => {
      setWidth((current) => {
        const availableWidth = parent?.clientWidth || window.innerWidth;
        const next = clampPanelWidth(current, availableWidth);
        if (next !== current) {
          localStorage.setItem(WIDTH_STORAGE_KEY, String(Math.round(next)));
        }
        return next;
      });
    };
    const resizeObserver =
      parent && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(clampToAvailableWidth)
        : null;
    if (parent) resizeObserver?.observe(parent);
    window.addEventListener("resize", clampToAvailableWidth);
    clampToAvailableWidth();
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", clampToAvailableWidth);
    };
  }, []);

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
      nextWidth = clampPanelWidth(
        startWidth + delta,
        panelRef.current?.parentElement?.clientWidth || window.innerWidth,
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

  useEffect(() => {
    isInspectingRef.current = isInspecting;
  }, [isInspecting]);

  useEffect(() => {
    activeAnnotationIdRef.current = activeAnnotationId;
  }, [activeAnnotationId]);

  useEffect(() => {
    isEditingRef.current = isEditing;
  }, [isEditing]);

  useEffect(() => {
    activeEditIdRef.current = editSelection?.annotationId;
  }, [editSelection?.annotationId]);

  useEffect(() => {
    if (!isFullscreen) return;
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        setIsFullscreen(false);
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isFullscreen]);

  useEffect(() => {
    if (annotationSelector) annotationInputRef.current?.focus();
  }, [annotationSelector]);

  useEffect(() => {
    if (editDraft) editTextRef.current?.focus();
  }, [editDraft]);

  // Selected elements can move independently after responsive reflows or
  // animations. One batched isolated-world measurement keeps every host-side
  // pin attached without exposing comments to the inspected page.
  useEffect(() => {
    if (!trackedAnnotationIds) return;
    const webContentsId = getWebContentsId();
    if (webContentsId === null) return;

    let disposed = false;
    let timerId: number | undefined;
    const refreshRects = async (): Promise<void> => {
      try {
        const measurements =
          await window.hermesAPI.measureWebPreviewSelections(webContentsId);
        if (disposed) return;

        const rects = new Map(
          measurements.map((measurement) => [
            measurement.annotationId,
            measurement.rect,
          ]),
        );
        setAnnotations((current) =>
          current
            .filter((annotation) => rects.get(annotation.annotationId) !== null)
            .map((annotation) => {
              const rect = rects.get(annotation.annotationId);
              return rect && !inspectionRectsEqual(annotation.rect, rect)
                ? { ...annotation, rect }
                : annotation;
            }),
        );

        const currentActiveAnnotationId = activeAnnotationIdRef.current;
        if (
          currentActiveAnnotationId !== undefined &&
          rects.get(currentActiveAnnotationId) === null
        ) {
          setAnnotationSelection(null);
          setAnnotationComment("");
          setInspectionCycle((current) => current + 1);
        } else {
          setAnnotationSelection((selection) => {
            if (!selection) return selection;
            const rect = rects.get(selection.annotationId);
            if (!rect || inspectionRectsEqual(selection.rect, rect)) {
              return selection;
            }
            return { ...selection, rect };
          });
        }

        const currentActiveEditId = activeEditIdRef.current;
        if (
          currentActiveEditId !== undefined &&
          rects.get(currentActiveEditId) === null
        ) {
          editRequestRef.current += 1;
          isEditingRef.current = false;
          setIsEditing(false);
          setEditSelection(null);
          setEditOriginal(null);
          setEditDraft(null);
        } else {
          setEditSelection((selection) => {
            if (!selection) return selection;
            const rect = rects.get(selection.annotationId);
            if (!rect || inspectionRectsEqual(selection.rect, rect)) {
              return selection;
            }
            return { ...selection, rect };
          });
        }
      } catch {
        // Preserve the last valid rectangle across a transient IPC failure.
      }

      if (!disposed) {
        timerId = window.setTimeout(
          () => void refreshRects(),
          ANNOTATION_TRACK_INTERVAL_MS,
        );
      }
    };

    void refreshRects();
    return () => {
      disposed = true;
      if (timerId !== undefined) window.clearTimeout(timerId);
    };
  }, [getWebContentsId, trackedAnnotationIds]);

  // Sync initialUrl prop to internal state when it changes from parent
  useEffect(() => {
    setCurrentUrl(initialUrl);
    setInputUrl(initialUrl);
    if (webviewRef.current) {
      webviewRef.current.src = initialUrl;
    }
    resetAnnotationWorkflow();
  }, [initialUrl, resetAnnotationWorkflow]);

  // Run picking in a dedicated Electron isolated world. The inspected page can
  // see its own DOM, but cannot spoof the structured result or read comments.
  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview || !isDomReady || !isInspecting) return;

    const webContentsId = getWebContentsId();
    if (webContentsId === null) {
      console.error("Failed to identify web preview");
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
  }, [getWebContentsId, inspectionCycle, isDomReady, isInspecting]);

  // Edit picking reuses the same isolated-world selector so the floating host
  // editor can modify only an explicitly retained DOM element.
  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview || !isDomReady || !isEditing || editSelection) return;

    const webContentsId = getWebContentsId();
    if (webContentsId === null) {
      isEditingRef.current = false;
      setIsEditing(false);
      return;
    }

    let disposed = false;
    const requestId = ++editRequestRef.current;
    void window.hermesAPI
      .inspectWebPreview(webContentsId)
      .then(async (value) => {
        if (
          disposed ||
          requestId !== editRequestRef.current ||
          !isEditingRef.current
        ) {
          return;
        }
        const selection = parseInspectionSelection(value);
        if (!selection) throw new Error("No editable element selected");
        const state = (await window.hermesAPI.readWebPreviewElementEditState(
          webContentsId,
          selection.annotationId,
        )) as WebPreviewElementEditState | null;
        if (
          !state ||
          typeof state.textContent !== "string" ||
          typeof state.canEditText !== "boolean"
        ) {
          releaseSelection(selection.annotationId);
          throw new Error("Unable to read editable styles");
        }
        if (
          disposed ||
          requestId !== editRequestRef.current ||
          !isEditingRef.current
        ) {
          releaseSelection(selection.annotationId);
          return;
        }
        setEditSelection(selection);
        setEditOriginal(state);
        setEditDraft(editDraftFromState(state));
      })
      .catch((error) => {
        if (disposed || requestId !== editRequestRef.current) return;
        console.error("Failed to edit web preview element:", error);
        isEditingRef.current = false;
        setIsEditing(false);
        setEditSelection(null);
        setEditOriginal(null);
        setEditDraft(null);
      });

    return () => {
      disposed = true;
      editRequestRef.current += 1;
      void window.hermesAPI
        .cancelWebPreviewInspection(webContentsId)
        .catch(() => {});
    };
  }, [
    editCycle,
    editSelection,
    getWebContentsId,
    isDomReady,
    isEditing,
    releaseSelection,
  ]);

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
      resetAnnotationWorkflow();
      setIsDomReady(false);
    };

    const handleDidStopLoading = (): void => {
      setIsLoading(false);
      // `dom-ready` can fire before this React effect attaches (especially
      // after a fast cached load). A stopped load has necessarily crossed DOM
      // readiness, so recover the picker instead of leaving Edit inert.
      setIsDomReady(true);
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
      resetAnnotationWorkflow();
      setIsDomReady(false);
    };

    const handleDidNavigateInPage = (e: Event): void => {
      const url = (e as unknown as { url: string }).url;
      setCurrentUrl(url);
      setInputUrl(url);
      updateNavigationState();
      // Same-document navigation (history.pushState/replaceState or a hash
      // change) keeps the current DOM and isolated-world handles alive. Keep
      // both DOM readiness and pinned annotations intact.
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
  }, [resetAnnotationWorkflow]);

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

  const cancelCurrentAnnotation = (): void => {
    if (annotationSelection) {
      releaseSelection(annotationSelection.annotationId);
    }
    isInspectingRef.current = false;
    inspectionRequestRef.current += 1;
    setIsInspecting(false);
    setAnnotationSelection(null);
    setAnnotationComment("");
  };

  const startAnnotation = async (): Promise<void> => {
    if (annotations.length >= MAX_ANNOTATIONS) return;
    if (editSelection && editOriginal) {
      await restoreElementEdit(editSelection, editOriginal);
    }
    closeElementEditor();
    inspectionRequestRef.current += 1;
    isInspectingRef.current = true;
    setAnnotationSelection(null);
    setAnnotationComment("");
    setIsInspecting(true);
    setInspectionCycle((current) => current + 1);
  };

  const toggleAnnotation = (): void => {
    if (isInspecting) {
      cancelCurrentAnnotation();
      return;
    }
    void startAnnotation();
  };

  const startElementEdit = (): void => {
    if (annotationSelection || isInspecting) cancelCurrentAnnotation();
    editRequestRef.current += 1;
    isEditingRef.current = true;
    setEditSelection(null);
    setEditOriginal(null);
    setEditDraft(null);
    setIsEditing(true);
    setEditCycle((current) => current + 1);
  };

  const toggleElementEdit = (): void => {
    if (isEditing) {
      void cancelElementEdit();
      return;
    }
    startElementEdit();
  };

  const updateElementEdit = (
    patch: Partial<WebPreviewElementEditDraft>,
  ): void => {
    if (!editSelection || !editOriginal || !editDraft) return;
    const next = { ...editDraft, ...patch };
    setEditDraft(next);
    void applyElementEdit(
      editSelection.annotationId,
      next,
      editOriginal.canEditText,
    );
  };

  const resetElementEdit = async (): Promise<void> => {
    if (!editSelection || !editOriginal) return;
    await restoreElementEdit(editSelection, editOriginal);
    setEditDraft(editDraftFromState(editOriginal));
  };

  const saveElementEdit = (): void => {
    if (!editSelection || !editDraft) return;
    onSaveElementEdit?.({
      url: currentUrl,
      selector: editSelection.selector,
      edit: editDraft,
    });
    closeElementEditor();
  };

  const saveCurrentAnnotation = (): void => {
    const comment = annotationComment.trim();
    if (!annotationSelection || !comment) return;

    const nextAnnotation = { ...annotationSelection, comment };
    const replacesExisting = annotations.some(
      (annotation) =>
        annotation.annotationId === annotationSelection.annotationId,
    );
    setAnnotations((current) => {
      const existingIndex = current.findIndex(
        (annotation) =>
          annotation.annotationId === annotationSelection.annotationId,
      );
      if (existingIndex === -1) return [...current, nextAnnotation];
      return current.map((annotation, index) =>
        index === existingIndex ? nextAnnotation : annotation,
      );
    });
    setAnnotationSelection(null);
    setAnnotationComment("");

    if (annotations.length + (replacesExisting ? 0 : 1) >= MAX_ANNOTATIONS) {
      isInspectingRef.current = false;
      setIsInspecting(false);
    } else {
      setInspectionCycle((current) => current + 1);
    }
  };

  const submitAnnotation = (e: React.FormEvent): void => {
    e.preventDefault();
    saveCurrentAnnotation();
  };

  const removeAnnotation = (annotationId: number): void => {
    setAnnotations((current) =>
      current.filter((annotation) => annotation.annotationId !== annotationId),
    );
    releaseSelection(annotationId);
  };

  const executeAnnotations = (): void => {
    if (
      annotations.length === 0 ||
      annotationSelection ||
      editSelection ||
      !onExecuteAnnotations
    ) {
      return;
    }
    onExecuteAnnotations({
      url: currentUrl,
      annotations: annotations.map(({ selector, comment }) => ({
        selector,
        comment,
      })),
    });
    resetAnnotationWorkflow();
  };

  const runWebPreviewShortcut = (shortcut: WebPreviewShortcutAction): void => {
    switch (shortcut) {
      case "back":
        handleBack();
        break;
      case "forward":
        handleForward();
        break;
      case "reload":
        handleReload();
        break;
      case "focus-address":
        addressInputRef.current?.focus();
        addressInputRef.current?.select();
        break;
      case "edit":
        toggleElementEdit();
        break;
      case "annotate":
        toggleAnnotation();
        break;
      case "fullscreen":
        setIsFullscreen((current) => !current);
        break;
      case "open-external":
        handleOpenExternal();
        break;
      case "close":
        onClose();
        break;
      case "commit":
        if (annotationSelection) saveCurrentAnnotation();
        else if (editSelection) saveElementEdit();
        else executeAnnotations();
        break;
    }
  };

  useEffect(() => {
    const handleWindowShortcut = (event: KeyboardEvent): void => {
      const shortcut = matchWebPreviewShortcut(
        {
          key: event.key,
          meta: event.metaKey,
          control: event.ctrlKey,
          shift: event.shiftKey,
          alt: event.altKey,
          type: "keyDown",
        },
        isMac,
      );
      if (!shortcut) return;
      event.preventDefault();
      event.stopPropagation();
      runWebPreviewShortcut(shortcut);
    };
    const unsubscribe = window.hermesAPI.onWebPreviewShortcut(
      runWebPreviewShortcut,
    );
    window.addEventListener("keydown", handleWindowShortcut);
    return () => {
      unsubscribe();
      window.removeEventListener("keydown", handleWindowShortcut);
    };
  });

  const shortcutTitle = (
    label: string,
    shortcut: WebPreviewShortcutAction,
  ): string => `${label} (${webPreviewShortcutLabel(shortcut, isMac)})`;

  const ariaShortcut = (shortcut: WebPreviewShortcutAction): string =>
    webPreviewAriaKeyShortcut(shortcut, isMac);

  const dismissToolsGuide = (): void => {
    try {
      localStorage.setItem(WEB_PREVIEW_GUIDE_STORAGE_KEY, "complete");
    } catch {
      // Keep the guide dismissible when localStorage is unavailable.
    }
    setGuideStep(null);
  };

  const viewportWidth =
    annotationViewport.width ||
    webviewContainerRef.current?.clientWidth ||
    width;
  const viewportHeight =
    annotationViewport.height ||
    webviewContainerRef.current?.clientHeight ||
    window.innerHeight;

  const annotationPosition = annotationSelection
    ? annotationLayout(annotationSelection.rect, viewportWidth, viewportHeight)
    : null;
  const editorPosition = editSelection
    ? editorLayout(editSelection.rect, viewportWidth, viewportHeight)
    : null;

  return (
    <div
      ref={panelRef}
      className={`web-preview-panel ${isFullscreen ? "web-preview-panel-fullscreen" : ""}`}
      style={{ width: isFullscreen ? "100%" : width }}
    >
      {!isFullscreen && (
        <div
          className={`web-preview-resize-handle ${
            isResizing ? "web-preview-resize-handle-active" : ""
          }`}
          onPointerDown={startResize}
          title="Drag to resize"
        />
      )}
      <div className="web-preview-header">
        <button
          type="button"
          className="web-preview-btn"
          onClick={handleBack}
          disabled={!canGoBack}
          title={shortcutTitle(t("common.back") || "Back", "back")}
          data-tooltip={t("common.back") || "Back"}
          data-shortcut={webPreviewShortcutLabel("back", isMac)}
          aria-label={t("common.back") || "Back"}
          aria-keyshortcuts={ariaShortcut("back")}
        >
          <ArrowLeft size={16} />
        </button>
        <button
          type="button"
          className="web-preview-btn"
          onClick={handleForward}
          disabled={!canGoForward}
          title={shortcutTitle(t("common.forward") || "Forward", "forward")}
          data-tooltip={t("common.forward") || "Forward"}
          data-shortcut={webPreviewShortcutLabel("forward", isMac)}
          aria-label={t("common.forward") || "Forward"}
          aria-keyshortcuts={ariaShortcut("forward")}
        >
          <ArrowRight size={16} />
        </button>
        <button
          type="button"
          className="web-preview-btn"
          onClick={handleReload}
          title={shortcutTitle(t("common.reload") || "Reload", "reload")}
          data-tooltip={t("common.reload") || "Reload"}
          data-shortcut={webPreviewShortcutLabel("reload", isMac)}
          aria-label={t("common.reload") || "Reload"}
          aria-keyshortcuts={ariaShortcut("reload")}
        >
          <RotateCw size={16} className={isLoading ? "animate-spin" : ""} />
        </button>
        <form
          className="web-preview-address-bar"
          onSubmit={handleAddressSubmit}
          data-tooltip="Focus address"
          data-shortcut={webPreviewShortcutLabel("focus-address", isMac)}
        >
          <Globe size={13} className="web-preview-globe-icon" />
          <input
            ref={addressInputRef}
            type="text"
            className="web-preview-address-input"
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            placeholder="Search or enter web address..."
            title={shortcutTitle("Focus address", "focus-address")}
            aria-keyshortcuts={ariaShortcut("focus-address")}
          />
        </form>

        <div className="web-preview-actions">
          <button
            type="button"
            className={`web-preview-btn web-preview-edit-btn ${isEditing ? "web-preview-btn-active" : ""}`}
            onClick={toggleElementEdit}
            title={shortcutTitle(
              isEditing ? "Cancel element edit" : "Edit text and typography",
              "edit",
            )}
            data-tooltip={
              isEditing ? "Cancel element edit" : "Edit text and typography"
            }
            data-shortcut={webPreviewShortcutLabel("edit", isMac)}
            aria-label={
              isEditing ? "Cancel element edit" : "Edit text and typography"
            }
            aria-pressed={isEditing}
            aria-keyshortcuts={ariaShortcut("edit")}
          >
            <Pencil size={16} />
            {isEditing && !editSelection && (
              <span className="web-preview-annotate-label">Select text</span>
            )}
          </button>
          <button
            type="button"
            className={`web-preview-btn web-preview-annotate-btn ${isInspecting ? "web-preview-btn-active" : ""}`}
            onClick={toggleAnnotation}
            disabled={!isInspecting && annotations.length >= MAX_ANNOTATIONS}
            title={shortcutTitle(
              isInspecting
                ? "Stop annotating"
                : annotations.length >= MAX_ANNOTATIONS
                  ? `Annotation limit reached (${MAX_ANNOTATIONS})`
                  : annotations.length > 0
                    ? "Add another annotation"
                    : "Annotate page",
              "annotate",
            )}
            data-tooltip={
              isInspecting
                ? "Stop annotating"
                : annotations.length >= MAX_ANNOTATIONS
                  ? `Annotation limit reached (${MAX_ANNOTATIONS})`
                  : annotations.length > 0
                    ? "Add another annotation"
                    : "Annotate page"
            }
            data-shortcut={webPreviewShortcutLabel("annotate", isMac)}
            aria-label={isInspecting ? "Stop annotating" : "Annotate page"}
            aria-pressed={isInspecting}
            aria-keyshortcuts={ariaShortcut("annotate")}
          >
            <MousePointerClick size={16} />
            {isInspecting && (
              <span className="web-preview-annotate-label">
                Annotating
                {annotations.length > 0 ? ` · ${annotations.length}` : ""}
              </span>
            )}
          </button>
          <button
            type="button"
            className="web-preview-btn"
            onClick={() => setIsFullscreen((current) => !current)}
            title={shortcutTitle(
              isFullscreen
                ? "Exit fullscreen preview"
                : "Enter fullscreen preview",
              "fullscreen",
            )}
            data-tooltip={
              isFullscreen
                ? "Exit fullscreen preview"
                : "Enter fullscreen preview"
            }
            data-shortcut={webPreviewShortcutLabel("fullscreen", isMac)}
            aria-label={
              isFullscreen
                ? "Exit fullscreen preview"
                : "Enter fullscreen preview"
            }
            aria-pressed={isFullscreen}
            aria-keyshortcuts={ariaShortcut("fullscreen")}
          >
            {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
          <button
            type="button"
            className="web-preview-btn"
            onClick={handleOpenExternal}
            title={shortcutTitle(
              t("worktree.open") || "Open in system browser",
              "open-external",
            )}
            data-tooltip={t("worktree.open") || "Open in system browser"}
            data-shortcut={webPreviewShortcutLabel("open-external", isMac)}
            aria-label={t("worktree.open") || "Open in system browser"}
            aria-keyshortcuts={ariaShortcut("open-external")}
          >
            <ExternalLink size={15} />
          </button>
          <button
            type="button"
            className="web-preview-btn"
            onClick={onClose}
            title={shortcutTitle(t("worktree.closeFile") || "Close", "close")}
            data-tooltip={t("worktree.closeFile") || "Close"}
            data-shortcut={webPreviewShortcutLabel("close", isMac)}
            aria-label={t("worktree.closeFile") || "Close"}
            aria-keyshortcuts={ariaShortcut("close")}
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
        {guideStep !== null && (
          <section
            className="web-preview-tools-guide"
            role="dialog"
            aria-modal="false"
            aria-label="Web preview tools guide"
          >
            <header className="web-preview-tools-guide-header">
              <span className="web-preview-tools-guide-progress">
                {guideStep + 1} of {WEB_PREVIEW_GUIDE_STEPS.length}
              </span>
              <button
                type="button"
                className="web-preview-tools-guide-skip"
                onClick={dismissToolsGuide}
              >
                Skip
              </button>
            </header>
            <h3>{WEB_PREVIEW_GUIDE_STEPS[guideStep].title}</h3>
            <p>{WEB_PREVIEW_GUIDE_STEPS[guideStep].body}</p>
            <kbd className="web-preview-tools-guide-shortcut">
              {webPreviewShortcutLabel(
                WEB_PREVIEW_GUIDE_STEPS[guideStep].shortcut,
                isMac,
              )}
            </kbd>
            <footer className="web-preview-tools-guide-footer">
              <div className="web-preview-tools-guide-dots" aria-hidden="true">
                {WEB_PREVIEW_GUIDE_STEPS.map((step, index) => (
                  <span
                    key={step.title}
                    className={index === guideStep ? "active" : ""}
                  />
                ))}
              </div>
              <div className="web-preview-tools-guide-actions">
                {guideStep > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      setGuideStep((current) => (current ?? 1) - 1)
                    }
                  >
                    Back
                  </button>
                )}
                <button
                  type="button"
                  className="web-preview-tools-guide-next"
                  onClick={() => {
                    if (guideStep === WEB_PREVIEW_GUIDE_STEPS.length - 1) {
                      dismissToolsGuide();
                    } else {
                      setGuideStep(guideStep + 1);
                    }
                  }}
                >
                  {guideStep === WEB_PREVIEW_GUIDE_STEPS.length - 1
                    ? "Got it"
                    : "Next"}
                </button>
              </div>
            </footer>
          </section>
        )}
        {annotations.map((annotation, index) => {
          const position = annotationLayout(
            annotation.rect,
            viewportWidth,
            viewportHeight,
            320,
          );
          return (
            <Fragment key={annotation.annotationId}>
              <div
                className="web-preview-annotation-outline"
                style={{
                  left: annotation.rect.left,
                  top: annotation.rect.top,
                  width: annotation.rect.width,
                  height: annotation.rect.height,
                }}
                aria-hidden="true"
              />
              <div
                className="web-preview-annotation-composer web-preview-annotation-pinned"
                style={{
                  left: position.left,
                  top: position.top,
                  width: position.width,
                }}
                role="group"
                aria-label={`Pinned comment ${index + 1} on ${annotation.selector}`}
              >
                <span
                  className="web-preview-annotation-index"
                  aria-hidden="true"
                >
                  {index + 1}
                </span>
                <span className="web-preview-annotation-pinned-text">
                  {annotation.comment}
                </span>
                <button
                  type="button"
                  className="web-preview-annotation-cancel"
                  onClick={() => removeAnnotation(annotation.annotationId)}
                  title={`Remove annotation ${index + 1}`}
                  aria-label={`Remove annotation ${index + 1}`}
                >
                  <X size={14} />
                </button>
              </div>
              <span
                className="web-preview-annotation-marker"
                style={{
                  left: position.markerLeft,
                  top: position.top + 9,
                }}
                aria-hidden="true"
              >
                {index + 1}
              </span>
            </Fragment>
          );
        })}
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
                  cancelCurrentAnnotation();
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
                onClick={cancelCurrentAnnotation}
                title="Cancel annotation (Esc)"
                aria-label="Cancel annotation"
                aria-keyshortcuts="Escape"
              >
                <X size={14} />
              </button>
              <button
                type="submit"
                className="web-preview-annotation-submit"
                disabled={!annotationComment.trim()}
                title={shortcutTitle("Save annotation", "commit")}
                aria-label="Save annotation"
                aria-keyshortcuts={ariaShortcut("commit")}
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
        {editSelection && editOriginal && editDraft && editorPosition && (
          <>
            <div
              className="web-preview-edit-outline"
              style={{
                left: editSelection.rect.left,
                top: editSelection.rect.top,
                width: editSelection.rect.width,
                height: editSelection.rect.height,
              }}
              aria-hidden="true"
            />
            <div className="web-preview-annotation-shield" aria-hidden="true" />
            <section
              className="web-preview-edit-popover"
              style={{
                left: editorPosition.left,
                top: editorPosition.top,
                width: editorPosition.width,
                maxHeight: editorPosition.maxHeight,
              }}
              role="dialog"
              aria-modal="false"
              aria-label="Edit text and typography"
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  void cancelElementEdit();
                }
              }}
            >
              <header className="web-preview-edit-header">
                <div className="web-preview-edit-title-wrap">
                  <span className="web-preview-edit-title">Edit element</span>
                  <span
                    className="web-preview-edit-selector"
                    title={editSelection.selector}
                  >
                    {editSelection.selector}
                  </span>
                </div>
                <button
                  type="button"
                  className="web-preview-annotation-cancel"
                  onClick={cancelElementEdit}
                  aria-label="Cancel element edit"
                  title="Cancel element edit (Esc)"
                  aria-keyshortcuts="Escape"
                >
                  <X size={15} />
                </button>
              </header>

              <label className="web-preview-edit-field web-preview-edit-field-wide">
                <span>Text</span>
                <textarea
                  ref={editTextRef}
                  value={editDraft.textContent}
                  disabled={!editOriginal.canEditText}
                  onChange={(event) =>
                    updateElementEdit({ textContent: event.target.value })
                  }
                  maxLength={20_000}
                  rows={3}
                  aria-describedby={
                    editOriginal.canEditText
                      ? undefined
                      : "web-preview-edit-text-help"
                  }
                />
              </label>
              {!editOriginal.canEditText && (
                <p
                  id="web-preview-edit-text-help"
                  className="web-preview-edit-help"
                >
                  This element contains nested markup. Typography can be edited,
                  but its text is protected.
                </p>
              )}

              <div className="web-preview-edit-section-label">Typography</div>
              <div className="web-preview-edit-grid">
                <div className="web-preview-edit-field web-preview-edit-field-wide">
                  <span>Font</span>
                  <FontFamilySelect
                    value={editDraft.fontFamily}
                    onChange={(fontFamily) => updateElementEdit({ fontFamily })}
                  />
                </div>
                <label className="web-preview-edit-field">
                  <span>Size (px)</span>
                  <input
                    type="number"
                    min="1"
                    max="512"
                    step="1"
                    value={editDraft.fontSize}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      if (Number.isFinite(value)) {
                        updateElementEdit({ fontSize: value });
                      }
                    }}
                  />
                </label>
                <label className="web-preview-edit-field">
                  <span>Weight</span>
                  <select
                    value={editDraft.fontWeight}
                    onChange={(event) =>
                      updateElementEdit({ fontWeight: event.target.value })
                    }
                  >
                    {[
                      "100",
                      "200",
                      "300",
                      "400",
                      "500",
                      "600",
                      "700",
                      "800",
                      "900",
                    ].map((weight) => (
                      <option key={weight} value={weight}>
                        {weight}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="web-preview-edit-field web-preview-edit-color-field">
                  <span>Color</span>
                  <input
                    type="color"
                    value={
                      /^#[\da-f]{6}$/i.test(editDraft.color)
                        ? editDraft.color
                        : "#000000"
                    }
                    onChange={(event) =>
                      updateElementEdit({ color: event.target.value })
                    }
                    aria-label="Text color picker"
                  />
                  <input
                    value={editDraft.color}
                    onChange={(event) =>
                      updateElementEdit({ color: event.target.value })
                    }
                    maxLength={100}
                    aria-label="Text color CSS value"
                  />
                </label>
                <label className="web-preview-edit-field">
                  <span>Align</span>
                  <select
                    value={editDraft.textAlign}
                    onChange={(event) =>
                      updateElementEdit({ textAlign: event.target.value })
                    }
                  >
                    {["start", "left", "center", "right", "justify", "end"].map(
                      (align) => (
                        <option key={align} value={align}>
                          {align}
                        </option>
                      ),
                    )}
                  </select>
                </label>
                <label className="web-preview-edit-field">
                  <span>Line height (px)</span>
                  <input
                    type="number"
                    min="0"
                    max="1024"
                    step="0.1"
                    value={editDraft.lineHeight}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      if (Number.isFinite(value)) {
                        updateElementEdit({ lineHeight: value });
                      }
                    }}
                  />
                </label>
                <label className="web-preview-edit-field">
                  <span>Tracking (px)</span>
                  <input
                    type="number"
                    min="-100"
                    max="100"
                    step="0.1"
                    value={editDraft.letterSpacing}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      if (Number.isFinite(value)) {
                        updateElementEdit({ letterSpacing: value });
                      }
                    }}
                  />
                </label>
              </div>

              <footer className="web-preview-edit-footer">
                <button type="button" onClick={resetElementEdit}>
                  Reset
                </button>
                <button type="button" onClick={cancelElementEdit}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="web-preview-edit-save"
                  onClick={saveElementEdit}
                  disabled={!onSaveElementEdit}
                  title={shortcutTitle("Save element edit", "commit")}
                  aria-keyshortcuts={ariaShortcut("commit")}
                >
                  Save
                </button>
              </footer>
            </section>
          </>
        )}
        {annotations.length > 0 && (
          <button
            type="button"
            className="web-preview-annotation-execute"
            onClick={executeAnnotations}
            disabled={
              Boolean(annotationSelection || editSelection) ||
              !onExecuteAnnotations
            }
            title={
              annotationSelection
                ? "Save or cancel the current comment first"
                : editSelection
                  ? "Save or cancel the current edit first"
                  : shortcutTitle(
                      `Execute ${annotations.length} annotation${annotations.length === 1 ? "" : "s"}`,
                      "commit",
                    )
            }
            aria-label={`Execute ${annotations.length} annotation${annotations.length === 1 ? "" : "s"}`}
            aria-keyshortcuts={ariaShortcut("commit")}
          >
            <span>Execute</span>
            <span className="web-preview-annotation-execute-count">
              {annotations.length}
            </span>
          </button>
        )}
      </div>
    </div>
  );
});
