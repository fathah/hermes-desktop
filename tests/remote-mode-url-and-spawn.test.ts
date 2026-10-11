import { describe, it, expect, vi, afterEach } from "vitest";

/**
 * Coverage for the two fixes in #266:
 *
 *   1. `normaliseRemoteUrl` strips trailing `/v1` and slashes so callers
 *      that append `/v1/<path>` don't produce `/v1/v1/...` → 404.
 *
 *   2. `startGateway` and `restartGateway` refuse to spawn a local
 *      hermes-agent when the connection is in remote/SSH mode — the
 *      defensive net that catches IPC paths that don't explicitly gate
 *      on `isRemoteMode()`.
 */

const {
  TEST_HOME,
  connModeRef,
  connAuthRef,
  sshTunnelUrlRef,
  sshLocalPortRef,
  spawnSpy,
} = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("path");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require("os");
  return {
    TEST_HOME: path.join(os.tmpdir(), `hermes-remote-test-${Date.now()}`),
    connModeRef: { mode: "local" as "local" | "remote" | "ssh" },
    connAuthRef: {
      mode: undefined as string | undefined,
      apiKey: "",
      url: "http://example.com",
    },
    sshTunnelUrlRef: { value: "http://localhost:18642" as string | null },
    sshLocalPortRef: { value: 18642 as number | undefined },
    spawnSpy: vi.fn(() => ({
      unref: () => {},
      pid: 12345,
      on: () => {},
    })),
  };
});

const dashboardRequestMock = vi.hoisted(() => vi.fn());

vi.mock("../src/main/remote-api", () => ({
  remoteDashboardRequestJson: dashboardRequestMock,
}));

vi.mock("../src/main/installer", () => ({
  HERMES_HOME: TEST_HOME,
  HERMES_PYTHON: "/usr/bin/python3",
  HERMES_REPO: "/dev/null",
  hermesCliArgs: () => ["gateway"],
  getEnhancedPath: () => process.env.PATH || "",
}));

vi.mock("../src/main/config", () => ({
  readDesktopConfig: () => ({}),
  getModelConfig: () => ({ model: "test-model", provider: "openrouter" }),
  readEnv: () => ({}),
  getConnectionConfig: () => ({
    mode: connModeRef.mode,
    remoteUrl: connAuthRef.url,
    apiKey: connAuthRef.apiKey,
    remoteAuthMode: connAuthRef.mode,
    ssh: {
      host: "",
      port: 22,
      username: "",
      keyPath: "",
      remotePort: 8642,
      localPort: sshLocalPortRef.value,
    },
  }),
}));

vi.mock("../src/main/ssh-tunnel", () => ({
  getSshTunnelUrl: () => sshTunnelUrlRef.value,
  isSshTunnelActive: () => true,
  isSshTunnelHealthy: () => Promise.resolve(true),
  startSshTunnel: () => Promise.resolve(),
}));

vi.mock("../src/main/utils", () => ({
  stripAnsi: (s: string) => s,
  pidIsAliveAs: () => false,
}));

vi.mock("../src/main/models", () => ({
  readModels: () => [],
}));

vi.mock("../src/main/process-options", () => ({
  HIDDEN_SUBPROCESS_OPTIONS: {},
}));

// Spy on child_process.spawn so we can assert it isn't called when the
// remote-mode guard fires.  When guards work correctly tests never
// reach the spawn site; the unref/pid/on stubs are belt-and-braces.

vi.mock("child_process", async () => {
  const actual =
    await vi.importActual<typeof import("child_process")>("child_process");
  return {
    ...actual,
    spawn: spawnSpy,
  };
});

import {
  normaliseRemoteUrl,
  getApiUrl,
  startGateway,
  startGatewayDetailed,
  restartGateway,
  restartGatewayViaCli,
  testRemoteConnection,
  contextFolderSystemMessage,
} from "../src/main/hermes";
import http from "http";

