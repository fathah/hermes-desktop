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

const { TEST_HOME, connModeRef, sshTunnelUrlRef, sshLocalPortRef, spawnSpy } =
  vi.hoisted(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require("path");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const os = require("os");
    return {
      TEST_HOME: path.join(os.tmpdir(), `hermes-remote-test-${Date.now()}`),
      connModeRef: { mode: "local" as "local" | "remote" | "ssh" },
      sshTunnelUrlRef: { value: "http://localhost:18642" as string | null },
      sshLocalPortRef: { value: 18642 as number | undefined },
      spawnSpy: vi.fn(() => ({
        unref: () => {},
        pid: 12345,
        on: () => {},
      })),
    };
  });

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
    remoteUrl: "http://example.com",
    apiKey: "",
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
      if (target === "http://127.0.0.1:18642/api/jobs?include_disabled=true") {
        return {
          ok: true,
          json: async () => ({
            jobs: [{ id: "job-1", name: "Daily", schedule: "0 9 * * *" }],
          }),
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
      "http://127.0.0.1:18642/api/jobs?include_disabled=true",
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
        cb({ statusCode: 200, resume: () => {} });
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
