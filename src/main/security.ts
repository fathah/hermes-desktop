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

export function isAllowedWebviewUrl(rawUrl: unknown): rawUrl is string {
  const url = parseUrl(rawUrl);
  if (!url || url.protocol !== "http:") return false;
  if (!LOCAL_WEBVIEW_HOSTS.has(url.hostname)) return false;

  const port = Number(url.port);
  return Number.isInteger(port) && port >= 1024 && port <= 65535;
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

export function hardenAttachedWebContents(webContents: WebContents): void {
  webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  webContents.on("will-navigate", (event, url) => {
    if (!isAllowedWebviewUrl(url)) {
      event.preventDefault();
    }
  });
  webContents.on("will-redirect", (event, url) => {
    if (!isAllowedWebviewUrl(url)) {
      event.preventDefault();
    }
  });
}

/**
 * Redact sensitive data patterns (e.g. API keys, bearer tokens, private keys)
 * from text blocks to prevent credential leaks in logs and UI transcripts.
 */
export function redactSensitiveData(text: string): string {
  if (typeof text !== "string" || !text) return text;

  let result = text;

  // 1. Redact API keys starting with sk- or desk-
  result = result.replace(/\b(sk-[a-zA-Z0-9-_]{20,})\b/g, "[REDACTED]");
  result = result.replace(/\b(desk-[a-zA-Z0-9-_]{20,})\b/g, "[REDACTED]");

  // 2. Redact Bearer tokens in Authorization headers or inline
  result = result.replace(
    /(Bearer[^\S\r\n]+)[a-zA-Z0-9-_=+.]{20,}/gi,
    "$1[REDACTED]",
  );

  // 3. Redact PEM private keys
  result = result.replace(
    /-----BEGIN [A-Z ]+ PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+ PRIVATE KEY-----/g,
    "[REDACTED PRIVATE KEY]",
  );

  return result;
}
