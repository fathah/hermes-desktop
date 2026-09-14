import { describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import {
  createLoopbackWebSocketRelay,
  dashboardWebSocketUrlNeedsRelay,
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
