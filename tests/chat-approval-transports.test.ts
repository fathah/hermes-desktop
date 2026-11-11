import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import { EventEmitter } from "events";
import type { ConnectionConfig } from "../src/main/config";

const transport = vi.hoisted(() => ({
  http: [] as Array<{ url: string; headers: Record<string, string> }>,
  rpc: [] as Array<{
    id?: string;
    method?: string;
    params?: Record<string, unknown>;
    result?: unknown;
    error?: unknown;
  }>,
  sockets: [] as Array<{ emit: (name: string, value?: string) => boolean }>,
  respond: vi.fn(),
  runsEvent: null as ((event: Record<string, unknown>) => void) | null,
}));

vi.mock("../src/main/installer", () => ({
  HERMES_HOME: "/tmp/approval-test",
  HERMES_PYTHON: "/usr/bin/true",
  HERMES_REPO: "/tmp",
  hermesCliArgs: () => [],
  getEnhancedPath: () => "",
}));
vi.mock("../src/main/config", () => ({
  getApiServerKey: () => "local-key",
  getActiveConnection: () => ({ connectionId: "local-test", config: {} }),
  // Deliberately differs from the connection captured by sendMessage.
  getConnectionConfig: () => ({
    mode: "remote",
    remoteUrl: "https://other.invalid",
    apiKey: "wrong-key",
    remoteAuthMode: "bearer",
    ssh: {},
  }),
  getModelConfig: () => ({ provider: "openrouter", model: "test-model" }),
  getConfigValue: () => null,
  readEnv: () => ({}),
}));
vi.mock("../src/main/utils", () => ({
  pidIsAliveAs: () => false,
  stripAnsi: (value: string) => value,
  profileHome: () => "/tmp/approval-test",
  normalizeProfileName: (value: string) => value,
  getActiveProfileNameSync: () => undefined,
}));
vi.mock("../src/main/ssh-tunnel", () => ({
  getSshTunnelUrl: () => null,
  isSshTunnelActive: () => false,
}));
vi.mock("../src/main/gateway-ports", () => ({ getProfilePort: () => 8642 }));
vi.mock("../src/main/secrets", () => ({
  providerListSafe: () => ({}),
  getSecret: () => null,
}));
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
        transport.rpc.push(frame);
        if (typeof frame.method !== "string") return;
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
        transport.http.push({ url, headers: options.headers });
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
  bindPendingApproval,
  clearAllPendingApprovals,
  resolvePendingApproval,
  resolvePendingClarify,
  sendMessage,
  stopHealthPolling,
  type ChatCallbacks,
} from "../src/main/hermes";
import type { ChatApprovalRequest } from "../src/shared/chat-approval";

const local = { mode: "local", ssh: {} } as ConnectionConfig;
const remote = {
  mode: "remote",
  remoteUrl: "http://original.invalid",
  apiKey: "original-key",
  remoteAuthMode: "bearer",
  ssh: {},
} as ConnectionConfig;
function callbacks(): ChatCallbacks & {
  onApproval: Mock<(approval: ChatApprovalRequest) => boolean>;
} {
  return {
    onChunk: vi.fn(),
    onDone: vi.fn(),
    onError: vi.fn(),
    onApproval: vi.fn((approval: ChatApprovalRequest) =>
      bindPendingApproval(approval.requestId, {
        ownerId: 1,
        runId: "chat-run",
      }),
    ),
  };
}
function emitApproval(payload: Record<string, unknown>): void {
  transport.sockets.at(-1)!.emit(
    "message",
    JSON.stringify({
      method: "event",
      params: { type: "approval.request", session_id: "live-1", payload },
    }),
  );
}
function emitServerRequest(
  method: string,
  id: string,
  params: Record<string, unknown> = {},
): void {
  transport.sockets.at(-1)!.emit(
    "message",
    JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params: { session_id: "live-1", ...params },
    }),
  );
}
function cancelServerRequest(id: string, sessionId = "live-1"): void {
  transport.sockets.at(-1)!.emit(
    "message",
    JSON.stringify({
      jsonrpc: "2.0",
      method: "event",
      params: {
        type: "request.cancel",
        session_id: sessionId,
        payload: { id, method: "approval", reason: "timeout" },
      },
    }),
  );
}
async function send(
  cb: ReturnType<typeof callbacks>,
  conn = local,
): ReturnType<typeof sendMessage> {
  return sendMessage(
    "hello",
    cb,
    `approval-${crypto.randomUUID()}`,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    conn,
    "original",
  );
}

