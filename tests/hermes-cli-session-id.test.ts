import { EventEmitter } from "events";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { mkdirSync, rmSync } from "fs";

const {
  spawned,
  TEST_HOME,
  TEST_REPO,
  healthStatuses,
  apiRequests,
  apiRequestErrors,
  requestEvents,
  modelConfig,
  profileEnv,
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
        kill: ReturnType<typeof vi.fn>;
        unref: ReturnType<typeof vi.fn>;
        spawnArgs?: string[];
        spawnOptions?: { env?: Record<string, string> };
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
    modelConfig: {
      model: "test-model",
      provider: "openrouter",
      baseUrl: "",
    },
    profileEnv: {} as Record<string, string>,
  };
});

vi.mock("http", () => ({
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
            requestEvents.push("health");
            cb?.({
              statusCode: healthStatuses.shift() ?? 503,
              resume: () => {},
            });
            return;
          }

          if (_url.endsWith("/v1/chat/completions")) {
            requestEvents.push("chat");
            const requestError = apiRequestErrors.shift();
            if (requestError === "HANG") {
              return;
            }
            if (requestError === "HANG_ACCEPTED") {
              apiRequests.push({
                body,
                headers: (_options.headers as Record<string, string>) || {},
              });
              return;
            }
            if (requestError === "TIMEOUT_ACCEPTED") {
              apiRequests.push({
                body,
                headers: (_options.headers as Record<string, string>) || {},
              });
              queueMicrotask(() => {
                handlers.get("timeout")?.();
              });
              return;
            }
            if (requestError?.startsWith("STATUS:")) {
              const [, status = "500", message = "API error"] =
                requestError.split(":");
              apiRequests.push({
                body,
                headers: (_options.headers as Record<string, string>) || {},
              });
              const res = new EventEmitter() as EventEmitter & {
                statusCode: number;
                headers: Record<string, string>;
              };
              res.statusCode = Number(status);
              res.headers = {};
              cb?.(res);
              queueMicrotask(() => {
                res.emit(
                  "data",
                  Buffer.from(JSON.stringify({ error: { message } })),
                );
                res.emit("end");
              });
              return;
            }
            if (requestError?.startsWith("STREAM_ERROR:")) {
              const message = requestError.slice("STREAM_ERROR:".length);
              apiRequests.push({
                body,
                headers: (_options.headers as Record<string, string>) || {},
              });
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
                    'data: {"choices":[{"delta":{"content":"Partial"}}]}\n\n',
                  ),
                );
                res.emit("error", new Error(message));
              });
              return;
            }
            if (requestError) {
              queueMicrotask(() => {
                handlers.get("error")?.(new Error(requestError));
              });
              return;
            }

            apiRequests.push({
              body,
              headers: (_options.headers as Record<string, string>) || {},
            });
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
        destroy: () => {
          handlers.get("error")?.(new Error("destroyed"));
        },
      };
      return req;
    },
  },
}));

vi.mock("https", () => ({
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
    spawn: vi.fn((_cmd: string, args?: string[], options?: unknown) => {
      const proc = Object.assign(new EventEmitter(), {
        stdout: new EventEmitter(),
        stderr: new EventEmitter(),
        killed: false,
        kill: vi.fn(),
        unref: vi.fn(),
        spawnArgs: args,
        spawnOptions: options,
      });
      proc.stderr.pipe = vi.fn();
      spawned.push(proc);
      return proc;
    }),
  },
  spawn: vi.fn((_cmd: string, args?: string[], options?: unknown) => {
    const proc = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      killed: false,
      kill: vi.fn(),
      unref: vi.fn(),
      spawnArgs: args,
      spawnOptions: options,
    });
    proc.stderr.pipe = vi.fn();
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
}));