afterEach(() => {
  vi.unstubAllGlobals();
  connModeRef.mode = "local";
  connAuthRef.mode = undefined;
  connAuthRef.apiKey = "";
  connAuthRef.url = "http://example.com";
  sshTunnelUrlRef.value = "http://localhost:18642";
  sshLocalPortRef.value = 18642;
});

describe("normaliseRemoteUrl", () => {
  it("strips a trailing /v1 segment so callers don't double it", () => {
    expect(normaliseRemoteUrl("http://127.0.0.1:8642/v1")).toBe(
      "http://127.0.0.1:8642",
    );
    expect(normaliseRemoteUrl("https://api.example.com/v1")).toBe(
      "https://api.example.com",
    );
  });

  it("strips trailing slashes", () => {
    expect(normaliseRemoteUrl("http://127.0.0.1:8642/")).toBe(
      "http://127.0.0.1:8642",
    );
    expect(normaliseRemoteUrl("http://127.0.0.1:8642///")).toBe(
      "http://127.0.0.1:8642",
    );
  });

  it("strips trailing /v1/ (slash-suffixed)", () => {
    expect(normaliseRemoteUrl("http://127.0.0.1:8642/v1/")).toBe(
      "http://127.0.0.1:8642",
    );
  });

  it("is case-insensitive on the /v1 segment", () => {
    expect(normaliseRemoteUrl("http://127.0.0.1:8642/V1")).toBe(
      "http://127.0.0.1:8642",
    );
  });

  it("trims whitespace", () => {
    expect(normaliseRemoteUrl("  http://127.0.0.1:8642  ")).toBe(
      "http://127.0.0.1:8642",
    );
  });

  it("leaves a clean URL untouched", () => {
    expect(normaliseRemoteUrl("http://127.0.0.1:8642")).toBe(
      "http://127.0.0.1:8642",
    );
    expect(normaliseRemoteUrl("https://api.example.com")).toBe(
      "https://api.example.com",
    );
  });

  it("doesn't strip a `/v1` that isn't the trailing segment", () => {
    // Pathological but valid — a host whose path contains v1 elsewhere
    // should not be mangled.
    expect(normaliseRemoteUrl("http://example.com/v1/foo")).toBe(
      "http://example.com/v1/foo",
    );
  });

  it("tolerates empty input", () => {
    expect(normaliseRemoteUrl("")).toBe("");
    // @ts-expect-error — defending against the undefined case
    expect(normaliseRemoteUrl(undefined)).toBe("");
  });
});

describe("getApiUrl in SSH mode", () => {
  it("uses the active SSH tunnel URL when tunnel state is available", () => {
    connModeRef.mode = "ssh";
    sshTunnelUrlRef.value = "http://localhost:18642";
    sshLocalPortRef.value = 18642;

    expect(getApiUrl()).toBe("http://localhost:18642");
  });

  it("preserves the original error when tunnel state is unavailable", () => {
    connModeRef.mode = "ssh";
    sshTunnelUrlRef.value = null;
    sshLocalPortRef.value = 18642;

    expect(() => getApiUrl()).toThrow("SSH tunnel is not active");
  });

  it("preserves the original error when no tunnel state or local port is available", () => {
    connModeRef.mode = "ssh";
    sshTunnelUrlRef.value = null;
    sshLocalPortRef.value = undefined;

    expect(() => getApiUrl()).toThrow("SSH tunnel is not active");
  });
});

