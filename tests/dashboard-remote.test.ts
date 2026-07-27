import http from "http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionConfig } from "../src/main/config";

const oauthMocks = vi.hoisted(() => ({
  buildRemoteOAuthWsUrl: vi.fn((baseUrl: string, ticket: string) => {
    const url = new URL("/api/ws", baseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("ticket", ticket);
    return url.toString();
  }),
  mintRemoteOAuthWsTicket: vi.fn(),
  probeRemoteAuthMode: vi.fn(),
  remoteOAuthSessionState: vi.fn(),
  requestRemoteOAuthJson: vi.fn(),
}));

const configMocks = vi.hoisted(() => ({
  getConnectionConfig: vi.fn(),
}));

vi.mock("../src/main/remote-oauth", () => oauthMocks);
vi.mock("../src/main/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/main/config")>()),
  getConnectionConfig: configMocks.getConnectionConfig,
}));

import {
  freshDashboardWebSocketUrl,
  getRemoteDashboardStatusForConfig,
  probeDashboardWebSocket,
  remoteDashboardConnectionFromConfig,
  sshDashboardConnectionFromTunnel,
} from "../src/main/dashboard";

let server: http.Server | null = null;

function startServer(
  handler: http.RequestListener,
): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const address = server!.address();
      if (!address || typeof address === "string") {
        throw new Error("Unexpected server address");
      }
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: () => new Promise<void>((done) => server!.close(() => done())),
      });
    });
  });
}

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = null;
  }
});

beforeEach(() => {
  vi.clearAllMocks();
  oauthMocks.buildRemoteOAuthWsUrl.mockImplementation(
    (baseUrl: string, ticket: string) => {
      const url = new URL("/api/ws", baseUrl);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      url.searchParams.set("ticket", ticket);
      return url.toString();
    },
  );
});

function remoteConnection(
  overrides: Partial<ConnectionConfig>,
): ConnectionConfig {
  return {
    mode: "remote",
    remoteUrl: "https://hermes.example/v1/",
    apiKey: "dashboard-token",
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

describe("remoteDashboardConnectionFromConfig", () => {
  it("builds an upstream dashboard websocket URL from remote settings", () => {
    const connection = remoteDashboardConnectionFromConfig(
      remoteConnection({}),
    );

    expect(connection).toMatchObject({
      baseUrl: "https://hermes.example",
      mode: "remote",
      token: "dashboard-token",
      wsUrl: "wss://hermes.example/api/ws?token=dashboard-token",
    });
  });

  it("returns null when remote dashboard settings are incomplete", () => {
    expect(
      remoteDashboardConnectionFromConfig(
        remoteConnection({ remoteUrl: "", apiKey: "dashboard-token" }),
      ),
    ).toBeNull();
    expect(
      remoteDashboardConnectionFromConfig(
        remoteConnection({ remoteUrl: "https://hermes.example", apiKey: "" }),
      ),
    ).toBeNull();
  });

  it("builds an OAuth connection without exposing token credentials", () => {
    expect(
      remoteDashboardConnectionFromConfig(
        remoteConnection({ apiKey: "", remoteAuthMode: "oauth" }),
      ),
    ).toMatchObject({
      authMode: "oauth",
      baseUrl: "https://hermes.example",
      token: "",
      wsUrl: "",
    });
  });

  it("ignores non-remote modes", () => {
    expect(
      remoteDashboardConnectionFromConfig(
        remoteConnection({ mode: "ssh", remoteUrl: "https://hermes.example" }),
      ),
    ).toBeNull();
  });
});

describe("OAuth remote dashboard status", () => {
  // @lat: [[remote-dashboard-oauth#Test specifications#OAuth dashboard readiness]]
  it("reports browser login needed without attempting authenticated REST", async () => {
    oauthMocks.probeRemoteAuthMode.mockResolvedValue({
      authMode: "oauth",
      version: "0.2.0",
    });
    oauthMocks.remoteOAuthSessionState.mockResolvedValue({ signedIn: false });

    await expect(
      getRemoteDashboardStatusForConfig(
        remoteConnection({ apiKey: "", remoteAuthMode: "auto" }),
      ),
    ).resolves.toMatchObject({
      supported: true,
      running: false,
      needsOAuthLogin: true,
      connection: { authMode: "oauth", token: "", wsUrl: "" },
    });
    expect(oauthMocks.requestRemoteOAuthJson).not.toHaveBeenCalled();
    expect(oauthMocks.mintRemoteOAuthWsTicket).not.toHaveBeenCalled();
  });

  it("authenticates REST with cookies and probes WebSocket with a ticket", async () => {
    const { url } = await startServer((_req, res) => {
      res.statusCode = 404;
      res.end();
    });
    let upgradeUrl = "";
    server!.on("upgrade", (req, socket) => {
      upgradeUrl = req.url || "";
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\n" +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n\r\n",
      );
      socket.destroy();
    });
    oauthMocks.probeRemoteAuthMode.mockResolvedValue({
      authMode: "oauth",
      version: "0.2.0",
    });
    oauthMocks.remoteOAuthSessionState.mockResolvedValue({ signedIn: true });
    oauthMocks.requestRemoteOAuthJson.mockResolvedValue([]);
    oauthMocks.mintRemoteOAuthWsTicket.mockResolvedValue("probe-once");

    const result = await getRemoteDashboardStatusForConfig(
      remoteConnection({
        remoteUrl: url,
        apiKey: "must-not-be-used",
        remoteAuthMode: "auto",
      }),
    );

    expect(result).toMatchObject({
      supported: true,
      running: true,
      connection: { authMode: "oauth", token: "", wsUrl: "" },
    });
    expect(oauthMocks.requestRemoteOAuthJson).toHaveBeenCalledWith(
      `${url}/api/sessions?limit=1`,
    );
    expect(upgradeUrl).toBe("/api/ws?ticket=probe-once");
  });
});

describe("freshDashboardWebSocketUrl", () => {
  // @lat: [[remote-dashboard-oauth#Test specifications#Fresh ticket per connection]]
  it("mints a new OAuth ticket for every connection attempt", async () => {
    configMocks.getConnectionConfig.mockReturnValue(
      remoteConnection({ apiKey: "", remoteAuthMode: "oauth" }),
    );
    oauthMocks.probeRemoteAuthMode.mockResolvedValue({
      authMode: "oauth",
      version: null,
    });
    oauthMocks.mintRemoteOAuthWsTicket
      .mockResolvedValueOnce("first")
      .mockResolvedValueOnce("second");

    await expect(freshDashboardWebSocketUrl()).resolves.toContain(
      "ticket=first",
    );
    await expect(freshDashboardWebSocketUrl()).resolves.toContain(
      "ticket=second",
    );
    expect(oauthMocks.mintRemoteOAuthWsTicket).toHaveBeenCalledTimes(2);
  });

  it("returns the stable token URL without minting", async () => {
    configMocks.getConnectionConfig.mockReturnValue(remoteConnection({}));
    oauthMocks.probeRemoteAuthMode.mockResolvedValue({
      authMode: "token",
      version: null,
    });

    await expect(freshDashboardWebSocketUrl()).resolves.toBe(
      "wss://hermes.example/api/ws?token=dashboard-token",
    );
    expect(oauthMocks.mintRemoteOAuthWsTicket).not.toHaveBeenCalled();
  });

  it("keeps an insecure remote target and token out of renderer IPC", async () => {
    configMocks.getConnectionConfig.mockReturnValue(
      remoteConnection({
        remoteUrl: "http://gateway.lan",
        apiKey: "private-dashboard-token",
      }),
    );
    oauthMocks.probeRemoteAuthMode.mockResolvedValue({
      authMode: "token",
      version: null,
    });

    const result = await freshDashboardWebSocketUrl();

    expect(result).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\/[a-f0-9]{64}$/);
    expect(result).not.toContain("gateway.lan");
    expect(result).not.toContain("private-dashboard-token");
  });
});

