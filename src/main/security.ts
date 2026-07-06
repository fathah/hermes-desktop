import type { WebContents, WebPreferences } from "electron";
import { pathToFileURL } from "url";

const EXTERNAL_PROTOCOLS = new Set(["https:", "http:", "mailto:"]);
const LOCAL_WEBVIEW_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

type WebviewPreferences = WebPreferences & {
  preloadURL?: string;
};

function parseUrl(rawUrl: unknown): URL | null {
  if (typeof rawUrl !== "string") return null;
  try {
    return new URL(rawUrl);
  } catch {
    return null;
  }
}

export function isAllowedExternalUrl(rawUrl: unknown): rawUrl is string {
  const url = parseUrl(rawUrl);
  return !!url && EXTERNAL_PROTOCOLS.has(url.protocol);
}

export function isAllowedAppNavigationUrl(
  rawUrl: unknown,
  rendererHtmlPath: string,
  devServerUrl?: string,
): rawUrl is string {
  const url = parseUrl(rawUrl);
  if (!url) return false;

  const devServer = parseUrl(devServerUrl);
  if (devServer) {
    return url.origin === devServer.origin;
  }

  const rendererUrl = pathToFileURL(rendererHtmlPath);
  return (
    url.protocol === "file:" && url.href.split("#")[0] === rendererUrl.href
  );
}

export function isAllowedWebviewUrl(
  rawUrl: unknown,
  allowHttps = false,
): rawUrl is string {
  if (
    typeof rawUrl === "string" &&
    (rawUrl === "about:blank" || rawUrl.startsWith("about:blank"))
  ) {
    return true;
  }

  const url = parseUrl(rawUrl);
  if (!url) {
    console.warn(`[SECURITY] Blocked webview URL (could not parse): ${rawUrl}`);
    return false;
  }

  if (url.protocol === "http:") {
    if (LOCAL_WEBVIEW_HOSTS.has(url.hostname)) {
      const port = Number(url.port);
      if (Number.isInteger(port) && port >= 1024 && port <= 65535) {
        return true;
      }
    }
    console.warn(`[SECURITY] Blocked local/remote HTTP webview URL: ${rawUrl}`);
    return false;
  }

  if (url.protocol === "https:") {
    if (allowHttps) {
      return true;
    }
    console.warn(
      `[SECURITY] Blocked HTTPS webview URL (not allowed for this webview): ${rawUrl}`,
    );
    return false;
  }

  console.warn(
    `[SECURITY] Blocked webview URL (unsupported protocol): ${rawUrl}`,
  );
  return false;
}

export function hardenWebviewPreferences(
  webPreferences: WebviewPreferences,
): void {
  delete webPreferences.preload;
  delete webPreferences.preloadURL;
  webPreferences.nodeIntegration = false;
  webPreferences.contextIsolation = true;
  webPreferences.sandbox = true;
  webPreferences.webSecurity = true;
  webPreferences.allowRunningInsecureContent = false;
}

export function hardenAttachedWebContents(
  webContents: WebContents,
  isWebPreview = false,
): void {
  webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  webContents.on("will-navigate", (event, url) => {
    if (!isAllowedWebviewUrl(url, isWebPreview)) {
      event.preventDefault();
    }
  });
  webContents.on("will-redirect", (event, url) => {
    if (!isAllowedWebviewUrl(url, isWebPreview)) {
      event.preventDefault();
    }
  });
}
