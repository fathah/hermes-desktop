import { describe, expect, it, vi } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import {
  createLoopbackWebSocketRelay,
  dashboardWebSocketUrlNeedsRelay,
  type DashboardWebSocketRelayOptions,
} from "../src/main/dashboard-websocket-relay";

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
}

function waitForMessage(socket: WebSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    socket.once("message", (data) => resolve(data.toString()));
    socket.once("error", reject);
  });
}

function waitForFailure(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error(`WebSocket unexpectedly stayed pending: ${url}`));
    }, 1_000);
    socket.once("open", () => {
      clearTimeout(timer);
      socket.terminate();
      reject(new Error(`WebSocket unexpectedly opened: ${url}`));
    });
    socket.once("error", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function listeningServer(): Promise<WebSocketServer> {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  return new Promise((resolve, reject) => {
    server.once("listening", () => resolve(server));
    server.once("error", reject);
  });
}

function closeServer(server: WebSocketServer): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function interactiveRelay(
  options: DashboardWebSocketRelayOptions = {},
): Promise<{
  client: WebSocket;
  upstream: WebSocket;
  rendererFrames: string[];
  agentFrames: Array<Record<string, unknown>>;
  close: () => Promise<void>;
}> {
  const server = await listeningServer();
  const address = server.address();
  if (typeof address === "string" || address === null)
    throw new Error("Expected server address.");
  const connected = new Promise<WebSocket>((resolve) =>
    server.once("connection", resolve),
  );
  const relayUrl = await createLoopbackWebSocketRelay(
    `ws://127.0.0.1:${address.port}/api/ws`,
    options,
  );
  const client = new WebSocket(relayUrl);
  const rendererFrames: string[] = [];
  client.on("message", (data) => rendererFrames.push(data.toString()));
  await waitForOpen(client);
  const upstream = await connected;
  const agentFrames: Array<Record<string, unknown>> = [];
  upstream.on("message", (data) =>
    agentFrames.push(JSON.parse(data.toString())),
  );
  return {
    client,
    upstream,
    rendererFrames,
    agentFrames,
    close: async () => {
      client.terminate();
      upstream.terminate();
      await closeServer(server);
    },
  };
}

function sensitiveFrame(
  id: string,
  method = "secret",
): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id,
    method,
    params: {
      session_id: "session-1",
      env_var: "EXAMPLE_API_KEY",
      prompt: "Enter the requested secret",
    },
  };
}

describe("dashboard WebSocket loopback relay", () => {
  it("selects only insecure non-loopback targets for relaying", () => {
    expect(dashboardWebSocketUrlNeedsRelay("ws://gateway.lan/api/ws")).toBe(
      true,
    );
    expect(dashboardWebSocketUrlNeedsRelay("wss://gateway.lan/api/ws")).toBe(
      false,
    );
    expect(dashboardWebSocketUrlNeedsRelay("ws://127.0.0.1:18642/api/ws")).toBe(
      false,
    );
    expect(dashboardWebSocketUrlNeedsRelay("ws://localhost:18642/api/ws")).toBe(
      false,
    );
  });

  // @lat: [[remote-dashboard-oauth#Test specifications#Loopback WebSocket confinement]]
  it("forwards one connection without exposing the target URL or ticket", async () => {
    const target = await listeningServer();
    const address = target.address();
    if (typeof address === "string" || address === null) {
      throw new Error("Expected an IP WebSocket server address.");
    }
    let requestUrl = "";
    target.on("connection", (socket, request) => {
      requestUrl = request.url || "";
      socket.on("message", (data, isBinary) =>
        socket.send(data, { binary: isBinary }),
      );
    });

    const targetUrl = `ws://127.0.0.1:${address.port}/api/ws?ticket=secret-once`;
    const relayUrl = await createLoopbackWebSocketRelay(targetUrl);
    const relay = new URL(relayUrl);
    expect(relay.hostname).toBe("127.0.0.1");
    expect(relayUrl).not.toContain("secret-once");
    expect(relay.port).not.toBe(String(address.port));

    await waitForFailure(`${relay.origin}/wrong-capability`);

    const client = new WebSocket(relayUrl);
    await waitForOpen(client);
    const echoed = waitForMessage(client);
    client.send("through-relay");
    await expect(echoed).resolves.toBe("through-relay");
    expect(requestUrl).toBe("/api/ws?ticket=secret-once");

    await waitForFailure(relayUrl);
    client.close();
    await closeServer(target);
  });
});

