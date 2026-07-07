import { EventEmitter } from "events";
import { mkdirSync, rmSync } from "fs";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

const {
  spawned,
  TEST_HOME,
  TEST_REPO,
  healthStatuses,
  apiRequests,
  apiRequestErrors,
  requestEvents,
  engineSha,
} = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("path");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require("os");
  return {
    spawned: [] as Array<
      EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        killed: boolean;
        exitCode: number | null;
        signalCode: NodeJS.Signals | null;
        kill: ReturnType<typeof vi.fn>;
        unref: ReturnType<typeof vi.fn>;
      }
    >,
    TEST_HOME: path.join(os.tmpdir(), `hermes-cli-session-test-${Date.now()}`),
    TEST_REPO: path.join(os.tmpdir(), `hermes-cli-session-repo-${Date.now()}`),
    healthStatuses: [] as number[],
    apiRequests: [] as Array<{
      body: string;
      headers: Record<string, string>;
    }>,
    apiRequestErrors: [] as string[],
    requestEvents: [] as string[],
    engineSha: "1111111111111111111111111111111111111111",
  };
});

vi.mock("node:http", () => ({
  default: {
    request: (
      _url: string,
      _options: Record<string, unknown>,
      cb?: (res: {
        statusCode: number;
        headers?: Record<string, string>;
        resume?: () => void;
        on?: (event: string, handler: (...args: unknown[]) => void) => void;
      }) => void,
    ) => {
      let body = "";
      const handlers = new Map<string, (...args: unknown[]) => void>();
      const req = {
        write: (chunk: string | Buffer) => {
          body += chunk.toString();
        },
        end: () => {
          if (_url.endsWith("/health")) {
            cb?.({
              statusCode: healthStatuses.shift() ?? 503,
              resume: () => {},
            });
            return;
          }

          if (_url.endsWith("/v1/chat/completions")) {
            requestEvents.push("chat");
            apiRequests.push({
              body,
              headers: (_options.headers as Record<string, string>) || {},
            });
            const injectedError = apiRequestErrors.shift();
            if (injectedError === "TIMEOUT_ACCEPTED") {
              handlers.get("timeout")?.();
              return;
            }
            if (injectedError) {
              handlers.get("error")?.(new Error(injectedError));
              return;
            }
            const res = new EventEmitter() as EventEmitter & {
              statusCode: number;
              headers: Record<string, string>;
            };
            res.statusCode = 200;
            res.headers = { "x-hermes-session-id": "desk-cold-gateway" };
            cb?.(res);
            queueMicrotask(() => {
              res.emit(
                "data",
                Buffer.from(
                  'data: {"choices":[{"delta":{"content":"Hi from API"}}]}\n\n',
                ),
              );
              res.emit("data", Buffer.from("data: [DONE]\n\n"));
              res.emit("end");
            });
          }
        },
        on: (event: string, handler: (...args: unknown[]) => void) => {
          handlers.set(event, handler);
          return req;
        },
        destroy: () => {},
        setTimeout: () => req,
      };
      return req;
    },
  },
}));

vi.mock("node:https", () => ({
  default: {
    request: () => ({
      write: () => {},
      end: () => {},
      on: () => {},
      destroy: () => {},
    }),
  },
}));

vi.mock("child_process", () => ({
  default: {
    spawn: vi.fn(() => {
      const proc = Object.assign(new EventEmitter(), {
        stdout: new EventEmitter(),
        stderr: new EventEmitter(),
        killed: false,
        exitCode: null,
        signalCode: null,
        kill: vi.fn(),
        unref: vi.fn(),
      });
      spawned.push(proc);
      return proc;
    }),
  },
  spawn: vi.fn(() => {
    const proc = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      killed: false,
      exitCode: null,
      signalCode: null,
      kill: vi.fn(),
      unref: vi.fn(),
    });
    spawned.push(proc);
    return proc;
  }),
}));

vi.mock("../src/main/installer", () => ({
  HERMES_HOME: TEST_HOME,
  HERMES_PYTHON: process.execPath,
  HERMES_REPO: TEST_REPO,
  hermesCliArgs: (extra?: string[]) => ["/dev/null", ...(extra || [])],
  getEnhancedPath: () => process.env.PATH || "",
  getHermesVersion: () => Promise.resolve("1.0.0"),
  getInstalledEngineSha: () => Promise.resolve(engineSha),
}));

vi.mock("../src/main/config", () => ({
  getModelConfig: () => ({ model: "test-model", provider: "openrouter" }),
  readEnv: () => ({}),
  getApiServerKey: () => "",
  getConnectionConfig: () => ({ mode: "local" as const }),
  readDesktopConfig: () => ({}),
}));

vi.mock("../src/main/engine-update-state", () => ({
  getEngineCapabilityState: () => ({
    installedSha: engineSha,
    lastVerifiedSha: engineSha,
    lastVerification: null,
    snapshot: {
      status: "ready",
      fetchedAt: "2026-07-07T00:00:00.000Z",
      mode: "local",
      engineSha,
      features: {},
      endpoints: {},
    },
  }),
}));

