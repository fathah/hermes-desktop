import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mockWriteFileSync = vi.fn();
const mockChmodSync = vi.fn();

vi.mock("fs", () => {
  const fns = {
    existsSync: () => true,
    mkdirSync: () => {},
    writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
    chmodSync: (...args: unknown[]) => mockChmodSync(...args),
  };
  return { ...fns, default: fns };
});

vi.mock("os", () => {
  const fns = {
    homedir: () => "/tmp/hermes-test-home",
  };
  return { ...fns, default: fns };
});

const mockReadDesktopConfig = vi.fn(() => ({}));
const mockWriteDesktopConfig = vi.fn();
const mockSendMessage = vi.fn();
const mockIsGatewayRunning = vi.fn(() => false);
const mockRunJobHeadless = vi.fn(() => Promise.resolve(true));
const mockCalendarQuery = vi.fn(() => []);

vi.mock("../src/main/config", () => ({
  readDesktopConfig: () => mockReadDesktopConfig(),
  writeDesktopConfig: (c: unknown) => mockWriteDesktopConfig(c),
  getConnectionConfig: () => ({ mode: "local" }),
}));

vi.mock("../src/main/hermes", () => ({
  isGatewayRunning: () => mockIsGatewayRunning(),
  sendMessage: (msg: string, callbacks: unknown) =>
    mockSendMessage(msg, callbacks),
}));

vi.mock("../src/main/scheduler", () => ({
  runJobHeadless: (jobId: string, jobName: string, profile: string) =>
    mockRunJobHeadless(jobId, jobName, profile),
}));

vi.mock("../src/main/note-index", () => ({
  getSpsNoteIndex: () => Promise.resolve({ query: mockCalendarQuery }),
}));

vi.mock("../src/main/utils", () => ({
  getActiveProfileNameSync: () => "test-profile",
  safeWriteFile: (path: string, content: string) =>
    mockWriteFileSync(path, content, "utf-8"),
}));

vi.mock("../src/main/installer/paths", () => ({
  HERMES_HOME: "/tmp/hermes-test-home/.hermes",
}));

import {
  startControlServer,
  stopControlServer,
} from "../src/main/control-server";

describe("Local Control Server Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await stopControlServer();
  });

  it("should start control server, write token to config, and handle GET /state", async () => {
    const desktopConfig: Record<string, unknown> = {};
    mockReadDesktopConfig.mockReturnValue(desktopConfig);

    const port = await startControlServer();
    expect(port).toBeGreaterThanOrEqual(8645);
    expect(desktopConfig.controlServerToken).toBeDefined();
    expect(desktopConfig.calendarFeedToken).toBeDefined();
    const token = desktopConfig.controlServerToken;

    // Verify OS-native script helper is generated
    expect(mockWriteFileSync).toHaveBeenCalled();
    const helperCall = mockWriteFileSync.mock.calls.find((call) =>
      String(call[0]).includes("/tmp/hermes-test-home/.hermes/bin/hermes-ask"),
    );
    const tokenCall = mockWriteFileSync.mock.calls.find((call) =>
      String(call[0]).includes(
        "/tmp/hermes-test-home/.hermes/control-server.token",
      ),
    );
    expect(helperCall).toBeDefined();
    expect(tokenCall).toBeDefined();
    const filePath = helperCall![0];
    const fileContent = helperCall![1];
    expect(filePath).toContain("/tmp/hermes-test-home/.hermes/bin/hermes-ask");
    expect(fileContent).toContain(`PORT="${port}"`);
    expect(fileContent).toContain("TOKEN_FILE=");
    expect(fileContent).not.toContain(String(token));
    expect(tokenCall![1]).toBe(`${token}\n`);
    expect(mockChmodSync).toHaveBeenCalledWith(filePath, 0o755);

    // Send HTTP query
    const res = await fetch(`http://127.0.0.1:${port}/state`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.profile).toBe("test-profile");
    expect(data.controlPort).toBe(port);
  });

  it("should reject unauthorized requests", async () => {
    const desktopConfig: Record<string, unknown> = {};
    mockReadDesktopConfig.mockReturnValue(desktopConfig);

    const port = await startControlServer();

    const res = await fetch(`http://127.0.0.1:${port}/state`, {
      headers: {
        Authorization: `Bearer invalid-token`,
      },
    });

    expect(res.status).toBe(401);
  });

  it("serves /calendar.ics with Authorization bearer control token", async () => {
    const desktopConfig: Record<string, unknown> = {};
    mockReadDesktopConfig.mockReturnValue(desktopConfig);
    mockCalendarQuery.mockReturnValueOnce([
      {
        path: "tasks/task-1.md",
        title: "Task One",
        props: { due: "2026-07-03", status: "todo" },
      },
    ]);

    const port = await startControlServer();
    const token = desktopConfig.controlServerToken;

    const res = await fetch(`http://127.0.0.1:${port}/calendar.ics`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    expect(await res.text()).toContain("SUMMARY:Task One");
  });

  it("serves /calendar.ics with the feed-only query token", async () => {
    const desktopConfig: Record<string, unknown> = {};
    mockReadDesktopConfig.mockReturnValue(desktopConfig);

    const port = await startControlServer();
    const feedToken = desktopConfig.calendarFeedToken;

    const res = await fetch(
      `http://127.0.0.1:${port}/calendar.ics?feedToken=${feedToken}`,
    );

    expect(res.status).toBe(200);
  });

  it("keeps legacy /calendar.ics query control-token compatibility", async () => {
    const desktopConfig: Record<string, unknown> = {};
    mockReadDesktopConfig.mockReturnValue(desktopConfig);

    const port = await startControlServer();
    const token = desktopConfig.controlServerToken;

    const res = await fetch(
      `http://127.0.0.1:${port}/calendar.ics?token=${token}`,
    );

    expect(res.status).toBe(200);
  });

  it("should trigger a background job on POST /cron/trigger", async () => {
    const desktopConfig: Record<string, unknown> = {};
    mockReadDesktopConfig.mockReturnValue(desktopConfig);

    const port = await startControlServer();
    const token = desktopConfig.controlServerToken;

    const res = await fetch(`http://127.0.0.1:${port}/cron/trigger`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ jobId: "job-123", jobName: "Test Run" }),
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.success).toBe(true);
    expect(mockRunJobHeadless).toHaveBeenCalledWith(
      "job-123",
      "Test Run",
      "test-profile",
    );
  });
});