describe("main-only sensitive gateway requests", () => {
  // @lat: [[main-server-requests#Main-only secret transport]]
  it("answers the exact id in main without forwarding the prompt or value to the renderer", async () => {
    const collect = vi.fn(async () => ({ value: "test-only-private-answer" }));
    const fixture = await interactiveRelay({
      collectSensitiveRequest: collect,
    });
    try {
      fixture.upstream.send(JSON.stringify(sensitiveFrame("srq-private1")));
      await vi.waitFor(() =>
        expect(fixture.agentFrames).toContainEqual({
          jsonrpc: "2.0",
          id: "srq-private1",
          result: { value: "test-only-private-answer" },
        }),
      );
      fixture.upstream.send(JSON.stringify(sensitiveFrame("srq-private1")));
      fixture.upstream.send(
        JSON.stringify({ method: "event", params: { type: "marker" } }),
      );
      await vi.waitFor(() => expect(fixture.rendererFrames).toHaveLength(1));
      expect(collect).toHaveBeenCalledTimes(1);
      expect(fixture.rendererFrames.join(" ")).not.toMatch(
        /private-answer|srq-private1|EXAMPLE_API_KEY/,
      );
      expect(
        fixture.agentFrames.filter(({ id }) => id === "srq-private1"),
      ).toHaveLength(1);
    } finally {
      await fixture.close();
    }
  });

  // @lat: [[main-server-requests#Secret cancellation]]
  it("dismisses a cancelled request and fences a late modal response", async () => {
    let finish!: (value: { value: string }) => void;
    let signal!: AbortSignal;
    const collect = vi.fn((_request, abort: AbortSignal) => {
      signal = abort;
      return new Promise<{ value: string }>((resolve) => {
        finish = resolve;
      });
    });
    const fixture = await interactiveRelay({
      collectSensitiveRequest: collect,
    });
    try {
      fixture.upstream.send(
        JSON.stringify(sensitiveFrame("srq-cancel-private")),
      );
      await vi.waitFor(() => expect(collect).toHaveBeenCalledTimes(1));
      fixture.upstream.send(
        JSON.stringify({
          method: "event",
          params: {
            type: "request.cancel",
            session_id: "other-session",
            payload: { id: "srq-cancel-private" },
          },
        }),
      );
      await vi.waitFor(() => expect(fixture.rendererFrames).toHaveLength(1));
      expect(signal.aborted).toBe(false);
      fixture.upstream.send(
        JSON.stringify({
          method: "event",
          params: {
            type: "request.cancel",
            session_id: "session-1",
            payload: { id: "srq-cancel-private" },
          },
        }),
      );
      await vi.waitFor(() => expect(signal.aborted).toBe(true));
      finish({ value: "late-private-answer" });
      fixture.upstream.send(
        JSON.stringify({ method: "event", params: { type: "marker" } }),
      );
      await vi.waitFor(() => expect(fixture.rendererFrames).toHaveLength(3));
      expect(fixture.agentFrames).toEqual([]);
      expect(fixture.rendererFrames.join(" ")).not.toContain(
        "late-private-answer",
      );
    } finally {
      await fixture.close();
    }
  });

  it("cancels sensitive input when its renderer socket closes", async () => {
    let finish!: (value: { value: string }) => void;
    let signal!: AbortSignal;
    const fixture = await interactiveRelay({
      collectSensitiveRequest: (_request, abort) => {
        signal = abort;
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
    });
    try {
      fixture.upstream.send(
        JSON.stringify(sensitiveFrame("srq-close-private", "sudo")),
      );
      await vi.waitFor(() => expect(signal).toBeDefined());
      fixture.client.close();
      await vi.waitFor(() => expect(signal.aborted).toBe(true));
      finish({ value: "late-after-close" });
      await Promise.resolve();
      expect(fixture.agentFrames).toEqual([]);
    } finally {
      await fixture.close();
    }
  });

  // @lat: [[main-server-requests#Sensitive replay snapshots]]
  it("collects restored secrets in main while preserving other open requests", async () => {
    const collect = vi.fn(async () => ({ value: "restored-private-answer" }));
    const fixture = await interactiveRelay({
      collectSensitiveRequest: collect,
    });
    try {
      const approval = {
        id: "srq-replayed-approval",
        method: "approval",
        params: {
          session_id: "session-1",
          request_id: "queue-1",
          choices: ["once", "deny"],
        },
      };
      fixture.upstream.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 4,
          result: {
            session_id: "session-1",
            open_requests: [sensitiveFrame("srq-replayed-private"), approval],
          },
        }),
      );
      await vi.waitFor(() => expect(fixture.agentFrames).toHaveLength(1));
      await vi.waitFor(() => expect(fixture.rendererFrames).toHaveLength(1));
      expect(JSON.parse(fixture.rendererFrames[0])).toEqual({
        jsonrpc: "2.0",
        id: 4,
        result: { session_id: "session-1", open_requests: [approval] },
      });
      expect(collect).toHaveBeenCalledTimes(1);
      expect(fixture.rendererFrames.join(" ")).not.toMatch(
        /restored-private-answer|EXAMPLE_API_KEY/,
      );
    } finally {
      await fixture.close();
    }
  });

  it("refuses an unsupported save-login interaction instead of forwarding it", async () => {
    const collect = vi.fn(async () => ({ value: "unused" }));
    const fixture = await interactiveRelay({
      collectSensitiveRequest: collect,
    });
    try {
      fixture.upstream.send(
        JSON.stringify(sensitiveFrame("srq-login-private", "vault.save_login")),
      );
      await vi.waitFor(() =>
        expect(fixture.agentFrames).toContainEqual(
          expect.objectContaining({
            id: "srq-login-private",
            error: expect.objectContaining({ code: -32601 }),
          }),
        ),
      );
      expect(collect).not.toHaveBeenCalled();
      expect(fixture.rendererFrames).toEqual([]);
    } finally {
      await fixture.close();
    }
  });

  it("refuses an unscoped sensitive prompt without opening a native collector", async () => {
    const collect = vi.fn(async () => ({ value: "unused" }));
    const fixture = await interactiveRelay({
      collectSensitiveRequest: collect,
    });
    try {
      const frame = sensitiveFrame("srq-unscoped-private");
      frame.params = {
        session_id: "",
        env_var: "EXAMPLE_API_KEY",
        prompt: "Unowned request",
      };
      fixture.upstream.send(JSON.stringify(frame));
      await vi.waitFor(() =>
        expect(fixture.agentFrames).toContainEqual(
          expect.objectContaining({
            id: "srq-unscoped-private",
            error: expect.objectContaining({ code: -32602 }),
          }),
        ),
      );
      expect(collect).not.toHaveBeenCalled();
      expect(fixture.rendererFrames).toEqual([]);
    } finally {
      await fixture.close();
    }
  });
});
