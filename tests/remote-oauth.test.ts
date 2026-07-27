import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "events";
import type { ConnectionConfig } from "../src/main/config";

const mocks = vi.hoisted(() => {
  class FakeEmitter {
    listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    on(name: string, listener: (...args: unknown[]) => void): this {
      this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]);
      return this;
    }
    emit(name: string, ...args: unknown[]): void {
      for (const listener of this.listeners.get(name) ?? []) listener(...args);
    }
  }
  class FakeBrowserWindow extends FakeEmitter {
    static instances: FakeBrowserWindow[] = [];
    destroyed = false;
    loadURL = vi.fn(() => Promise.resolve());
    webContents = new FakeEmitter();
    constructor(readonly options: Record<string, unknown>) {
      super();
      FakeBrowserWindow.instances.push(this);
    }
    destroy(): void {
      this.destroyed = true;
    }
    isDestroyed(): boolean {
      return this.destroyed;
    }
  }
  const cookieGet = vi.fn();
  const cookieRemove = vi.fn();
  const request = vi.fn();
  const fromPartition = vi.fn(() => ({
    cookies: { get: cookieGet, remove: cookieRemove },
  }));
  return {
    BrowserWindow: FakeBrowserWindow,
    cookieGet,
    cookieRemove,
    fromPartition,
    request,
  };
});

vi.mock("electron", () => ({
  app: { isReady: () => true },
  BrowserWindow: mocks.BrowserWindow,
  net: { request: mocks.request },
  session: { fromPartition: mocks.fromPartition },
}));

import {
  REMOTE_OAUTH_PARTITION,
  buildRemoteOAuthWsUrl,
  clearRemoteOAuthSession,
  connectionConfigAfterRemoteOAuthLogin,
  cookiesHaveRemoteOAuthSession,
  mintRemoteOAuthWsTicket,
  openRemoteOAuthLogin,
  requestRemoteOAuthJson,
  remoteOAuthSessionState,
} from "../src/main/remote-oauth";

function connectionConfig(
  overrides: Partial<ConnectionConfig> = {},
): ConnectionConfig {
  return {
    mode: "remote",
    remoteUrl: "https://hermes.example/v1",
    apiKey: "original-token",
    remoteAuthMode: "auto",
    remoteChatTransport: "auto",
    sshChatTransport: "auto",
    ssh: {
      host: "",
      port: 22,
      username: "",
      keyPath: "",
      remotePort: 8642,
      localPort: 18642,
    },
    ...overrides,
  };
}

function mockNetJsonResponse(
  statusCode: number,
  body: unknown,
): {
  abort: ReturnType<typeof vi.fn>;
  setHeader: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
} {
  const request = new EventEmitter() as EventEmitter & {
    abort: ReturnType<typeof vi.fn>;
    end: () => void;
    setHeader: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
  };
  request.abort = vi.fn();
  request.setHeader = vi.fn();
  request.write = vi.fn();
  request.end = () => {
    queueMicrotask(() => {
      const response = new EventEmitter() as EventEmitter & {
        headers: Record<string, string>;
        statusCode: number;
      };
      response.statusCode = statusCode;
      response.headers = { "content-type": "application/json" };
      request.emit("response", response);
      if (body !== undefined) response.emit("data", JSON.stringify(body));
      response.emit("end");
    });
  };
  mocks.request.mockReturnValue(request);
  return request;
}

