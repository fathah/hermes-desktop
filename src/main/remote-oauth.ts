import {
  app,
  BrowserWindow,
  net,
  session,
  type Cookie,
  type Session,
} from "electron";
import type { ConnectionConfig } from "./config";

export const REMOTE_OAUTH_PARTITION = "persist:hermes-remote-oauth";

const SESSION_COOKIE_SUFFIXES = [
  "hermes_session_at",
  "hermes_session_rt",
] as const;

export type RemoteOAuthErrorCode =
  | "oauth_cancelled"
  | "oauth_connection_changed"
  | "oauth_login_required"
  | "oauth_request_failed";

export class RemoteOAuthError extends Error {
  readonly needsOAuthLogin: boolean;

  constructor(
    message: string,
    readonly code: RemoteOAuthErrorCode,
    readonly statusCode?: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "RemoteOAuthError";
    this.needsOAuthLogin = code === "oauth_login_required";
  }
}

export interface RemoteOAuthRequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  timeoutMs?: number;
}

function normalizeRemoteOAuthBaseUrl(rawUrl: string): URL {
  const url = new URL(rawUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Remote OAuth gateway URL must use HTTP(S).");
  }
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/+$/, "");
  if (/^\/(?:v1|api)$/i.test(url.pathname)) url.pathname = "";
  if (!url.pathname) url.pathname = "/";
  return url;
}

export function connectionConfigAfterRemoteOAuthLogin(
  loginBaseUrl: string,
  current: ConnectionConfig,
): ConnectionConfig {
  const loginUrl = normalizeRemoteOAuthBaseUrl(loginBaseUrl).toString();
  let currentUrl = "";
  try {
    currentUrl = current.remoteUrl.trim()
      ? normalizeRemoteOAuthBaseUrl(current.remoteUrl).toString()
      : "";
  } catch {
    // An invalid current URL means the selection changed during sign-in.
  }
  if (current.mode !== "remote" || currentUrl !== loginUrl) {
    throw new RemoteOAuthError(
      "The remote connection changed while sign-in was open. Sign in again for the current gateway.",
      "oauth_connection_changed",
    );
  }
  return { ...current, remoteAuthMode: "oauth" };
}

function getRemoteOAuthSession(): Session {
  if (!app.isReady()) {
    throw new Error("Desktop is not ready for remote OAuth authentication.");
  }
  return session.fromPartition(REMOTE_OAUTH_PARTITION);
}

export function cookiesHaveRemoteOAuthSession(
  cookies: Array<Pick<Cookie, "name">>,
): boolean {
  return cookies.some((cookie) =>
    SESSION_COOKIE_SUFFIXES.some(
      (suffix) => cookie.name === suffix || cookie.name.endsWith(`_${suffix}`),
    ),
  );
}

export async function remoteOAuthSessionState(
  baseUrl: string,
): Promise<{ signedIn: boolean }> {
  const normalized = normalizeRemoteOAuthBaseUrl(baseUrl);
  const cookies = await getRemoteOAuthSession().cookies.get({
    url: normalized.toString(),
  });
  return { signedIn: cookiesHaveRemoteOAuthSession(cookies) };
}

