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

vi.mock("../src/main/hermes/gateway-process", async (importActual) => {
  const actual =
    await importActual<typeof import("../src/main/hermes/gateway-process")>();
  return {
    ...actual,
    getApiUrl: () => baseUrl,
    getRemoteAuthHeader: () => ({}),
    isRemoteMode: () => false,
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
  };
});

import {
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
    req.on("end", () => responder(req, res, body));
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
  doneP: Promise<void>;
}

function callbacks(): Harness {
  const chunks: string[] = [];
  const errors: string[] = [];
  const counters = { doneCalls: 0 };
  let resolve!: () => void;
  const doneP = new Promise<void>((r) => (resolve = r));
  const cb: ChatCallbacks = {
    onChunk: (t) => chunks.push(t),
    onError: (e) => {
      errors.push(e);
      resolve();
    },
    onDone: () => {
      counters.doneCalls += 1;
      resolve();
    },
  };
  return { cb, chunks, errors, counters, doneP };
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
