import { describe, expect, it, vi } from "vitest";
import { pathToFileURL } from "url";
import { readFileSync } from "fs";
import { join } from "path";
import {
  hardenAttachedWebContents,
  hardenWebviewPreferences,
  isAllowedAppNavigationUrl,
  isAllowedExternalUrl,
  isAllowedWebviewUrl,
} from "../src/main/security";

const ROOT = join(__dirname, "..");
// Main-process window/security wiring lives in the startup module after the
// app/ refactor; index.ts only bootstraps it via startMainProcess().
const mainSrc = readFileSync(join(ROOT, "src/main/app/start.ts"), "utf-8");
const menuSrc = readFileSync(join(ROOT, "src/main/app/menu.ts"), "utf-8");
const preloadSrc = readFileSync(join(ROOT, "src/preload/index.ts"), "utf-8");
const installerSrc = readFileSync(join(ROOT, "src/main/installer.ts"), "utf-8");

describe("Electron main process hardening", () => {
  it("keeps the main renderer isolated from Node privileges", () => {
    expect(mainSrc).toContain("nodeIntegration: false");
    expect(mainSrc).toContain("contextIsolation: true");
    expect(mainSrc).toContain("sandbox: true");
    expect(mainSrc).toContain("webSecurity: true");
    expect(mainSrc).toContain("allowRunningInsecureContent: false");
  });

  it("keeps a production diagnostics path for renderer DevTools", () => {
    expect(mainSrc).toContain("HERMES_OPEN_DEVTOOLS");
    expect(mainSrc).toContain("openDevTools({ mode: \"detach\" })");
    expect(menuSrc).toContain("Toggle Developer Tools");
    expect(menuSrc).toContain("toggleDevTools()");
  });

  it("loads the packaged renderer next to the bundled main output", () => {
    expect(mainSrc).toContain(
      'join(__dirname, "../renderer/index.html")',
    );
    expect(mainSrc).not.toContain(
      'join(__dirname, "../../renderer/index.html")',
    );
  });

  it("blocks untrusted top-level navigation and webview attachment", () => {
    expect(mainSrc).toContain("setWindowOpenHandler((details) => {");
    expect(mainSrc).toContain('webContents.on("will-navigate"');
    expect(mainSrc).toContain('"will-attach-webview"');
    expect(mainSrc).toContain("isAllowedAppNavigationUrl(");
    expect(mainSrc).toContain("isAllowedWebviewUrl(params.src");
    expect(mainSrc).toContain("hardenWebviewPreferences(webPreferences)");
  });

  it("keeps attached webviews constrained after initial attachment", () => {
    expect(mainSrc).toContain('app.on("web-contents-created"');
    expect(mainSrc).toContain('contents.getType() === "webview"');
    expect(mainSrc).toContain(
      "hardenAttachedWebContents(contents, isWebPreview)",
    );
  });

  it("identifies the web preview webview by its dedicated session, not a spoofable attribute", () => {
    // getLastWebPreferences is not a public Electron API and returns undefined;
    // the preview must be recognized via its partition session instead.
    expect(mainSrc).not.toContain("getLastWebPreferences");
    expect(mainSrc).toContain('session.fromPartition("web-preview")');
  });

  it("routes shell.openExternal through the allowlist helper", () => {
    const directShellOpens = mainSrc.match(/shell\.openExternal\(/g) ?? [];
    expect(directShellOpens).toHaveLength(1);
    expect(mainSrc).toContain(
      "function openExternalUrl(rawUrl: unknown): void",
    );
  });

  it("keeps the sandboxed main preload free of external runtime imports", () => {
    expect(preloadSrc).not.toContain("@electron-toolkit/preload");
  });

  it("runs hermes doctor without a shell-built command string", () => {
    expect(installerSrc).toContain(
      'execFileSync(HERMES_PYTHON, hermesCliArgs(["doctor"])',
    );
    expect(installerSrc).not.toContain("execSync(`");
  });

  it("keeps the Linux sudo precache install flow wired in", () => {
    expect(installerSrc).toContain(
      'import { precacheSudoCredentials } from "./sudoCreds"',
    );
    expect(installerSrc).toContain(
      "const sudoPrecache = await precacheSudoCredentials(",
    );
    expect(installerSrc).toContain("sudoPrecache.stop();");
  });
});

describe("Electron external URL policy", () => {
  it("allows browser-safe external protocols", () => {
    expect(isAllowedExternalUrl("https://example.com/docs")).toBe(true);
    expect(isAllowedExternalUrl("http://localhost:3000")).toBe(true);
    expect(isAllowedExternalUrl("mailto:security@example.com")).toBe(true);
  });

  it("blocks dangerous or ambiguous external URLs", () => {
    expect(isAllowedExternalUrl("javascript:alert(1)")).toBe(false);
    expect(
      isAllowedExternalUrl("data:text/html,<script>alert(1)</script>"),
    ).toBe(false);
    expect(isAllowedExternalUrl("file:///C:/Users/me/token.txt")).toBe(false);
    expect(isAllowedExternalUrl("/relative/path")).toBe(false);
    expect(isAllowedExternalUrl({ href: "https://example.com" })).toBe(false);
  });
});

describe("Electron app navigation policy", () => {
  const rendererHtmlPath = "C:\\app\\out\\renderer\\index.html";
  const rendererUrl = pathToFileURL(rendererHtmlPath).href;

  it("allows the packaged renderer file", () => {
    expect(isAllowedAppNavigationUrl(rendererUrl, rendererHtmlPath)).toBe(true);
    expect(
      isAllowedAppNavigationUrl(`${rendererUrl}#settings`, rendererHtmlPath),
    ).toBe(true);
  });

  it("allows only the configured dev server origin in dev mode", () => {
    expect(
      isAllowedAppNavigationUrl(
        "http://localhost:5173/src/main.tsx",
        rendererHtmlPath,
        "http://localhost:5173",
      ),
    ).toBe(true);
    expect(
      isAllowedAppNavigationUrl(
        "http://localhost:3000",
        rendererHtmlPath,
        "http://localhost:5173",
      ),
    ).toBe(false);
  });

  it("blocks navigation to other local or remote documents", () => {
    expect(
      isAllowedAppNavigationUrl(
        "file:///C:/Users/me/secrets.html",
        rendererHtmlPath,
      ),
    ).toBe(false);
    expect(
      isAllowedAppNavigationUrl("https://example.com", rendererHtmlPath),
    ).toBe(false);
  });
});

describe("Electron webview policy", () => {
  it("allows loopback HTTP URLs on app-controlled ports and about:blank, and remote/local HTTPS URLs when permitted", () => {
    expect(isAllowedWebviewUrl("http://localhost:3000")).toBe(true);
    expect(isAllowedWebviewUrl("http://127.0.0.1:65535/path")).toBe(true);
    expect(isAllowedWebviewUrl("http://[::1]:3000")).toBe(true);
    expect(isAllowedWebviewUrl("about:blank")).toBe(true);

    // By default, HTTPS is blocked
    expect(isAllowedWebviewUrl("https://localhost:3000")).toBe(false);
    expect(isAllowedWebviewUrl("https://example.com/docs")).toBe(false);

    // HTTPS is allowed when explicitly permitted
    expect(isAllowedWebviewUrl("https://localhost:3000", true)).toBe(true);
    expect(isAllowedWebviewUrl("https://example.com/docs", true)).toBe(true);
  });

  it("blocks remote HTTP, invalid ports, and non-HTTP/HTTPS webview URLs", () => {
    expect(isAllowedWebviewUrl("http://example.com:3000")).toBe(false);
    expect(isAllowedWebviewUrl("http://localhost:80")).toBe(false);
    expect(isAllowedWebviewUrl("file:///C:/Users/me/page.html")).toBe(false);
    expect(isAllowedWebviewUrl("javascript:alert(1)")).toBe(false);
  });

  it("removes privileged webview capabilities before attachment", () => {
    const webPreferences = {
      preload: "C:\\tmp\\evil-preload.js",
      preloadURL: "file:///C:/tmp/evil-preload.js",
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
      webSecurity: false,
      allowRunningInsecureContent: true,
    };

    hardenWebviewPreferences(webPreferences);

    expect(webPreferences).not.toHaveProperty("preload");
    expect(webPreferences).not.toHaveProperty("preloadURL");
    expect(webPreferences.nodeIntegration).toBe(false);
    expect(webPreferences.contextIsolation).toBe(true);
    expect(webPreferences.sandbox).toBe(true);
    expect(webPreferences.webSecurity).toBe(true);
    expect(webPreferences.allowRunningInsecureContent).toBe(false);
  });

  it("blocks post-attachment navigation away from loopback webview URLs", () => {
    type NavigationHandler = (
      event: { preventDefault: () => void },
      url: string,
    ) => void;
    const handlers = new Map<string, NavigationHandler>();
    const webContentsMock = {
      setWindowOpenHandler: vi.fn(),
      on: vi.fn((event: string, handler: NavigationHandler) => {
        handlers.set(event, handler);
      }),
    };

    // Default (non-preview) webview: only loopback HTTP is permitted.
    hardenAttachedWebContents(
      webContentsMock as unknown as Parameters<
        typeof hardenAttachedWebContents
      >[0],
    );

    expect(webContentsMock.setWindowOpenHandler).toHaveBeenCalledWith(
      expect.any(Function),
    );
    expect(handlers.has("will-navigate")).toBe(true);
    expect(handlers.has("will-redirect")).toBe(true);

    const allowedEvent = { preventDefault: vi.fn() };
    handlers.get("will-navigate")?.(allowedEvent, "http://localhost:3000");
    expect(allowedEvent.preventDefault).not.toHaveBeenCalled();

    const blockedEvent = { preventDefault: vi.fn() };
    handlers.get("will-navigate")?.(blockedEvent, "http://attacker.com:3000");
    expect(blockedEvent.preventDefault).toHaveBeenCalled();

    const redirectedEvent = { preventDefault: vi.fn() };
    handlers.get("will-redirect")?.(redirectedEvent, "http://example.com:3000");
    expect(redirectedEvent.preventDefault).toHaveBeenCalled();

    // A non-preview webview must still block remote HTTPS.
    const httpsEvent = { preventDefault: vi.fn() };
    handlers.get("will-navigate")?.(httpsEvent, "https://example.com/docs");
    expect(httpsEvent.preventDefault).toHaveBeenCalled();
  });

  it("allows post-attachment navigation/redirects to remote HTTPS for the web preview webview", () => {
    type NavigationHandler = (
      event: { preventDefault: () => void },
      url: string,
    ) => void;
    const handlers = new Map<string, NavigationHandler>();
    const webContentsMock = {
      setWindowOpenHandler: vi.fn(),
      on: vi.fn((event: string, handler: NavigationHandler) => {
        handlers.set(event, handler);
      }),
    };

    // isWebPreview=true is supplied by the caller (index.ts decides this by
    // comparing webContents.session against session.fromPartition).
    hardenAttachedWebContents(
      webContentsMock as unknown as Parameters<
        typeof hardenAttachedWebContents
      >[0],
      true,
    );

    const navEvent = { preventDefault: vi.fn() };
    handlers.get("will-navigate")?.(navEvent, "https://example.com/docs");
    expect(navEvent.preventDefault).not.toHaveBeenCalled();

    // google.com -> www.google.com style redirects must also be allowed.
    const redirectEvent = { preventDefault: vi.fn() };
    handlers.get("will-redirect")?.(redirectEvent, "https://www.google.com/");
    expect(redirectEvent.preventDefault).not.toHaveBeenCalled();
  });
});
