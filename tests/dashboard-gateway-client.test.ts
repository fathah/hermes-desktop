import { describe, expect, it } from "vitest";
import { normalizeDashboardNotification } from "../src/renderer/src/screens/Chat/dashboardGatewayClient";

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
