import http from "http";
import { afterEach, describe, expect, it } from "vitest";
import type { ConnectionConfig } from "../src/main/config";
import {
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

function remoteConnection(
  overrides: Partial<ConnectionConfig>,
): ConnectionConfig {
  return {
    mode: "remote",
    remoteUrl: "https://hermes.example/v1/",
    apiKey: "dashboard-token",
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

  it("ignores non-remote modes", () => {
    expect(
      remoteDashboardConnectionFromConfig(
        remoteConnection({ mode: "ssh", remoteUrl: "https://hermes.example" }),
      ),
    ).toBeNull();
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