beforeEach(() => {
  vi.stubEnv("VITEST", "false");
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("npm_lifecycle_event", "approval-regression");
  transport.http.length = 0;
  transport.rpc.length = 0;
  transport.sockets.length = 0;
  transport.runsEvent = null;
  transport.respond.mockReset();
  transport.respond.mockImplementation((method: string) =>
    method === "session.create"
      ? { session_id: "live-1", stored_session_id: "stored-1", info: {} }
      : method === "approval.respond"
        ? { resolved: 1 }
        : {},
  );
});
afterEach(() => {
  for (const socket of transport.sockets) socket.emit("close");
  clearAllPendingApprovals();
  stopHealthPolling();
  vi.unstubAllEnvs();
});

describe("approval transport safety", () => {
  // @lat: [[chat-commands#Structured command approvals#Gateway approval correlation]]
  it("sends the gateway ID, never the opaque renderer ID", async () => {
    const cb = callbacks();
    const handle = await send(cb);
    emitApproval({
      request_id: "upstream-1",
      command: "npm publish",
      choices: ["once"],
    });
    const approval = cb.onApproval.mock.calls[0][0];
    expect(approval.requestId).not.toBe("upstream-1");
    expect(
      await resolvePendingApproval(approval.requestId, "once", {
        ownerId: 1,
        runId: "chat-run",
      }),
    ).toBe(true);
    expect(transport.rpc).toContainEqual(
      expect.objectContaining({
        method: "approval.respond",
        params: {
          session_id: "live-1",
          request_id: "upstream-1",
          choice: "once",
          all: false,
        },
      }),
    );
    handle.abort();
  });

  it.each(["missing ID", "disconnect", "stale ID"])(
    "fails closed on %s without replaying the prompt",
    async (failure) => {
      const cb = callbacks();
      await send(cb);
      emitApproval({
        ...(failure === "missing ID" ? {} : { request_id: "upstream-1" }),
        choices: ["once"],
      });
      if (failure === "disconnect") transport.sockets.at(-1)!.emit("close");
      if (failure === "stale ID") {
        transport.respond.mockReturnValue({ resolved: 0 });
        expect(
          await resolvePendingApproval(
            cb.onApproval.mock.calls[0][0].requestId,
            "once",
            { ownerId: 1, runId: "chat-run" },
          ),
        ).toBe(false);
      }
      expect(cb.onError).toHaveBeenCalledWith(
        expect.stringContaining("Approval flow failed:"),
      );
      expect(transport.http.some(({ url }) => url.includes("/v1/"))).toBe(
        false,
      );
      expect(
        transport.rpc.filter(({ method }) => method === "prompt.submit"),
      ).toHaveLength(1);
    },
  );

  it("does not replay after approval arrives before a rejected prompt acknowledgement", async () => {
    const cb = callbacks();
    transport.respond.mockImplementation(
      (method: string, _params: unknown, socket: EventEmitter) => {
        if (method === "session.create")
          return { session_id: "live-1", info: {} };
        if (method === "prompt.submit") {
          socket.emit(
            "message",
            JSON.stringify({
              method: "event",
              params: {
                type: "approval.request",
                session_id: "live-1",
                payload: { request_id: "upstream-1", choices: ["once"] },
              },
            }),
          );
          return new Error("lost acknowledgement");
        }
        return {};
      },
    );
    await send(cb);
    expect(cb.onError).toHaveBeenCalledWith(
      expect.stringContaining("not replayed"),
    );
    expect(transport.http.some(({ url }) => url.includes("/v1/"))).toBe(false);
    expect(
      await resolvePendingApproval(
        cb.onApproval.mock.calls[0][0].requestId,
        "once",
        { ownerId: 1, runId: "chat-run" },
      ),
    ).toBe(false);
  });

  // @lat: [[chat-commands#Structured command approvals#Runs approval fail-closed]]
  it("stops unsupported Runs approvals using the original connection, with no approval POST or replay", async () => {
    const cb = callbacks();
    await send(cb, remote);
    await vi.waitFor(() => expect(transport.runsEvent).not.toBeNull());
    transport.runsEvent!({
      event: "approval.request",
      request_id: "upstream-1",
      command: "npm publish",
    });
    transport.runsEvent!({ event: "run.failed", error: "stream lost" });
    expect(cb.onApproval).not.toHaveBeenCalled();
    expect(cb.onError).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("cannot safely target"),
    );
    expect(transport.http).toContainEqual({
      url: "http://original.invalid/v1/runs/run-1/stop",
      headers: expect.objectContaining({
        Authorization: "Bearer original-key",
      }),
    });
    expect(
      transport.http.some(
        ({ url }) =>
          url.endsWith("/approval") || url.endsWith("/chat/completions"),
      ),
    ).toBe(false);
  });
});

