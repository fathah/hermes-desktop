import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRef, useState } from "react";
import { useChatIPC } from "./useChatIPC";
import type { ActiveTurn, ChatMessage, UsageState } from "../types";

type Callback<T extends unknown[]> = (...args: T) => void;

interface ChatIpcCallbacks {
  sessionStarted?: Callback<[string, string]>;
  chunk?: Callback<[string, string]>;
  reasoning?: Callback<[string, string]>;
  done?: Callback<[string, string]>;
  error?: Callback<[string, string]>;
  toolProgress?: Callback<[string, string]>;
  toolEvent?: Callback<[string, unknown]>;
  usage?: Callback<[string, UsageState]>;
}

function installHermesApi(callbacks: ChatIpcCallbacks): {
  getSessionMessages: ReturnType<typeof vi.fn>;
} {
  const getSessionMessages = vi.fn(async (sessionId: string) => {
    if (sessionId === "old-session") {
      return [
        { kind: "user", id: 1, content: "old prompt" },
        { kind: "assistant", id: 2, content: "old answer" },
      ];
    }
    return [];
  });

  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: {
      getSessionMessages,
      onChatSessionStarted: (cb: Callback<[string, string]>) => {
        callbacks.sessionStarted = cb;
        return vi.fn();
      },
      onChatChunk: (cb: Callback<[string, string]>) => {
        callbacks.chunk = cb;
        return vi.fn();
      },
      onChatReasoningChunk: (cb: Callback<[string, string]>) => {
        callbacks.reasoning = cb;
        return vi.fn();
      },
      onChatDone: (cb: Callback<[string, string]>) => {
        callbacks.done = cb;
        return vi.fn();
      },
      onChatError: (cb: Callback<[string, string]>) => {
        callbacks.error = cb;
        return vi.fn();
      },
      onChatToolProgress: (cb: Callback<[string, string]>) => {
        callbacks.toolProgress = cb;
        return vi.fn();
      },
      onChatToolEvent: (cb: Callback<[string, unknown]>) => {
        callbacks.toolEvent = cb;
        return vi.fn();
      },
      onClarifyRequest: vi.fn(() => vi.fn()),
      onChatUsage: (cb: Callback<[string, UsageState]>) => {
        callbacks.usage = cb;
        return vi.fn();
      },
    },
  });

  return { getSessionMessages };
}

function Harness({
  sessionScopeId,
}: {
  sessionScopeId: string | null;
}): React.JSX.Element {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [, setHermesSessionId] = useState<string | null>(sessionScopeId);
  const [, setToolProgress] = useState<string | null>(null);
  const [, setIsLoading] = useState(false);
  const [, setUsage] = useState<UsageState | null>(null);
  const activeTurnRef = useRef<ActiveTurn | null>(null);

  useChatIPC({
    runId: "run-1",
    sessionScopeId,
    setMessages,
    setHermesSessionId,
    setToolProgress,
    setIsLoading,
    setUsage,
    activeTurnRef,
  });

  return (
    <output data-testid="ids">
      {JSON.stringify(messages.map((message) => message.id))}
    </output>
  );
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "hermesAPI");
});

describe("useChatIPC session scoping", () => {
  it("ignores late DB refreshes from an old session after the visible chat is cleared", async () => {
    const callbacks: ChatIpcCallbacks = {};
    const api = installHermesApi(callbacks);
    const view = render(<Harness sessionScopeId="old-session" />);

    view.rerender(<Harness sessionScopeId={null} />);

    await act(async () => {
      callbacks.done?.("run-1", "old-session");
    });

    expect(api.getSessionMessages).not.toHaveBeenCalled();
    expect(screen.getByTestId("ids")).toHaveTextContent("[]");
  });

  it("accepts DB refreshes for the visible session", async () => {
    const callbacks: ChatIpcCallbacks = {};
    const api = installHermesApi(callbacks);
    render(<Harness sessionScopeId="old-session" />);

    await act(async () => {
      callbacks.done?.("run-1", "old-session");
    });

    expect(api.getSessionMessages).toHaveBeenCalledWith("old-session");
    expect(screen.getByTestId("ids")).toHaveTextContent(
      JSON.stringify(["db-1", "db-2"]),
    );
  });
});
