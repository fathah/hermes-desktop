import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";

// hermes.ts pulls in the full main-process import graph; mock the modules with
// import-time side effects (installer → electron) and the two seams under
// test (config's readEnv / secrets' providerListSafe). Everything else
// (run-stream, url-key-map, …) is pure and loads for real.
vi.mock("./installer", () => ({
  HERMES_HOME: "/tmp/hermes-test-home",
  HERMES_REPO: "/tmp/hermes-test-repo",
  HERMES_PYTHON: "python3",
  hermesCliArgs: vi.fn(() => []),
  getEnhancedPath: vi.fn(() => ""),
}));
vi.mock("./config", () => ({
  getApiServerKey: vi.fn(() => ""),
  getActiveConnection: vi.fn(() => ({
    connectionId: "connection-test",
    name: "Test",
    config: {},
  })),
  getConnectionConfig: vi.fn(() => ({
    mode: "local",
    remoteUrl: "",
    apiKey: "",
    remoteAuthMode: "auto",
    ssh: {},
  })),
  getConfigValue: vi.fn(() => null),
  getModelConfig: vi.fn(),
  readEnv: vi.fn(() => ({})),
}));
vi.mock("./ssh-tunnel", () => ({
  getSshTunnelUrl: vi.fn(() => null),
  isSshTunnelActive: vi.fn(() => false),
  isSshTunnelHealthy: vi.fn(() => false),
  startSshTunnel: vi.fn(),
}));
vi.mock("./utils", () => ({
  pidIsAliveAs: vi.fn(() => false),
  stripAnsi: (s: string) => s,
  profileHome: vi.fn(() => "/tmp/hermes-test-home"),
  profilePaths: vi.fn(() => ({
    configFile: "/tmp/hermes-test-home/config.yaml",
    envFile: "/tmp/hermes-test-home/.env",
  })),
  normalizeProfileName: (p?: string) => p,
  getActiveProfileNameSync: vi.fn(() => undefined),
}));
vi.mock("./gateway-ports", () => ({ getProfilePort: vi.fn(() => 8642) }));
vi.mock("./models", () => ({ readModels: vi.fn(() => []) }));
vi.mock("./secrets", () => ({ providerListSafe: vi.fn(() => ({})) }));
vi.mock("child_process", () => {
  const spawn = vi.fn();
  return { spawn, ChildProcess: class {}, default: { spawn } };
});

import { spawn } from "child_process";
import { readModels } from "./models";
import {
  getApiServerKey,
  getActiveConnection,
  getConnectionConfig,
  getModelConfig,
  readEnv,
} from "./config";
import type { ConnectionConfig } from "./config";
import { providerListSafe } from "./secrets";
import { pidIsAliveAs, profileHome } from "./utils";
import {
  assertLocalGatewayKeyMutationAllowed,
  clearAgentCapabilityEvidence,
  getAgentCapabilityEvidence,
  getCachedAgentCapabilityEvidence,
  getRemoteAuthHeader,
  isExternallyManagedMultiplexGateway,
  isGatewayRunning,
  stopGateway,
  bindPendingApproval,
  clearAllPendingApprovals,
  registerPendingApproval,
  resolvePendingApproval,
  recordAgentCommandInventory,
  recordAgentRuntimeInfo,
  sendMessage,
  shouldForceCliForSessionOverride,
  stopHealthPolling,
  transcribeAudio,
} from "./hermes";
import type { ChatCallbacks } from "./hermes";
import { normalizeApprovalRequest } from "../shared/chat-approval";

const mockedGetModelConfig = vi.mocked(getModelConfig);
const mockedGetApiServerKey = vi.mocked(getApiServerKey);
const mockedGetActiveConnection = vi.mocked(getActiveConnection);
const mockedGetConnectionConfig = vi.mocked(getConnectionConfig);
const mockedReadEnv = vi.mocked(readEnv);
const mockedProviderListSafe = vi.mocked(providerListSafe);
const mockedSpawn = vi.mocked(spawn);

