import { afterEach, describe, expect, it, vi } from "vitest";

const electronMock = vi.hoisted(() => {
  const state = {
    eventHandlers: new Map<string, (...args: unknown[]) => void>(),
    onBeforeRequestHandler: undefined as
      | ((
          details: { url: string; resourceType: string },
          callback: (response: { cancel: boolean }) => void,
        ) => void)
      | undefined,
  };

  const webRequest = {
    onBeforeRequest: vi.fn(
      (
        _filter: { urls: string[] },
        handler: (
          details: { url: string; resourceType: string },
          callback: (response: { cancel: boolean }) => void,
        ) => void,
      ) => {
        state.onBeforeRequestHandler = handler;
      },
    ),
  };
  const session = { webRequest };
  const webContents = {
    executeJavaScript: vi.fn(),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      state.eventHandlers.set(event, handler);
    }),
    session,
    setWindowOpenHandler: vi.fn(),
    stop: vi.fn(),
  };
  const windowInstance = {
    destroy: vi.fn(),
    isDestroyed: vi.fn(() => false),
    loadURL: vi.fn(),
    webContents,
  };
  const BrowserWindow = vi.fn(function BrowserWindow(_options: unknown) {
    return windowInstance;
  });

  return {
    BrowserWindow,
    state,
    webContents,
    webRequest,
    windowInstance,
  };
});

vi.mock("electron", () => ({
  BrowserWindow: electronMock.BrowserWindow,
}));

import {
  discoverSubstackCardsWithBrowser,
  extractSubstackVisibleCards,
  isAllowedSubstackBrowserRequestUrl,
  isAllowedSubstackDiscoveryUrl,
  isSubstackRenderSnapshotSettled,
  snapshotSubstackRenderState,
} from "./substack-radar-browser";

const html = `
  <main>
    <a href="https://agentnotes.substack.com">
      <h3>Agent Notes</h3>
      <p>Deep field notes about AI agents and workflows.</p>
      <span>12K subscribers</span>
      <span>Bestseller</span>
    </a>
    <a href="/@writer">
      <h3>Ignored relative profile</h3>
    </a>
  </main>
`;

function resetElectronMock(): void {
  electronMock.BrowserWindow.mockClear();
  electronMock.windowInstance.destroy.mockClear();
  electronMock.windowInstance.isDestroyed.mockClear();
  electronMock.windowInstance.isDestroyed.mockReturnValue(false);
  electronMock.windowInstance.loadURL.mockReset();
  electronMock.webContents.executeJavaScript.mockReset();
  electronMock.webContents.on.mockClear();
  electronMock.webContents.setWindowOpenHandler.mockClear();
  electronMock.webContents.stop.mockClear();
  electronMock.webRequest.onBeforeRequest.mockClear();
  electronMock.state.eventHandlers.clear();
  electronMock.state.onBeforeRequestHandler = undefined;
}

describe("extractSubstackVisibleCards", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("extracts public Substack publication cards from visible HTML", () => {
    expect(
      extractSubstackVisibleCards(
        html,
        "AI agents",
        "https://substack.com/explore",
      ),
    ).toEqual([
      {
        publicationUrl: "https://agentnotes.substack.com/",
        title: "Agent Notes",
        description: "Deep field notes about AI agents and workflows.",
        author: "",
        category: "AI agents",
        visibleSignals: {
          subscriberText: "12K subscribers",
          badgeText: "Bestseller",
        },
        sourcePageUrl: "https://substack.com/explore",
      },
    ]);
  });

  it("extracts from the nearest visible card around a publication link", () => {
    const siblingCardHtml = `
      <main>
        <article>
          <a href="https://fieldnotes.substack.com">Open publication</a>
          <h3>Field Notes</h3>
          <p>Sharp reporting about applied AI systems.</p>
          <span>22K subscribers</span>
          <span>Featured</span>
        </article>
      </main>
    `;

    expect(
      extractSubstackVisibleCards(
        siblingCardHtml,
        "Applied AI",
        "https://substack.com/search/ai",
      ),
    ).toEqual([
      {
        publicationUrl: "https://fieldnotes.substack.com/",
        title: "Field Notes",
        description: "Sharp reporting about applied AI systems.",
        author: "",
        category: "Applied AI",
        visibleSignals: {
          subscriberText: "22K subscribers",
          badgeText: "Featured",
        },
        sourcePageUrl: "https://substack.com/search/ai",
      },
    ]);
  });

  it("uses markup fallback when DOMParser is unavailable", () => {
    vi.stubGlobal("DOMParser", undefined);

    const fallbackHtml = `
      <main>
        <div class="publication-card">
          <h3>Fallback Dispatch</h3>
          <a href="https://fallbackdispatch.substack.com">Read</a>
          <p>Browser-free extraction for public discovery cards.</p>
          <span>2K subscribers</span>
          <span>Bestseller</span>
        </div>
      </main>
    `;

    expect(
      extractSubstackVisibleCards(
        fallbackHtml,
        "Discovery",
        "https://substack.com/explore",
      ),
    ).toEqual([
      {
        publicationUrl: "https://fallbackdispatch.substack.com/",
        title: "Fallback Dispatch",
        description: "Browser-free extraction for public discovery cards.",
        author: "",
        category: "Discovery",
        visibleSignals: {
          subscriberText: "2K subscribers",
          badgeText: "Bestseller",
        },
        sourcePageUrl: "https://substack.com/explore",
      },
    ]);
  });
});

