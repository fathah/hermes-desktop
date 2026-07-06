import { beforeEach, describe, expect, it, vi } from "vitest";

const { connectionRef, fetchSpy, sshConfig, sshRunCronSpy } = vi.hoisted(() => {
  const sshConfig = {
    host: "example.test",
    port: 22,
    username: "hermes",
    keyPath: "/tmp/id_ed25519",
    remotePort: 8642,
    localPort: 18642,
  };
  return {
    sshConfig,
    connectionRef: {
      value: {
        mode: "ssh" as const,
        ssh: sshConfig,
      },
    },
    fetchSpy: vi.fn(),
    sshRunCronSpy: vi.fn(),
  };
});

vi.mock("../src/main/config", () => ({
  getConnectionConfig: () => connectionRef.value,
}));

vi.mock("../src/main/hermes", () => ({
  isRemoteMode: () => true,
  getApiUrl: () => "http://127.0.0.1:18642",
  getRemoteAuthHeader: () => ({}),
  normaliseRemoteUrl: (url: string) => url.replace(/\/+$/, ""),
}));

vi.mock("../src/main/installer", () => ({
  HERMES_HOME: "C:/hermes",
  HERMES_PYTHON: "C:/hermes/hermes-agent/venv/Scripts/pythonw.exe",
  hermesCliArgs: (args: string[] = []) => ["-m", "hermes_cli.main", ...args],
}));

vi.mock("../src/main/process-options", () => ({
  HIDDEN_SUBPROCESS_OPTIONS: {},
}));

vi.mock("../src/main/ssh-remote", () => ({
  sshRunCron: sshRunCronSpy,
}));

vi.mock("../src/main/utils", () => ({
  profileHome: () => "C:/hermes",
}));

beforeEach(() => {
  fetchSpy.mockReset();
  sshRunCronSpy.mockReset();
  vi.stubGlobal("fetch", fetchSpy);
});

describe("SSH profile cron jobs", () => {
  it("lists named-profile jobs through the remote Hermes launcher instead of the default API", async () => {
    sshRunCronSpy.mockResolvedValue({
      success: true,
      stdout: `
  bf14f5b235c7 [active]
    Name:      daily-marketing-report
    Schedule:  0 14 * * *
    Repeat:    ∞
    Next run:  2026-06-25T14:00:00+09:00
    Deliver:   discord:channel-456
`,
    });

    const { listCronJobs } = await import("../src/main/cronjobs");
    const jobs = await listCronJobs(true, "marketing");

    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      id: "bf14f5b235c7",
      name: "daily-marketing-report",
      schedule: "0 14 * * *",
      deliver: ["discord:channel-456"],
    });
    expect(sshRunCronSpy).toHaveBeenCalledWith(sshConfig, ["list", "--all"], {
      profile: "marketing",
      timeoutMs: 15000,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("creates named-profile jobs through the remote Hermes launcher", async () => {
    sshRunCronSpy.mockResolvedValue({ success: true, stdout: "created\n" });

    const { createCronJob } = await import("../src/main/cronjobs");
    const result = await createCronJob(
      "0 9 * * *",
      "Prepare the daily brief.",
      "Daily brief",
      "discord",
      "biz-office",
    );

    expect(result).toEqual({ success: true, error: undefined });
    expect(sshRunCronSpy).toHaveBeenCalledWith(
      sshConfig,
      [
        "create",
        "0 9 * * *",
        "Prepare the daily brief.",
        "--name",
        "Daily brief",
        "--deliver",
        "discord",
      ],
      { profile: "biz-office", timeoutMs: 15000 },
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
