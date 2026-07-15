import { beforeEach, describe, expect, it, vi } from "vitest";

const { remoteRequestJson, requestRemoteOAuthJson, RemoteOAuthError } =
  vi.hoisted(() => {
    class TestRemoteOAuthError extends Error {
      readonly needsOAuthLogin: boolean;

      constructor(
        message: string,
        readonly code:
          | "oauth_cancelled"
          | "oauth_connection_changed"
          | "oauth_login_required"
          | "oauth_request_failed",
        readonly statusCode?: number,
      ) {
        super(message);
        this.name = "RemoteOAuthError";
        this.needsOAuthLogin = code === "oauth_login_required";
      }
    }

    return {
      remoteRequestJson: vi.fn(),
      requestRemoteOAuthJson: vi.fn(),
      RemoteOAuthError: TestRemoteOAuthError,
    };
  });

vi.mock("./remote-sessions", () => ({
  dashboardApiUrl: (
    config: { remoteUrl: string; profile?: string },
    path: string,
  ) => {
    const url = new URL(path, `${config.remoteUrl.replace(/\/+$/, "")}/`);
    if (config.profile && config.profile !== "default") {
      url.searchParams.set("profile", config.profile);
    }
    return url.toString();
  },
  remoteRequestJson,
}));

vi.mock("./remote-oauth", () => ({
  requestRemoteOAuthJson,
  RemoteOAuthError,
}));

import { remoteDashboardRequestJson } from "./remote-api";
import type { ConnectionConfig } from "./config";

function remoteConnection(remoteAuthMode: "token" | "oauth"): ConnectionConfig {
  return {
    mode: "remote",
    remoteUrl: "https://remote.example:9119",
    apiKey: "secret",
    remoteAuthMode,
    remoteChatTransport: "auto",
    sshChatTransport: "auto",
    ssh: {
      host: "",
      port: 22,
      username: "",
      keyPath: "",
      remotePort: 9119,
      localPort: 9119,
    },
  };
}

beforeEach(() => {
  remoteRequestJson.mockReset();
  requestRemoteOAuthJson.mockReset();
});

describe("remote dashboard API client", () => {
  it("uses token dashboard transport with profile scoping", async () => {
    remoteRequestJson.mockResolvedValue({ ok: true });

    await expect(
      remoteDashboardRequestJson(
        remoteConnection("token"),
        "/api/tools/toolsets",
        { method: "PUT", body: { enabled: true } },
        "research",
      ),
    ).resolves.toEqual({ ok: true });

    expect(remoteRequestJson).toHaveBeenCalledWith(
      {
        remoteUrl: "https://remote.example:9119",
        apiKey: "secret",
        profile: "research",
      },
      "/api/tools/toolsets",
      { method: "PUT", body: { enabled: true } },
    );
    expect(requestRemoteOAuthJson).not.toHaveBeenCalled();
  });

  it("uses cookie-authenticated OAuth transport with scoped URL", async () => {
    requestRemoteOAuthJson.mockResolvedValue({ profiles: [] });

    await expect(
      remoteDashboardRequestJson(
        remoteConnection("oauth"),
        "/api/profiles",
        {},
        "research",
      ),
    ).resolves.toEqual({ profiles: [] });

    expect(requestRemoteOAuthJson).toHaveBeenCalledWith(
      "https://remote.example:9119/api/profiles?profile=research",
      {},
    );
    expect(remoteRequestJson).not.toHaveBeenCalled();
  });

  it("omits default profile query parameter", async () => {
    requestRemoteOAuthJson.mockResolvedValue([]);
    await remoteDashboardRequestJson(
      remoteConnection("oauth"),
      "/api/tools/toolsets",
      {},
      "default",
    );
    expect(requestRemoteOAuthJson).toHaveBeenCalledWith(
      "https://remote.example:9119/api/tools/toolsets",
      {},
    );
  });

  it("rejects non-Remote connections instead of touching local state", async () => {
    const local = {
      ...remoteConnection("token"),
      mode: "local",
    } as ConnectionConfig;
    await expect(
      remoteDashboardRequestJson(local, "/api/status"),
    ).rejects.toThrow("direct Remote mode");
    expect(remoteRequestJson).not.toHaveBeenCalled();
    expect(requestRemoteOAuthJson).not.toHaveBeenCalled();
  });

  it("normalizes token HTTP failures with a structured status", async () => {
    // @lat: [[remote-dashboard-oauth#Test specifications#Management failure classification]]
    remoteRequestJson.mockRejectedValue(
      new Error('404: {"detail":"Not Found"}'),
    );

    await expect(
      remoteDashboardRequestJson(
        remoteConnection("token"),
        "/api/tools/toolsets",
      ),
    ).rejects.toMatchObject({
      name: "RemoteDashboardApiError",
      statusCode: 404,
      unsupported: true,
    });
  });

  it("normalizes OAuth feature failures without losing HTTP status", async () => {
    requestRemoteOAuthJson.mockRejectedValue(
      new RemoteOAuthError(
        "Remote OAuth request failed (404).",
        "oauth_request_failed",
        404,
      ),
    );

    await expect(
      remoteDashboardRequestJson(
        remoteConnection("oauth"),
        "/api/tools/toolsets",
      ),
    ).rejects.toMatchObject({
      name: "RemoteDashboardApiError",
      statusCode: 404,
      unsupported: true,
    });
  });

  it("preserves OAuth login-required errors for reauthentication", async () => {
    // @lat: [[remote-dashboard-oauth#Test specifications#Management authentication routing]]
    const loginRequired = new RemoteOAuthError(
      "Remote OAuth session expired. Sign in again.",
      "oauth_login_required",
      401,
    );
    requestRemoteOAuthJson.mockRejectedValue(loginRequired);

    await expect(
      remoteDashboardRequestJson(
        remoteConnection("oauth"),
        "/api/tools/toolsets",
      ),
    ).rejects.toBe(loginRequired);
  });
});
