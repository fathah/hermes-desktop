import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  conn: {
    mode: "local" as "local" | "remote" | "ssh",
    remoteUrl: "",
    apiKey: "",
    ssh: {
      host: "",
      port: 22,
      username: "",
      keyPath: "",
      remotePort: 8642,
      localPort: 18642,
    },
  },
}));

const mocks = vi.hoisted(() => ({
  isApiServerReady: vi.fn(),
  isGatewayRunning: vi.fn(),
  getGatewayHealthStatus: vi.fn(),
  testRemoteConnection: vi.fn(),
  sshGatewayStatus: vi.fn(),
}));

vi.mock("../src/main/config", () => ({
  getConnectionConfig: () => state.conn,
}));

vi.mock("../src/main/hermes", () => ({
  isApiServerReady: mocks.isApiServerReady,
  isGatewayRunning: mocks.isGatewayRunning,
  getGatewayHealthStatus: mocks.getGatewayHealthStatus,
  testRemoteConnection: mocks.testRemoteConnection,
}));

vi.mock("../src/main/ssh-remote", () => ({
  sshGatewayStatus: mocks.sshGatewayStatus,
}));

describe("connection gateway status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.conn = {
      mode: "local",
      remoteUrl: "",
      apiKey: "",
      ssh: {
        host: "",
        port: 22,
        username: "",
        keyPath: "",
        remotePort: 8642,
        localPort: 18642,
      },
    };
    mocks.isApiServerReady.mockResolvedValue(false);
    mocks.isGatewayRunning.mockReturnValue(false);
    mocks.getGatewayHealthStatus.mockReturnValue("healthy");
    mocks.testRemoteConnection.mockResolvedValue(false);
    mocks.sshGatewayStatus.mockResolvedValue(false);
  });

  it("reports local gateway health from a real /health probe", async () => {
    mocks.isApiServerReady.mockResolvedValue(true);
    const { getConnectionGatewayStatus } =
      await import("../src/main/gateway-status");

    await expect(getConnectionGatewayStatus("work")).resolves.toEqual({
      running: true,
      health: "healthy",
    });
    expect(mocks.isApiServerReady).toHaveBeenCalledWith("work");
  });

  it("does not leave local status healthy after a failed probe", async () => {
    mocks.isGatewayRunning.mockReturnValue(true);
    const { getConnectionGatewayStatus } =
      await import("../src/main/gateway-status");

    await expect(getConnectionGatewayStatus()).resolves.toEqual({
      running: true,
      health: "unhealthy",
    });
  });

  it("probes remote URL mode through the remote connection test", async () => {
    state.conn = {
      ...state.conn,
      mode: "remote",
      remoteUrl: "http://127.0.0.1:8642",
      apiKey: "remote-secret",
    };
    mocks.testRemoteConnection.mockResolvedValue(true);
    const { getConnectionGatewayStatus } =
      await import("../src/main/gateway-status");

    await expect(getConnectionGatewayStatus()).resolves.toEqual({
      running: true,
      health: "healthy",
    });
    expect(mocks.testRemoteConnection).toHaveBeenCalledWith(
      "http://127.0.0.1:8642",
      "remote-secret",
    );
  });

  it("uses the SSH gateway status implementation in SSH mode", async () => {
    state.conn = {
      ...state.conn,
      mode: "ssh",
      ssh: {
        ...state.conn.ssh,
        host: "remote.example",
      },
    };
    mocks.sshGatewayStatus.mockResolvedValue(true);
    const { getConnectionGatewayStatus } =
      await import("../src/main/gateway-status");

    await expect(getConnectionGatewayStatus()).resolves.toEqual({
      running: true,
      health: "healthy",
    });
    expect(mocks.sshGatewayStatus).toHaveBeenCalledWith(state.conn.ssh);
  });
});