vi.mock("../src/main/config", () => ({
  getModelConfig: () => modelConfig,
  getConfigValue: () => "",
  readEnv: () => profileEnv,
  getApiServerKey: () => "",
  getConnectionConfig: () => ({ mode: "local" as const }),
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
  beforeEach(() => {
    healthStatuses.length = 0;
    apiRequests.length = 0;
    apiRequestErrors.length = 0;
    requestEvents.length = 0;
    modelConfig.model = "test-model";
    modelConfig.provider = "openrouter";
    modelConfig.baseUrl = "";
    for (const key of Object.keys(profileEnv)) {
      delete profileEnv[key];
    }
    rmSync(TEST_REPO, { recursive: true, force: true });
  });

  afterEach(() => {
    stopGateway(undefined, true);
    stopHealthPolling();
    spawned.length = 0;
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

  it("runs AIML API through the CLI custom provider bridge", async () => {
    modelConfig.model = "gpt-4o-mini";
    modelConfig.provider = "aimlapi";
    modelConfig.baseUrl = "https://api.aimlapi.com/v1";
    profileEnv.AIMLAPI_API_KEY = "sk-aiml-test";

    const done = new Promise<string | undefined>((resolve) => {
      sendMessage("hi", {
        onChunk: () => {},
        onDone: resolve,
        onError: () => {},
      }).then(() => {
        const proc = spawned[0];
        proc.stdout.emit("data", Buffer.from("Hi there"));
        proc.emit("close", 0);
      });
    });

    await expect(done).resolves.toBeUndefined();

    const proc = spawned[0];
    expect(proc.spawnArgs).toEqual(
      expect.arrayContaining(["-m", "gpt-4o-mini", "--provider", "custom"]),
    );
    expect(proc.spawnOptions?.env).toMatchObject({
      AIMLAPI_API_KEY: "sk-aiml-test",
      OPENAI_API_KEY: "sk-aiml-test",
      OPENAI_BASE_URL: "https://api.aimlapi.com/v1",
      CUSTOM_BASE_URL: "https://api.aimlapi.com/v1",
      HERMES_INFERENCE_PROVIDER: "custom",
    });
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
    expect(JSON.parse(apiRequests[0].body)).toMatchObject({
      session_id: cliSessionId,
      messages: [{ role: "user", content: "what time is it?" }],
      stream: true,
    });
  });

  it("uses a healthy running gateway API instead of falling back to CLI", async () => {
    mkdirSync(TEST_REPO, { recursive: true });
    healthStatuses.push(200);

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
    expect(JSON.parse(apiRequests[0].body)).toMatchObject({
      messages: [{ role: "user", content: "hi" }],
      stream: true,
    });
  });

  it("recovers a stopped local gateway before sending via the API", async () => {
    mkdirSync(TEST_REPO, { recursive: true });
    healthStatuses.push(503, 503, 200);

    const chunks: string[] = [];
    const done = new Promise<string | undefined>((resolve, reject) => {
      sendMessage("hi after update", {
        onChunk: (chunk) => chunks.push(chunk),
        onDone: resolve,
        onError: reject,
      }).catch(reject);
    });

    await expect(done).resolves.toBe("desk-cold-gateway");
    expect(chunks.join("")).toBe("Hi from API");
    expect(spawned).toHaveLength(1);
    expect(apiRequests).toHaveLength(1);
    expect(JSON.parse(apiRequests[0].body)).toMatchObject({
      messages: [{ role: "user", content: "hi after update" }],
      stream: true,
    });
  });

  it("restarts a tracked but unhealthy local gateway before sending via the API", async () => {
    mkdirSync(TEST_REPO, { recursive: true });
    expect(startGateway()).toBe(true);
    expect(spawned).toHaveLength(1);
    healthStatuses.push(503, 503, 503, 200);

    const chunks: string[] = [];
    const done = new Promise<string | undefined>((resolve, reject) => {
      sendMessage("hi after stale gateway", {
        onChunk: (chunk) => chunks.push(chunk),
        onDone: resolve,
        onError: reject,
      }).catch(reject);
    });

    await expect(done).resolves.toBe("desk-cold-gateway");
    expect(chunks.join("")).toBe("Hi from API");
    expect(spawned).toHaveLength(2);
    expect(apiRequests).toHaveLength(1);
    expect(JSON.parse(apiRequests[0].body)).toMatchObject({
      messages: [{ role: "user", content: "hi after stale gateway" }],
      stream: true,
    });
  });

  it("recovers after a stale ready cache without slowing the normal API send path", async () => {
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
    expect(requestEvents).toEqual(["health", "chat"]);

    apiRequestErrors.push("connect ECONNREFUSED 127.0.0.1:8765");
    healthStatuses.push(503, 200);
    const secondSendStart = requestEvents.length;

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
    expect(requestEvents[secondSendStart]).toBe("chat");
    expect(requestEvents.at(-1)).toBe("chat");
    expect(JSON.parse(apiRequests[1].body)).toMatchObject({
      messages: [{ role: "user", content: "hi after restart" }],
      stream: true,
    });
  });

  it("retries a reset local API socket once after gateway recovery", async () => {
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

    apiRequestErrors.push("read ECONNRESET");
    healthStatuses.push(503, 200);

    const chunks: string[] = [];
    await expect(
      new Promise<string | undefined>((resolve, reject) => {
        sendMessage("hi after reset", {
          onChunk: (chunk) => chunks.push(chunk),
          onDone: resolve,
          onError: reject,
        }).catch(reject);
      }),
    ).resolves.toBe("desk-cold-gateway");

    expect(chunks.join("")).toBe("Hi from API");
    expect(apiRequests).toHaveLength(2);
    expect(JSON.parse(apiRequests[1].body)).toMatchObject({
      messages: [{ role: "user", content: "hi after reset" }],
      stream: true,
    });
  });

  it("preserves API response errors when recovery succeeds", async () => {
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

    apiRequestErrors.push("STATUS:401:Authentication failed");
    healthStatuses.push(503, 200);
    const startedSessions: string[] = [];

    await expect(
      new Promise<string | undefined>((resolve, reject) => {
        sendMessage("bad key", {
          onChunk: () => {},
          onDone: resolve,
          onSessionStarted: (sessionId) => startedSessions.push(sessionId),
          onError: reject,
        }).catch(reject);
      }),
    ).rejects.toThrow("Authentication failed");

    expect(startedSessions).toEqual([]);
    expect(apiRequests).toHaveLength(2);
    expect(JSON.parse(apiRequests[1].body)).toMatchObject({
      messages: [{ role: "user", content: "bad key" }],
      stream: true,
    });
  });

  it("reports a mid-stream API disconnect without replaying partial output", async () => {
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

    apiRequestErrors.push("STREAM_ERROR:read ECONNRESET");
    healthStatuses.push(503, 200);
    const secondSendStart = requestEvents.length;

    const chunks: string[] = [];
    await expect(
      new Promise<string | undefined>((resolve, reject) => {
        sendMessage("partial stream", {
          onChunk: (chunk) => chunks.push(chunk),
          onDone: resolve,
          onError: reject,
        }).catch(reject);
      }),
    ).rejects.toThrow("Stream error: read ECONNRESET");

    expect(chunks.join("")).toBe("Partial");
    expect(apiRequests).toHaveLength(2);
    expect(requestEvents[secondSendStart]).toBe("chat");
    await vi.waitFor(() => {
      expect(spawned).toHaveLength(1);
      expect(healthStatuses).toHaveLength(0);
      expect(requestEvents.slice(secondSendStart + 1)).toContain("health");
    });
    expect(JSON.parse(apiRequests[1].body)).toMatchObject({
      messages: [{ role: "user", content: "partial stream" }],
      stream: true,
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
    expect(requestEvents).toEqual(["health", "chat"]);

    apiRequestErrors.push("TIMEOUT_ACCEPTED");
    healthStatuses.push(503, 503, 200);
    const secondSendStart = requestEvents.length;

    const chunks: string[] = [];
    await expect(
      new Promise<string | undefined>((resolve, reject) => {
        sendMessage("hi after hung gateway", {
          onChunk: (chunk) => chunks.push(chunk),
          onDone: resolve,
          onError: reject,
        }).catch(reject);
      }),
    ).rejects.toThrow(
      "API request timed out. Check the SSH tunnel and remote Hermes gateway.",
    );

    expect(chunks).toEqual([]);
    expect(spawned).toHaveLength(1);
    expect(apiRequests).toHaveLength(2);
    expect(requestEvents[secondSendStart]).toBe("chat");
    expect(requestEvents.slice(secondSendStart + 1)).toContain("health");
    expect(JSON.parse(apiRequests[1].body)).toMatchObject({
      messages: [{ role: "user", content: "hi after hung gateway" }],
      stream: true,
    });
  });
});