describe("main-process peer-to-peer Agent requests", () => {
  // @lat: [[main-server-requests#Correlated replies]]
  it("advertises before creating a session and answers the exact server id once", async () => {
    const cb = callbacks();
    const handle = await send(cb);
    expect(
      transport.rpc.findIndex(({ method }) => method === "client.capabilities"),
    ).toBeLessThan(
      transport.rpc.findIndex(({ method }) => method === "session.create"),
    );
    emitServerRequest("approval", "srq-current1", {
      request_id: "queue-entry-1",
      command: "npm publish",
      choices: ["once", "deny"],
    });
    emitServerRequest("approval", "srq-current1", {
      request_id: "queue-entry-1",
      command: "npm publish",
      choices: ["once", "deny"],
    });
    expect(cb.onApproval).toHaveBeenCalledTimes(1);
    const requestId = cb.onApproval.mock.calls[0][0].requestId;
    expect(
      await resolvePendingApproval(requestId, "once", {
        ownerId: 1,
        runId: "chat-run",
      }),
    ).toBe(true);
    expect(
      await resolvePendingApproval(requestId, "once", {
        ownerId: 1,
        runId: "chat-run",
      }),
    ).toBe(false);
    expect(transport.rpc).toContainEqual({
      jsonrpc: "2.0",
      id: "srq-current1",
      result: { choice: "once", all: false },
    });
    expect(
      transport.rpc.some(({ method }) => method === "approval.respond"),
    ).toBe(false);
    handle.abort();
  });

  // @lat: [[main-server-requests#Batch clarification]]
  it("retains invalid batch answers for retry and returns one complete answer map", async () => {
    const cb = { ...callbacks(), onClarify: vi.fn() };
    const handle = await send(cb);
    const questions = [
      {
        qid: "first",
        question: "Which folder?",
        choices: [],
        multi_select: false,
      },
      {
        qid: "second",
        question: "Which format?",
        choices: ["PDF", "HTML"],
        multi_select: false,
      },
    ];
    emitServerRequest("clarify", "srq-batch1", { questions });
    const card = cb.onClarify.mock.calls[0][0];
    expect(card.questions).toEqual(questions);
    expect(card.requestId).not.toBe("srq-batch1");
    expect(resolvePendingClarify(card.requestId, "not a complete batch")).toBe(
      false,
    );
    expect(
      resolvePendingClarify(
        card.requestId,
        JSON.stringify({ answers: { first: "/tmp/report", second: "PDF" } }),
      ),
    ).toBe(true);
    expect(transport.rpc).toContainEqual({
      jsonrpc: "2.0",
      id: "srq-batch1",
      result: { answers: { first: "/tmp/report", second: "PDF" } },
    });
    expect(
      transport.rpc.some(({ method }) => method === "clarify.respond"),
    ).toBe(false);
    handle.abort();
  });

  // @lat: [[main-server-requests#Cancellation isolation]]
  it("expires only the matching live request and refuses its stale response", async () => {
    const cb = {
      ...callbacks(),
      onClarify: vi.fn(),
      onRequestCancelled: vi.fn(),
    };
    const handle = await send(cb);
    emitServerRequest("approval", "srq-cancel1", {
      request_id: "queue-1",
      choices: ["once"],
    });
    const approvalId = cb.onApproval.mock.calls[0][0].requestId;
    cancelServerRequest("srq-cancel1", "another-session");
    expect(cb.onRequestCancelled).not.toHaveBeenCalled();
    cancelServerRequest("srq-cancel1");
    expect(cb.onRequestCancelled).toHaveBeenCalledExactlyOnceWith({
      requestId: approvalId,
      kind: "approval",
    });
    expect(
      await resolvePendingApproval(approvalId, "once", {
        ownerId: 1,
        runId: "chat-run",
      }),
    ).toBe(false);
    emitServerRequest("clarify", "srq-cancel2", {
      questions: [{ qid: "q", question: "Where?" }],
    });
    const clarifyId = cb.onClarify.mock.calls[0][0].requestId;
    cancelServerRequest("srq-cancel2");
    expect(resolvePendingClarify(clarifyId, "here")).toBe(false);
    expect(cb.onError).not.toHaveBeenCalled();
    handle.abort();
  });

  // @lat: [[main-server-requests#Resume restoration]]
  it("restores unanswered requests after the resumed session owns the transport", async () => {
    const cb = callbacks();
    transport.respond.mockImplementation((method: string) =>
      method === "session.resume"
        ? {
            session_id: "live-1",
            resumed: "stored-1",
            info: {},
            open_requests: [
              {
                id: "srq-restored1",
                method: "approval",
                params: {
                  session_id: "live-1",
                  request_id: "queue-1",
                  choices: ["deny"],
                },
              },
            ],
          }
        : {},
    );
    const handle = await sendMessage(
      "hello",
      cb,
      `resume-${crypto.randomUUID()}`,
      "stored-1",
      undefined,
      undefined,
      undefined,
      undefined,
      local,
      "original",
    );
    expect(cb.onApproval).toHaveBeenCalledTimes(1);
    expect(
      await resolvePendingApproval(
        cb.onApproval.mock.calls[0][0].requestId,
        "deny",
        { ownerId: 1, runId: "chat-run" },
      ),
    ).toBe(true);
    expect(transport.rpc).toContainEqual({
      jsonrpc: "2.0",
      id: "srq-restored1",
      result: { choice: "deny", all: false },
    });
    handle.abort();
  });

  it("defers a live request arriving before session.resume acknowledges its runtime id", async () => {
    const cb = callbacks();
    transport.respond.mockImplementation(
      (method: string, _params: unknown, socket: EventEmitter) => {
        if (method !== "session.resume") return {};
        socket.emit(
          "message",
          JSON.stringify({
            jsonrpc: "2.0",
            id: "srq-before-resume",
            method: "approval",
            params: {
              session_id: "live-1",
              request_id: "queue-1",
              choices: ["deny"],
            },
          }),
        );
        return { session_id: "live-1", resumed: "stored-1", info: {} };
      },
    );
    const handle = await sendMessage(
      "hello",
      cb,
      `resume-${crypto.randomUUID()}`,
      "stored-1",
      undefined,
      undefined,
      undefined,
      undefined,
      local,
      "original",
    );
    expect(cb.onApproval).toHaveBeenCalledTimes(1);
    expect(
      transport.rpc.find(({ id }) => id === "srq-before-resume"),
    ).toBeUndefined();
    handle.abort();
  });

  // @lat: [[main-server-requests#Unsupported interactions]]
  it("explicitly refuses unsupported, malformed and unrelated-session requests", async () => {
    const cb = callbacks();
    const handle = await send(cb);
    emitServerRequest("setup_beat", "srq-unsupported1");
    emitServerRequest("approval", "srq-other1", {
      session_id: "other-session",
      request_id: "other",
      choices: ["once"],
    });
    emitServerRequest("clarify", "srq-malformed1", { questions: [] });
    expect(cb.onApproval).not.toHaveBeenCalled();
    for (const id of ["srq-unsupported1", "srq-other1", "srq-malformed1"]) {
      expect(transport.rpc).toContainEqual(
        expect.objectContaining({
          id,
          error: expect.objectContaining({ code: -32601 }),
        }),
      );
    }
    handle.abort();
  });

  // @lat: [[main-server-requests#Interactive turns never replay]]
  it("never replays a prompt after clarification precedes a lost submit acknowledgment", async () => {
    const cb = { ...callbacks(), onClarify: vi.fn() };
    transport.respond.mockImplementation(
      (method: string, _params: unknown, socket: EventEmitter) => {
        if (method === "session.create")
          return { session_id: "live-1", info: {} };
        if (method !== "prompt.submit") return {};
        socket.emit(
          "message",
          JSON.stringify({
            jsonrpc: "2.0",
            id: "srq-no-replay",
            method: "clarify",
            params: {
              session_id: "live-1",
              questions: [{ qid: "q", question: "Where?" }],
            },
          }),
        );
        return new Error("lost acknowledgment");
      },
    );
    await send(cb);
    expect(cb.onClarify).toHaveBeenCalledTimes(1);
    expect(cb.onError).toHaveBeenCalledWith(
      expect.stringContaining("not replayed"),
    );
    expect(transport.http.some(({ url }) => url.includes("/v1/"))).toBe(false);
  });
});
