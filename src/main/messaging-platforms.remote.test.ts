import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => vi.fn());
const config = vi.hoisted(() => ({
  mode: "remote",
  remoteUrl: "http://r:9119",
  remoteAuthMode: undefined as string | undefined,
  apiKey: "",
}));

vi.mock("./config", () => ({
  getConnectionConfig: () => ({ ...config }),
}));
vi.mock("./hermes", () => ({
  normaliseRemoteUrl: (url: string) => url.replace(/\/+$/, ""),
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
    config.remoteAuthMode = undefined;
    config.remoteUrl = "http://r:9119";
  });

  afterEach(() => vi.unstubAllGlobals());

  // @lat: [[main-process#Main Process#Remote Gateway management#Keyless messaging compatibility]]
  it.each(["token", "auto"])(
    "retains named-profile messaging on keyless %s servers",
    async (mode) => {
      config.remoteAuthMode = mode;
      request.mockRejectedValue(
        new Error("Remote Hermes dashboard token is not configured."),
      );
      const bare = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ platforms: [], ok: true }),
      });
      vi.stubGlobal("fetch", bare);
      await fetchRemoteMessagingPlatforms("work");
      await updateRemoteMessagingPlatform(
        "telegram",
        { enabled: true },
        "work",
      );
      await testRemoteMessagingPlatform("telegram", "work");
      expect(bare.mock.calls.map((c) => [c[0], c[1].method])).toEqual([
        ["http://r:9119/api/messaging/platforms?profile=work", "GET"],
        ["http://r:9119/api/messaging/platforms/telegram?profile=work", "PUT"],
        [
          "http://r:9119/api/messaging/platforms/telegram/test?profile=work",
          "POST",
        ],
      ]);
    },
  );

  it.each(["auto", "oauth"])(
    "does not retry %s authentication failure anonymously",
    async (mode) => {
      config.remoteAuthMode = mode;
      request.mockRejectedValue(new Error("Remote OAuth login required"));
      const bare = vi.fn();
      vi.stubGlobal("fetch", bare);
      await expect(fetchRemoteMessagingPlatforms()).rejects.toThrow(
        "Remote OAuth login required",
      );
      expect(bare).not.toHaveBeenCalled();
    },
  );

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
      undefined,
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

  // @lat: [[main-process#Main Process#Remote Gateway management#Messaging profile isolation]]
  it("lists, updates and tests messaging settings for the selected remote profile", async () => {
    request.mockResolvedValue({ ok: true, platforms: [] });
    await fetchRemoteMessagingPlatforms("work");
    await updateRemoteMessagingPlatform("telegram", { enabled: true }, "work");
    await testRemoteMessagingPlatform("telegram", "work");

    expect(request.mock.calls.map((call) => [call[1], call[3]])).toEqual([
      ["/api/messaging/platforms", "work"],
      ["/api/messaging/platforms/telegram", "work"],
      ["/api/messaging/platforms/telegram/test", "work"],
    ]);
  });
});
