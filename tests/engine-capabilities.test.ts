import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const TEST_DIR = join(
  tmpdir(),
  `hermes-test-engine-capabilities-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
);

const { execFileMock, gatewayFetchMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  gatewayFetchMock: vi.fn(),
}));

vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return {
    ...actual,
    execFile: execFileMock,
    default: { ...actual, execFile: execFileMock },
  };
});

vi.mock("../src/main/security/network-policy", () => ({
  gatewayFetch: gatewayFetchMock,
  providerFetch: gatewayFetchMock,
  publicFetch: gatewayFetchMock,
}));

function resetHome(): void {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIR, { recursive: true });
  process.env.HERMES_HOME = TEST_DIR;
}

async function freshConfig(): Promise<typeof import("../src/main/config")> {
  vi.resetModules();
  return await import("../src/main/config");
}

async function freshInstaller(): Promise<
  typeof import("../src/main/installer")
> {
  vi.resetModules();
  return await import("../src/main/installer");
}

async function freshEngineCapabilities(): Promise<
  typeof import("../src/main/engine-capabilities")
> {
  vi.resetModules();
  return await import("../src/main/engine-capabilities");
}

afterEach(() => {
  delete process.env.HERMES_HOME;
  vi.resetModules();
  execFileMock.mockReset();
  gatewayFetchMock.mockReset();
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("engine capability payload normalization", () => {
  it("preserves the installed engine's feature values and endpoint descriptors", async () => {
    const {
      engineSupportsMixtureOfAgents,
      engineSupportsSlashCommand,
      normalizeEngineCapabilitiesPayload,
    } = await import("../src/shared/engine-capabilities");

    const normalized = normalizeEngineCapabilitiesPayload({
      object: "hermes.api_server.capabilities",
      features: {
        chat_completions: true,
        audio_api: false,
        session_continuity_header: "X-Hermes-Session-Id",
      },
      endpoints: {
        health: { method: "GET", path: "/health" },
        chat_completions: {
          method: "POST",
          path: "/v1/chat/completions",
        },
      },
    });

    expect(normalized.features).toEqual({
      chat_completions: true,
      audio_api: false,
      session_continuity_header: "X-Hermes-Session-Id",
    });
    expect(normalized.endpoints).toEqual({
      health: { method: "GET", path: "/health" },
      chat_completions: {
        method: "POST",
        path: "/v1/chat/completions",
      },
    });

    expect(
      engineSupportsMixtureOfAgents({
        status: "ready",
        fetchedAt: "2026-07-07T00:00:00.000Z",
        mode: "local",
        engineSha: "sha",
        features: { mixture_of_agents: true },
        endpoints: {},
      }),
    ).toBe(true);
    expect(
      engineSupportsSlashCommand(
        {
          status: "ready",
          fetchedAt: "2026-07-07T00:00:00.000Z",
          mode: "local",
          engineSha: "sha",
          features: { slash_commands: "/goal,/learn,/journey" },
          endpoints: {},
        },
        "learn",
      ),
    ).toBe(true);
    expect(
      engineSupportsSlashCommand(
        {
          status: "unknown",
          fetchedAt: null,
          mode: "local",
          engineSha: null,
          features: { slash_commands: "/goal" },
          endpoints: {},
        },
        "goal",
      ),
    ).toBe(false);
  });
});

describe("installed engine SHA capture", () => {
  it("returns the local git HEAD when the installed engine is a git checkout", async () => {
    resetHome();
    mkdirSync(join(TEST_DIR, "hermes-agent", ".git"), { recursive: true });
    execFileMock.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        callback: (error: Error | null, stdout: Buffer, stderr: Buffer) => void,
      ) => callback(null, Buffer.from("abc123def\n"), Buffer.from("")),
    );

    const { getInstalledEngineSha } = await freshInstaller();

    await expect(getInstalledEngineSha()).resolves.toBe("abc123def");
    expect(execFileMock).toHaveBeenCalledWith(
      "git",
      ["rev-parse", "HEAD"],
      expect.objectContaining({
        cwd: join(TEST_DIR, "hermes-agent"),
        timeout: 5000,
      }),
      expect.any(Function),
    );
  });

  it("returns null for non-git installs or rev-parse failures", async () => {
    resetHome();

    const { getInstalledEngineSha } = await freshInstaller();
    await expect(getInstalledEngineSha()).resolves.toBeNull();

    vi.resetModules();
    mkdirSync(join(TEST_DIR, "hermes-agent", ".git"), { recursive: true });
    execFileMock.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        callback: (error: Error | null, stdout: Buffer, stderr: Buffer) => void,
      ) => callback(new Error("fatal"), Buffer.from(""), Buffer.from("fatal")),
    );

    const { getInstalledEngineSha: getFailingSha } = await freshInstaller();
    await expect(getFailingSha()).resolves.toBeNull();
  });
});

describe("engine capability state", () => {
  it("persists capability snapshots per profile", async () => {
    resetHome();
    const { getEngineCapabilityState, recordEngineCapabilitySnapshot } =
      await freshConfig();

    recordEngineCapabilitySnapshot(
      {
        status: "ready",
        fetchedAt: "2026-07-03T00:00:00.000Z",
        mode: "local",
        engineSha: "work-sha",
        features: { chat_completions: true },
        endpoints: {
          chat_completions: {
            method: "POST",
            path: "/v1/chat/completions",
          },
        },
      },
      "work",
    );
    recordEngineCapabilitySnapshot(
      {
        status: "unknown",
        fetchedAt: "2026-07-03T01:00:00.000Z",
        mode: "remote",
        engineSha: null,
        features: {},
        endpoints: {},
        error: "missing endpoint",
      },
      "personal",
    );

    expect(getEngineCapabilityState("work").installedSha).toBe("work-sha");
    expect(getEngineCapabilityState("work").snapshot.status).toBe("ready");
    expect(getEngineCapabilityState("personal").installedSha).toBeNull();
    expect(getEngineCapabilityState("personal").snapshot.status).toBe(
      "unknown",
    );
  });

  it("persists contract verification results and advances last verified SHA only on pass", async () => {
    resetHome();
    const {
      getEngineCapabilityState,
      recordEngineCapabilitySnapshot,
      recordEngineContractVerification,
    } = await freshConfig();

    recordEngineCapabilitySnapshot(
      {
        status: "ready",
        fetchedAt: "2026-07-03T00:00:00.000Z",
        mode: "local",
        engineSha: "work-sha",
        features: {},
        endpoints: {},
      },
      "work",
    );

    recordEngineContractVerification(
      {
        checkedAt: "2026-07-03T00:01:00.000Z",
        status: "passed",
        findings: [],
      },
      "work",
    );

    expect(getEngineCapabilityState("work").lastVerifiedSha).toBe("work-sha");
    expect(getEngineCapabilityState("work").lastVerification?.status).toBe(
      "passed",
    );

    recordEngineCapabilitySnapshot(
      {
        status: "ready",
        fetchedAt: "2026-07-03T00:02:00.000Z",
        mode: "local",
        engineSha: "next-sha",
        features: {},
        endpoints: {},
      },
      "work",
    );
    recordEngineContractVerification(
      {
        checkedAt: "2026-07-03T00:03:00.000Z",
        status: "broken",
        findings: [],
      },
      "work",
    );

    expect(getEngineCapabilityState("work").installedSha).toBe("next-sha");
    expect(getEngineCapabilityState("work").lastVerifiedSha).toBe("work-sha");
    expect(getEngineCapabilityState("work").lastVerification?.status).toBe(
      "broken",
    );
  });

  it("records an unknown snapshot instead of throwing when capabilities are unavailable", async () => {
    resetHome();
    gatewayFetchMock.mockResolvedValue({
      status: 404,
      text: async () => "",
    });

    const { refreshEngineCapabilities } = await freshEngineCapabilities();

    const state = await refreshEngineCapabilities("work");

    expect(state.snapshot.status).toBe("unknown");
    expect(state.snapshot.features).toEqual({});
    expect(state.snapshot.endpoints).toEqual({});
    expect(state.snapshot.error).toContain("404");

    const { getEngineCapabilityState } = await freshConfig();
    expect(getEngineCapabilityState("work").snapshot.status).toBe("unknown");
  });
});