describe("Cron SSH fallback", () => {
  it("scopes the configured/default port fallback to cron after a successful /health probe", async () => {
    connModeRef.mode = "ssh";
    sshTunnelUrlRef.value = null;
    sshLocalPortRef.value = 18642;

    const fetchSpy = vi.fn(async (target: string) => {
      if (target === "http://127.0.0.1:18642/health") {
        return { ok: true } as Response;
      }
      if (target === "http://127.0.0.1:18642/api/cron/jobs") {
        return {
          ok: true,
          status: 200,
          json: async () => [
            { id: "job-1", name: "Daily", schedule: "0 9 * * *" },
          ],
        } as Response;
      }
      throw new Error(`unexpected fetch target: ${target}`);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const { listCronJobs } = await import("../src/main/cronjobs");
    const jobs = await listCronJobs();

    expect(jobs).toHaveLength(1);
    expect(jobs[0].id).toBe("job-1");
    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:18642/health",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:18642/api/cron/jobs",
      expect.any(Object),
    );
  });

  it("lists dashboard cron jobs through the authenticated dashboard request in direct remote mode", async () => {
    connModeRef.mode = "remote";
    sshTunnelUrlRef.value = "http://example.com";
    dashboardRequestMock.mockReset();
    dashboardRequestMock.mockResolvedValue([
      { id: "job-1", name: "nas-md-rebuild-watch", schedule: "every 30m" },
    ]);
    const fetchSpy = vi.fn(async () => {
      throw new Error("bare fetch must not be used for dashboard cron");
    });
    vi.stubGlobal("fetch", fetchSpy);

    const { listCronJobs } = await import("../src/main/cronjobs");
    const jobs = await listCronJobs();

    expect(jobs.map((j) => j.name)).toEqual(["nas-md-rebuild-watch"]);
    expect(dashboardRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "remote" }),
      "/api/cron/jobs?profile=default",
      expect.objectContaining({ method: "GET" }),
      undefined,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // @lat: [[scheduled-jobs#Test specifications#Selected remote profile]]
  it("scopes dashboard reads and mutations to the selected profile", async () => {
    connModeRef.mode = "remote";
    dashboardRequestMock.mockReset();
    dashboardRequestMock.mockResolvedValue([]);
    const {
      listCronJobs,
      createCronJob,
      removeCronJob,
      pauseCronJob,
      resumeCronJob,
      triggerCronJob,
    } = await import("../src/main/cronjobs");
    await listCronJobs(true, "work");
    await createCronJob("every 1h", "ping", "watch", "local", "work");
    await removeCronJob("j1", "work");
    await pauseCronJob("j1", "work");
    await resumeCronJob("j1", "work");
    await triggerCronJob("j1", "work");
    expect(dashboardRequestMock.mock.calls.map((c) => [c[1], c[3]])).toEqual([
      ["/api/cron/jobs?profile=work", "work"],
      ["/api/cron/jobs?profile=work", "work"],
      ["/api/cron/jobs/j1?profile=work", "work"],
      ["/api/cron/jobs/j1/pause?profile=work", "work"],
      ["/api/cron/jobs/j1/resume?profile=work", "work"],
      ["/api/cron/jobs/j1/trigger?profile=work", "work"],
    ]);
  });

  // @lat: [[scheduled-jobs#Test specifications#Fallback retains its target]]
  it("keeps a delayed gateway fallback on the original connection and named profile", async () => {
    connModeRef.mode = "remote";
    connAuthRef.apiKey = "a-token";
    let reject!: (error: Error) => void;
    dashboardRequestMock.mockReset();
    dashboardRequestMock.mockImplementation(
      () =>
        new Promise((_, r) => {
          reject = r;
        }),
    );
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200 }) as Response);
    vi.stubGlobal("fetch", fetchSpy);
    const { removeCronJob } = await import("../src/main/cronjobs");
    const pending = removeCronJob("j1", "work");
    await vi.waitFor(() => expect(dashboardRequestMock).toHaveBeenCalled());
    connAuthRef.url = "http://other.example.com";
    connAuthRef.apiKey = "b-token";
    reject(Object.assign(new Error("Not Found"), { statusCode: 404 }));
    expect((await pending).success).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://example.com/p/work/api/jobs/j1",
      expect.objectContaining({
        method: "DELETE",
        headers: { Authorization: "Bearer a-token" },
      }),
    );
  });

  // @lat: [[scheduled-jobs#Test specifications#OAuth failures remain authenticated]]
  it("does not retry failed auto-mode OAuth requests through bare fetch", async () => {
    connModeRef.mode = "remote";
    connAuthRef.mode = "auto";
    dashboardRequestMock.mockReset();
    dashboardRequestMock.mockRejectedValue(
      new Error("Remote OAuth login required"),
    );
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { removeCronJob } = await import("../src/main/cronjobs");
    expect(await removeCronJob("j1")).toEqual({
      success: false,
      error: "Remote OAuth login required",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns an empty list (not a throw) when the dashboard rejects the session", async () => {
    connModeRef.mode = "remote";
    sshTunnelUrlRef.value = "http://example.com";
    dashboardRequestMock.mockReset();
    dashboardRequestMock.mockImplementation(async () => {
      throw Object.assign(new Error("unauthenticated"), { statusCode: 401 });
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn());

    const { listCronJobs } = await import("../src/main/cronjobs");
    expect(await listCronJobs()).toEqual([]);
    expect(errorSpy).toHaveBeenCalledWith(
      "[CRON] remote list failed:",
      "unauthenticated",
    );
    errorSpy.mockRestore();
  });

  it("sends cron mutations to the dashboard with a parsed JSON body and /trigger for run", async () => {
    connModeRef.mode = "remote";
    sshTunnelUrlRef.value = "http://example.com";
    dashboardRequestMock.mockReset();
    dashboardRequestMock.mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", vi.fn());

    const { createCronJob, pauseCronJob, triggerCronJob, removeCronJob } =
      await import("../src/main/cronjobs");
    expect(
      (await createCronJob("every 30m", "ping", "nas-watch", "local")).success,
    ).toBe(true);
    expect((await pauseCronJob("j1")).success).toBe(true);
    expect((await triggerCronJob("j1")).success).toBe(true);
    expect((await removeCronJob("j1")).success).toBe(true);

    const calls = dashboardRequestMock.mock.calls.map((c) => [
      c[1],
      c[2].method,
      c[2].body,
    ]);
    expect(calls).toEqual([
      [
        "/api/cron/jobs?profile=default",
        "POST",
        {
          name: "nas-watch",
          schedule: "every 30m",
          prompt: "ping",
          deliver: "local",
        },
      ],
      ["/api/cron/jobs/j1/pause?profile=default", "POST", undefined],
      ["/api/cron/jobs/j1/trigger?profile=default", "POST", undefined],
      ["/api/cron/jobs/j1?profile=default", "DELETE", undefined],
    ]);
  });

  it("maps /trigger to the gateway /run when only the legacy route exists", async () => {
    connModeRef.mode = "remote";
    sshTunnelUrlRef.value = "http://example.com";
    dashboardRequestMock.mockReset();
    dashboardRequestMock.mockImplementation(async () => {
      throw Object.assign(new Error("Not Found"), { statusCode: 404 });
    });
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200 }) as Response);
    vi.stubGlobal("fetch", fetchSpy);

    const { triggerCronJob } = await import("../src/main/cronjobs");
    expect((await triggerCronJob("j1")).success).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://example.com/api/jobs/j1/run",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("keeps a keyless gateway working: no token means a plain request, not a failed list", async () => {
    connModeRef.mode = "remote";
    sshTunnelUrlRef.value = "http://example.com";
    dashboardRequestMock.mockReset();
    dashboardRequestMock.mockImplementation(async () => {
      throw new Error("Remote Hermes dashboard token is not configured.");
    });
    const fetchSpy = vi.fn(async (target: string) => {
      if (target === "http://example.com/api/cron/jobs?profile=default") {
        return {
          ok: true,
          status: 200,
          json: async () => [
            { id: "k1", name: "Keyless", schedule: "* * * * *" },
          ],
        } as Response;
      }
      throw new Error(`unexpected fetch target: ${target}`);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const { listCronJobs } = await import("../src/main/cronjobs");
    expect((await listCronJobs()).map((j) => j.id)).toEqual(["k1"]);
  });

  // @lat: [[scheduled-jobs#Test specifications#Anonymous dashboard profile routing]]
  it.each(["token", "auto"])(
    "uses dashboard profile queries for named keyless %s requests",
    async (mode) => {
      connModeRef.mode = "remote";
      connAuthRef.mode = mode;
      dashboardRequestMock.mockReset();
      dashboardRequestMock.mockRejectedValue(
        new Error("Remote Hermes dashboard token is not configured."),
      );
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [],
      } as Response);
      vi.stubGlobal("fetch", fetchSpy);
      const { listCronJobs, removeCronJob } =
        await import("../src/main/cronjobs");
      await listCronJobs(true, "work");
      expect((await removeCronJob("j1", "work")).success).toBe(true);
      expect(fetchSpy.mock.calls.map((c) => c[0])).toEqual([
        "http://example.com/api/cron/jobs?profile=work",
        "http://example.com/api/cron/jobs/j1?profile=work",
      ]);
    },
  );

  // @lat: [[scheduled-jobs#Test specifications#Anonymous HTML actions fail]]
  it("rejects a keyless mutation answered by an HTML SPA page", async () => {
    connModeRef.mode = "remote";
    connAuthRef.mode = "token";
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response("<html>Sign in</html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const { removeCronJob } = await import("../src/main/cronjobs");
    expect(await removeCronJob("j1", "work")).toEqual({
      success: false,
      error: "Remote cron returned HTML instead of an API response.",
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("does not report a job action as done when the OAuth reply was a sign-in page", async () => {
    connModeRef.mode = "remote";
    connAuthRef.mode = "oauth";
    sshTunnelUrlRef.value = "http://example.com";
    dashboardRequestMock.mockReset();
    // requestRemoteOAuthJson rejects an HTML body but keeps the HTTP status (200).
    dashboardRequestMock.mockImplementation(async () => {
      throw Object.assign(new Error("Remote OAuth returned HTML"), {
        statusCode: 200,
      });
    });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const { pauseCronJob } = await import("../src/main/cronjobs");
    const res = await pauseCronJob("j1");
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/HTML/);
    // And an OAuth remote never falls back to an unauthenticated request.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("falls back to gateway /api/jobs when the dashboard cron route is unsupported", async () => {
    connModeRef.mode = "remote";
    sshTunnelUrlRef.value = "http://example.com";
    dashboardRequestMock.mockReset();
    dashboardRequestMock.mockRejectedValue(
      Object.assign(new Error("405: Method Not Allowed"), { statusCode: 405 }),
    );

    const fetchSpy = vi.fn(async (target: string) => {
      if (target === "http://example.com/api/jobs?include_disabled=true") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            jobs: [{ id: "gw-1", name: "Legacy", schedule: "0 9 * * *" }],
          }),
        } as Response;
      }
      throw new Error(`unexpected fetch target: ${target}`);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const { listCronJobs } = await import("../src/main/cronjobs");
    const jobs = await listCronJobs();

    expect(jobs).toHaveLength(1);
    expect(jobs[0].id).toBe("gw-1");
    expect(dashboardRequestMock).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://example.com/api/jobs?include_disabled=true",
      expect.any(Object),
    );
  });

  it("does not send cron API requests to the configured/default port when /health fails", async () => {
    connModeRef.mode = "ssh";
    sshTunnelUrlRef.value = null;
    sshLocalPortRef.value = 18642;

    const fetchSpy = vi.fn(async (target: string) => {
      if (target === "http://127.0.0.1:18642/health") {
        return { ok: false } as Response;
      }
      throw new Error(`unexpected fetch target: ${target}`);
    });
    vi.stubGlobal("fetch", fetchSpy);
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const { listCronJobs } = await import("../src/main/cronjobs");
    const jobs = await listCronJobs();

    expect(jobs).toEqual([]);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[CRON] remote list error:",
      expect.any(Error),
    );
    consoleErrorSpy.mockRestore();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://127.0.0.1:18642/health",
      expect.objectContaining({ method: "GET" }),
    );
  });
});

