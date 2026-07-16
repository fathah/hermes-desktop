import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionConfig } from "./config";

const { dashboardRequest, tokenRequest } = vi.hoisted(() => ({
  dashboardRequest: vi.fn(),
  tokenRequest: vi.fn(),
}));

vi.mock("./remote-api", () => ({
  remoteDashboardRequestJson: dashboardRequest,
}));
vi.mock("./remote-sessions", () => ({
  remoteRequestJson: tokenRequest,
}));

import { remoteGetHermesHome, remoteGetHermesVersion } from "./remote-metadata";

const oauthConnection = {
  mode: "remote",
  remoteUrl: "https://remote.example",
  apiKey: "",
  remoteAuthMode: "oauth",
} as ConnectionConfig;

beforeEach(() => {
  dashboardRequest.mockReset();
  tokenRequest.mockReset();
});

describe("remote metadata authentication", () => {
  // @lat: [[remote-management#Test specifications#Authentication routing]]
  it("uses the cookie-aware boundary for direct OAuth", async () => {
    dashboardRequest.mockResolvedValue({
      version: "0.18.2",
      hermes_home: "/srv/hermes",
    });

    await expect(remoteGetHermesHome(oauthConnection)).resolves.toBe(
      "/srv/hermes",
    );
    await expect(remoteGetHermesVersion(oauthConnection)).resolves.toContain(
      "Hermes Agent v0.18.2",
    );
    expect(dashboardRequest).toHaveBeenCalledTimes(2);
    expect(dashboardRequest).toHaveBeenCalledWith(
      oauthConnection,
      "/api/status",
      {},
    );
    expect(tokenRequest).not.toHaveBeenCalled();
  });

  it("retains token transport for an SSH dashboard bridge", async () => {
    const bridge = {
      remoteUrl: "http://127.0.0.1:18642",
      apiKey: "session-token",
      profile: "writer",
    };
    tokenRequest.mockResolvedValue({ hermes_home: "/srv/writer" });

    await expect(remoteGetHermesHome(bridge)).resolves.toBe("/srv/writer");
    expect(tokenRequest).toHaveBeenCalledWith(bridge, "/api/status", {});
    expect(dashboardRequest).not.toHaveBeenCalled();
  });
});