describe("local gateway status", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "hermes-one-gateway-status-"));
    vi.mocked(profileHome).mockImplementation((profile) =>
      profile ? join(home, "profiles", String(profile)) : home,
    );
    vi.mocked(pidIsAliveAs).mockReturnValue(true);
  });

  afterEach(() => {
    vi.mocked(profileHome).mockReset();
    vi.mocked(pidIsAliveAs).mockReset();
    rmSync(home, { recursive: true, force: true });
  });

  // @lat: [[connections#Test specifications#Local multiplex gateway status]]
  it.skipIf(process.platform !== "linux")(
    "recognizes a live default-home multiplex gateway without gateway.pid",
    () => {
      const stat = readFileSync(`/proc/${process.pid}/stat`, "utf-8");
      const startTime = Number(
        stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19],
      );
      writeFileSync(
        join(home, "gateway_state.json"),
        JSON.stringify({
          gateway_state: "running",
          kind: "hermes-gateway",
          hermes_home: home,
          pid: process.pid,
          start_time: startTime,
          served_profiles: ["default", "scout"],
        }),
      );

      expect(isGatewayRunning("default")).toBe(true);
      expect(isGatewayRunning("scout")).toBe(false);
      expect(pidIsAliveAs).toHaveBeenCalledWith(process.pid, [
        "python",
        "pythonw",
      ]);
    },
  );

  it.skipIf(process.platform !== "linux")(
    "rejects a reused PID with a different process start fingerprint",
    () => {
      const stat = readFileSync(`/proc/${process.pid}/stat`, "utf-8");
      const startTime = Number(
        stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19],
      );
      writeFileSync(
        join(home, "gateway_state.json"),
        JSON.stringify({
          gateway_state: "running",
          kind: "hermes-gateway",
          hermes_home: home,
          pid: process.pid,
          start_time: startTime + 1,
          served_profiles: ["default"],
        }),
      );
      expect(isGatewayRunning("default")).toBe(false);
    },
  );

  // @lat: [[connections#Test specifications#Externally managed gateway controls]]
  it.skipIf(process.platform !== "linux")(
    "refuses to stop a service-owned multiplex gateway",
    () => {
      const stat = readFileSync(`/proc/${process.pid}/stat`, "utf-8");
      const startTime = Number(
        stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19],
      );
      writeFileSync(
        join(home, "gateway_state.json"),
        JSON.stringify({
          kind: "hermes-gateway",
          hermes_home: home,
          gateway_state: "running",
          pid: process.pid,
          start_time: startTime,
          served_profiles: ["default"],
        }),
      );
      expect(stopGateway("default", true)).toBe(false);
      expect(isGatewayRunning("default")).toBe(true);
    },
  );

  // @lat: [[connections#Test specifications#Externally managed API keys]]
  it.skipIf(process.platform !== "linux")(
    "identifies a live external default gateway before rotating credentials",
    () => {
      const stat = readFileSync(`/proc/${process.pid}/stat`, "utf-8");
      const startTime = Number(
        stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19],
      );
      writeFileSync(
        join(home, "gateway_state.json"),
        JSON.stringify({
          kind: "hermes-gateway",
          hermes_home: home,
          gateway_state: "running",
          pid: process.pid,
          start_time: startTime,
          served_profiles: ["default"],
        }),
      );
      expect(isExternallyManagedMultiplexGateway("default")).toBe(true);
      expect(isExternallyManagedMultiplexGateway("scout")).toBe(false);
      expect(() =>
        assertLocalGatewayKeyMutationAllowed("API_SERVER_KEY", "default"),
      ).toThrow("managed outside Hermes One");
      expect(() =>
        assertLocalGatewayKeyMutationAllowed("api_server.token", "default"),
      ).toThrow("managed outside Hermes One");
      expect(() =>
        assertLocalGatewayKeyMutationAllowed("api_server.extra.key", "default"),
      ).toThrow("managed outside Hermes One");
      expect(() =>
        assertLocalGatewayKeyMutationAllowed(
          "platforms.api_server.extra.key",
          "default",
        ),
      ).toThrow("managed outside Hermes One");
      expect(() =>
        assertLocalGatewayKeyMutationAllowed("model.default", "default"),
      ).not.toThrow();
    },
  );

  it.skipIf(process.platform !== "linux")(
    "rejects invalid ownership and stale multiplex state",
    () => {
      const file = join(home, "gateway_state.json");
      const stat = readFileSync(`/proc/${process.pid}/stat`, "utf-8");
      const startTime = Number(
        stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19],
      );
      const state = {
        kind: "hermes-gateway",
        hermes_home: home,
        gateway_state: "running",
        pid: process.pid,
        start_time: startTime,
        served_profiles: ["default", "scout"],
      };
      writeFileSync(file, JSON.stringify(state));
      expect(isGatewayRunning("default")).toBe(true);
      expect(isGatewayRunning("other")).toBe(false);

      for (const changed of [
        { kind: "not-a-gateway" },
        { hermes_home: join(home, "other") },
        { gateway_state: "stopped" },
        { served_profiles: ["scout"] },
      ]) {
        writeFileSync(file, JSON.stringify({ ...state, ...changed }));
        expect(isGatewayRunning("default")).toBe(false);
      }

      writeFileSync(file, JSON.stringify(state));
      vi.mocked(pidIsAliveAs).mockReturnValue(false);
      expect(isGatewayRunning("default")).toBe(false);

      writeFileSync(file, "not json");
      expect(isGatewayRunning("default")).toBe(false);
    },
  );

  // @lat: [[connections#Test specifications#Equivalent gateway home paths]]
  it.skipIf(process.platform !== "linux")(
    "recognizes the same gateway home through a symlink",
    () => {
      const alias = join(home, "alias");
      symlinkSync(home, alias, "dir");
      const stat = readFileSync(`/proc/${process.pid}/stat`, "utf-8");
      const startTime = Number(
        stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19],
      );
      writeFileSync(
        join(home, "gateway_state.json"),
        JSON.stringify({
          kind: "hermes-gateway",
          hermes_home: home,
          gateway_state: "running",
          pid: process.pid,
          start_time: startTime,
          served_profiles: ["default"],
        }),
      );
      vi.mocked(profileHome).mockReturnValue(alias);
      expect(isGatewayRunning("default")).toBe(true);
      expect(isExternallyManagedMultiplexGateway("default")).toBe(true);
    },
  );
});

