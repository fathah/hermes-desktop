import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
} from "vitest";
import http from "http";
import type { AddressInfo } from "net";

// chat-client reaches the gateway via getApiUrl()/isRemoteMode() from
// gateway-process and getModelConfig()/getApiServerKey() from config. Point
// those at a fake local server so we exercise the REAL streaming/terminal-state
// logic in sendMessageViaApi without a live Hermes gateway.
let baseUrl = "";
const state = {
  remoteMode: false,
  connectionMode: "local" as "local" | "remote" | "ssh",
};
const requests: Array<{ method: string; url: string; body: string }> = [];

vi.mock("../src/main/hermes/gateway-process", async (importActual) => {
  const actual =
    await importActual<typeof import("../src/main/hermes/gateway-process")>();
  return {
    ...actual,
    getApiUrl: () => baseUrl,
    getRemoteAuthHeader: () =>
      state.remoteMode ? { Authorization: "Bearer remote" } : {},
    isRemoteMode: () => state.remoteMode,
    isGatewayRunning: () => true,
    isApiServerReady: () => Promise.resolve(true),
    getApiServerAvailable: () => true,
  };
});

vi.mock("../src/main/config", async (importActual) => {
  const actual = await importActual<typeof import("../src/main/config")>();
  return {
    ...actual,
    getApiServerKey: () => "",
    getModelConfig: () => ({
      model: "test-model",
      provider: "openai",
      baseUrl: "",
    }),
    readEnv: () => ({}),
    getConnectionConfig: () => ({ mode: state.connectionMode }),
  };
});

import {
  clearHermesChatTransportCache,
  sendMessageViaApi,
  type ChatCallbacks,
} from "../src/main/hermes/chat-client";

/** A handler decides how the fake gateway responds to each POST. */
type Responder = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  body: string,
) => void;
let responder: Responder = (_req, res) => res.end();