export async function probeRemoteAuthMode(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ authMode: "token" | "oauth"; version: string | null }> {
  const normalized = normalizeRemoteOAuthBaseUrl(baseUrl);
  const statusUrl = new URL("/api/status", normalized.origin).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  timer.unref?.();
  try {
    const response = await fetchImpl(statusUrl, {
      method: "GET",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new RemoteOAuthError(
        `Remote gateway status probe failed (${response.status}).`,
        "oauth_request_failed",
        response.status,
      );
    }
    let status: { auth_required?: unknown; version?: unknown };
    try {
      status = (await response.json()) as typeof status;
    } catch (error) {
      throw new RemoteOAuthError(
        "Remote gateway returned an invalid /api/status response.",
        "oauth_request_failed",
        response.status,
        { cause: error },
      );
    }
    return {
      authMode: status.auth_required === true ? "oauth" : "token",
      version: typeof status.version === "string" ? status.version : null,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function clearRemoteOAuthSession(baseUrl: string): Promise<void> {
  const normalized = normalizeRemoteOAuthBaseUrl(baseUrl);
  const oauthSession = getRemoteOAuthSession();
  const cookies = await oauthSession.cookies.get({
    url: normalized.toString(),
  });
  await Promise.all(
    cookies.map((cookie) => {
      const cookieUrl = new URL(normalized.origin);
      cookieUrl.protocol = cookie.secure ? "https:" : "http:";
      cookieUrl.hostname = (cookie.domain || normalized.hostname).replace(
        /^\./,
        "",
      );
      cookieUrl.pathname = cookie.path || "/";
      return oauthSession.cookies.remove(cookieUrl.toString(), cookie.name);
    }),
  );
}

export function buildRemoteOAuthWsUrl(baseUrl: string, ticket: string): string {
  const normalized = normalizeRemoteOAuthBaseUrl(baseUrl);
  normalized.protocol = normalized.protocol === "https:" ? "wss:" : "ws:";
  normalized.pathname = "/api/ws";
  normalized.searchParams.set("ticket", ticket);
  return normalized.toString();
}

export function requestRemoteOAuthJson(
  rawUrl: string,
  options: RemoteOAuthRequestOptions = {},
): Promise<unknown> {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return Promise.reject(
      new RemoteOAuthError(
        "Remote OAuth request URL must use HTTP(S).",
        "oauth_request_failed",
      ),
    );
  }

  return new Promise((resolve, reject) => {
    const oauthSession = getRemoteOAuthSession();
    const request = net.request({
      method: options.method ?? "GET",
      redirect: "follow",
      session: oauthSession,
      url: parsed.toString(),
      useSessionCookies: true,
    });
    request.setHeader("Content-Type", "application/json");

    let settled = false;
    const timeoutMs = options.timeoutMs ?? 8_000;
    const finish = (error?: Error, value?: unknown): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(() => {
      request.abort();
      finish(
        new RemoteOAuthError(
          `Timed out connecting to remote OAuth gateway after ${timeoutMs}ms.`,
          "oauth_request_failed",
        ),
      );
    }, timeoutMs);
    timer.unref?.();

    request.on("response", (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("error", (error) =>
        finish(
          new RemoteOAuthError(
            `Remote OAuth response failed: ${error.message}`,
            "oauth_request_failed",
            response.statusCode,
            { cause: error },
          ),
        ),
      );
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        const statusCode = response.statusCode ?? 500;
        if (statusCode === 401) {
          finish(
            new RemoteOAuthError(
              "Remote OAuth session expired. Sign in again.",
              "oauth_login_required",
              statusCode,
            ),
          );
          return;
        }
        if (statusCode >= 400) {
          finish(
            new RemoteOAuthError(
              `Remote OAuth request failed (${statusCode}): ${text.slice(0, 200)}`,
              "oauth_request_failed",
              statusCode,
            ),
          );
          return;
        }
        if (!text) {
          finish(undefined, null);
          return;
        }
        const contentType = String(response.headers["content-type"] ?? "");
        if (
          /^\s*<(?:!doctype|html)/i.test(text) ||
          contentType.includes("text/html")
        ) {
          finish(
            new RemoteOAuthError(
              `Expected JSON from ${parsed.toString()} but received HTML.`,
              "oauth_request_failed",
              statusCode,
            ),
          );
          return;
        }
        try {
          finish(undefined, JSON.parse(text));
        } catch (error) {
          finish(
            new RemoteOAuthError(
              `Invalid JSON from ${parsed.toString()}: ${text.slice(0, 200)}`,
              "oauth_request_failed",
              statusCode,
              { cause: error },
            ),
          );
        }
      });
    });
    request.on("error", (error) =>
      finish(
        new RemoteOAuthError(
          `Remote OAuth request failed: ${error.message}`,
          "oauth_request_failed",
          undefined,
          { cause: error },
        ),
      ),
    );

    if (options.body !== undefined) {
      request.write(JSON.stringify(options.body));
    }
    request.end();
  });
}

export async function mintRemoteOAuthWsTicket(
  baseUrl: string,
): Promise<string> {
  const normalized = normalizeRemoteOAuthBaseUrl(baseUrl);
  const endpoint = new URL("/api/auth/ws-ticket", normalized.origin).toString();
  const response = (await requestRemoteOAuthJson(endpoint, {
    method: "POST",
  })) as { ticket?: unknown } | null;
  if (!response || typeof response.ticket !== "string" || !response.ticket) {
    throw new RemoteOAuthError(
      `Remote gateway returned an invalid response from /api/auth/ws-ticket.`,
      "oauth_request_failed",
    );
  }
  return response.ticket;
}

export function openRemoteOAuthLogin(
  baseUrl: string,
  parent?: BrowserWindow | null,
): Promise<{ signedIn: true }> {
  const normalized = normalizeRemoteOAuthBaseUrl(baseUrl);
  const oauthSession = getRemoteOAuthSession();

  return new Promise((resolve, reject) => {
    let settled = false;
    const loginWindow = new BrowserWindow({
      width: 520,
      height: 720,
      title: "Sign in to remote Hermes gateway",
      autoHideMenuBar: true,
      ...(parent ? { parent, modal: true } : {}),
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        session: oauthSession,
        webSecurity: true,
      },
    });

    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearInterval(pollTimer);
      if (!loginWindow.isDestroyed()) loginWindow.destroy();
      if (error) reject(error);
      else resolve({ signedIn: true });
    };
    const checkSession = async (): Promise<void> => {
      if (settled) return;
      try {
        const state = await remoteOAuthSessionState(normalized.toString());
        if (state.signedIn) finish();
      } catch {
        // Navigation may temporarily leave the gateway during the provider flow.
      }
    };
    const pollTimer = setInterval(() => void checkSession(), 750);
    pollTimer.unref?.();

    loginWindow.webContents.on("did-navigate", () => void checkSession());
    loginWindow.webContents.on(
      "did-redirect-navigation",
      () => void checkSession(),
    );
    loginWindow.webContents.on("did-frame-navigate", () => void checkSession());
    loginWindow.on("closed", () => {
      if (!settled) {
        finish(
          new RemoteOAuthError(
            "Remote gateway sign-in was cancelled.",
            "oauth_cancelled",
          ),
        );
      }
    });

    const loginUrl = new URL("/login", normalized.origin).toString();
    void loginWindow
      .loadURL(loginUrl)
      .catch((error) =>
        finish(
          new RemoteOAuthError(
            `Could not open remote gateway sign-in: ${error instanceof Error ? error.message : String(error)}`,
            "oauth_request_failed",
            undefined,
            { cause: error },
          ),
        ),
      );
  });
}