describe("chat approval normalization", () => {
  it("preserves an explicit safe choice subset and always includes deny", () => {
    expect(
      normalizeApprovalRequest(
        {
          command: "rm -rf build",
          reason: "recursive delete",
          choices: ["session", "bogus", "session"],
        },
        "opaque-id",
      ),
    ).toEqual({
      requestId: "opaque-id",
      command: "rm -rf build",
      description: "recursive delete",
      choices: ["session", "deny"],
    });
  });

  it("does not expose permanent approval when the payload forbids it", () => {
    expect(
      normalizeApprovalRequest(
        {
          cmd: "chmod 777 file",
          choices: ["once", "always"],
          allow_permanent: false,
        },
        "opaque-id",
      ).choices,
    ).toEqual(["once", "deny"]);
  });
});

describe("pending chat approvals", () => {
  afterEach(() => clearAllPendingApprovals());

  it("validates offered choices and removes only an acknowledged response", async () => {
    const responder = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const requestId = registerPendingApproval(["once", "deny"], responder);

    await expect(resolvePendingApproval(requestId, "always")).resolves.toBe(
      false,
    );
    await expect(resolvePendingApproval(requestId, "once")).resolves.toBe(
      false,
    );
    await expect(resolvePendingApproval(requestId, "deny")).resolves.toBe(true);
    await expect(resolvePendingApproval(requestId, "deny")).resolves.toBe(
      false,
    );
    expect(responder).toHaveBeenCalledTimes(2);
  });

  it("rejects a duplicate response while acknowledgement is in flight", async () => {
    let acknowledge!: (value: boolean) => void;
    const responder = vi.fn(
      () => new Promise<boolean>((resolve) => (acknowledge = resolve)),
    );
    const requestId = registerPendingApproval(["once"], responder);
    const first = resolvePendingApproval(requestId, "once");

    await expect(resolvePendingApproval(requestId, "once")).resolves.toBe(
      false,
    );
    acknowledge(true);
    await expect(first).resolves.toBe(true);
    expect(responder).toHaveBeenCalledTimes(1);
  });

  it("does not report success after a pending request is cleared", async () => {
    let acknowledge!: (value: boolean) => void;
    const requestId = registerPendingApproval(
      ["once"],
      () => new Promise<boolean>((resolve) => (acknowledge = resolve)),
    );
    const response = resolvePendingApproval(requestId, "once");

    clearAllPendingApprovals();
    acknowledge(true);
    await expect(response).resolves.toBe(false);
  });

  it("scopes an approval response to its renderer and run", async () => {
    const responder = vi.fn().mockResolvedValue(true);
    const requestId = registerPendingApproval(["deny"], responder);
    expect(bindPendingApproval(requestId, { ownerId: 7, runId: "run-1" })).toBe(
      true,
    );

    await expect(
      resolvePendingApproval(requestId, "deny", {
        ownerId: 8,
        runId: "run-1",
      }),
    ).resolves.toBe(false);
    await expect(
      resolvePendingApproval(requestId, "deny", {
        ownerId: 7,
        runId: "run-2",
      }),
    ).resolves.toBe(false);
    await expect(
      resolvePendingApproval(requestId, "deny", {
        ownerId: 7,
        runId: "run-1",
      }),
    ).resolves.toBe(true);
  });
});

