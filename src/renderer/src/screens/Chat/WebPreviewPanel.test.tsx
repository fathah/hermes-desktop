import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    locale: "en",
    setLocale: vi.fn(),
  }),
}));

vi.mock("lucide-react", () => ({
  X: () => null,
  ArrowLeft: () => null,
  ArrowRight: () => null,
  RotateCw: () => null,
  ExternalLink: () => null,
  Globe: () => null,
  MousePointerClick: () => null,
  MessageCircle: () => null,
  ArrowUp: () => null,
  Maximize2: () => null,
  Minimize2: () => null,
  Pencil: () => null,
  Check: () => null,
  ChevronDown: () => null,
}));

import {
  DEFAULT_WEB_PREVIEW_URL,
  WEB_PREVIEW_GUIDE_STORAGE_KEY,
  WebPreviewPanel,
} from "./WebPreviewPanel";

interface InspectionResult {
  annotationId: number;
  selector: string;
  rect: { left: number; top: number; width: number; height: number };
}

interface Measurement {
  annotationId: number;
  rect: InspectionResult["rect"] | null;
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function pendingPromise<T>(): Promise<T> {
  return new Promise(() => {});
}

function installInspectorBridge({
  inspectWebPreview,
  measureWebPreviewSelections = vi.fn(() => pendingPromise<Measurement[]>()),
  cancelWebPreviewInspection = vi.fn().mockResolvedValue(undefined),
  releaseWebPreviewSelection = vi.fn().mockResolvedValue(undefined),
  clearWebPreviewSelections = vi.fn().mockResolvedValue(undefined),
  readWebPreviewElementEditState = vi.fn().mockResolvedValue(null),
  applyWebPreviewElementEdit = vi.fn().mockResolvedValue(true),
  onWebPreviewShortcut = vi.fn(() => () => {}),
}: {
  inspectWebPreview: ReturnType<typeof vi.fn>;
  measureWebPreviewSelections?: ReturnType<typeof vi.fn>;
  cancelWebPreviewInspection?: ReturnType<typeof vi.fn>;
  releaseWebPreviewSelection?: ReturnType<typeof vi.fn>;
  clearWebPreviewSelections?: ReturnType<typeof vi.fn>;
  readWebPreviewElementEditState?: ReturnType<typeof vi.fn>;
  applyWebPreviewElementEdit?: ReturnType<typeof vi.fn>;
  onWebPreviewShortcut?: ReturnType<typeof vi.fn>;
}): void {
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: {
      inspectWebPreview,
      measureWebPreviewSelections,
      cancelWebPreviewInspection,
      releaseWebPreviewSelection,
      clearWebPreviewSelections,
      readWebPreviewElementEditState,
      applyWebPreviewElementEdit,
      onWebPreviewShortcut,
    } as unknown as typeof window.hermesAPI,
  });
}

function configureWebview(
  container: HTMLElement,
  webContentsId: number,
): {
  webview: HTMLElement & {
    canGoBack: () => boolean;
    canGoForward: () => boolean;
    goBack: () => void;
    goForward: () => void;
    reload: () => void;
    getWebContentsId: () => number;
  };
  webviewContainer: HTMLDivElement;
} {
  const webview = container.querySelector("webview") as HTMLElement & {
    canGoBack: () => boolean;
    canGoForward: () => boolean;
    goBack: () => void;
    goForward: () => void;
    reload: () => void;
    getWebContentsId: () => number;
  };
  webview.canGoBack = () => false;
  webview.canGoForward = () => false;
  webview.goBack = vi.fn();
  webview.goForward = vi.fn();
  webview.reload = vi.fn();
  webview.getWebContentsId = () => webContentsId;
  const webviewContainer = container.querySelector(
    ".web-preview-webview-container",
  ) as HTMLDivElement;
  Object.defineProperties(webviewContainer, {
    clientWidth: { configurable: true, value: 480 },
    clientHeight: { configurable: true, value: 700 },
  });
  return { webview, webviewContainer };
}

beforeEach(() => {
  localStorage.removeItem(WEB_PREVIEW_GUIDE_STORAGE_KEY);
});