describe("isAllowedSubstackDiscoveryUrl", () => {
  it("accepts only public Substack explore and search pages", () => {
    expect(isAllowedSubstackDiscoveryUrl("https://substack.com/explore")).toBe(
      true,
    );
    expect(
      isAllowedSubstackDiscoveryUrl("https://substack.com/search/ai-agents"),
    ).toBe(true);
    expect(isAllowedSubstackDiscoveryUrl("https://substack.com/search/")).toBe(
      false,
    );
    expect(
      isAllowedSubstackDiscoveryUrl("https://agentnotes.substack.com"),
    ).toBe(false);
    expect(isAllowedSubstackDiscoveryUrl("http://substack.com/explore")).toBe(
      false,
    );
  });
});

describe("isAllowedSubstackBrowserRequestUrl", () => {
  it("allows only HTTPS Substack and Substack CDN requests", () => {
    expect(
      isAllowedSubstackBrowserRequestUrl("https://substack.com/explore"),
    ).toBe(true);
    expect(
      isAllowedSubstackBrowserRequestUrl("https://agentnotes.substack.com/p/x"),
    ).toBe(true);
    expect(
      isAllowedSubstackBrowserRequestUrl("https://substackcdn.com/image.png"),
    ).toBe(true);
    expect(
      isAllowedSubstackBrowserRequestUrl("http://substack.com/explore"),
    ).toBe(false);
    expect(isAllowedSubstackBrowserRequestUrl("https://localhost:8642")).toBe(
      false,
    );
    expect(isAllowedSubstackBrowserRequestUrl("https://127.0.0.1:8642")).toBe(
      false,
    );
    expect(isAllowedSubstackBrowserRequestUrl("https://10.0.0.4/feed")).toBe(
      false,
    );
    expect(
      isAllowedSubstackBrowserRequestUrl("https://169.254.169.254/latest"),
    ).toBe(false);
    expect(isAllowedSubstackBrowserRequestUrl("https://[::1]/")).toBe(false);
    expect(isAllowedSubstackBrowserRequestUrl("https://example.com/feed")).toBe(
      false,
    );
  });
});

describe("Substack render settle snapshots", () => {
  it("does not settle before delayed sibling card content is visible", () => {
    const earlyHtml = `
      <main>
        <article>
          <a href="https://slowfieldnotes.substack.com">Open publication</a>
        </article>
      </main>
    `;
    const settledHtml = `
      <main>
        <article>
          <a href="https://slowfieldnotes.substack.com">Open publication</a>
          <h3>Slow Field Notes</h3>
          <p>Delayed reporting about rendered discovery cards.</p>
          <span>44K subscribers</span>
        </article>
      </main>
    `;

    const early = snapshotSubstackRenderState(
      earlyHtml,
      "AI agents",
      "https://substack.com/explore",
    );
    const settled = snapshotSubstackRenderState(
      settledHtml,
      "AI agents",
      "https://substack.com/explore",
    );

    expect(isSubstackRenderSnapshotSettled(early, early, 2)).toBe(false);
    expect(isSubstackRenderSnapshotSettled(early, settled, 1)).toBe(false);
    expect(isSubstackRenderSnapshotSettled(settled, settled, 2)).toBe(true);
  });
});

