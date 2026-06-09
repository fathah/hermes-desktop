import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  runChatTurn,
  type ChatTransport,
  type ChatTurnSink,
  type ChatTurnEffects,
  type ChatTurnContext,
} from "../src/main/chat-orchestrator";
import type { ChatCallbacks } from "../src/main/hermes/chat-client";

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function makeEffects(): ChatTurnEffects {
  return {
    recordUsage: vi.fn(),
    persistAssistantMetadata: vi.fn(),
    maybeAutoApprove: vi.fn(() => false),
    playCompletionSound: vi.fn(),
    notifyComplete: vi.fn(),
    notifyError: vi.fn(),
  };
}

interface Harness {
  emits: Array<{ channel: string; payload: unknown }>;
  sink: ChatTurnSink;
  effects: ChatTurnEffects;
  abortRegistry: Map<string, () => void>;
  abortSpy: () => void;
  /** Captured callbacks the fake transport received — drive them to simulate streaming. */
  cb: () => ChatCallbacks;
  ctx: (overrides?: Partial<ChatTurnContext>) => ChatTurnContext;
}

function harness(opts?: {
  sinkReturns?: boolean;
  secrets?: string[];
}): Harness {
  const emits: Array<{ channel: string; payload: unknown }> = [];
  let captured: ChatCallbacks | undefined;
  const abortSpy = vi.fn();
  const transport: ChatTransport = (_message, callbacks) => {
    captured = callbacks;
    return Promise.resolve({ abort: abortSpy });
  };
  const sink: ChatTurnSink = {
    emit: (channel, payload) => {
      emits.push({ channel, payload });
      return opts?.sinkReturns ?? true;
    },
  };
  const effects = makeEffects();
  const abortRegistry = new Map<string, () => void>();
  return {
    emits,
    sink,
    effects,
    abortRegistry,
    abortSpy,
    cb: () => {
      if (!captured) throw new Error("transport not called yet");
      return captured;
    },
    ctx: (overrides) => ({
      transport,
      sink,
      effects,
      abortRegistry,
      sessionKey: "sess-key",
      secretsToRedact: opts?.secrets ?? [],
      ...overrides,
    }),
  };
}

const req = { message: "hi" };

describe("runChatTurn", () => {
  beforeEach(() => vi.clearAllMocks());

  it("streams chunks and resolves with the full response on done", async () => {
    const h = harness();
    const p = runChatTurn(req, h.ctx());
    await tick();

    h.cb().onChunk("hello");
    h.cb().onChunk(" world");
    h.cb().onDone("session-1");

    await expect(p).resolves.toEqual({
      response: "hello world",
      sessionId: "session-1",
    });
    expect(h.emits).toContainEqual({ channel: "chat-chunk", payload: "hello" });
    expect(h.emits).toContainEqual({
      channel: "chat-chunk",
      payload: " world",
    });
    expect(h.emits).toContainEqual({
      channel: "chat-done",
      payload: "session-1",
    });
    expect(h.effects.persistAssistantMetadata).toHaveBeenCalledWith(
      "session-1",
    );
    expect(h.effects.playCompletionSound).toHaveBeenCalledOnce();
    expect(h.effects.notifyComplete).toHaveBeenCalledWith("hello world");
  });

  it("registers the abort in the registry, and clears it on done", async () => {
    const h = harness();
    const p = runChatTurn(req, h.ctx());
    await tick();
    expect(h.abortRegistry.get("sess-key")).toBe(h.abortSpy);

    h.cb().onDone(undefined);
    await p;
    expect(h.abortRegistry.has("sess-key")).toBe(false);
  });

  it("aborts an in-flight turn for the same session before starting", async () => {
    const h = harness();
    const previousAbort = vi.fn();
    h.abortRegistry.set("sess-key", previousAbort);

    const p = runChatTurn(req, h.ctx());
    await tick();
    expect(previousAbort).toHaveBeenCalledOnce();

    h.cb().onDone("s");
    await p;
  });

  it("rejects and notifies on error", async () => {
    const h = harness();
    const p = runChatTurn(req, h.ctx());
    await tick();

    h.cb().onError("boom");

    await expect(p).rejects.toThrow("boom");
    expect(h.emits).toContainEqual({ channel: "chat-error", payload: "boom" });
    expect(h.effects.notifyError).toHaveBeenCalledWith("boom");
    expect(h.abortRegistry.has("sess-key")).toBe(false);
  });

  it("routes approvals: auto-approve emits chat-approval-auto, else chat-approval-request", async () => {
    const h = harness();
    (h.effects.maybeAutoApprove as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);
    const p = runChatTurn(req, h.ctx());
    await tick();

    const reqA = { id: "a", command: "ls" };
    const reqB = { id: "b", command: "rm" };
    h.cb().onApprovalRequest!(reqA as never);
    h.cb().onApprovalRequest!(reqB as never);

    expect(h.emits).toContainEqual({
      channel: "chat-approval-auto",
      payload: { ...reqA, sessionKey: "sess-key" },
    });
    expect(h.emits).toContainEqual({
      channel: "chat-approval-request",
      payload: { ...reqB, sessionKey: "sess-key" },
    });

    h.cb().onDone("s");
    await p;
  });

  it("emits usage and forwards it to recordUsage", async () => {
    const h = harness();
    const p = runChatTurn(req, h.ctx());
    await tick();

    const usage = {
      promptTokens: 1,
      completionTokens: 2,
      totalTokens: 3,
    };
    h.cb().onUsage!(usage as never);
    expect(h.emits).toContainEqual({ channel: "chat-usage", payload: usage });
    expect(h.effects.recordUsage).toHaveBeenCalledWith(usage);

    h.cb().onDone("s");
    await p;
  });

  it("redacts configured secrets from streamed content", async () => {
    const h = harness({ secrets: ["topsecret"] });
    const p = runChatTurn(req, h.ctx());
    await tick();

    h.cb().onChunk("token is topsecret ok");
    h.cb().onDone("s");
    const { response } = await p;

    const streamed = h.emits
      .filter((e) => e.channel === "chat-chunk")
      .map((e) => e.payload)
      .join("");
    expect(streamed).not.toContain("topsecret");
    expect(response).not.toContain("topsecret");
  });
});
