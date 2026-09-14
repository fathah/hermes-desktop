import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionConfig } from "./config";

const mocks = vi.hoisted(() => ({
  getAgentCapabilityEvidence: vi.fn(),
  getCachedAgentCapabilityEvidence: vi.fn(),
  getHermesVersion: vi.fn(),
  isGatewayRunning: vi.fn(),
  probeRemoteAuthMode: vi.fn(),
  remoteOAuthSessionState: vi.fn(),
  sshGatewayStatus: vi.fn(),
  sshGetHermesVersion: vi.fn(),
  testRemoteConnection: vi.fn(),
}));

vi.mock("./config", () => ({
  getApiServerKeyStatus: () => ({ hasKey: true }),
  getConnectionRegistry: () => ({
    version: 1,
    activeConnectionId: "local",
    connections: [
      { connectionId: "local", name: "Local", config: config("local") },
      {
        connectionId: "remote",
        name: "Remote",
        config: config("remote", "remote-secret"),
      },
      { connectionId: "ssh", name: "SSH", config: config("ssh") },
    ],
  }),
}));
vi.mock("./hermes", () => ({
  getAgentCapabilityEvidence: mocks.getAgentCapabilityEvidence,
  getCachedAgentCapabilityEvidence: mocks.getCachedAgentCapabilityEvidence,
  isGatewayRunning: mocks.isGatewayRunning,
  testRemoteConnection: mocks.testRemoteConnection,
}));
vi.mock("./installer", () => ({ getHermesVersion: mocks.getHermesVersion }));
vi.mock("./remote-oauth", () => ({
  probeRemoteAuthMode: mocks.probeRemoteAuthMode,
  remoteOAuthSessionState: mocks.remoteOAuthSessionState,
}));
vi.mock("./ssh-remote", () => ({
  sshGatewayStatus: mocks.sshGatewayStatus,
  sshGetHermesVersion: mocks.sshGetHermesVersion,
}));

import { getConnectionStatuses } from "./connection-status";

function config(
  mode: "local" | "remote" | "ssh",
  apiKey = "",
): ConnectionConfig {
  return {
    mode,
    remoteUrl: mode === "remote" ? "https://hermes.example" : "",
    apiKey,
    remoteAuthMode: "auto" as const,
    remoteChatTransport: "auto" as const,
    sshChatTransport: "auto" as const,
    ssh: {
      host: mode === "ssh" ? "ssh.example" : "",
      port: 22,
      username: mode === "ssh" ? "hermes" : "",
      keyPath: "",
      remotePort: 8642,
      localPort: 18642,
    },
  };
}

describe("connection status snapshots", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isGatewayRunning.mockReturnValue(true);
    mocks.getHermesVersion.mockResolvedValue("Hermes Agent v1.0.0");
    mocks.probeRemoteAuthMode.mockResolvedValue({
      authMode: "token",
      version: "1.1.0",
    });
    mocks.testRemoteConnection.mockResolvedValue(false);
    mocks.sshGatewayStatus.mockResolvedValue(false);
    mocks.sshGetHermesVersion.mockResolvedValue(null);
    mocks.getAgentCapabilityEvidence.mockResolvedValue({
      apiRunsTransport: true,
      commandNames: null,
      runtimeInfo: { desktop_contract: 6, version: "1.0.0" },
    });
    mocks.getCachedAgentCapabilityEvidence.mockReturnValue({
      apiRunsTransport: null,
      commandNames: null,
      runtimeInfo: null,
    });
  });

  // @lat: [[connections#Test specifications#Isolated status probes]]
  it("reports each record without returning its credentials", async () => {
    const statuses = await getConnectionStatuses("default");

    expect(
      statuses.map(({ connectionId, health, authentication }) => ({
        connectionId,
        health,
        authentication,
      })),
    ).toEqual([
      {
        connectionId: "local",
        health: "online",
        authentication: "authenticated",
      },
      { connectionId: "remote", health: "online", authentication: "required" },
      { connectionId: "ssh", health: "offline", authentication: "unknown" },
    ]);
    expect(mocks.probeRemoteAuthMode).toHaveBeenCalledWith(
      "https://hermes.example",
      fetch,
      "remote-secret",
    );
    expect(JSON.stringify(statuses)).not.toContain("remote-secret");
    expect(mocks.getCachedAgentCapabilityEvidence).toHaveBeenCalledWith(
      "remote",
      "default",
    );
  });
});
