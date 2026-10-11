import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionConfig } from "../src/main/config";

const transport = vi.hoisted(() => ({
  sockets: [] as Array<{ emit: (name: string, value?: string) => boolean }>,
  respond: vi.fn(),
  runsEvent: null as ((event: Record<string, unknown>) => void) | null,
}));

vi.mock("../src/main/installer", () => ({
  HERMES_HOME: "/tmp/gateway-session-test",
  HERMES_PYTHON: "/usr/bin/true",
  HERMES_REPO: "/tmp",
  hermesCliArgs: () => [],
  getEnhancedPath: () => "",
}));
vi.mock("../src/main/config", () => ({
  getApiServerKey: () => "local-key",
  getActiveConnection: () => ({ connectionId: "local-test", config: {} }),
  getConnectionConfig: () => ({ mode: "local", ssh: {} }),
  getModelConfig: () => ({ provider: "openrouter", model: "test-model" }),
  getConfigValue: () => null,
  readEnv: () => ({}),
}));
vi.mock("../src/main/utils", () => ({
  pidIsAliveAs: () => false,
  stripAnsi: (value: string) => value,
  profileHome: () => "/tmp/gateway-session-test",
  normalizeProfileName: (value: string) => value,
  getActiveProfileNameSync: () => undefined,
}));
vi.mock("../src/main/ssh-tunnel", () => ({
  getSshTunnelUrl: () => null,
  isSshTunnelActive: () => false,
}));
vi.mock("../src/main/gateway-ports", () => ({ getProfilePort: () => 8642 }));
vi.mock("../src/main/secrets", () => ({ providerListSafe: () => ({}) }));
vi.mock("../src/main/models", () => ({ readModels: () => [] }));
vi.mock("child_process", async () => {
  const { EventEmitter } = await import("events");
  const spawn = vi.fn(() =>
    Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      kill: vi.fn(),
      killed: false,
      exitCode: null,
    }),
  );
  return { spawn, ChildProcess: class {}, default: { spawn } };
});
vi.mock("net", async () => {
  const { EventEmitter } = await import("events");
  return {
    default: {
      createServer: () => {
        const server = Object.assign(new EventEmitter(), {
          listen: () => queueMicrotask(() => server.emit("listening")),
          close: (callback: () => void) => callback(),
        });
        return server;
      },
    },
  };
});
vi.mock("ws", async () => {
  const { EventEmitter } = await import("events");
  return {
    default: class extends EventEmitter {
      static OPEN = 1;
      readyState = 1;
      constructor() {
        super();
        transport.sockets.push(this);
        queueMicrotask(() => this.emit("open"));
      }
      close(): void {
        this.readyState = 3;
        this.emit("close");
      }
      send(raw: string): void {
        const frame = JSON.parse(raw);
        queueMicrotask(() => {
          const result = transport.respond(frame.method, frame.params, this);
          this.emit(
            "message",
            JSON.stringify({
              id: frame.id,
              ...(result instanceof Error
                ? { error: { message: result.message } }
                : { result }),
            }),
          );
        });
      }
    },
  };
});
vi.mock("http", async () => {
  const { EventEmitter } = await import("events");
  return {
    default: {
      request: (
        url: string,
        options: { headers: Record<string, string> },
        callback?: (res: EventEmitter) => void,
      ) => {
        const response = Object.assign(new EventEmitter(), {
          statusCode: 200,
          resume: () => undefined,
        });
        return Object.assign(new EventEmitter(), {
          write: () => undefined,
          destroy: () => undefined,
          end: () =>
            queueMicrotask(() => {
              callback?.(response);
              if (url.endsWith("/events")) {
                transport.runsEvent = (event) =>
                  response.emit(
                    "data",
                    Buffer.from(`data: ${JSON.stringify(event)}\n\n`),
                  );
                return;
              }
              let body = {};
              if (url.endsWith("/v1/capabilities"))
                body = {
                  features: {
                    run_submission: true,
                    run_events_sse: true,
                    run_stop: true,
                    run_approval_response: true,
                    tool_progress_events: true,
                  },
                  endpoints: {
                    runs: { path: "/v1/runs" },
                    run_events: { path: "/v1/runs/{run_id}/events" },
                    run_stop: { path: "/v1/runs/{run_id}/stop" },
                    run_approval: { path: "/v1/runs/{run_id}/approval" },
                  },
                };
              if (url.endsWith("/v1/runs")) body = { run_id: "run-1" };
              response.emit("data", Buffer.from(JSON.stringify(body)));
              response.emit("end");
            }),
        });
      },
    },
  };
});