let server: http.Server;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c.toString()));
    req.on("end", () => {
      requests.push({ method: req.method || "GET", url: req.url || "", body });
      responder(req, res, body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(() => {
  server.close();
});

interface Harness {
  cb: ChatCallbacks;
  chunks: string[];
  errors: string[];
  counters: { doneCalls: number };
  doneSessionIds: Array<string | undefined>;
  doneP: Promise<void>;
}

function callbacks(): Harness {
  const chunks: string[] = [];
  const errors: string[] = [];
  const counters = { doneCalls: 0 };
  const doneSessionIds: Array<string | undefined> = [];
  let resolve!: () => void;
  const doneP = new Promise<void>((r) => (resolve = r));
  const cb: ChatCallbacks = {
    onChunk: (t) => chunks.push(t),
    onError: (e) => {
      errors.push(e);
      resolve();
    },
    onDone: (sessionId) => {
      counters.doneCalls += 1;
      doneSessionIds.push(sessionId);
      resolve();
    },
  };
  return { cb, chunks, errors, counters, doneSessionIds, doneP };
}

function isStreaming(body: string): boolean {
  try {
    return JSON.parse(body).stream === true;
  } catch {
    return false;
  }
}

beforeEach(() => {
  responder = (_req, res) => res.end();
  requests.length = 0;
  state.remoteMode = false;
  state.connectionMode = "local";
  clearHermesChatTransportCache();
});

describe("sendMessageViaApi terminal-state safety", () => {
  it("MED-6: flushes a trailing SSE block that has no closing \\n\\n", async () => {
    responder = (_req, res) => {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      // No trailing blank line — the gateway disconnected at a byte boundary.
      res.end('data: {"choices":[{"delta":{"content":"hello tail"}}]}\n');
    };
    const h = callbacks();
    sendMessageViaApi("hi", h.cb);
    await h.doneP;
    expect(h.chunks.join("")).toContain("hello tail");
    expect(h.counters.doneCalls).toBe(1);
    expect(h.errors).toHaveLength(0);
  });

  it("MED-5: surfaces a mid-stream error even when [DONE] follows content", async () => {
    responder = (_req, res) => {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(
        'data: {"choices":[{"delta":{"content":"partial answer"}}]}\n\n',
      );
      res.write('data: {"error":{"message":"upstream exploded"}}\n\n');
      res.write("data: [DONE]\n\n");
      res.end();
    };
    const h = callbacks();
    sendMessageViaApi("hi", h.cb);
    await h.doneP;
    const all = h.chunks.join("");
    expect(all).toContain("partial answer");
    expect(all).toContain("upstream exploded"); // error surfaced, not swallowed
    expect(h.counters.doneCalls).toBe(1); // exactly one terminal onDone, no double-fire
  });

  it("calls onDone exactly once on a normal [DONE] stream", async () => {
    responder = (_req, res) => {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write('data: {"choices":[{"delta":{"content":"ok"}}]}\n\n');
      res.write("data: [DONE]\n\n");
      res.end();
    };
    const h = callbacks();
    sendMessageViaApi("hi", h.cb);
    await h.doneP;
    expect(h.chunks.join("")).toContain("ok");
    expect(h.counters.doneCalls).toBe(1);
  });

  it("calls a terminal error exactly once when aborted mid-stream", async () => {
    let openResponse: http.ServerResponse | null = null;
    responder = (_req, res) => {
      openResponse = res;
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n');
    };
    const h = callbacks();
    const handle = sendMessageViaApi("hi", h.cb);

    await vi.waitFor(() => {
      expect(h.chunks.join("")).toContain("partial");
    });

    handle.abort();
    handle.abort();
    openResponse?.end("data: [DONE]\n\n");

    const outcome = await Promise.race([
      h.doneP.then(() => "terminal"),
      new Promise((resolve) => setTimeout(() => resolve("timeout"), 50)),
    ]);

    expect(outcome).toBe("terminal");
    expect(h.errors).toEqual(["Chat request aborted."]);
    expect(h.counters.doneCalls).toBe(0);
  });

  it("HIGH-1: probe fallback resolves (does not hang) when it cannot reach the model", async () => {
    // Stream connects, ends with zero content and no error → triggers probeRealError().
    // The probe request hits a connection reset → must finish with an error, never hang.
    responder = (_req, res, body) => {
      if (isStreaming(body)) {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.end(); // no content, no error → triggers probeRealError()
      } else {
        // the non-streaming probe — reset the socket so the probe must resolve
        // via its error handler rather than hanging.
        res.socket?.destroy();
      }
    };
    const h = callbacks();
    sendMessageViaApi("hi", h.cb);
    await h.doneP;
    expect(h.errors.length).toBeGreaterThan(0);
    expect(h.counters.doneCalls).toBe(0);
  });
});

describe("sendMessageViaApi remote chat surface detection", () => {
  it("uses /api/chat/completions on a v0.17 backend that exposes no /v1 routes", async () => {
    state.remoteMode = true;
    state.connectionMode = "remote";
    responder = (req, res) => {
      if (req.method === "GET" && req.url === "/openapi.json") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            openapi: "3.1.0",
            paths: { "/api/chat/completions": { post: {} } },
          }),
        );
        return;
      }
      if (req.url === "/api/chat/completions") {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write('data: {"choices":[{"delta":{"content":"api ok"}}]}\n\n');
        res.write("data: [DONE]\n\n");
        res.end();
        return;
      }
      res.writeHead(405, { "Content-Type": "text/html" });
      res.end("<html>method not allowed</html>");
    };

    const h = callbacks();
    sendMessageViaApi("hi", h.cb);
    await h.doneP;

    expect(h.errors).toHaveLength(0);
    expect(h.chunks.join("")).toContain("api ok");
    expect(
      requests.some(
        (r) => r.method === "POST" && r.url === "/v1/chat/completions",
      ),
    ).toBe(false);
    expect(
      requests.some(
        (r) => r.method === "POST" && r.url === "/api/chat/completions",
      ),
    ).toBe(true);
  });

  it("falls back from a /v1/chat/completions 405 HTML response to /api/chat/completions", async () => {
    state.remoteMode = true;
    state.connectionMode = "ssh";
    responder = (req, res) => {
      if (req.method === "GET" && req.url === "/openapi.json") {
        res.writeHead(404);
        res.end();
        return;
      }
      if (req.method === "GET" && req.url === "/v1/capabilities") {
        res.writeHead(404);
        res.end();
        return;
      }
      if (req.url === "/v1/chat/completions") {
        res.writeHead(405, { "Content-Type": "text/html" });
        res.end("<html>dashboard shell</html>");
        return;
      }
      if (req.url === "/api/chat/completions") {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write(
          'data: {"choices":[{"delta":{"content":"fallback ok"}}]}\n\n',
        );
        res.write("data: [DONE]\n\n");
        res.end();
        return;
      }
      res.writeHead(404);
      res.end();
    };

    const h = callbacks();
    sendMessageViaApi("hi", h.cb);
    await h.doneP;

    expect(h.errors).toHaveLength(0);
    expect(h.chunks.join("")).toContain("fallback ok");
    expect(
      requests.filter(
        (r) => r.method === "POST" && r.url === "/v1/chat/completions",
      ),
    ).toHaveLength(1);
    expect(
      requests.some(
        (r) => r.method === "POST" && r.url === "/api/chat/completions",
      ),
    ).toBe(true);
  });

  it("adapts /api/sessions/{id}/chat/stream SSE to desktop chat callbacks", async () => {
    state.remoteMode = true;
    state.connectionMode = "remote";
    responder = (req, res, body) => {
      if (req.method === "GET" && req.url === "/openapi.json") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            openapi: "3.1.0",
            paths: {
              "/api/sessions": { post: {} },
              "/api/sessions/{session_id}/chat/stream": { post: {} },
            },
          }),
        );
        return;
      }
      if (req.method === "POST" && req.url === "/api/sessions") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ session_id: "session-created" }));
        return;
      }
      if (
        req.method === "POST" &&
        req.url === "/api/sessions/session-created/chat/stream"
      ) {
        const parsed = JSON.parse(body) as {
          message?: string;
          system_message?: string;
        };
        expect(parsed.message).toBe("hi");
        expect(parsed.system_message).toContain("grounding");
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write(
          'event: assistant.delta\ndata: {"delta":"session stream ok"}\n\n',
        );
        res.write(
          'event: run.completed\ndata: {"session_id":"session-created"}\n\n',
        );
        res.write("event: done\ndata: {}\n\n");
        res.end();
        return;
      }
      res.writeHead(404);
      res.end();
    };

    const h = callbacks();
    sendMessageViaApi(
      "hi",
      h.cb,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { role: "system", content: "grounding" },
    );
    await h.doneP;

    expect(h.errors).toHaveLength(0);
    expect(h.chunks.join("")).toContain("session stream ok");
    expect(h.doneSessionIds).toEqual(["session-created"]);
  });

  it("fails with an actionable error when the backend has no compatible chat route", async () => {
    state.remoteMode = true;
    state.connectionMode = "ssh";
    responder = (req, res) => {
      if (req.method === "GET" && req.url === "/openapi.json") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ openapi: "3.1.0", paths: { "/health": {} } }));
        return;
      }
      if (req.method === "GET" && req.url === "/v1/capabilities") {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(500);
      res.end("unexpected model route");
    };

    const h = callbacks();
    sendMessageViaApi("hi", h.cb);
    await h.doneP;

    expect(h.errors.join("\n")).toMatch(/Hermes proxy\/API-server port/i);
    expect(
      requests.some(
        (r) => r.method === "POST" && r.url === "/v1/chat/completions",
      ),
    ).toBe(false);
  });
});
