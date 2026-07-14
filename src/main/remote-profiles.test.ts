import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionConfig } from "./config";

const remoteDashboardRequestJson = vi.hoisted(() => vi.fn());
vi.mock("./remote-api", () => ({ remoteDashboardRequestJson }));

import {
  remoteCreateProfile,
  remoteDeleteProfile,
  remoteListProfiles,
  remoteReadSoul,
  remoteSetActiveProfile,
  remoteWriteSoul,
} from "./remote-profiles";

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

describe("remote profiles routing", () => {
  it("maps Agent rows and server active profile", async () => {
    remoteDashboardRequestJson
      .mockResolvedValueOnce({
        profiles: [
          {
            name: "default",
            path: "/srv/hermes",
            is_default: true,
            model: "gpt-5",
            provider: "openai",
            has_env: true,
            skill_count: 3,
            gateway_running: true,
          },
          {
            name: "research",
            path: "/srv/hermes/profiles/research",
            model: null,
          },
        ],
      })
      .mockResolvedValueOnce({ active: "research" });

    const profiles = await remoteListProfiles(connection);
    expect(profiles).toHaveLength(2);
    expect(profiles[0]).toMatchObject({
      id: "default",
      name: "default",
      isDefault: true,
      isActive: false,
      model: "gpt-5",
      provider: "openai",
      hasEnv: true,
      skillCount: 3,
      gatewayRunning: true,
      avatar: null,
    });
    expect(profiles[1]).toMatchObject({
      id: "research",
      isActive: true,
      provider: "auto",
    });
    expect(profiles[0].color).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it("creates, deletes, and activates through Agent API", async () => {
    remoteDashboardRequestJson.mockResolvedValue({ ok: true, name: "writer" });
    await expect(
      remoteCreateProfile(connection, "Writer", "default"),
    ).resolves.toEqual({ success: true, id: "writer" });
    await expect(remoteDeleteProfile(connection, "writer")).resolves.toEqual({
      success: true,
    });
    await expect(remoteSetActiveProfile(connection, "writer")).resolves.toBe(
      true,
    );
    expect(remoteDashboardRequestJson).toHaveBeenNthCalledWith(
      1,
      connection,
      "/api/profiles",
      { method: "POST", body: { name: "Writer", clone_from: "default" } },
    );
    expect(remoteDashboardRequestJson).toHaveBeenNthCalledWith(
      2,
      connection,
      "/api/profiles/writer",
      { method: "DELETE" },
    );
    expect(remoteDashboardRequestJson).toHaveBeenNthCalledWith(
      3,
      connection,
      "/api/profiles/active",
      { method: "POST", body: { name: "writer" } },
    );
  });

  it("reads and writes Soul through profile endpoint", async () => {
    remoteDashboardRequestJson
      .mockResolvedValueOnce({ content: "Remote soul", exists: true })
      .mockResolvedValueOnce({ ok: true });
    await expect(remoteReadSoul(connection, "research")).resolves.toBe(
      "Remote soul",
    );
    await expect(
      remoteWriteSoul(connection, "Updated", "research"),
    ).resolves.toBe(true);
    expect(remoteDashboardRequestJson).toHaveBeenNthCalledWith(
      1,
      connection,
      "/api/profiles/research/soul",
    );
    expect(remoteDashboardRequestJson).toHaveBeenNthCalledWith(
      2,
      connection,
      "/api/profiles/research/soul",
      { method: "PUT", body: { content: "Updated" } },
    );
  });
});
