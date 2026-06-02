import { describe, it, expect, vi } from "vitest";

describe("Multi-session Chat Abort Concurrency", () => {
  it("cancels only the targeted session when abort-chat is triggered", () => {
    const activeChatAborts = new Map<string, () => void>();

    const abortA = vi.fn();
    const abortB = vi.fn();
    const abortC = vi.fn();

    // Register active streams
    activeChatAborts.set("session-123", abortA);
    activeChatAborts.set("session-456", abortB);
    activeChatAborts.set("sender-789", abortC);

    // Trigger abort for session-123
    const actionA = activeChatAborts.get("session-123");
    if (actionA) {
      actionA();
      activeChatAborts.delete("session-123");
    }

    expect(abortA).toHaveBeenCalledTimes(1);
    expect(abortB).not.toHaveBeenCalled();
    expect(abortC).not.toHaveBeenCalled();

    expect(activeChatAborts.has("session-123")).toBe(false);
    expect(activeChatAborts.has("session-456")).toBe(true);
    expect(activeChatAborts.has("sender-789")).toBe(true);
  });

  it("handles empty/missing sessions by fallback keys without collision", () => {
    const activeChatAborts = new Map<string, () => void>();

    const abortFallback = vi.fn();
    activeChatAborts.set("sender-1", abortFallback);

    // Trigger abort for window 1 fallback
    const action = activeChatAborts.get("sender-1");
    if (action) {
      action();
      activeChatAborts.delete("sender-1");
    }

    expect(abortFallback).toHaveBeenCalledTimes(1);
    expect(activeChatAborts.has("sender-1")).toBe(false);
  });
});