describe("cronJobsFromResponseBody", () => {
  it("accepts both dashboard arrays and gateway {jobs} wrappers", async () => {
    const { cronJobsFromResponseBody } = await import("../src/main/cronjobs");
    expect(cronJobsFromResponseBody([{ id: "a" }])).toEqual([{ id: "a" }]);
    expect(cronJobsFromResponseBody({ jobs: [{ id: "b" }] })).toEqual([
      { id: "b" },
    ]);
    expect(cronJobsFromResponseBody(null)).toEqual([]);
  });
});

describe("testRemoteConnection candidate probing", () => {
  function stubHttp(
    reply: (target: string) => { status: number; type: string },
  ): { seen: string[]; restore: () => void } {
    const seen: string[] = [];
    const spy = vi
      .spyOn(http, "request")
      .mockImplementation((target: unknown, ...rest: unknown[]) => {
        const url = String(target);
        seen.push(url);
        const cb = rest[rest.length - 1] as (res: unknown) => void;
        const r = reply(url);
        cb({
          statusCode: r.status,
          headers: { "content-type": r.type },
          resume: () => {},
        });
        return {
          on: () => {},
          end: () => {},
          destroy: () => {},
        } as unknown as ReturnType<typeof http.request>;
      });
    return { seen, restore: () => spy.mockRestore() };
  }

  it("accepts a NEW dashboard URL whose /health is the SPA but whose /api/status is JSON", async () => {
    connModeRef.mode = "remote"; // saved connection points elsewhere
    const probe = stubHttp((url) =>
      url.endsWith("/health")
        ? { status: 200, type: "text/html; charset=utf-8" }
        : { status: 200, type: "application/json" },
    );
    await expect(
      testRemoteConnection("http://new-dashboard:9119"),
    ).resolves.toBe(true);
    expect(probe.seen).toEqual([
      "http://new-dashboard:9119/health",
      "http://new-dashboard:9119/api/status",
    ]);
    probe.restore();
  });

  it("still rejects a URL that answers HTML on both paths", async () => {
    const probe = stubHttp(() => ({ status: 200, type: "text/html" }));
    await expect(testRemoteConnection("http://spa-only:9119")).resolves.toBe(
      false,
    );
    probe.restore();
  });
});