function testConnection(
  fields: Partial<ConnectionConfig> = {},
): ConnectionConfig {
  return {
    mode: "local",
    remoteUrl: "",
    apiKey: "",
    remoteAuthMode: "auto",
    remoteChatTransport: "auto",
    sshChatTransport: "auto",
    ssh: {
      host: "",
      port: 22,
      username: "",
      keyPath: "",
      remotePort: 8642,
      localPort: 8642,
    },
    ...fields,
  };
}

describe("Agent capability evidence cache", () => {
  // @lat: [[agent-capabilities#Test specifications#Evidence invalidation]]
  it("drops command evidence after catalog failure or Agent contract changes", async () => {
    clearAgentCapabilityEvidence();
    recordAgentRuntimeInfo({ desktop_contract: 5, version: "0.19.0" });
    expect(recordAgentCommandInventory({ pairs: [["/queue", "Queue"]] })).toBe(
      true,
    );
    expect((await getAgentCapabilityEvidence()).commandNames).toEqual([
      "queue",
    ]);

    recordAgentRuntimeInfo({ desktop_contract: 6, version: "0.20.0" });
    expect((await getAgentCapabilityEvidence()).commandNames).toBeNull();

    recordAgentCommandInventory({ pairs: [["/steer", "Steer"]] });
    expect(recordAgentCommandInventory(undefined)).toBe(false);
    expect((await getAgentCapabilityEvidence()).commandNames).toBeNull();

    expect(recordAgentRuntimeInfo(undefined)).toBe(false);
    expect((await getAgentCapabilityEvidence()).runtimeInfo).toBeNull();
    clearAgentCapabilityEvidence();
  });

  it("keeps evidence attached to a stable connection identity", () => {
    clearAgentCapabilityEvidence();
    mockedGetActiveConnection.mockReturnValue({
      connectionId: "connection-a",
      name: "A",
      config: testConnection(),
    });
    recordAgentRuntimeInfo(
      { desktop_contract: 6, version: "0.20.0" },
      undefined,
      "connection-a",
    );

    mockedGetActiveConnection.mockReturnValue({
      connectionId: "connection-b",
      name: "B",
      config: testConnection(),
    });

    expect(
      getCachedAgentCapabilityEvidence("connection-a").runtimeInfo,
    ).toEqual({ desktop_contract: 6, version: "0.20.0" });
    expect(
      getCachedAgentCapabilityEvidence("connection-b").runtimeInfo,
    ).toBeNull();
    clearAgentCapabilityEvidence();
  });
});

describe("remote authentication headers", () => {
  // @lat: [[remote-dashboard-oauth#Test specifications#OAuth bearer suppression]]
  it("does not reuse a stored token after the remote resolves to OAuth", () => {
    mockedGetConnectionConfig.mockReturnValue(
      testConnection({
        mode: "remote",
        remoteUrl: "https://hermes.example",
        apiKey: "stale-token",
        remoteAuthMode: "oauth",
      }),
    );

    expect(getRemoteAuthHeader()).toEqual({});

    mockedGetConnectionConfig.mockReturnValue(
      testConnection({
        mode: "remote",
        remoteUrl: "https://hermes.example",
        apiKey: "current-token",
        remoteAuthMode: "token",
      }),
    );
    expect(getRemoteAuthHeader()).toEqual({
      Authorization: "Bearer current-token",
    });
  });
});

