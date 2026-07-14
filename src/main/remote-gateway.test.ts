import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionConfig } from "./config";

const remoteDashboardRequestJson = vi.hoisted(() => vi.fn());
vi.mock("./remote-api", () => ({ remoteDashboardRequestJson }));

import {
  remoteGatewayStatus,
  remoteRestartGateway,
  remoteStartGateway,
  remoteStopGateway,
} from "./remote-gateway";

const connection = {
  mode: "remote",
  remoteUrl: "https://remote.example:9119",
  apiKey: "",
  remoteAuthMode: "oauth",
  remoteChatTransport: "auto",
  sshChatTransport: "auto",
  ssh: {},
} as ConnectionConfig;

beforeEach(() => remoteDashboardRequestJson.mockReset());

describe("remote gateway routing", () => {
  it("reads profile-scoped gateway status", async () => {
    remoteDashboardRequestJson.mockResolvedValue({ gateway_running: true });
    await expect(remoteGatewayStatus(connection, "research")).resolves.toBe(
      true,
    );
    expect(remoteDashboardRequestJson).toHaveBeenCalledWith(
      connection,
      "/api/status",
      {},
      "research",
    );
  });

  it("starts, stops, and restarts selected profile gateway", async () => {
    remoteDashboardRequestJson.mockResolvedValue({ ok: true, pid: 42 });
    await expect(remoteStartGateway(connection, "research")).resolves.toEqual({
      success: true,
      running: true,
    });
    await expect(remoteStopGateway(connection, "research")).resolves.toBe(true);
    await expect(remoteRestartGateway(connection, "research")).resolves.toBe(
      true,
    );
    expect(remoteDashboardRequestJson).toHaveBeenNthCalledWith(
      1,
      connection,
      "/api/gateway/start",
      { method: "POST" },
      "research",
    );
    expect(remoteDashboardRequestJson).toHaveBeenNthCalledWith(
      2,
      connection,
      "/api/gateway/stop",
      { method: "POST" },
      "research",
    );
    expect(remoteDashboardRequestJson).toHaveBeenNthCalledWith(
      3,
      connection,
      "/api/gateway/restart",
      { method: "POST" },
      "research",
    );
  });
});
