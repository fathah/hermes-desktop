import { beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => vi.fn());

vi.mock("./config", () => ({
  getConnectionConfig: () => ({ mode: "remote", remoteUrl: "http://r:9119" }),
}));
vi.mock("./remote-api", () => ({ remoteDashboardRequestJson: request }));

import {
  remoteGatewayStatus,
  remoteRestartGateway,
  remoteStartGateway,
  remoteStopGateway,
} from "./remote-gateway";

describe("remote gateway lifecycle", () => {
  beforeEach(() => {
    request.mockReset();
  });

  it("reads liveness from /api/status gateway_running", async () => {
    request.mockResolvedValue({ gateway_running: true });
    expect(await remoteGatewayStatus()).toBe(true);
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "remote" }),
      "/api/status",
    );
    request.mockResolvedValue({ gateway_running: false });
    expect(await remoteGatewayStatus()).toBe(false);
  });

  it("treats an unreachable dashboard as not running", async () => {
    request.mockImplementation(async () => {
      throw new Error("down");
    });
    expect(await remoteGatewayStatus()).toBe(false);
  });

  it("POSTs start/stop/restart and scopes a named profile", async () => {
    request.mockResolvedValue({ ok: true, pid: 1 });
    expect(await remoteStartGateway()).toEqual({ success: true });
    expect(await remoteStopGateway()).toEqual({ success: true });
    expect(await remoteRestartGateway("work")).toEqual({ success: true });
    expect(request.mock.calls.map((c) => [c[1], c[2]])).toEqual([
      ["/api/gateway/start", { method: "POST" }],
      ["/api/gateway/stop", { method: "POST" }],
      ["/api/gateway/restart?profile=work", { method: "POST" }],
    ]);
  });

  it("surfaces the server refusal as an error result", async () => {
    request.mockImplementation(async () => {
      throw new Error("409: served by multiplexer");
    });
    expect(await remoteStartGateway()).toEqual({
      success: false,
      error: "409: served by multiplexer",
    });
  });

  it("scopes status, start, stop and restart to the same profile", async () => {
    request.mockResolvedValue({ ok: true, pid: 1, gateway_running: true });
    await remoteGatewayStatus("work");
    await remoteStartGateway("work");
    await remoteStopGateway("work");
    await remoteRestartGateway("work");
    expect(request.mock.calls.map((c) => c[1])).toEqual([
      "/api/status?profile=work",
      "/api/gateway/start?profile=work",
      "/api/gateway/stop?profile=work",
      "/api/gateway/restart?profile=work",
    ]);
  });
});
