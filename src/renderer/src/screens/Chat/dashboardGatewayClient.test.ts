// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardGatewayClient } from "./dashboardGatewayClient";

// A controllable WebSocket stand-in: it never opens, errors, or closes on its
// own, so each test drives the readyState transition explicitly. This lets us
// exercise the connect handshake — in particular the stalled CONNECTING case
// that wedged the transport before issue #718 added a connect timeout.
class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static last: FakeWebSocket | null = null;

  readyState = FakeWebSocket.CONNECTING;
  closeCalls = 0;
  private listeners: Record<string, ((event: unknown) => void)[]> = {};

  constructor(public url: string) {
    FakeWebSocket.last = this;
  }

  addEventListener(type: string, handler: (event: unknown) => void): void {
    (this.listeners[type] ??= []).push(handler);
  }

  removeEventListener(type: string, handler: (event: unknown) => void): void {
    this.listeners[type] = (this.listeners[type] ?? []).filter(
      (candidate) => candidate !== handler,
    );
  }

  close(): void {
    this.closeCalls += 1;
    this.readyState = FakeWebSocket.CLOSED;
  }

  emit(type: string, event: unknown = {}): void {
    for (const handler of this.listeners[type] ?? []) handler(event);
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeWebSocket.last = null;
  (globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket =
    FakeWebSocket as unknown as typeof WebSocket;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("DashboardGatewayClient.connect", () => {
  it("rejects and closes the socket when the handshake stalls", async () => {
    const client = new DashboardGatewayClient({ connectTimeoutMs: 1_000 });
    const connecting = client.connect("ws://localhost/api/ws");
    const assertion = expect(connecting).rejects.toThrow(/timed out/i);

    // Socket never fires open/error/close — only the timeout should settle it.
    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;

    expect(FakeWebSocket.last?.closeCalls).toBe(1);
    expect(client.connected).toBe(false);
  });

  it("resolves on open and cancels the timeout", async () => {
    const client = new DashboardGatewayClient({ connectTimeoutMs: 1_000 });
    const connecting = client.connect("ws://localhost/api/ws");

    const socket = FakeWebSocket.last;
    if (!socket) throw new Error("socket not created");
    socket.readyState = FakeWebSocket.OPEN;
    socket.emit("open");
    await connecting;

    expect(client.connected).toBe(true);
    // A late timeout firing must not tear down a healthy socket.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(socket.closeCalls).toBe(0);
    expect(client.connected).toBe(true);
  });

  it("rejects when the socket closes before the handshake settles", async () => {
    const client = new DashboardGatewayClient({ connectTimeoutMs: 10_000 });
    const connecting = client.connect("ws://localhost/api/ws");
    const assertion = expect(connecting).rejects.toThrow(/closed/i);

    FakeWebSocket.last?.emit("close", {});
    await assertion;
  });
});
