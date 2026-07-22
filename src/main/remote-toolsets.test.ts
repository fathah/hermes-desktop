import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionConfig } from "./config";

const remoteDashboardRequestJson = vi.hoisted(() => vi.fn());
vi.mock("./remote-api", () => ({ remoteDashboardRequestJson }));

import { remoteGetToolsets, remoteSetToolsetEnabled } from "./remote-toolsets";

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

describe("remote toolsets routing", () => {
  it("maps Agent toolset rows to Desktop ToolsetInfo", async () => {
    remoteDashboardRequestJson.mockResolvedValue([
      {
        name: "web",
        label: "Web",
        description: "Search and fetch",
        enabled: true,
      },
      { name: "terminal", label: "Terminal", enabled: false },
      { label: "invalid" },
    ]);

    await expect(remoteGetToolsets(connection, "research")).resolves.toEqual([
      {
        key: "web",
        label: "Web",
        description: "Search and fetch",
        enabled: true,
      },
      {
        key: "terminal",
        label: "Terminal",
        description: "",
        enabled: false,
      },
    ]);
    expect(remoteDashboardRequestJson).toHaveBeenCalledWith(
      connection,
      "/api/tools/toolsets",
      {},
      "research",
    );
  });

  it("toggles profile-scoped Agent toolset", async () => {
    remoteDashboardRequestJson.mockResolvedValue({ ok: true });
    await expect(
      remoteSetToolsetEnabled(connection, "web", false, "research"),
    ).resolves.toBe(true);
    expect(remoteDashboardRequestJson).toHaveBeenCalledWith(
      connection,
      "/api/tools/toolsets/web",
      { method: "PUT", body: { enabled: false } },
      "research",
    );
  });

  it("rejects malformed toolset key before request", async () => {
    await expect(
      remoteSetToolsetEnabled(connection, "../config", true),
    ).rejects.toThrow("Invalid toolset key");
    expect(remoteDashboardRequestJson).not.toHaveBeenCalled();
  });
});