import {
  clearAllPendingApprovals,
  sendMessage,
  stopHealthPolling,
  type ChatCallbacks,
} from "../src/main/hermes";

// session.create answers with a live id and the stored id that state.db (and
// therefore the sidebar session cache) is keyed by. They are deliberately
// different so a test can prove which one the renderer is handed.
const LIVE_SESSION = "live-1";
const STORED_SESSION = "stored-1";

const LOCAL = { mode: "local", ssh: {} } as ConnectionConfig;

function callbacks(started: string[]): ChatCallbacks {
  return {
    onChunk: vi.fn(),
    onReasoningChunk: vi.fn(),
    onDone: vi.fn(),
    onError: vi.fn(),
    onSessionStarted: (sessionId) => started.push(sessionId),
  };
}

function emitEvent(params: Record<string, unknown>): void {
  transport.sockets
    .at(-1)!
    .emit("message", JSON.stringify({ method: "event", params }));
}

function emitDelta(text: string): void {
  emitEvent({
    type: "message.delta",
    session_id: LIVE_SESSION,
    payload: { text },
  });
}

async function send(cb: ChatCallbacks): ReturnType<typeof sendMessage> {
  return sendMessage(
    "hello",
    cb,
    `gateway-session-${crypto.randomUUID()}`,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    LOCAL,
    "original",
  );
}

beforeEach(() => {
  vi.stubEnv("VITEST", "false");
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("npm_lifecycle_event", "gateway-session-test");
  transport.sockets.length = 0;
  transport.runsEvent = null;
  transport.respond.mockReset();
  transport.respond.mockImplementation((method: string) =>
    method === "session.create"
      ? {
          session_id: LIVE_SESSION,
          stored_session_id: STORED_SESSION,
          info: {},
        }
      : {},
  );
});

afterEach(() => {
  for (const socket of transport.sockets) socket.emit("close");
  clearAllPendingApprovals();
  stopHealthPolling();
  vi.unstubAllEnvs();
});

describe("gateway session id announcement (#980)", () => {
  it("stays unannounced until the turn produces something", async () => {
    const started: string[] = [];
    const cb = callbacks(started);

    await send(cb);

    expect(started).toEqual([]);
  });

  it("announces the stored id on the first message delta", async () => {
    const started: string[] = [];
    const cb = callbacks(started);

    await send(cb);
    emitDelta("Looking into it");

    expect(started).toEqual([STORED_SESSION]);
    expect(cb.onChunk).toHaveBeenCalledWith("Looking into it");
  });

  it("announces the stored id on the first reasoning delta", async () => {
    const started: string[] = [];
    const cb = callbacks(started);

    await send(cb);
    emitEvent({
      type: "reasoning.delta",
      session_id: LIVE_SESSION,
      payload: { text: "thinking" },
    });

    expect(started).toEqual([STORED_SESSION]);
  });

  it("announces the stored id on the first tool event", async () => {
    const started: string[] = [];
    const cb = callbacks(started);

    await send(cb);
    emitEvent({
      type: "tool.start",
      session_id: LIVE_SESSION,
      payload: { name: "search_web", tool_id: "call-1" },
    });

    expect(started).toEqual([STORED_SESSION]);
  });

  it("announces once for the whole turn, then reports the same id on done", async () => {
    const started: string[] = [];
    const cb = callbacks(started);

    await send(cb);
    emitDelta("Looking into it");
    emitDelta(" Done.");
    emitEvent({
      type: "message.complete",
      session_id: LIVE_SESSION,
      payload: { text: "Looking into it Done." },
    });

    await vi.waitFor(() =>
      expect(cb.onDone).toHaveBeenCalledWith(STORED_SESSION),
    );
    expect(started).toEqual([STORED_SESSION]);
  });
});
