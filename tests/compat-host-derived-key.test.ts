import { EventEmitter } from "events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockState, spawned, TEST_HOME, TEST_REPO, spawnMock } = vi.hoisted(
  () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require("path");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const os = require("os");
    const state = {
      modelConfig: {
        model: "deepseek-chat",
        provider: "custom",
        baseUrl: "https://api.deepseek.com/v1",
      },
      profileEnv: {} as Record<string, string>,
      models: [] as Array<{
        id: string;
        name: string;
        provider: string;
        model: string;
        baseUrl: string;
        createdAt: number;
        apiMode?: string | null;
      }>,
    };
    const calls: Array<{ env: Record<string, string> }> = [];
    const spawn = vi.fn((_cmd: string, _args: string[], options: unknown) => {
      const proc = Object.assign(new EventEmitter(), {
        stdout: new EventEmitter(),
        stderr: new EventEmitter(),
        kill: vi.fn(),
        unref: vi.fn(),
      });
      calls.push({
        env: {
          ...((options as { env?: Record<string, string> }).env || {}),
        },
      });
      return proc;
    });
    return {
      mockState: state,
      spawned: calls,
      spawnMock: spawn,
      TEST_HOME: path.join(os.tmpdir(), `hermes-host-derived-${Date.now()}`),
      TEST_REPO: os.tmpdir(),
    };
  },
);

vi.mock("child_process", () => ({
  default: { spawn: spawnMock },
  spawn: spawnMock,
}));

vi.mock("../src/main/installer", () => ({
  HERMES_HOME: TEST_HOME,
  HERMES_PYTHON: process.execPath,
  HERMES_REPO: TEST_REPO,
  hermesCliArgs: (extra?: string[]) => ["/dev/null", ...(extra || [])],
  getEnhancedPath: () => process.env.PATH || "",
  getHermesVersion: () => Promise.resolve("1.0.0"),
}));

vi.mock("../src/main/config", () => ({
  getModelConfig: () => mockState.modelConfig,
  readEnv: () => mockState.profileEnv,
  getApiServerKey: () => "",
  getConnectionConfig: () => ({ mode: "local" as const }),
  readDesktopConfig: () => ({}),
}));

vi.mock("../src/main/models", () => ({
  readModels: () => mockState.models,
}));

vi.mock("../src/main/ssh-tunnel", () => ({
  getSshTunnelUrl: () => null,
  isSshTunnelActive: () => false,
  isSshTunnelHealthy: () => Promise.resolve(false),
  startSshTunnel: () => Promise.resolve(),
}));

vi.mock("../src/main/utils", () => ({
  stripAnsi: (s: string) => s,
  pidIsAliveAs: () => false,
  getActiveProfileNameSync: () => "default",
  normalizeProfileName: (p?: string) =>
    p === undefined || p === "" || p === "default" ? undefined : p,
  profileHome: () => TEST_HOME,
  profilePaths: () => ({
    home: TEST_HOME,
    envFile: `${TEST_HOME}/.env`,
    configFile: `${TEST_HOME}/config.yaml`,
  }),
}));

vi.mock("../src/main/process-options", () => ({
  HIDDEN_SUBPROCESS_OPTIONS: {},
}));

import { sendMessageViaCli } from "../src/main/hermes/chat-client/cli";

describe("custom provider host-derived key compatibility", () => {
  let originalDeepseek: string | undefined;
  let originalOpenai: string | undefined;

  beforeEach(() => {
    spawned.length = 0;
    spawnMock.mockClear();
    mockState.modelConfig = {
      model: "deepseek-chat",
      provider: "custom",
      baseUrl: "https://api.deepseek.com/v1",
    };
    mockState.profileEnv = {};
    mockState.models = [];
    originalDeepseek = process.env.DEEPSEEK_API_KEY;
    originalOpenai = process.env.OPENAI_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    if (originalDeepseek === undefined) {
      delete process.env.DEEPSEEK_API_KEY;
    } else {
      process.env.DEEPSEEK_API_KEY = originalDeepseek;
    }
    if (originalOpenai === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalOpenai;
    }
  });

  it("adds the host-derived vendor key when CLI fallback resolves a custom-provider key", async () => {
    mockState.profileEnv = {
      CUSTOM_PROVIDER_MYDEEPSEEK_KEY: "sk-custom-prefix-only",
    };
    mockState.models = [
      {
        id: "model-1",
        name: "MyDeepseek",
        provider: "custom",
        model: "deepseek-chat",
        baseUrl: "https://api.deepseek.com/v1",
        createdAt: 1,
      },
    ];

    sendMessageViaCli("hello", {
      onChunk: () => {},
      onDone: () => {},
      onError: () => {},
    });

    expect(spawned).toHaveLength(1);
    expect(spawned[0].env.OPENAI_API_KEY).toBe("sk-custom-prefix-only");
    expect(spawned[0].env.DEEPSEEK_API_KEY).toBe("sk-custom-prefix-only");
  });

  it("does not write the no-key-required sentinel to the host-derived vendor key", async () => {
    sendMessageViaCli("hello", {
      onChunk: () => {},
      onDone: () => {},
      onError: () => {},
    });

    expect(spawned).toHaveLength(1);
    expect(spawned[0].env.OPENAI_API_KEY).toBe("no-key-required");
    expect(spawned[0].env).not.toHaveProperty("DEEPSEEK_API_KEY");
  });
});