describe("transcribeAudio API route", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    mockedGetApiServerKey.mockReset();
    mockedGetApiServerKey.mockReturnValue("");
    mockedGetConnectionConfig.mockReset();
    mockedGetConnectionConfig.mockReturnValue(
      testConnection({
        mode: "remote",
        remoteUrl: "http://remote.test:8642",
        apiKey: "remote-key",
      }),
    );
    mockedGetModelConfig.mockReset();
    mockedReadEnv.mockReset();
    mockedProviderListSafe.mockReset();
    mockedGetModelConfig.mockReturnValue({
      baseUrl: "https://api.groq.com/openai/v1",
    } as ReturnType<typeof getModelConfig>);
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, transcript: "transcribed" }),
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function sentRequest(): [string, RequestInit] {
    expect(fetchMock).toHaveBeenCalledTimes(1);
    return fetchMock.mock.calls[0] as [string, RequestInit];
  }

  function sentJsonBody(): { data_url: string; mime_type: string } {
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    return JSON.parse(init.body as string) as {
      data_url: string;
      mime_type: string;
    };
  }

  it("posts desktop recordings to the Hermes audio endpoint", async () => {
    await expect(
      transcribeAudio(new Uint8Array([1, 2, 3]), "audio/webm", "default"),
    ).resolves.toBe("transcribed");

    const [url, init] = sentRequest();
    expect(url).toBe("http://remote.test:8642/api/audio/transcribe");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
      Authorization: "Bearer remote-key",
    });
    expect(sentJsonBody()).toEqual({
      data_url: "data:audio/webm;base64,AQID",
      mime_type: "audio/webm",
    });
  });

  it("strips a remote /v1 suffix before calling the desktop audio route", async () => {
    mockedGetConnectionConfig.mockReturnValue(
      testConnection({
        mode: "remote",
        remoteUrl: "http://remote.test:8642/v1",
        apiKey: "",
      }),
    );

    await transcribeAudio(new Uint8Array([1, 2, 3]), "audio/webm", "default");

    const [url] = sentRequest();
    expect(url).toBe("http://remote.test:8642/api/audio/transcribe");
  });

  it("surfaces backend transcription errors", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => "404 page not found",
    });

    await expect(
      transcribeAudio(new Uint8Array([1, 2, 3]), "audio/webm", "default"),
    ).rejects.toThrow("Transcription failed (404). 404 page not found");
  });
});