describe("sshDashboardConnectionFromTunnel", () => {
  it("builds an upstream dashboard websocket URL from an SSH tunnel", () => {
    const connection = sshDashboardConnectionFromTunnel(
      remoteConnection({ mode: "ssh" }),
      "http://127.0.0.1:18642/",
      "ssh-dashboard-token",
    );

    expect(connection).toMatchObject({
      baseUrl: "http://127.0.0.1:18642",
      mode: "ssh",
      token: "ssh-dashboard-token",
      wsUrl: "ws://127.0.0.1:18642/api/ws?token=ssh-dashboard-token",
    });
  });

  it("returns null when SSH dashboard tunnel settings are incomplete", () => {
    expect(
      sshDashboardConnectionFromTunnel(
        remoteConnection({ mode: "ssh" }),
        "",
        "ssh-dashboard-token",
      ),
    ).toBeNull();
    expect(
      sshDashboardConnectionFromTunnel(
        remoteConnection({ mode: "ssh" }),
        "http://127.0.0.1:18642",
        "",
      ),
    ).toBeNull();
  });

  it("ignores non-SSH modes", () => {
    expect(
      sshDashboardConnectionFromTunnel(
        remoteConnection({ mode: "remote" }),
        "http://127.0.0.1:18642",
        "ssh-dashboard-token",
      ),
    ).toBeNull();
  });
});

describe("probeDashboardWebSocket", () => {
  it("accepts dashboards that support the embedded chat websocket", async () => {
    const { url } = await startServer((_req, res) => {
      res.statusCode = 404;
      res.end();
    });
    server!.on("upgrade", (_req, socket) => {
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\n" +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          "\r\n",
      );
      socket.destroy();
    });

    await expect(
      probeDashboardWebSocket({
        baseUrl: url,
        wsUrl: url.replace("http:", "ws:") + "/api/ws?token=token",
        token: "token",
        mode: "remote",
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects dashboards where REST works but embedded chat is disabled", async () => {
    const { url } = await startServer((_req, res) => {
      res.statusCode = 403;
      res.end("embedded chat disabled");
    });

    await expect(
      probeDashboardWebSocket({
        baseUrl: url,
        wsUrl: url.replace("http:", "ws:") + "/api/ws?token=token",
        token: "token",
        mode: "remote",
      }),
    ).rejects.toThrow(
      /WebSocket is unavailable \(403: embedded chat disabled\)/,
    );
  });
});
