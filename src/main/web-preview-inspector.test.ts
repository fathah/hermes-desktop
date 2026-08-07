import { beforeEach, describe, expect, it, vi } from "vitest";

const electronMock = vi.hoisted(() => {
  return {
    previewSession: {},
    fromId: vi.fn(),
    fromPartition: vi.fn(),
  };
});

vi.mock("electron", () => ({
  session: { fromPartition: electronMock.fromPartition },
  webContents: { fromId: electronMock.fromId },
}));

import {
  applyWebPreviewElementEdit,
  cancelWebPreviewInspection,
  clearWebPreviewSelections,
  inspectWebPreview,
  measureWebPreviewSelections,
  readWebPreviewElementEditState,
  releaseWebPreviewSelection,
  WEB_PREVIEW_INSPECTOR_SOURCE,
  WEB_PREVIEW_SELECTION_RECTS_SOURCE,
} from "./web-preview-inspector";

function createAuthorizedContext(): {
  event: { sender: object; senderFrame: object };
  mainWindow: { webContents: object };
  target: {
    isDestroyed: ReturnType<typeof vi.fn>;
    getType: ReturnType<typeof vi.fn>;
    hostWebContents: object;
    session: object;
    executeJavaScriptInIsolatedWorld: ReturnType<typeof vi.fn>;
  };
} {
  const mainFrame = {};
  const sender = { mainFrame };
  const target = {
    isDestroyed: vi.fn(() => false),
    getType: vi.fn(() => "webview"),
    hostWebContents: sender,
    session: electronMock.previewSession,
    executeJavaScriptInIsolatedWorld: vi.fn(),
  };
  return {
    event: { sender, senderFrame: mainFrame },
    mainWindow: { webContents: sender },
    target,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  electronMock.fromPartition.mockReturnValue(electronMock.previewSession);
});

