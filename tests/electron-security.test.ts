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
const mainSrc = readFileSync(join(ROOT, "src/main/index.ts"), "utf-8");
const preloadSrc = readFileSync(join(ROOT, "src/preload/index.ts"), "utf-8");
const installerSrc = readFileSync(join(ROOT, "src/main/installer.ts"), "utf-8");
const systemIpcSrc = readFileSync(
  join(ROOT, "src/main/ipc/system.ts"),
  "utf-8",
);
const rendererHtml = readFileSync(
  join(ROOT, "src/renderer/index.html"),
  "utf-8",
);

describe("Electron main process hardening", () => {
  it("keeps the main renderer isolated from Node privileges", () => {
    expect(mainSrc).toContain("nodeIntegration: false");
    expect(mainSrc).toContain("contextIsolation: true");
    expect(mainSrc).toContain("sandbox: true");
    expect(mainSrc).toContain("webSecurity: true");
    expect(mainSrc).toContain("allowRunningInsecureContent: false");
    expect(mainSrc).not.toContain("webviewTag: true");
  });

  it("blocks untrusted top-level navigation and webview attachment", () => {
    expect(mainSrc).toContain("setWindowOpenHandler((details) => {");
    expect(mainSrc).toContain('webContents.on("will-navigate"');
    expect(mainSrc).toContain('"will-attach-webview"');
    expect(mainSrc).toContain("isAllowedAppNavigationUrl(");
    expect(mainSrc).toContain("isAllowedWebviewUrl(params.src)");
    expect(mainSrc).toContain("hardenWebviewPreferences(webPreferences)");
  });

  it("keeps attached webviews constrained after initial attachment", () => {
    expect(mainSrc).toContain('app.on("web-contents-created"');
    expect(mainSrc).toContain('contents.getType() === "webview"');
    expect(mainSrc).toContain("hardenAttachedWebContents(contents)");
  });

  it("keeps the quick-capture smoke driver env-gated and out of preload", () => {
    expect(mainSrc).toContain('process.env.HERMES_SMOKE_QUICK_CAPTURE === "1"');
    expect(mainSrc).toContain("__HERMES_SMOKE_TRIGGER_TASK_CAPTURE__");
    expect(preloadSrc).not.toContain("__HERMES_SMOKE_TRIGGER_TASK_CAPTURE__");
  });

  it("stops the semantic index helper during app shutdown", () => {
    expect(mainSrc).toContain(
      'import { semanticManager } from "./semantic-index"',
    );
    const stopPos = mainSrc.indexOf("semanticManager.stop()");
    const closeIndexesPos = mainSrc.indexOf("void closeAllNoteIndexes()");
    expect(stopPos).toBeGreaterThan(-1);
    expect(closeIndexesPos).toBeGreaterThan(-1);
    expect(stopPos).toBeLessThan(closeIndexesPos);
  });

  it("disables packaged Windows auto-update while Windows builds are unsigned", () => {
    expect(mainSrc).toContain("isWindowsUnsignedAutoUpdateBlocked()");
    expect(mainSrc).toContain('process.platform === "win32"');
    // The updater warning moved from console.log to the structured logger.
    expect(mainSrc).toContain('log.warn("updater"');
    expect(mainSrc).toContain(
      "disabled on unsigned Windows builds; use manual updates",
    );
    expect(systemIpcSrc).toContain("isWindowsUnsignedAutoUpdateBlocked()");
    expect(systemIpcSrc).toContain('process.platform === "win32"');
    expect(systemIpcSrc).toContain(
      'safeHandle("download-update", () => false)',
    );
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

  it("runs the Unix installer without a bash -c command string", () => {
    expect(installerSrc).toMatch(/spawn\(\s*"bash",\s*buildUnixInstallArgs\(/);
    expect(installerSrc).not.toContain('spawn("bash", ["-c"');
  });

  it("allows bundled renderer fonts without broadening script policy", () => {
    expect(rendererHtml).toContain("font-src 'self' data:");
    expect(rendererHtml).toContain(
      "script-src 'self' 'wasm-unsafe-eval' blob:",
    );
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
  it("allows only loopback HTTP URLs on app-controlled ports", () => {
    expect(isAllowedWebviewUrl("http://localhost:3000")).toBe(true);
    expect(isAllowedWebviewUrl("http://127.0.0.1:65535/path")).toBe(true);
    expect(isAllowedWebviewUrl("http://[::1]:3000")).toBe(true);
  });

  it("blocks remote, privileged, and non-HTTP webview URLs", () => {
    expect(isAllowedWebviewUrl("https://localhost:3000")).toBe(false);
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
  });
});
