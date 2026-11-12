// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardGatewayClient } from "./dashboardGatewayClient";

// A controllable WebSocket stand-in: it never opens, errors, or closes on its
// own, so each test drives the readyState transition explicitly. This lets us
// exercise the connect handshake — in particular the stalled CONNECTING case
// that wedged the transport before issue #718 added a connect timeout.
class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static last: FakeWebSocket | null = null;

  readyState = FakeWebSocket.CONNECTING;
  closeCalls = 0;
  sent: Array<Record<string, unknown>> = [];
  private listeners: Record<string, ((event: unknown) => void)[]> = {};

  constructor(public url: string) {
    FakeWebSocket.last = this;
  }

  addEventListener(type: string, handler: (event: unknown) => void): void {
    (this.listeners[type] ??= []).push(handler);
  }

  removeEventListener(type: string, handler: (event: unknown) => void): void {
    this.listeners[type] = (this.listeners[type] ?? []).filter(
      (candidate) => candidate !== handler,
    );
  }

  close(): void {
    this.closeCalls += 1;
    this.readyState = FakeWebSocket.CLOSED;
  }

  send(value: string): void {
    this.sent.push(JSON.parse(value));
  }

  receive(value: unknown): void {
    this.emit("message", { data: JSON.stringify(value) });
  }

  emit(type: string, event: unknown = {}): void {
    for (const handler of this.listeners[type] ?? []) handler(event);
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeWebSocket.last = null;
  (globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket =
    FakeWebSocket as unknown as typeof WebSocket;
});

async function openClient(onEvent = vi.fn()): Promise<{
  client: DashboardGatewayClient;
  socket: FakeWebSocket;
  onEvent: ReturnType<typeof vi.fn>;
}> {
  const client = new DashboardGatewayClient({ onEvent });
  const connecting = client.connect("ws://127.0.0.1/api/ws");
  const socket = FakeWebSocket.last!;
  socket.readyState = FakeWebSocket.OPEN;
  socket.emit("open");
  await connecting;
  const capabilities = socket.sent.find(
    (frame) => frame.method === "client.capabilities",
  )!;
  socket.receive({ jsonrpc: "2.0", id: capabilities.id, result: {} });
  return { client, socket, onEvent };
}

const approvalFrame = (
  id = "srq-012345abcdef",
  session = "session-1",
): {
  jsonrpc: string;
  id: string;
  method: string;
  params: {
    session_id: string;
    request_id: string;
    command: string;
    choices: string[];
  };
} => ({
  jsonrpc: "2.0",
  id,
  method: "approval",
  params: {
    session_id: session,
    request_id: "original-approval",
    command: "echo check",
    choices: ["once", "deny"],
  },
});