describe("sendMessage session model override routing", () => {
  const noopCallbacks: ChatCallbacks = {
    onChunk: vi.fn(),
    onDone: vi.fn(),
    onError: vi.fn(),
  };

  function fakeChildProcess(): unknown {
    return {
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn(),
      kill: vi.fn(),
      killed: false,
    };
  }

  function cliArgs(): string[] {
    expect(mockedSpawn).toHaveBeenCalledTimes(1);
    return mockedSpawn.mock.calls[0][1] as string[];
  }

  beforeEach(() => {
    vi.mocked(readModels).mockReset().mockReturnValue([]);
    mockedGetApiServerKey.mockReset();
    mockedGetApiServerKey.mockReturnValue("");
    mockedGetConnectionConfig.mockReset();
    mockedGetConnectionConfig.mockReturnValue(
      testConnection({
        mode: "local",
        remoteUrl: "",
        apiKey: "",
      }),
    );
    mockedGetModelConfig.mockReset();
    mockedReadEnv.mockReset();
    mockedReadEnv.mockReturnValue({});
    mockedProviderListSafe.mockReset();
    mockedProviderListSafe.mockReturnValue({});
    mockedSpawn.mockReset();
    mockedSpawn.mockReturnValue(fakeChildProcess() as ReturnType<typeof spawn>);
    // Persisted default: GPT-5.5 on the (sticky) OpenAI-Codex provider.
    mockedGetModelConfig.mockReturnValue({
      provider: "openai-codex",
      model: "gpt-5.5",
      baseUrl: "https://chatgpt.com/backend-api/codex",
    } as ReturnType<typeof getModelConfig>);
  });

  afterEach(() => {
    stopHealthPolling();
  });

  // @lat: [[provider-setup#Provider setup#LLM-provider keys are configured-only, via modals#Named custom providers#Runtime credential parity]]
  it.each(["env", "vault"])(
    "passes a named custom provider's %s key to the CLI for equivalent URLs",
    async (source) => {
      const key = "CUSTOM_PROVIDER_TEST_LABEL_KEY";
      vi.mocked(readModels).mockReturnValue([
        {
          id: "first",
          name: "No key",
          provider: "custom",
          providerLabel: "Absent Label",
          model: "test",
          baseUrl: "https://example.com/Api",
          createdAt: 1,
        },
        {
          id: "test",
          name: "Test",
          provider: "custom",
          providerLabel: "Test Label",
          model: "test",
          baseUrl: "https://EXAMPLE.com:443/Api/",
          createdAt: 1,
        },
      ]);
      if (source === "env")
        mockedReadEnv.mockReturnValue({ [key]: "profile-secret" });
      else mockedProviderListSafe.mockReturnValue({ [key]: "profile-secret" });
      await sendMessage(
        "hello",
        noopCallbacks,
        "default",
        undefined,
        undefined,
        undefined,
        undefined,
        {
          provider: "custom",
          model: "test",
          baseUrl: "https://example.com/Api",
        },
      );
      const options = mockedSpawn.mock.calls[0][2];
      expect(options?.env?.OPENAI_API_KEY).toBe("profile-secret");
      expect(options?.env?.OPENAI_BASE_URL).toBe("https://example.com/Api");
    },
  );

  // @lat: [[provider-setup#Requesty provider preset#Vault credentials reach CLI]]
  it.each([
    ["https://router.requesty.ai/v1", "vault"],
    ["https://router.eu.requesty.ai/v1", "vault"],
    ["https://router.requesty.ai/v1", "profile"],
    ["https://router.requesty.ai/v1", "process"],
  ])(
    "passes Requesty CLI credentials for %s from %s",
    async (baseUrl, source) => {
      vi.stubEnv("REQUESTY_API_KEY", "");
      vi.stubEnv("OPENAI_API_KEY", "");
      vi.stubEnv("CUSTOM_API_KEY", "");
      mockedProviderListSafe.mockReturnValue({ REQUESTY_API_KEY: "vault-key" });
      if (source === "profile")
        mockedReadEnv.mockReturnValue({ REQUESTY_API_KEY: "profile-key" });
      if (source === "process") vi.stubEnv("REQUESTY_API_KEY", "process-key");
      try {
        await sendMessage(
          "hello",
          noopCallbacks,
          "work",
          undefined,
          undefined,
          undefined,
          undefined,
          { provider: "custom", model: "openai/gpt-4o-mini", baseUrl },
        );
        const env = mockedSpawn.mock.calls[0][2]?.env;
        expect(env?.REQUESTY_API_KEY).toBe(`${source}-key`);
        expect(env?.OPENAI_API_KEY).toBe(`${source}-key`);
        expect(env?.OPENAI_BASE_URL).toBe(baseUrl);
        expect(mockedProviderListSafe).toHaveBeenCalledExactlyOnceWith("work");
      } finally {
        vi.unstubAllEnvs();
      }
    },
  );

  // @lat: [[model-selection#Session model override#Text-only legacy fallback routes via CLI]]
  it("routes a cross-provider override through the CLI with its provider + model", async () => {
    await sendMessage(
      "hello",
      noopCallbacks,
      "default",
      undefined,
      undefined,
      undefined,
      undefined,
      { provider: "gemini", model: "gemini-2.5-pro", baseUrl: "" },
    );

    const args = cliArgs();
    expect(args).toContain("-m");
    expect(args[args.indexOf("-m") + 1]).toBe("gemini-2.5-pro");
    expect(args).toContain("--provider");
    expect(args[args.indexOf("--provider") + 1]).toBe("gemini");
  });

  // @lat: [[model-selection#Session model override#Attachment turns stay on session transport]]
  it("keeps attachment turns off the CLI override fallback", () => {
    const persisted = {
      provider: "openai-codex",
      model: "gpt-5.5",
      baseUrl: "https://chatgpt.com/backend-api/codex",
    } as ReturnType<typeof getModelConfig>;
    const effective = {
      provider: "gemini",
      model: "gemini-2.5-pro",
      baseUrl: "",
    } as ReturnType<typeof getModelConfig>;

    expect(
      shouldForceCliForSessionOverride(
        persisted,
        effective,
        { provider: "gemini", model: "gemini-2.5-pro", baseUrl: "" },
        [
          {
            id: "img-1",
            kind: "image",
            name: "cat.png",
            mime: "image/png",
            size: 12,
            dataUrl: "data:image/png;base64,AAAA",
          },
        ],
      ),
    ).toBe(false);
  });
});