describe("testRemoteConnection URL probe", () => {
  it("strips trailing /v1 before appending /health", async () => {
    // Capture the URL handed to http.request by the health probe.
    // Reported in #266: stale code path was building
    // `http://host/v1/health` from a user-supplied `http://host/v1`,
    // which 404s and produces the "Cannot reach remote Hermes" splash.
    let capturedTarget: string | undefined;
    const reqSpy = vi
      .spyOn(http, "request")
      .mockImplementation((target: unknown, ...rest: unknown[]) => {
        capturedTarget = String(target);
        // Find the response callback (last arg) and immediately fire it
        // with a fake 200 so the promise resolves cleanly.
        const cb = rest[rest.length - 1] as (res: unknown) => void;
        cb({
          statusCode: 200,
          headers: { "content-type": "application/json" },
          resume: () => {},
        });
        // Stub minimal request handle
        return {
          on: () => {},
          end: () => {},
          destroy: () => {},
        } as unknown as ReturnType<typeof http.request>;
      });

    await testRemoteConnection("http://127.0.0.1:8642/v1");
    expect(capturedTarget).toBe("http://127.0.0.1:8642/health");

    await testRemoteConnection("http://127.0.0.1:8642/V1/");
    expect(capturedTarget).toBe("http://127.0.0.1:8642/health");

    reqSpy.mockRestore();
  });

  it("rejects dashboard SPA HTML /health as not a gateway api_server", async () => {
    const reqSpy = vi
      .spyOn(http, "request")
      .mockImplementation((_target: unknown, ...rest: unknown[]) => {
        const cb = rest[rest.length - 1] as (res: unknown) => void;
        cb({
          statusCode: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
          resume: () => {},
        });
        return {
          on: () => {},
          end: () => {},
          destroy: () => {},
        } as unknown as ReturnType<typeof http.request>;
      });

    await expect(testRemoteConnection("http://127.0.0.1:9119")).resolves.toBe(
      false,
    );

    reqSpy.mockRestore();
  });
});