describe("web preview inspector IPC", () => {
  it("runs only fixed source in an isolated world and normalizes the result", async () => {
    const { event, mainWindow, target } = createAuthorizedContext();
    target.executeJavaScriptInIsolatedWorld.mockResolvedValue({
      annotationId: 1,
      selector: "#hero-heading",
      rect: { left: 10, top: 20, width: 300, height: 80 },
    });
    electronMock.fromId.mockReturnValue(target);

    await expect(
      inspectWebPreview(event as never, 42, () => mainWindow as never),
    ).resolves.toEqual({
      annotationId: 1,
      selector: "#hero-heading",
      rect: { left: 10, top: 20, width: 300, height: 80 },
    });
    expect(target.executeJavaScriptInIsolatedWorld).toHaveBeenCalledWith(
      1_001,
      [{ code: WEB_PREVIEW_INSPECTOR_SOURCE }],
    );
    expect(WEB_PREVIEW_INSPECTOR_SOURCE).not.toContain("outerHTML");
    expect(WEB_PREVIEW_INSPECTOR_SOURCE).not.toContain("console.");
    expect(WEB_PREVIEW_INSPECTOR_SOURCE).not.toContain("Add a comment");
    expect(WEB_PREVIEW_INSPECTOR_SOURCE).toContain("event.isTrusted");
    expect(WEB_PREVIEW_INSPECTOR_SOURCE).toContain(
      "const selectedElement = elementAtPoint(event.clientX, event.clientY)",
    );
    expect(WEB_PREVIEW_INSPECTOR_SOURCE).toContain(
      "globalThis.__hermesWebPreviewSelectedElements = selections",
    );
    expect(WEB_PREVIEW_INSPECTOR_SOURCE).toContain(
      "selections.set(annotationId, selectedElement)",
    );
  });

  it("rejects unauthorized callers, targets, and malformed results", async () => {
    const { event, mainWindow, target } = createAuthorizedContext();
    electronMock.fromId.mockReturnValue(target);

    await expect(
      inspectWebPreview(
        { ...event, senderFrame: {} } as never,
        42,
        () => mainWindow as never,
      ),
    ).rejects.toThrow("Unauthorized");

    target.session = {};
    await expect(
      inspectWebPreview(event as never, 42, () => mainWindow as never),
    ).rejects.toThrow("Invalid web preview target");

    target.session = electronMock.previewSession;
    target.executeJavaScriptInIsolatedWorld.mockResolvedValue({
      annotationId: 1,
      selector: "body",
      rect: { left: "invalid", top: 0, width: 1, height: 1 },
    });
    await expect(
      inspectWebPreview(event as never, 42, () => mainWindow as never),
    ).rejects.toThrow("Invalid web preview inspection result");
  });

  it("cancels through fixed code in the same isolated world", async () => {
    const { event, mainWindow, target } = createAuthorizedContext();
    target.executeJavaScriptInIsolatedWorld.mockResolvedValue(undefined);
    electronMock.fromId.mockReturnValue(target);

    await expect(
      cancelWebPreviewInspection(event as never, 42, () => mainWindow as never),
    ).resolves.toBeUndefined();
    expect(target.executeJavaScriptInIsolatedWorld).toHaveBeenCalledWith(
      1_001,
      [
        {
          code: expect.stringContaining("__hermesWebPreviewInspectorCleanup"),
        },
      ],
    );
    expect(
      target.executeJavaScriptInIsolatedWorld.mock.calls[0]?.[1]?.[0]?.code,
    ).not.toContain("__hermesWebPreviewSelectedElements.clear");
  });

  it("remeasures all retained elements through fixed isolated-world code", async () => {
    const { event, mainWindow, target } = createAuthorizedContext();
    target.executeJavaScriptInIsolatedWorld.mockResolvedValue([
      {
        annotationId: 1,
        rect: { left: 30, top: 40, width: 250, height: 90 },
      },
      { annotationId: 2, rect: null },
    ]);
    electronMock.fromId.mockReturnValue(target);

    await expect(
      measureWebPreviewSelections(
        event as never,
        42,
        () => mainWindow as never,
      ),
    ).resolves.toEqual([
      {
        annotationId: 1,
        rect: { left: 30, top: 40, width: 250, height: 90 },
      },
      { annotationId: 2, rect: null },
    ]);
    expect(target.executeJavaScriptInIsolatedWorld).toHaveBeenCalledWith(
      1_001,
      [{ code: WEB_PREVIEW_SELECTION_RECTS_SOURCE }],
    );

    target.executeJavaScriptInIsolatedWorld.mockResolvedValue([
      {
        annotationId: 1,
        rect: { left: 30, top: Number.NaN, width: 250, height: 90 },
      },
    ]);
    await expect(
      measureWebPreviewSelections(
        event as never,
        42,
        () => mainWindow as never,
      ),
    ).rejects.toThrow("Invalid web preview selection measurements");
  });

  it("reads validated text and typography state for a retained element", async () => {
    const { event, mainWindow, target } = createAuthorizedContext();
    const editState = {
      textContent: "Board knows what happens next.",
      canEditText: true,
      styles: {
        color: "rgb(239, 68, 68)",
        fontFamily: "Inter, sans-serif",
        fontSize: 32,
        fontWeight: "600",
        letterSpacing: -0.32,
        lineHeight: 38.4,
        textAlign: "start",
      },
      inlineStyles: {
        color: null,
        "font-family": null,
        "font-size": "32px",
        "font-weight": "600",
        "letter-spacing": null,
        "line-height": null,
        "text-align": null,
      },
    };
    target.executeJavaScriptInIsolatedWorld.mockResolvedValue(editState);
    electronMock.fromId.mockReturnValue(target);

    await expect(
      readWebPreviewElementEditState(
        event as never,
        42,
        9,
        () => mainWindow as never,
      ),
    ).resolves.toEqual(editState);
    const source = target.executeJavaScriptInIsolatedWorld.mock
      .calls[0]?.[1]?.[0]?.code as string;
    expect(source).toContain("selections.get(9)");
    expect(source).toContain("getComputedStyle");
    expect(source).not.toContain("outerHTML");

    target.executeJavaScriptInIsolatedWorld.mockResolvedValue({
      ...editState,
      styles: { ...editState.styles, fontSize: Number.NaN },
    });
    await expect(
      readWebPreviewElementEditState(
        event as never,
        42,
        9,
        () => mainWindow as never,
      ),
    ).rejects.toThrow("Invalid web preview element edit state");
  });

  it("applies only validated text and typography properties", async () => {
    const { event, mainWindow, target } = createAuthorizedContext();
    target.executeJavaScriptInIsolatedWorld.mockResolvedValue(true);
    electronMock.fromId.mockReturnValue(target);

    await expect(
      applyWebPreviewElementEdit(
        event as never,
        42,
        9,
        {
          textContent: 'Safe text "; globalThis.pwned = true;',
          styles: {
            color: "#ef4444",
            "font-size": "32px",
            "font-weight": "600",
          },
        },
        () => mainWindow as never,
      ),
    ).resolves.toBe(true);
    const source = target.executeJavaScriptInIsolatedWorld.mock
      .calls[0]?.[1]?.[0]?.code as string;
    expect(source).toContain("selections.get(9)");
    expect(source).toContain("globalThis.atob");
    expect(source).toContain("element.style.setProperty");
    expect(source).not.toContain("globalThis.pwned");

    await expect(
      applyWebPreviewElementEdit(
        event as never,
        42,
        9,
        { styles: { background: "red" } },
        () => mainWindow as never,
      ),
    ).rejects.toThrow("Invalid web preview element edit patch");
  });

  it("releases one retained element or clears the complete batch", async () => {
    const { event, mainWindow, target } = createAuthorizedContext();
    target.executeJavaScriptInIsolatedWorld.mockResolvedValue(undefined);
    electronMock.fromId.mockReturnValue(target);

    await releaseWebPreviewSelection(
      event as never,
      42,
      7,
      () => mainWindow as never,
    );
    expect(target.executeJavaScriptInIsolatedWorld).toHaveBeenLastCalledWith(
      1_001,
      [{ code: expect.stringContaining(".delete(7)") }],
    );

    await expect(
      releaseWebPreviewSelection(
        event as never,
        42,
        "7",
        () => mainWindow as never,
      ),
    ).rejects.toThrow("Invalid web preview annotation ID");

    await clearWebPreviewSelections(
      event as never,
      42,
      () => mainWindow as never,
    );
    expect(target.executeJavaScriptInIsolatedWorld).toHaveBeenLastCalledWith(
      1_001,
      [{ code: expect.stringContaining("SelectedElements.clear") }],
    );
  });
});