afterEach(() => {
  cleanup();
  localStorage.removeItem(WEB_PREVIEW_GUIDE_STORAGE_KEY);
  Reflect.deleteProperty(window, "hermesAPI");
  vi.restoreAllMocks();
});

describe("WebPreviewPanel first-run guide", () => {
  it("walks new users through the tools and stays dismissed", () => {
    installInspectorBridge({
      inspectWebPreview: vi.fn(() => pendingPromise<InspectionResult | null>()),
    });
    const view = render(<WebPreviewPanel onClose={vi.fn()} />);

    expect(
      view.getByRole("dialog", { name: "Web preview tools guide" }),
    ).toBeInTheDocument();
    expect(view.getByText("1 of 4")).toBeVisible();
    expect(view.getByRole("heading", { name: "Edit elements" })).toBeVisible();

    fireEvent.click(view.getByRole("button", { name: "Next" }));
    expect(
      view.getByRole("heading", { name: "Comment on the page" }),
    ).toBeVisible();
    fireEvent.click(view.getByRole("button", { name: "Next" }));
    expect(
      view.getByRole("heading", { name: "Apply your comments" }),
    ).toBeVisible();
    fireEvent.click(view.getByRole("button", { name: "Next" }));
    expect(
      view.getByRole("heading", { name: "Control the preview" }),
    ).toBeVisible();
    fireEvent.click(view.getByRole("button", { name: "Got it" }));

    expect(
      view.queryByRole("dialog", { name: "Web preview tools guide" }),
    ).not.toBeInTheDocument();
    expect(localStorage.getItem(WEB_PREVIEW_GUIDE_STORAGE_KEY)).toBe(
      "complete",
    );

    view.unmount();
    const reopened = render(<WebPreviewPanel onClose={vi.fn()} />);
    expect(
      reopened.queryByRole("dialog", { name: "Web preview tools guide" }),
    ).not.toBeInTheDocument();
  });
});

describe("WebPreviewPanel fullscreen", () => {
  it("opens Nept when no initial destination is provided", () => {
    installInspectorBridge({
      inspectWebPreview: vi.fn(() => pendingPromise<InspectionResult | null>()),
    });
    const { container, getByPlaceholderText } = render(
      <WebPreviewPanel onClose={vi.fn()} />,
    );

    expect(DEFAULT_WEB_PREVIEW_URL).toBe("https://nept.cloud");
    expect(getByPlaceholderText("Search or enter web address...")).toHaveValue(
      "https://nept.cloud",
    );
    expect(container.querySelector("webview")).toHaveAttribute(
      "src",
      "https://nept.cloud",
    );
  });

  it("expands over the chat workspace and exits without replacing the webview", () => {
    installInspectorBridge({
      inspectWebPreview: vi.fn(() => pendingPromise<InspectionResult | null>()),
    });
    const { container, getByTitle } = render(
      <WebPreviewPanel
        initialUrl="https://example.com/"
        onClose={vi.fn()}
        onExecuteAnnotations={vi.fn()}
      />,
    );
    configureWebview(container, 31);
    const panel = container.querySelector(".web-preview-panel");
    const originalWebview = container.querySelector("webview");

    fireEvent.click(getByTitle(/^Enter fullscreen preview/));
    expect(panel).toHaveClass("web-preview-panel-fullscreen");
    expect(panel).toHaveStyle({ width: "100%" });
    expect(container.querySelector(".web-preview-resize-handle")).toBeNull();
    expect(container.querySelector("webview")).toBe(originalWebview);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(panel).not.toHaveClass("web-preview-panel-fullscreen");
    expect(getByTitle(/^Enter fullscreen preview/)).toBeInTheDocument();
    expect(container.querySelector("webview")).toBe(originalWebview);
  });
});

