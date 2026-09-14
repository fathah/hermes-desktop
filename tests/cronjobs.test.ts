import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";

const profileHomeRef = vi.hoisted(() => ({ value: "C:/hermes" }));

const { execFileSpy } = vi.hoisted(() => ({
  execFileSpy: vi.fn(
    (
      _file: string,
      _args: string[],
      _options: Record<string, unknown>,
      callback: (err: Error | null, stdout: string, stderr: string) => void,
    ) => callback(null, "ok", ""),
  ),
}));

vi.mock("child_process", () => ({
  execFile: execFileSpy,
  default: { execFile: execFileSpy },
}));

vi.mock("../src/main/utils", () => ({
  profileHome: () => profileHomeRef.value,
}));

vi.mock("../src/main/hermes", () => ({
  isRemoteMode: () => false,
  getApiUrl: () => "http://127.0.0.1:8642",
  getRemoteAuthHeader: () => ({}),
}));

vi.mock("../src/main/installer", () => ({
  HERMES_HOME: "C:/hermes",
  HERMES_PYTHON: "C:/hermes/hermes-agent/venv/Scripts/pythonw.exe",
  hermesCliArgs: (args: string[] = []) => ["-m", "hermes_cli.main", ...args],
}));

describe("createCronJob", () => {
  beforeEach(() => {
    execFileSpy.mockClear();
  });

  it("passes the prompt as the cron create positional argument before flags", async () => {
    const { createCronJob } = await import("../src/main/cronjobs");

    await createCronJob(
      "7 17 * * *",
      "Create a daily brief with local news, weather, and quotes.",
      "Daily brief",
      "telegram",
    );

    expect(execFileSpy).toHaveBeenCalledTimes(1);
    expect(execFileSpy.mock.calls[0][1]).toEqual([
      "-m",
      "hermes_cli.main",
      "cron",
      "create",
      "7 17 * * *",
      "Create a daily brief with local news, weather, and quotes.",
      "--name",
      "Daily brief",
      "--deliver",
      "telegram",
    ]);
    expect(execFileSpy.mock.calls[0][1]).not.toContain("--");
  });
});

describe("local cron jobs", () => {
  // @lat: [[scheduled-jobs#Test specifications#Local terminal-state normalization]]
  it("preserves completed jobs from disk and filters disabled jobs without rewriting them", async () => {
    const home = mkdtempSync(join(tmpdir(), "hermes-cron-states-"));
    const previousHome = profileHomeRef.value;
    try {
      profileHomeRef.value = home;
      mkdirSync(join(home, "cron"));
      const file = join(home, "cron", "jobs.json");
      const content = JSON.stringify({
        jobs: [
          { id: "finished", state: "completed", enabled: false },
          { id: "paused", state: "paused", enabled: false },
          { id: "legacy-disabled", enabled: false },
          { id: "active", state: "scheduled", enabled: true },
        ],
      });
      writeFileSync(file, content);

      const { listCronJobs } = await import("../src/main/cronjobs");
      const jobs = await listCronJobs();
      expect(
        jobs.map(({ id, state, enabled }) => ({ id, state, enabled })),
      ).toEqual([
        { id: "finished", state: "completed", enabled: false },
        { id: "paused", state: "paused", enabled: false },
        { id: "legacy-disabled", state: "paused", enabled: false },
        { id: "active", state: "active", enabled: true },
      ]);
      await expect(listCronJobs(false)).resolves.toEqual([
        expect.objectContaining({ id: "active" }),
      ]);
      expect(readFileSync(file, "utf-8")).toBe(content);
    } finally {
      profileHomeRef.value = previousHome;
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("parseCronListOutput", () => {
  it("parses the Hermes cron list table used by SSH profiles", async () => {
    const { parseCronListOutput } = await import("../src/main/cronjobs");

    const jobs = parseCronListOutput(`
┌─────────────────────────────────────────────────────────────────────────┐
│                         Scheduled Jobs                                  │
└─────────────────────────────────────────────────────────────────────────┘

  321a3a33703e [active]
    Name:      daily-daegu-startup-grant-monitoring
    Schedule:  0 9 * * *
    Repeat:    ∞
    Next run:  2026-06-25T09:00:00+09:00
    Deliver:   origin
    Workdir:   /workspaces/biz-office
    Last run:  2026-06-24T09:16:46.248027+09:00  ok

  85e1165b00eb [paused]
    Name:      server-emergency-watchdog
    Schedule:  every 10m
    Repeat:    2/5
    Next run:  2026-06-24T23:00:40.707549+09:00
    Deliver:   discord:channel-123
    Script:    server_emergency_watchdog.py
    Mode:      no-agent (script stdout delivered directly)
`);

    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      id: "321a3a33703e",
      name: "daily-daegu-startup-grant-monitoring",
      schedule: "0 9 * * *",
      state: "active",
      enabled: true,
      next_run_at: "2026-06-25T09:00:00+09:00",
      last_run_at: "2026-06-24T09:16:46.248027+09:00",
      last_status: "ok",
      repeat: { times: null, completed: 0 },
      deliver: ["origin"],
    });
    expect(jobs[1]).toMatchObject({
      id: "85e1165b00eb",
      state: "paused",
      enabled: false,
      repeat: { times: 5, completed: 2 },
      deliver: ["discord:channel-123"],
      script: "server_emergency_watchdog.py",
    });
  });
});