describe("remote OAuth session boundary", () => {
  beforeEach(() => {
    mocks.cookieGet.mockReset();
    mocks.cookieRemove.mockReset();
    mocks.fromPartition.mockClear();
    mocks.request.mockReset();
    mocks.BrowserWindow.instances.length = 0;
  });

  it("opens a sandboxed login window in the OAuth partition", async () => {
    mocks.cookieGet.mockResolvedValue([{ name: "hermes_session_at" }]);

    const login = openRemoteOAuthLogin("https://hermes.example");
    const window = mocks.BrowserWindow.instances[0];

    expect(window.options).toMatchObject({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    });
    expect(window.loadURL).toHaveBeenCalledWith("https://hermes.example/login");

    window.webContents.emit("did-navigate");
    await expect(login).resolves.toEqual({ signedIn: true });
    expect(window.destroyed).toBe(true);
  });

  it("reports cancellation when the login window closes first", async () => {
    mocks.cookieGet.mockResolvedValue([]);

    const login = openRemoteOAuthLogin("https://hermes.example");
    mocks.BrowserWindow.instances[0].emit("closed");

    await expect(login).rejects.toMatchObject({ code: "oauth_cancelled" });
  });

  // @lat: [[remote-dashboard-oauth#Test specifications#Post-login config revalidation]]
  it("applies login to the current matching config without restoring stale settings", () => {
    const current = connectionConfig({
      remoteUrl: "https://hermes.example/api/",
      apiKey: "changed-while-login-was-open",
      remoteChatTransport: "dashboard",
      sshChatTransport: "legacy",
      ssh: {
        host: "new-host",
        port: 2222,
        username: "jai",
        keyPath: "/tmp/id",
        remotePort: 9000,
        localPort: 19000,
      },
    });

    expect(
      connectionConfigAfterRemoteOAuthLogin(
        "https://hermes.example/v1",
        current,
      ),
    ).toEqual({ ...current, remoteAuthMode: "oauth" });
  });

  it.each([
    connectionConfig({ remoteUrl: "https://other.example" }),
    connectionConfig({ mode: "ssh" }),
  ])(
    "rejects login completion after the selected connection changes",
    (current) => {
      expect(() =>
        connectionConfigAfterRemoteOAuthLogin(
          "https://hermes.example/v1",
          current,
        ),
      ).toThrowError(
        expect.objectContaining({ code: "oauth_connection_changed" }),
      );
    },
  );

  it("routes authenticated JSON through Electron net with session cookies", async () => {
    const request = mockNetJsonResponse(200, { ok: true });

    await expect(
      requestRemoteOAuthJson("https://hermes.example/api/sessions"),
    ).resolves.toEqual({ ok: true });

    expect(mocks.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        session: expect.any(Object),
        url: "https://hermes.example/api/sessions",
        useSessionCookies: true,
      }),
    );
    expect(request.setHeader).toHaveBeenCalledWith(
      "Content-Type",
      "application/json",
    );
  });

  it("mints a single-use WebSocket ticket through the OAuth session", async () => {
    const request = mockNetJsonResponse(200, { ticket: "fresh-once" });

    await expect(
      mintRemoteOAuthWsTicket("https://hermes.example/v1"),
    ).resolves.toBe("fresh-once");
    expect(mocks.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        url: "https://hermes.example/api/auth/ws-ticket",
      }),
    );
    expect(request.write).not.toHaveBeenCalled();
  });

  it("maps HTTP 401 to a structured OAuth login requirement", async () => {
    mockNetJsonResponse(401, { detail: "expired" });

    await expect(
      mintRemoteOAuthWsTicket("https://hermes.example"),
    ).rejects.toMatchObject({
      code: "oauth_login_required",
      needsOAuthLogin: true,
      statusCode: 401,
    });
  });

  it("rejects malformed ticket responses with endpoint context", async () => {
    mockNetJsonResponse(200, { ticket: "" });

    await expect(
      mintRemoteOAuthWsTicket("https://hermes.example"),
    ).rejects.toThrow(/\/api\/auth\/ws-ticket/);
  });

  // @lat: [[remote-dashboard-oauth#Test specifications#Cookie session boundary]]
  it("recognizes access and refresh session cookies", () => {
    expect(cookiesHaveRemoteOAuthSession([{ name: "hermes_session_at" }])).toBe(
      true,
    );
    expect(cookiesHaveRemoteOAuthSession([{ name: "hermes_session_rt" }])).toBe(
      true,
    );
    expect(
      cookiesHaveRemoteOAuthSession([{ name: "tenant_hermes_session_at" }]),
    ).toBe(true);
    expect(cookiesHaveRemoteOAuthSession([{ name: "unrelated" }])).toBe(false);
  });

  it("uses a dedicated persistent Electron partition", async () => {
    mocks.cookieGet.mockResolvedValue([{ name: "hermes_session_rt" }]);

    await expect(
      remoteOAuthSessionState("https://hermes.example"),
    ).resolves.toEqual({ signedIn: true });
    expect(mocks.fromPartition).toHaveBeenCalledWith(REMOTE_OAUTH_PARTITION);
    expect(mocks.cookieGet).toHaveBeenCalledWith({
      url: "https://hermes.example/",
    });
  });

  it("builds ticket WebSocket URLs from the gateway origin", () => {
    expect(buildRemoteOAuthWsUrl("https://host.example/v1", "a b")).toBe(
      "wss://host.example/api/ws?ticket=a+b",
    );
    expect(buildRemoteOAuthWsUrl("http://127.0.0.1:9119", "once")).toBe(
      "ws://127.0.0.1:9119/api/ws?ticket=once",
    );
    expect(() => buildRemoteOAuthWsUrl("file:///tmp/x", "ticket")).toThrow(
      /HTTP\(S\)/,
    );
  });

  it("signs out only cookies scoped to the selected gateway", async () => {
    mocks.cookieGet.mockResolvedValue([
      {
        name: "hermes_session_at",
        domain: ".hermes.example",
        path: "/",
        secure: true,
      },
      {
        name: "hermes_session_rt",
        domain: ".hermes.example",
        path: "/auth",
        secure: true,
      },
    ]);
    mocks.cookieRemove.mockResolvedValue(undefined);

    await clearRemoteOAuthSession("https://hermes.example");

    expect(mocks.cookieGet).toHaveBeenCalledWith({
      url: "https://hermes.example/",
    });
    expect(mocks.cookieRemove).toHaveBeenCalledTimes(2);
    expect(mocks.cookieRemove).toHaveBeenCalledWith(
      "https://hermes.example/",
      "hermes_session_at",
    );
    expect(mocks.cookieRemove).toHaveBeenCalledWith(
      "https://hermes.example/auth",
      "hermes_session_rt",
    );
  });
});
