import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionConfig } from "./config";

const remoteDashboardRequestJson = vi.hoisted(() => vi.fn());
vi.mock("./remote-api", () => ({ remoteDashboardRequestJson }));

import {
  fetchRemoteMessagingPlatforms,
  testRemoteMessagingPlatform,
  updateRemoteMessagingPlatform,
} from "./messaging-platforms";

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

describe("remote messaging routing", () => {
  it("reads, updates, and tests through authenticated client", async () => {
    remoteDashboardRequestJson
      .mockResolvedValueOnce({ platforms: [], editable: false })
      .mockResolvedValueOnce({ ok: true, platform: "telegram" })
      .mockResolvedValueOnce({ ok: true, state: "running", message: "ok" });
    await expect(
      fetchRemoteMessagingPlatforms(connection, "research"),
    ).resolves.toMatchObject({ editable: true, source: "remote-api" });
    await updateRemoteMessagingPlatform(
      connection,
      "telegram",
      { enabled: true },
      "research",
    );
    await testRemoteMessagingPlatform(connection, "telegram", "research");
    expect(remoteDashboardRequestJson).toHaveBeenNthCalledWith(
      2,
      connection,
      "/api/messaging/platforms/telegram",
      { method: "PUT", body: { enabled: true } },
      "research",
    );
  });
});
