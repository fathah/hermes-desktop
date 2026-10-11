// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  ensureDashboard: vi.fn(),
  ensureTunnel: vi.fn(),
}));
vi.mock("../src/main/config", () => ({
  getConnectionConfig: () => ({
    mode: "ssh",
    sshChatTransport: "dashboard",
    ssh: { host: "synthetic-host", username: "synthetic-user" },
  }),
  getActiveConnection: () => ({ connectionId: "selected" }),
}));
vi.mock("../src/main/installer", () => ({
  HERMES_HOME: "/synthetic",
  HERMES_REPO: "/synthetic",
  HERMES_PYTHON: process.execPath,
  getEnhancedPath: () => "",
  hermesCliArgs: (args: string[]) => args,
}));
vi.mock("../src/main/hermes-agent-compat", () => ({
  ensureLocalDashboardCompatibility: () => ({ ok: true }),
}));
vi.mock("../src/main/remote-oauth", () => ({}));
vi.mock("../src/main/utils", () => ({
  getActiveProfileNameSync: () => "work",
  normalizeProfileName: (profile: string) => profile,
  profileHome: () => "/synthetic",
}));
vi.mock("../src/main/ssh-remote", () => ({
  sshEnsureDashboard: state.ensureDashboard,
}));
vi.mock("../src/main/ssh-tunnel", () => ({
  ensureSshTunnel: state.ensureTunnel,
  getSshTunnelUrl: () => null,
}));

beforeEach(() => {
  vi.resetModules();
  state.ensureDashboard.mockReset();
  state.ensureTunnel.mockReset();
});

// @lat: [[dashboard-shutdown#SSH dashboard continuation on quit]]
it("does not start a local tunnel after a remote dashboard reply arrives during quit", async () => {
  const dashboard = await import("../src/main/dashboard");
  const releases: ((value: { port: number; token: string }) => void)[] = [];
  state.ensureDashboard.mockImplementation(
    () => new Promise((resolve) => releases.push(resolve)),
  );
  const start = dashboard.startDashboard("work", "selected");
  const status = dashboard.getDashboardStatus("work", "selected");
  const url = dashboard.freshDashboardWebSocketUrl("work", "selected");
  const urlRejected = expect(url).rejects.toThrow("shutting down");
  expect(releases).toHaveLength(3);
  dashboard.beginDashboardShutdown();
  await dashboard.stopAllDashboards();
  for (const release of releases) release({ port: 5678, token: "synthetic" });
  for (const result of await Promise.all([start, status]))
    expect(result).toMatchObject({
      running: false,
      error: expect.stringContaining("shutting down"),
    });
  await urlRejected;
  expect(state.ensureTunnel).not.toHaveBeenCalled();
});

// @lat: [[dashboard-shutdown#Admitted tunnel continuation on quit]]
it("rejects an SSH status whose admitted tunnel finishes after quit begins", async () => {
  const dashboard = await import("../src/main/dashboard");
  state.ensureDashboard.mockResolvedValue({ port: 5678, token: "synthetic" });
  let release!: () => void;
  state.ensureTunnel.mockImplementation(
    () => new Promise<void>((resolve) => (release = resolve)),
  );
  const status = dashboard.getDashboardStatus("work", "selected");
  await vi.waitFor(() => expect(state.ensureTunnel).toHaveBeenCalledTimes(1));
  dashboard.beginDashboardShutdown();
  release();
  await expect(status).resolves.toMatchObject({
    running: false,
    error: expect.stringContaining("shutting down"),
  });
});
