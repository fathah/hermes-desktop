import { beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => vi.fn());

vi.mock("./config", () => ({
  getConnectionConfig: () => ({ mode: "remote", remoteUrl: "http://r:9119" }),
}));
vi.mock("./remote-api", () => ({ remoteDashboardRequestJson: request }));

import {
  fetchRemoteMessagingPlatforms,
  testRemoteMessagingPlatform,
  updateRemoteMessagingPlatform,
} from "./messaging-platforms";

describe("remote messaging platforms", () => {
  beforeEach(() => {
    request.mockReset();
  });

  it("goes through the authenticated dashboard boundary, never a bare fetch", async () => {
    const bare = vi.fn();
    vi.stubGlobal("fetch", bare);
    request.mockResolvedValue({ platforms: [] });
    const res = await fetchRemoteMessagingPlatforms();
    expect(res).toMatchObject({ editable: true, source: "remote-api" });
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "remote" }),
      "/api/messaging/platforms",
      { method: "GET", body: undefined },
    );
    expect(bare).not.toHaveBeenCalled();
  });

  it("updates and tests a platform with the right verb, path and body", async () => {
    request.mockResolvedValue({ ok: true, platform: "telegram" });
    await updateRemoteMessagingPlatform("telegram", { enabled: true });
    await testRemoteMessagingPlatform("telegram");
    expect(request.mock.calls.map((c) => [c[1], c[2]])).toEqual([
      [
        "/api/messaging/platforms/telegram",
        { method: "PUT", body: { enabled: true } },
      ],
      [
        "/api/messaging/platforms/telegram/test",
        { method: "POST", body: undefined },
      ],
    ]);
  });

  it("surfaces an auth failure instead of an empty catalog", async () => {
    request.mockImplementation(async () => {
      throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });
    });
    await expect(fetchRemoteMessagingPlatforms()).rejects.toThrow(
      "Unauthorized",
    );
  });
});