describe("startGateway / restartGateway in remote mode", () => {
  it("startGateway refuses to spawn in remote mode", () => {
    spawnSpy.mockClear();
    connModeRef.mode = "remote";
    const result = startGateway();
    expect(result).toBe(false);
    expect(spawnSpy).not.toHaveBeenCalled();
  });

  it("startGatewayDetailed reports why remote mode cannot start a local gateway", () => {
    spawnSpy.mockClear();
    connModeRef.mode = "remote";
    const result = startGatewayDetailed();
    expect(result.success).toBe(false);
    expect(result.running).toBe(false);
    expect(result.error).toContain("local mode");
    expect(spawnSpy).not.toHaveBeenCalled();
  });

  it("startGateway refuses to spawn in ssh mode", () => {
    spawnSpy.mockClear();
    connModeRef.mode = "ssh";
    const result = startGateway();
    expect(result).toBe(false);
    expect(spawnSpy).not.toHaveBeenCalled();
  });

  it("startGatewayDetailed reports why ssh mode cannot start a local gateway", () => {
    spawnSpy.mockClear();
    connModeRef.mode = "ssh";
    const result = startGatewayDetailed();
    expect(result.success).toBe(false);
    expect(result.running).toBe(false);
    expect(result.error).toContain("local mode");
    expect(spawnSpy).not.toHaveBeenCalled();
  });

  it("restartGateway is a no-op in remote mode", () => {
    spawnSpy.mockClear();
    connModeRef.mode = "remote";
    restartGateway();
    expect(spawnSpy).not.toHaveBeenCalled();
  });

  it("restartGateway is a no-op in ssh mode", () => {
    spawnSpy.mockClear();
    connModeRef.mode = "ssh";
    restartGateway();
    expect(spawnSpy).not.toHaveBeenCalled();
  });

  it("restartGatewayViaCli refuses to spawn in remote mode", async () => {
    spawnSpy.mockClear();
    connModeRef.mode = "remote";
    await expect(restartGatewayViaCli()).resolves.toBe(false);
    expect(spawnSpy).not.toHaveBeenCalled();
  });

  it("restartGatewayViaCli refuses to spawn in ssh mode", async () => {
    spawnSpy.mockClear();
    connModeRef.mode = "ssh";
    await expect(restartGatewayViaCli()).resolves.toBe(false);
    expect(spawnSpy).not.toHaveBeenCalled();
  });
});

describe("contextFolderSystemMessage (issue #27)", () => {
  it("returns null when no folder is set", () => {
    expect(contextFolderSystemMessage(undefined)).toBeNull();
    expect(contextFolderSystemMessage("")).toBeNull();
    expect(contextFolderSystemMessage("   ")).toBeNull();
  });

  it("builds a system-role message naming the folder", () => {
    const msg = contextFolderSystemMessage("C:\\Users\\me\\project");
    expect(msg).not.toBeNull();
    expect(msg!.role).toBe("system");
    expect(msg!.content).toContain("C:\\Users\\me\\project");
  });

  it("trims surrounding whitespace from the folder path", () => {
    const msg = contextFolderSystemMessage("  /home/me/proj  ");
    expect(msg!.content).toContain("/home/me/proj");
    expect(msg!.content).not.toContain("  /home/me/proj");
  });

  it("instructs the agent to use absolute paths under the folder", () => {
    const msg = contextFolderSystemMessage("/work");
    expect(msg!.content.toLowerCase()).toContain("absolute path");
  });
});