describe("current Agent blocking requests", () => {
  // @lat: [[server-requests#Matching request replies]]
  it("advertises support and answers the received approval ID without issuing a response RPC", async () => {
    const { client, socket, onEvent } = await openClient();
    expect(socket.sent[0]).toMatchObject({
      method: "client.capabilities",
      params: { server_requests: true },
    });
    client.activateServerRequests("session-1");
    socket.receive(approvalFrame());
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "approval.request",
        payload: expect.objectContaining({
          request_id: "srq-012345abcdef",
          command: "echo check",
        }),
      }),
    );
    await expect(
      client.request("approval.respond", {
        request_id: "srq-012345abcdef",
        choice: "once",
      }),
    ).resolves.toEqual({ resolved: 1 });
    expect(socket.sent.at(-1)).toEqual({
      jsonrpc: "2.0",
      id: "srq-012345abcdef",
      result: { choice: "once", all: false },
    });
    await expect(
      client.request("approval.respond", {
        request_id: "srq-012345abcdef",
        choice: "once",
      }),
    ).rejects.toThrow(/no longer open/);
    socket.receive(approvalFrame());
    expect(onEvent).toHaveBeenCalledTimes(1);
    client.close();
  });

  // @lat: [[server-requests#Request cancellation]]
  it("expires a cancelled approval and rejects a late answer", async () => {
    const { client, socket, onEvent } = await openClient();
    client.activateServerRequests("session-1");
    socket.receive(approvalFrame());
    socket.receive({
      method: "event",
      params: {
        type: "request.cancel",
        session_id: "session-1",
        payload: {
          id: "srq-012345abcdef",
          method: "approval",
          reason: "interrupted",
        },
      },
    });
    expect(onEvent).toHaveBeenLastCalledWith({
      type: "approval.expire",
      session_id: "session-1",
      payload: { request_id: "srq-012345abcdef" },
    });
    expect(
      client.respondServerRequest("srq-012345abcdef", { choice: "once" }),
    ).toBe(false);
    client.close();
  });

  it("does not let another session cancel the active session's request", async () => {
    const { client, socket, onEvent } = await openClient();
    client.activateServerRequests("session-1");
    socket.receive(approvalFrame());
    socket.receive({
      method: "event",
      params: {
        type: "request.cancel",
        session_id: "another-session",
        payload: { id: "srq-012345abcdef" },
      },
    });
    expect(onEvent).toHaveBeenCalledTimes(1);
    await expect(
      client.request("approval.respond", {
        request_id: "srq-012345abcdef",
        choice: "deny",
      }),
    ).resolves.toEqual({ resolved: 1 });
    client.close();
  });

  // @lat: [[server-requests#Resume restoration]]
  it("restores open requests only after the resumed session is adopted, without duplicate cards", async () => {
    const { client, socket, onEvent } = await openClient();
    const resuming = client.request("session.resume", {
      session_id: "stored-1",
    });
    const resume = socket.sent.at(-1)!;
    socket.receive({
      id: resume.id,
      result: { session_id: "session-1", open_requests: [approvalFrame()] },
    });
    await resuming;
    expect(onEvent).not.toHaveBeenCalled();
    client.activateServerRequests("session-1");
    socket.receive(approvalFrame());
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ server_request_replay: true }),
      }),
    );
    client.close();
  });

  it("does not reopen an answered approval from an older same-socket snapshot", async () => {
    const { client, socket, onEvent } = await openClient();
    client.activateServerRequests("session-1");
    socket.receive(approvalFrame());
    const snapshot = client.request("session.events.since", {
      session_id: "session-1",
    });
    const snapshotId = socket.sent.at(-1)!.id;
    await client.request("approval.respond", {
      request_id: "srq-012345abcdef",
      choice: "deny",
    });
    socket.receive({
      id: snapshotId,
      result: { open_requests: [approvalFrame()] },
    });
    await snapshot;
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(
      client.respondServerRequest("srq-012345abcdef", { choice: "once" }),
    ).toBe(false);
    client.close();
  });

  it("refuses a replay that changes the command behind an outstanding approval", async () => {
    const { client, socket, onEvent } = await openClient();
    client.activateServerRequests("session-1");
    socket.receive(approvalFrame());
    const snapshot = client.request("session.events.since", {
      session_id: "session-1",
    });
    const id = socket.sent.at(-1)!.id;
    const changed = approvalFrame();
    changed.params.command = "different command";
    socket.receive({ id, result: { open_requests: [changed] } });
    await snapshot;
    expect(onEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "approval.expire" }),
    );
    expect(socket.sent.at(-1)).toMatchObject({
      id: changed.id,
      error: { code: -32602 },
    });
    expect(client.respondServerRequest(changed.id, { choice: "once" })).toBe(
      false,
    );
    client.close();
  });

  it("refreshes typed locked answers on clarification replay without changing its questions", async () => {
    const { client, socket, onEvent } = await openClient();
    client.activateServerRequests("session-1");
    const frame = {
      ...approvalFrame(),
      method: "clarify",
      params: {
        session_id: "session-1",
        questions: [
          { qid: "a", question: "Environment?" },
          { qid: "b", question: "Region?" },
        ],
      },
    };
    socket.receive(frame);
    const snapshot = client.request("session.events.since", {
      session_id: "session-1",
    });
    socket.receive({
      id: socket.sent.at(-1)!.id,
      result: {
        open_requests: [
          { ...frame, params: { ...frame.params, answers: { a: "staging" } } },
        ],
      },
    });
    await snapshot;
    expect(onEvent).toHaveBeenCalledTimes(2);
    expect(onEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          answers: { a: "staging" },
          server_request_replay: true,
        }),
      }),
    );
    client.close();
  });

  it("defers request delivery through a session handoff and declines other owners after adoption", async () => {
    const { client, socket, onEvent } = await openClient();
    client.activateServerRequests("old-session");
    const resuming = client.request("session.resume", { session_id: "stored" });
    const resumeId = socket.sent.at(-1)!.id;
    socket.receive(approvalFrame());
    expect(onEvent).not.toHaveBeenCalled();
    socket.receive({ id: resumeId, result: { session_id: "session-1" } });
    await resuming;
    client.activateServerRequests("session-1");
    expect(onEvent).toHaveBeenCalledTimes(1);
    socket.receive(approvalFrame("srq-other-owner", "different-session"));
    expect(socket.sent.at(-1)).toMatchObject({
      id: "srq-other-owner",
      error: { code: 4404 },
    });
    client.close();
  });

  it("declines a buffered foreign request when its session handoff fails", async () => {
    const { client, socket, onEvent } = await openClient();
    client.activateServerRequests("old-session");
    const resuming = client.request("session.resume", { session_id: "stored" });
    const rejected = expect(resuming).rejects.toThrow("Resume refused");
    const resumeId = socket.sent.at(-1)!.id;
    socket.receive(approvalFrame());
    expect(onEvent).not.toHaveBeenCalled();
    socket.receive({ id: resumeId, error: { message: "Resume refused" } });
    await rejected;
    expect(socket.sent.at(-1)).toMatchObject({
      id: "srq-012345abcdef",
      error: { code: 4404 },
    });
    expect(
      client.respondServerRequest("srq-012345abcdef", { choice: "once" }),
    ).toBe(false);
    client.close();
  });

  // @lat: [[server-requests#Unsupported requests]]
  it("declines unsupported and malformed requests explicitly and never emits secret fields", async () => {
    const { client, socket, onEvent } = await openClient();
    socket.receive({
      ...approvalFrame(),
      method: "secret",
      params: { session_id: "session-1", env_var: "TOKEN", prompt: "Secret" },
    });
    expect(socket.sent.at(-1)).toMatchObject({
      id: "srq-012345abcdef",
      error: { code: -32601 },
    });
    socket.receive({ ...approvalFrame("srq-window"), method: "preview.read" });
    expect(socket.sent.at(-1)).toMatchObject({ error: { code: 4404 } });
    socket.receive({ ...approvalFrame("srq-malformed"), params: null });
    expect(socket.sent.at(-1)).toMatchObject({ error: { code: -32602 } });
    expect(onEvent).not.toHaveBeenCalled();
    client.close();
  });

  it("sends one complete batch answer and preserves locked answers", async () => {
    const { client, socket } = await openClient();
    client.activateServerRequests("session-1");
    socket.receive({
      ...approvalFrame(),
      method: "clarify",
      params: {
        session_id: "session-1",
        questions: [
          { qid: "a", question: "Environment?" },
          { qid: "b", question: "Region?" },
        ],
        answers: { a: "staging" },
      },
    });
    await expect(
      client.request("clarify.respond", {
        request_id: "srq-012345abcdef",
        answer: JSON.stringify({ answers: { a: "production", b: "Dubai" } }),
      }),
    ).resolves.toEqual({ status: "ok" });
    expect(socket.sent.at(-1)).toEqual({
      jsonrpc: "2.0",
      id: "srq-012345abcdef",
      result: { answers: { a: "staging", b: "Dubai" } },
    });
    client.close();
  });

  it("ignores frames from a replaced socket", async () => {
    const { client, socket, onEvent } = await openClient();
    client.close();
    socket.receive(approvalFrame());
    socket.emit("close");
    expect(onEvent).not.toHaveBeenCalled();
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("DashboardGatewayClient.connect", () => {
  it("rejects and closes the socket when the handshake stalls", async () => {
    const client = new DashboardGatewayClient({ connectTimeoutMs: 1_000 });
    const connecting = client.connect("ws://localhost/api/ws");
    const assertion = expect(connecting).rejects.toThrow(/timed out/i);

    // Socket never fires open/error/close — only the timeout should settle it.
    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;

    expect(FakeWebSocket.last?.closeCalls).toBe(1);
    expect(client.connected).toBe(false);
  });

  it("resolves on open and cancels the timeout", async () => {
    const client = new DashboardGatewayClient({ connectTimeoutMs: 1_000 });
    const connecting = client.connect("ws://localhost/api/ws");

    const socket = FakeWebSocket.last;
    if (!socket) throw new Error("socket not created");
    socket.readyState = FakeWebSocket.OPEN;
    socket.emit("open");
    await connecting;

    expect(client.connected).toBe(true);
    // A late timeout firing must not tear down a healthy socket.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(socket.closeCalls).toBe(0);
    expect(client.connected).toBe(true);
  });

  it("rejects when the socket closes before the handshake settles", async () => {
    const client = new DashboardGatewayClient({ connectTimeoutMs: 10_000 });
    const connecting = client.connect("ws://localhost/api/ws");
    const assertion = expect(connecting).rejects.toThrow(/closed/i);

    FakeWebSocket.last?.emit("close", {});
    await assertion;
  });
});
