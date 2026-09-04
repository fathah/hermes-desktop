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
  cancelWebPreviewInspection,
  inspectWebPreview,
  WEB_PREVIEW_INSPECTOR_SOURCE,
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
      selector: "#hero-heading",
      rect: { left: 10, top: 20, width: 300, height: 80 },
    });
    electronMock.fromId.mockReturnValue(target);

    await expect(
      inspectWebPreview(event as never, 42, () => mainWindow as never),
    ).resolves.toEqual({
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
