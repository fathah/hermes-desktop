import { act, renderHook } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, expect, it, vi } from "vitest";
afterEach(() => vi.unstubAllGlobals());
import { useDashboardChatTransport } from "./useDashboardChatTransport";
import type { ChatMessage, ActiveTurn } from "../types";

// @lat: [[remote-profiles#Tests#Real native connection setup remains admitted]]
it("allows the real native client initial cleanup and first prompt handshake", async () => {
  const sent: string[] = [];
  class SyntheticWebSocket {
    static OPEN = 1;
    static CONNECTING = 0;
    static CLOSING = 2;
    static CLOSED = 3;
    readyState = 0;
    listeners = new Map<string, Set<(event: unknown) => void>>();
    constructor(public url: string) {
      queueMicrotask(() => {
        this.readyState = 1;
        this.emit("open", {});
      });
    }
    addEventListener(type: string, fn: (event: unknown) => void): void {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type)!.add(fn);
    }
    removeEventListener(type: string, fn: (event: unknown) => void): void {
      this.listeners.get(type)?.delete(fn);
    }
    emit(type: string, event: unknown): void {
      this.listeners.get(type)?.forEach((fn) => fn(event));
    }
    close(): void {
      this.readyState = 3;
      this.emit("close", {});
    }
    send(wire: string): void {
      const request = JSON.parse(wire) as { id: number; method: string };
      sent.push(request.method);
      const result =
        request.method === "session.create"
          ? { session_id: "runtime", stored_session_id: "stored" }
          : { status: "ok" };
      queueMicrotask(() =>
        this.emit("message", {
          data: JSON.stringify({ jsonrpc: "2.0", id: request.id, result }),
        }),
      );
    }
  }
  vi.stubGlobal("WebSocket", SyntheticWebSocket);
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: {
      startDashboard: vi.fn(async () => ({
        running: true,
        connection: { wsUrl: "ws://isolated.test" },
      })),
      freshDashboardWsUrl: vi.fn(async () => "ws://isolated.test"),
      recordAgentRuntimeInfo: vi.fn(async () => true),
    },
  });
  const { result, unmount } = renderHook(() =>
    useDashboardChatTransport({
      activeTurnRef: useRef<ActiveTurn | null>(null),
      connectionId: "a",
      connectionMode: "remote",
      connectionRevision: 0,
      getConnectionAuthority: async () => "same-private-revision",
      contextFolder: null,
      enabled: true,
      fallbackOnUnavailable: false,
      hermesSessionId: null,
      messagesRef: useRef<ChatMessage[]>([]),
      model: "",
      provider: "",
      profile: "work",
      setHermesSessionId: vi.fn(),
      setIsLoading: vi.fn(),
      setMessages: vi.fn(),
      setToolProgress: vi.fn(),
      setUsage: vi.fn(),
    }),
  );
  await act(async () => {
    await result.current.sendMessage("hello");
  });
  expect(sent).toContain("prompt.submit");
  unmount();
});