vi.mock("../src/main/engine-contract-verify", () => ({
  verifyAndRecordEngineContract: vi.fn(),
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

vi.mock("../src/main/models", () => ({
  readModels: () => [],
}));

vi.mock("../src/main/process-options", () => ({
  HIDDEN_SUBPROCESS_OPTIONS: {},
}));

import {
  sendMessage,
  startGateway,
  stopGateway,
  stopHealthPolling,
} from "../src/main/hermes";

describe("CLI fallback session id propagation", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    healthStatuses.length = 0;
    apiRequests.length = 0;
    apiRequestErrors.length = 0;
    requestEvents.length = 0;
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (urlStr.endsWith("/health")) {
        requestEvents.push("health");
        const status = healthStatuses.shift() ?? 503;
        return {
          status,
          ok: status === 200,
          text: async () => "",
          json: async () => ({}),
        } as Response;
      }
      return {
        status: 404,
        ok: false,
        text: async () => "",
        json: async () => ({}),
      } as Response;
    }) as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    stopGateway(undefined, true);
    stopHealthPolling();
    spawned.length = 0;
    globalThis.fetch = originalFetch;
    rmSync(TEST_REPO, { recursive: true, force: true });
  });

  it("captures the quiet CLI session id from stderr so the next desktop turn can resume it", async () => {
    const done = new Promise<string | undefined>((resolve) => {
      sendMessage("hi", {
        onChunk: () => {},
        onDone: resolve,
        onError: () => {},
      }).then(() => {
        const proc = spawned[0];
        proc.stdout.emit("data", Buffer.from("Hi there"));
        proc.stderr.emit(
          "data",
          Buffer.from("\nsession_id: 20260527_143413_10df4c\n"),
        );
        proc.emit("close", 0);
      });
    });

    await expect(done).resolves.toBe("20260527_143413_10df4c");
  });

  it("continues a CLI-created timestamp session over the API instead of minting a desk id", async () => {
    const cliSessionId = "20260527_143413_10df4c";
    const firstDone = new Promise<string | undefined>((resolve) => {
      sendMessage("hi", {
        onChunk: () => {},
        onDone: resolve,
        onError: () => {},
      }).then(() => {
        const proc = spawned[0];
        proc.stdout.emit("data", Buffer.from("Hi there"));
        proc.stderr.emit(
          "data",
          Buffer.from(`\nsession_id: ${cliSessionId}\n`),
        );
        proc.emit("close", 0);
      });
    });

    await expect(firstDone).resolves.toBe(cliSessionId);

    healthStatuses.push(200);
    await expect(
      new Promise<string | undefined>((resolve, reject) => {
        sendMessage(
          "what time is it?",
          {
            onChunk: () => {},
            onDone: resolve,
            onError: reject,
          },
          undefined,
          cliSessionId,
        ).catch(reject);
      }),
    ).resolves.toBe("desk-cold-gateway");

    expect(apiRequests).toHaveLength(1);
    expect(apiRequests[0].headers["X-Hermes-Session-Id"]).toBe(cliSessionId);
    const body0 = JSON.parse(apiRequests[0].body);
    expect(body0.session_id).toBe(cliSessionId);
    expect(body0.stream).toBe(true);
    expect(body0.messages[body0.messages.length - 1]).toMatchObject({
      role: "user",
      content: "what time is it?",
    });
  });

  it("waits for a cold gateway to become API-ready instead of falling back to CLI", async () => {
    mkdirSync(TEST_REPO, { recursive: true });
    healthStatuses.push(503, 200);

    expect(startGateway()).toBe(true);
    expect(spawned).toHaveLength(1);

    const chunks: string[] = [];
    const done = new Promise<string | undefined>((resolve, reject) => {
      sendMessage("hi", {
        onChunk: (chunk) => chunks.push(chunk),
        onDone: resolve,
        onError: reject,
      }).catch(reject);
    });

    await expect(done).resolves.toBe("desk-cold-gateway");
    expect(chunks.join("")).toBe("Hi from API");
    expect(spawned).toHaveLength(1);
    expect(apiRequests).toHaveLength(1);
    const body0 = JSON.parse(apiRequests[0].body);
    expect(body0.stream).toBe(true);
    expect(body0.messages[body0.messages.length - 1]).toMatchObject({
      role: "user",
      content: "hi",
    });
  });

  it("re-checks health when a previously-ready local gateway is restarted cold", async () => {
    mkdirSync(TEST_REPO, { recursive: true });
    healthStatuses.push(200);

    await expect(
      new Promise<string | undefined>((resolve, reject) => {
        sendMessage("warmup", {
          onChunk: () => {},
          onDone: resolve,
          onError: reject,
        }).catch(reject);
      }),
    ).resolves.toBe("desk-cold-gateway");
    expect(apiRequests).toHaveLength(1);

    expect(startGateway()).toBe(true);
    expect(spawned).toHaveLength(1);
    healthStatuses.push(503, 200);

    const chunks: string[] = [];
    await expect(
      new Promise<string | undefined>((resolve, reject) => {
        sendMessage("hi after restart", {
          onChunk: (chunk) => chunks.push(chunk),
          onDone: resolve,
          onError: reject,
        }).catch(reject);
      }),
    ).resolves.toBe("desk-cold-gateway");

    expect(chunks.join("")).toBe("Hi from API");
    expect(spawned).toHaveLength(1);
    expect(apiRequests).toHaveLength(2);
    const body1 = JSON.parse(apiRequests[1].body);
    expect(body1.stream).toBe(true);
    expect(body1.messages[body1.messages.length - 1]).toMatchObject({
      role: "user",
      content: "hi after restart",
    });
  });

  it("recovers a stopped local gateway before sending via the API", async () => {
    mkdirSync(TEST_REPO, { recursive: true });
    healthStatuses.push(503, 200);

    const chunks: string[] = [];
    await sendMessage("hi after update", {
      onChunk: (chunk) => chunks.push(chunk),
      onDone: () => {},
      onError: () => {},
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(chunks.join("")).toBe("Hi from API");
    expect(spawned).toHaveLength(1);
    expect(apiRequests).toHaveLength(1);
    const body0 = JSON.parse(apiRequests[0].body);
    expect(body0.messages[body0.messages.length - 1]).toMatchObject({
      role: "user",
      content: "hi after update",
    });
  });

  it("restarts a tracked but unhealthy local gateway before sending via the API", async () => {
    mkdirSync(TEST_REPO, { recursive: true });
    expect(startGateway()).toBe(true);
    expect(spawned).toHaveLength(1);
    healthStatuses.push(503, 503, 503, 200);

    const chunks: string[] = [];
    await expect(
      new Promise<string | undefined>((resolve, reject) => {
        sendMessage("hi after stale gateway", {
          onChunk: (chunk) => chunks.push(chunk),
          onDone: resolve,
          onError: reject,
        }).catch(reject);
      }),
    ).resolves.toBe("desk-cold-gateway");

    expect(chunks.join("")).toBe("Hi from API");
    expect(spawned).toHaveLength(2);
    expect(apiRequests).toHaveLength(1);
    const body0 = JSON.parse(apiRequests[0].body);
    expect(body0.messages[body0.messages.length - 1]).toMatchObject({
      role: "user",
      content: "hi after stale gateway",
    });
  });

  it("recovers after a stale ready cache and retries a local ECONNREFUSED once", async () => {
    mkdirSync(TEST_REPO, { recursive: true });
    healthStatuses.push(200);

    await expect(
      new Promise<string | undefined>((resolve, reject) => {
        sendMessage("warmup", {
          onChunk: () => {},
          onDone: resolve,
          onError: reject,
        }).catch(reject);
      }),
    ).resolves.toBe("desk-cold-gateway");
    expect(requestEvents).toEqual(["health", "chat"]);

    apiRequestErrors.push("connect ECONNREFUSED 127.0.0.1:8765");
    healthStatuses.push(503, 200);
    const chunks: string[] = [];

    await expect(
      new Promise<string | undefined>((resolve, reject) => {
        sendMessage("hi after restart", {
          onChunk: (chunk) => chunks.push(chunk),
          onDone: resolve,
          onError: reject,
        }).catch(reject);
      }),
    ).resolves.toBe("desk-cold-gateway");

    expect(chunks.join("")).toBe("Hi from API");
    expect(spawned).toHaveLength(1);
    expect(apiRequests).toHaveLength(3);
    const body2 = JSON.parse(apiRequests[2].body);
    expect(body2.messages[body2.messages.length - 1]).toMatchObject({
      role: "user",
      content: "hi after restart",
    });
  });

  it("recovers an accepted timed-out request without replaying the user message", async () => {
    mkdirSync(TEST_REPO, { recursive: true });
    healthStatuses.push(200);

    await expect(
      new Promise<string | undefined>((resolve, reject) => {
        sendMessage("warmup", {
          onChunk: () => {},
          onDone: resolve,
          onError: reject,
        }).catch(reject);
      }),
    ).resolves.toBe("desk-cold-gateway");

    apiRequestErrors.push("TIMEOUT_ACCEPTED");
    healthStatuses.push(503, 503, 200);
    const chunks: string[] = [];

    await expect(
      new Promise<string | undefined>((resolve, reject) => {
        sendMessage("hi after hung gateway", {
          onChunk: (chunk) => chunks.push(chunk),
          onDone: resolve,
          onError: (error) => reject(new Error(error)),
        }).catch(reject);
      }),
    ).rejects.toThrow(
      "Local Hermes gateway became unhealthy while processing this message and was restarted. Please resend the message if needed.",
    );

    expect(chunks).toEqual([]);
    expect(spawned).toHaveLength(1);
    expect(apiRequests).toHaveLength(2);
    const body1 = JSON.parse(apiRequests[1].body);
    expect(body1.messages[body1.messages.length - 1]).toMatchObject({
      role: "user",
      content: "hi after hung gateway",
    });
  });
});