describe("WebPreviewPanel keyboard shortcuts", () => {
  it("runs toolbar actions and exposes their shortcut labels", () => {
    let guestShortcutHandler:
      | Parameters<typeof window.hermesAPI.onWebPreviewShortcut>[0]
      | undefined;
    const onWebPreviewShortcut = vi.fn(
      (
        handler: Parameters<typeof window.hermesAPI.onWebPreviewShortcut>[0],
      ) => {
        guestShortcutHandler = handler;
        return () => {};
      },
    );
    installInspectorBridge({
      inspectWebPreview: vi.fn(() => pendingPromise<InspectionResult | null>()),
      onWebPreviewShortcut,
    });
    const onClose = vi.fn();
    const { container, getByPlaceholderText, getByTitle } = render(
      <WebPreviewPanel initialUrl="https://example.com/" onClose={onClose} />,
    );
    const { webview } = configureWebview(container, 32);
    const address = getByPlaceholderText("Search or enter web address...");

    const fullscreen = getByTitle("Enter fullscreen preview (Ctrl+Shift+F)");
    expect(fullscreen).toHaveAttribute("aria-keyshortcuts", "Control+Shift+F");
    expect(fullscreen).toHaveAttribute(
      "data-tooltip",
      "Enter fullscreen preview",
    );
    expect(fullscreen).toHaveAttribute("data-shortcut", "Ctrl+Shift+F");
    fireEvent.keyDown(window, { key: "r", ctrlKey: true });
    expect(webview.reload).toHaveBeenCalledOnce();
    fireEvent.keyDown(window, { key: "l", ctrlKey: true });
    expect(address).toHaveFocus();
    act(() => guestShortcutHandler?.("fullscreen"));
    expect(container.querySelector(".web-preview-panel")).toHaveClass(
      "web-preview-panel-fullscreen",
    );
    fireEvent.keyDown(window, { key: "w", ctrlKey: true, shiftKey: true });
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("WebPreviewPanel annotation lifecycle", () => {
  it("pins multiple comments and executes them once as an ordered batch", async () => {
    const firstInspection = deferred<InspectionResult | null>();
    const secondInspection = deferred<InspectionResult | null>();
    const inspectWebPreview = vi
      .fn()
      .mockReturnValueOnce(firstInspection.promise)
      .mockReturnValueOnce(secondInspection.promise)
      .mockImplementation(() => pendingPromise<InspectionResult | null>());
    const cancelWebPreviewInspection = vi.fn().mockResolvedValue(undefined);
    const clearWebPreviewSelections = vi.fn().mockResolvedValue(undefined);
    installInspectorBridge({
      inspectWebPreview,
      cancelWebPreviewInspection,
      clearWebPreviewSelections,
    });
    const onExecuteAnnotations = vi.fn();
    const {
      container,
      getByLabelText,
      getByPlaceholderText,
      getByRole,
      getByText,
      getByTitle,
      queryByText,
    } = render(
      <WebPreviewPanel
        initialUrl="http://localhost:3000/"
        onClose={vi.fn()}
        onExecuteAnnotations={onExecuteAnnotations}
      />,
    );
    const { webview } = configureWebview(container, 42);

    act(() => webview.dispatchEvent(new Event("dom-ready")));
    fireEvent.click(getByTitle(/^Annotate page/));
    await waitFor(() => expect(inspectWebPreview).toHaveBeenCalledWith(42));

    await act(async () => {
      firstInspection.resolve({
        annotationId: 1,
        selector: "#hero-heading",
        rect: { left: 20, top: 30, width: 300, height: 80 },
      });
      await firstInspection.promise;
    });

    const firstComment = getByPlaceholderText("Add a comment…");
    expect(firstComment).toBe(document.activeElement);
    expect(
      container.querySelector(".web-preview-annotation-shield"),
    ).toBeInTheDocument();
    fireEvent.change(firstComment, {
      target: { value: "  Make this heading smaller  " },
    });
    fireEvent.submit(firstComment.closest("form") as HTMLFormElement);

    expect(onExecuteAnnotations).not.toHaveBeenCalled();
    expect(
      getByLabelText("Pinned comment 1 on #hero-heading"),
    ).toHaveTextContent("Make this heading smaller");
    expect(getByText("Execute")).toBeInTheDocument();
    await waitFor(() => expect(inspectWebPreview).toHaveBeenCalledTimes(2));

    await act(async () => {
      secondInspection.resolve({
        annotationId: 2,
        selector: ".primary-cta",
        rect: { left: 70, top: 160, width: 220, height: 52 },
      });
      await secondInspection.promise;
    });

    const secondComment = getByPlaceholderText("Add a comment…");
    expect(
      getByRole("button", { name: "Execute 1 annotation" }),
    ).toBeDisabled();
    fireEvent.change(secondComment, {
      target: { value: "Use the green brand color" },
    });
    fireEvent.click(getByTitle(/^Save annotation/));

    expect(onExecuteAnnotations).not.toHaveBeenCalled();
    expect(
      getByLabelText("Pinned comment 1 on #hero-heading"),
    ).toBeInTheDocument();
    expect(
      getByLabelText("Pinned comment 2 on .primary-cta"),
    ).toHaveTextContent("Use the green brand color");
    await waitFor(() => expect(inspectWebPreview).toHaveBeenCalledTimes(3));

    const navigation = new Event("did-navigate-in-page") as Event & {
      url: string;
    };
    navigation.url = "http://localhost:3000/#hydrated";
    act(() => webview.dispatchEvent(navigation));
    expect(
      getByLabelText("Pinned comment 1 on #hero-heading"),
    ).toBeInTheDocument();

    fireEvent.click(getByRole("button", { name: "Execute 2 annotations" }));

    expect(onExecuteAnnotations).toHaveBeenCalledTimes(1);
    expect(onExecuteAnnotations).toHaveBeenCalledWith({
      url: "http://localhost:3000/#hydrated",
      annotations: [
        { selector: "#hero-heading", comment: "Make this heading smaller" },
        { selector: ".primary-cta", comment: "Use the green brand color" },
      ],
    });
    expect(queryByText("Execute")).toBeNull();
    expect(clearWebPreviewSelections).toHaveBeenCalledWith(42);
  });

  it("ignores stale picks and cancelling a draft preserves saved pins", async () => {
    const firstInspection = deferred<InspectionResult | null>();
    const secondInspection = deferred<InspectionResult | null>();
    const thirdInspection = deferred<InspectionResult | null>();
    const inspectWebPreview = vi
      .fn()
      .mockReturnValueOnce(firstInspection.promise)
      .mockReturnValueOnce(secondInspection.promise)
      .mockReturnValueOnce(thirdInspection.promise);
    const cancelWebPreviewInspection = vi.fn().mockResolvedValue(undefined);
    const releaseWebPreviewSelection = vi.fn().mockResolvedValue(undefined);
    installInspectorBridge({
      inspectWebPreview,
      cancelWebPreviewInspection,
      releaseWebPreviewSelection,
    });
    const { container, getByLabelText, getByPlaceholderText, getByTitle } =
      render(
        <WebPreviewPanel
          initialUrl="https://example.com/"
          onClose={vi.fn()}
          onExecuteAnnotations={vi.fn()}
        />,
      );
    const { webview } = configureWebview(container, 77);

    act(() => webview.dispatchEvent(new Event("dom-ready")));
    fireEvent.click(getByTitle(/^Annotate page/));
    await waitFor(() => expect(inspectWebPreview).toHaveBeenCalledTimes(1));
    fireEvent.click(getByTitle(/^Stop annotating/));
    fireEvent.click(getByTitle(/^Annotate page/));
    await waitFor(() => expect(inspectWebPreview).toHaveBeenCalledTimes(2));

    await act(async () => {
      firstInspection.resolve({
        annotationId: 1,
        selector: "#stale",
        rect: { left: 0, top: 0, width: 10, height: 10 },
      });
      await firstInspection.promise;
    });
    expect(
      container.querySelector(".web-preview-annotation-outline"),
    ).toBeNull();

    await act(async () => {
      secondInspection.resolve({
        annotationId: 2,
        selector: "#saved",
        rect: { left: 10, top: 10, width: 20, height: 20 },
      });
      await secondInspection.promise;
    });
    const savedInput = getByPlaceholderText("Add a comment…");
    fireEvent.change(savedInput, { target: { value: "Keep this" } });
    fireEvent.click(getByTitle(/^Save annotation/));
    await waitFor(() => expect(inspectWebPreview).toHaveBeenCalledTimes(3));

    await act(async () => {
      thirdInspection.resolve({
        annotationId: 3,
        selector: "#draft",
        rect: { left: 40, top: 40, width: 30, height: 30 },
      });
      await thirdInspection.promise;
    });
    fireEvent.keyDown(getByPlaceholderText("Add a comment…"), {
      key: "Escape",
    });

    expect(getByLabelText("Pinned comment 1 on #saved")).toHaveTextContent(
      "Keep this",
    );
    expect(releaseWebPreviewSelection).toHaveBeenCalledWith(77, 3);
    expect(cancelWebPreviewInspection).toHaveBeenCalled();
  });

  it("tracks multiple keyed rectangles and removes only disconnected pins", async () => {
    const firstInspection = deferred<InspectionResult | null>();
    const secondInspection = deferred<InspectionResult | null>();
    const firstMeasurement = deferred<Measurement[]>();
    const secondMeasurement = deferred<Measurement[]>();
    const inspectWebPreview = vi
      .fn()
      .mockReturnValueOnce(firstInspection.promise)
      .mockReturnValueOnce(secondInspection.promise)
      .mockImplementation(() => pendingPromise<InspectionResult | null>());
    const measureWebPreviewSelections = vi
      .fn()
      .mockReturnValueOnce(firstMeasurement.promise)
      .mockReturnValueOnce(secondMeasurement.promise)
      .mockImplementation(() => pendingPromise<Measurement[]>());
    const releaseWebPreviewSelection = vi.fn().mockResolvedValue(undefined);
    installInspectorBridge({
      inspectWebPreview,
      measureWebPreviewSelections,
      releaseWebPreviewSelection,
    });
    const { container, getByLabelText, getByPlaceholderText, getByTitle } =
      render(
        <WebPreviewPanel
          initialUrl="https://example.com/"
          onClose={vi.fn()}
          onExecuteAnnotations={vi.fn()}
        />,
      );
    const { webview } = configureWebview(container, 91);

    act(() => webview.dispatchEvent(new Event("dom-ready")));
    fireEvent.click(getByTitle(/^Annotate page/));
    await act(async () => {
      firstInspection.resolve({
        annotationId: 10,
        selector: "#moving-card",
        rect: { left: 430, top: 680, width: 100, height: 80 },
      });
      await firstInspection.promise;
    });
    const firstInput = getByPlaceholderText("Add a comment…");
    expect(firstInput.closest("form")).toHaveStyle({
      left: "108px",
      top: "644px",
      width: "360px",
    });

    await act(async () => {
      firstMeasurement.resolve([
        {
          annotationId: 10,
          rect: { left: 100, top: 200, width: 200, height: 20 },
        },
      ]);
      await firstMeasurement.promise;
    });
    fireEvent.change(firstInput, { target: { value: "Keep me pinned" } });
    fireEvent.click(getByTitle(/^Save annotation/));

    await act(async () => {
      secondInspection.resolve({
        annotationId: 11,
        selector: "#temporary-card",
        rect: { left: 20, top: 300, width: 120, height: 60 },
      });
      await secondInspection.promise;
    });
    const secondInput = getByPlaceholderText("Add a comment…");
    fireEvent.change(secondInput, { target: { value: "Remove if gone" } });
    fireEvent.click(getByTitle(/^Save annotation/));

    await waitFor(() =>
      expect(measureWebPreviewSelections).toHaveBeenCalledTimes(2),
    );
    await act(async () => {
      secondMeasurement.resolve([
        {
          annotationId: 10,
          rect: { left: 200, top: 300, width: 100, height: 60 },
        },
        { annotationId: 11, rect: null },
      ]);
      await secondMeasurement.promise;
    });

    await waitFor(() => {
      expect(getByLabelText("Pinned comment 1 on #moving-card")).toHaveStyle({
        left: "90px",
        top: "306px",
        width: "320px",
      });
      expect(
        container.querySelector('[aria-label*="#temporary-card"]'),
      ).toBeNull();
    });

    fireEvent.click(getByTitle("Remove annotation 1"));
    expect(releaseWebPreviewSelection).toHaveBeenCalledWith(91, 10);
  });
});

describe("WebPreviewPanel element editor", () => {
  it("starts editing after did-stop-loading when dom-ready was missed", async () => {
    const inspectWebPreview = vi.fn(() => pendingPromise<InspectionResult>());
    installInspectorBridge({ inspectWebPreview });
    const { container, getByRole } = render(
      <WebPreviewPanel initialUrl="https://nept.cloud" onClose={vi.fn()} />,
    );
    const { webview } = configureWebview(container, 54);

    act(() => webview.dispatchEvent(new Event("did-stop-loading")));
    fireEvent.click(getByRole("button", { name: "Edit text and typography" }));

    await waitFor(() => expect(inspectWebPreview).toHaveBeenCalledWith(54));
  });

  it("live-previews typography, restores on cancel, and saves through the agent", async () => {
    const inspection = deferred<InspectionResult | null>();
    const applyWebPreviewElementEdit = vi.fn().mockResolvedValue(true);
    const readWebPreviewElementEditState = vi.fn().mockResolvedValue({
      textContent: "Original heading",
      canEditText: true,
      styles: {
        color: "#112233",
        fontFamily: "Arial, Helvetica, sans-serif",
        fontSize: 32,
        fontWeight: "600",
        letterSpacing: -0.3,
        lineHeight: 38.4,
        textAlign: "left",
      },
      inlineStyles: {
        color: null,
        "font-family": null,
        "font-size": null,
        "font-weight": null,
        "letter-spacing": null,
        "line-height": null,
        "text-align": null,
      },
    });
    installInspectorBridge({
      inspectWebPreview: vi.fn(() => inspection.promise),
      readWebPreviewElementEditState,
      applyWebPreviewElementEdit,
    });
    const onSaveElementEdit = vi.fn();
    const { container, getByLabelText, getByRole, getByText } = render(
      <WebPreviewPanel
        initialUrl="http://localhost:3000/"
        onClose={vi.fn()}
        onSaveElementEdit={onSaveElementEdit}
      />,
    );
    const { webview } = configureWebview(container, 55);
    act(() => webview.dispatchEvent(new Event("dom-ready")));

    fireEvent.click(getByRole("button", { name: "Edit text and typography" }));
    await act(async () => {
      inspection.resolve({
        annotationId: 12,
        selector: "h1.hero-title",
        rect: { left: 10, top: 300, width: 460, height: 230 },
      });
      await inspection.promise;
    });
    await waitFor(() =>
      expect(readWebPreviewElementEditState).toHaveBeenCalledWith(55, 12),
    );
    expect(container.querySelector(".web-preview-edit-popover")).toHaveStyle({
      left: "60px",
      top: "12px",
      width: "360px",
      maxHeight: "276px",
    });

    const text = getByLabelText("Text");
    fireEvent.change(text, { target: { value: "Edited heading" } });
    const font = getByRole("button", { name: "Font" });
    expect(font).toHaveStyle({ fontFamily: "Arial, Helvetica, sans-serif" });
    fireEvent.click(font);
    const georgia = getByRole("option", { name: "Georgia Aa" });
    expect(georgia).toHaveStyle({ fontFamily: "Georgia" });
    expect(
      getByRole("option", { name: /Arial, Helvetica.*current.*Aa/ }),
    ).toBeVisible();
    fireEvent.click(georgia);
    fireEvent.change(getByLabelText("Weight"), {
      target: { value: "800" },
    });
    await waitFor(() =>
      expect(applyWebPreviewElementEdit).toHaveBeenLastCalledWith(
        55,
        12,
        expect.objectContaining({
          textContent: "Edited heading",
          styles: expect.objectContaining({
            "font-family": "Georgia",
            "font-weight": "800",
          }),
        }),
      ),
    );

    fireEvent.click(getByText("Save"));
    expect(onSaveElementEdit).toHaveBeenCalledWith({
      url: "http://localhost:3000/",
      selector: "h1.hero-title",
      edit: expect.objectContaining({
        textContent: "Edited heading",
        fontFamily: "Georgia",
        fontWeight: "800",
      }),
    });
    expect(
      container.querySelector(".web-preview-edit-popover"),
    ).not.toBeInTheDocument();
  });
});