describe("discoverSubstackCardsWithBrowser", () => {
  afterEach(() => {
    vi.useRealTimers();
    resetElectronMock();
  });

  it("creates a hidden sandboxed non-persistent browser and extracts scored cards", async () => {
    resetElectronMock();
    electronMock.windowInstance.loadURL.mockResolvedValue(undefined);
    electronMock.webContents.executeJavaScript.mockResolvedValue(`
      <main>
        <article>
          <a href="https://agentnotes.substack.com">Open</a>
          <h3>Agent Notes</h3>
          <p>Deep field notes about AI agents and workflows.</p>
          <span>12K subscribers</span>
          <span>Bestseller</span>
        </article>
      </main>
    `);

    const cards = await discoverSubstackCardsWithBrowser(
      "AI agents",
      "https://substack.com/explore",
    );

    expect(electronMock.BrowserWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        show: false,
        webPreferences: expect.objectContaining({
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webviewTag: false,
          partition: expect.stringMatching(/^substack-radar:/),
        }),
      }),
    );
    const options = electronMock.BrowserWindow.mock.calls[0]?.[0] as
      | { webPreferences?: { partition?: string } }
      | undefined;
    expect(options?.webPreferences?.partition).not.toMatch(/^persist:/);
    expect(cards).toEqual([
      expect.objectContaining({
        id: "substack-radar:https://agentnotes.substack.com/",
        publicationUrl: "https://agentnotes.substack.com/",
        score: 92,
        title: "Agent Notes",
      }),
    ]);
    expect(electronMock.windowInstance.destroy).toHaveBeenCalled();
  });

  it("denies popups, webviews, off-allowlist navigations, and off-allowlist requests", async () => {
    resetElectronMock();
    electronMock.windowInstance.loadURL.mockResolvedValue(undefined);
    electronMock.webContents.executeJavaScript.mockResolvedValue(`
      <main>
        <a href="https://agentnotes.substack.com">
          <h3>Agent Notes</h3>
          <p>Deep field notes about AI agents and workflows.</p>
        </a>
      </main>
    `);

    await discoverSubstackCardsWithBrowser(
      "AI agents",
      "https://substack.com/explore",
    );

    const windowOpenHandler =
      electronMock.webContents.setWindowOpenHandler.mock.calls[0]?.[0];
    expect(windowOpenHandler?.()).toEqual({ action: "deny" });

    const preventWebview = vi.fn();
    electronMock.state.eventHandlers.get("will-attach-webview")?.({
      preventDefault: preventWebview,
    });
    expect(preventWebview).toHaveBeenCalled();

    const preventNavigation = vi.fn();
    electronMock.state.eventHandlers.get("will-navigate")?.(
      { preventDefault: preventNavigation },
      "https://example.com/",
    );
    expect(preventNavigation).toHaveBeenCalled();

    const requestHandler = electronMock.state.onBeforeRequestHandler;
    expect(requestHandler).toBeDefined();
    expect(electronMock.webRequest.onBeforeRequest).toHaveBeenCalledWith(
      { urls: ["<all_urls>"] },
      expect.any(Function),
    );

    const requestDecision = (
      url: string,
      resourceType = "image",
    ): { cancel: boolean } | undefined => {
      let result: { cancel: boolean } | undefined;
      requestHandler?.({ url, resourceType }, (response) => {
        result = response;
      });
      return result;
    };

    expect(requestDecision("https://substack.com/explore")).toEqual({
      cancel: false,
    });
    expect(requestDecision("https://agentnotes.substack.com/p/x")).toEqual({
      cancel: false,
    });
    expect(requestDecision("https://substackcdn.com/image.png")).toEqual({
      cancel: false,
    });
    expect(requestDecision("https://localhost:8642/private")).toEqual({
      cancel: true,
    });
    expect(requestDecision("https://127.0.0.1:8642/private")).toEqual({
      cancel: true,
    });
    expect(requestDecision("https://example.com/tracker.js", "script")).toEqual(
      {
        cancel: true,
      },
    );
  });

  it("stops and destroys the browser on load timeout", async () => {
    resetElectronMock();
    vi.useFakeTimers();
    electronMock.windowInstance.loadURL.mockReturnValue(new Promise(() => {}));

    const discovery = discoverSubstackCardsWithBrowser(
      "AI agents",
      "https://substack.com/explore",
    );
    const rejection = expect(discovery).rejects.toThrow(
      /Timed out loading Substack page/,
    );

    await vi.runOnlyPendingTimersAsync();
    await rejection;
    expect(electronMock.webContents.stop).toHaveBeenCalled();
    expect(electronMock.windowInstance.destroy).toHaveBeenCalled();
  });
});
