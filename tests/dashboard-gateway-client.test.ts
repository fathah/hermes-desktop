import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DashboardGatewayClient,
  normalizeDashboardNotification,
} from "../src/renderer/src/screens/Chat/dashboardGatewayClient";

afterEach(() => {
  vi.useRealTimers();
});

describe("normalizeDashboardNotification", () => {
  it("normalizes upstream JSON-RPC event envelopes", () => {
    expect(
      normalizeDashboardNotification({
        jsonrpc: "2.0",
        method: "event",
        params: {
          type: "message.delta",
          session_id: "runtime-1",
          payload: { text: "hello" },
        },
      }),
    ).toEqual({
      type: "message.delta",
      session_id: "runtime-1",
      payload: { text: "hello" },
    });
  });

  it("keeps raw event objects accepted for defensive compatibility", () => {
    expect(
      normalizeDashboardNotification({
        type: "tool.start",
        session_id: "runtime-1",
        payload: { name: "terminal" },
      }),
    ).toEqual({
      type: "tool.start",
      session_id: "runtime-1",
      payload: { name: "terminal" },
    });
  });
});

describe("DashboardGatewayClient", () => {
  it("honors per-request timeout overrides", async () => {
    vi.useFakeTimers();
    const client = new DashboardGatewayClient({ requestTimeoutMs: 30_000 });
    const socket = {
      close: vi.fn(),
      readyState: WebSocket.OPEN,
      send: vi.fn(),
    };
    (
      client as unknown as {
        socket: typeof socket;
      }
    ).socket = socket;

    const request = client.request("session.resume", {}, 120_000);
    let rejected = false;
    request.catch(() => {
      rejected = true;
    });

    await vi.advanceTimersByTimeAsync(30_000);
    expect(rejected).toBe(false);

    await vi.advanceTimersByTimeAsync(90_000);
    await expect(request).rejects.toThrow(
      "Hermes dashboard request timed out: session.resume",
    );
    expect(socket.send).toHaveBeenCalledWith(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "session.resume",
        params: {},
      }),
    );
  });
});