describe("web preview inspector source", () => {
  it("rejects synthetic selection events and suppresses target pointer handlers", async () => {
    const selectedElement = document.createElement("h1");
    selectedElement.id = "hero-heading";
    selectedElement.getBoundingClientRect = () =>
      ({
        left: 10,
        top: 20,
        right: 310,
        bottom: 100,
        width: 300,
        height: 80,
        x: 10,
        y: 20,
        toJSON: () => ({}),
      }) as DOMRect;
    document.body.appendChild(selectedElement);
    const originalElementFromPoint = document.elementFromPoint;
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => selectedElement),
    });
    const pagePointerHandler = vi.fn();
    selectedElement.addEventListener("pointerdown", pagePointerHandler);

    try {
      const resultPromise = new Function(
        `return (${WEB_PREVIEW_INSPECTOR_SOURCE});`,
      )() as Promise<unknown>;
      let settled = false;
      void resultPromise.then(() => {
        settled = true;
      });
      selectedElement.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          clientX: 20,
          clientY: 30,
        }),
      );
      selectedElement.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true }),
      );
      selectedElement.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      await Promise.resolve();
      expect(settled).toBe(false);
      expect(pagePointerHandler).not.toHaveBeenCalled();

      const cleanupInspector = (
        globalThis as typeof globalThis & {
          __hermesWebPreviewInspectorCleanup?: () => void;
        }
      ).__hermesWebPreviewInspectorCleanup;
      expect(cleanupInspector).toBeTypeOf("function");
      cleanupInspector?.();
      await expect(resultPromise).resolves.toBeNull();
      expect(document.body.children).toHaveLength(1);
    } finally {
      selectedElement.remove();
      Object.defineProperty(document, "elementFromPoint", {
        configurable: true,
        value: originalElementFromPoint,
      });
    }
  });
});
