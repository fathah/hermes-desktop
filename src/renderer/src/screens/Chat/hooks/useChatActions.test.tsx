import { act, render, waitFor } from "@testing-library/react";
import { useEffect, useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ChatInputHandle } from "../ChatInput";
import type { ActiveTurn, ChatMessage, QueueAnchor } from "../types";
import type { SlashExecOutcome } from "../slashExec";
import { useChatActions } from "./useChatActions";

interface HarnessApi {
  actions?: ReturnType<typeof useChatActions>;
  activeTurn?: React.MutableRefObject<ActiveTurn | null>;
  messages?: ChatMessage[];
}

interface HarnessProps {
  api: HarnessApi;
  enqueueMessage?: (text: string) => void;
  execSlash?: (
    command: string,
    sys: (text: string) => void,
  ) => Promise<SlashExecOutcome>;
  initialLoading?: boolean;
  sendViaDashboard?: (text: string) => Promise<boolean>;
  setIsLoading?: (loading: boolean) => void;
}

const initialMessages: ChatMessage[] = [
  {
    id: "user-active",
    role: "user",
    content: "active task",
    turnId: "turn-active",
  },
  {
    id: "tool-active",
    kind: "tool_call",
    role: "agent",
    callId: "call-active",
    name: "terminal",
    args: "working",
  },
];

function Harness({
  api,
  enqueueMessage,
  execSlash,
  initialLoading = true,
  sendViaDashboard,
  setIsLoading = vi.fn(),
}: HarnessProps): null {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const activeTurnRef = useRef<ActiveTurn | null>({
    turnId: "turn-active",
    userId: "user-active",
    startIndex: 0,
    status: "running",
  });
  const chatInputRef = useRef<ChatInputHandle>(null);
  const actions = useChatActions({
    runId: "run-test",
    hermesSessionId: "session-test",
    messages,
    isLoading: initialLoading,
    setIsLoading,
    setMessages,
    chatInputRef,
    localCommands: {
      isLocal: () => false,
      executeLocal: vi.fn(async () => false),
    },
    activeTurnRef,
    contextFolder: null,
    sendViaDashboard,
    execSlashViaDashboard: execSlash,
    enqueueMessage,
    addAgentMessage: (content) =>
      setMessages((prev) => [
        ...prev,
        { id: `agent-${prev.length}`, role: "agent", content },
      ]),
  });

  useEffect(() => {
    Object.assign(api, { actions, activeTurn: activeTurnRef, messages });
  }, [actions, activeTurnRef, api, messages]);
  return null;
}

describe("useChatActions queue routing", () => {
  it("queues the resolved /queue prompt without inserting a user bubble mid-turn", async () => {
    const enqueueMessage = vi.fn();
    const execSlash = vi.fn(
      async (): Promise<SlashExecOutcome> => ({
        kind: "send",
        message: "resolved follow-up",
      }),
    );
    const api: HarnessApi = {};
    render(
      <Harness
        api={api}
        enqueueMessage={enqueueMessage}
        execSlash={execSlash}
      />,
    );

    await act(async () => {
      await api.actions?.handleSend("/queue follow-up", [], true);
    });

    expect(enqueueMessage).toHaveBeenCalledWith("resolved follow-up", []);
    expect(api.messages).toEqual(initialMessages);
  });

  it("keeps non-queue slash command rendering unchanged", async () => {
    const execSlash = vi.fn(
      async (
        _command: string,
        sys: (text: string) => void,
      ): Promise<SlashExecOutcome> => {
        sys("status ok");
        return { kind: "done" };
      },
    );
    const api: HarnessApi = {};
    render(<Harness api={api} execSlash={execSlash} />);

    await act(async () => {
      await api.actions?.handleSend("/status", [], true);
    });

    await waitFor(() =>
      expect(api.messages?.map((message) => message.id)).toHaveLength(4),
    );
    expect(
      api.messages?.map((message) =>
        "content" in message ? message.content : "",
      ),
    ).toEqual(["active task", "", "/status", "status ok"]);
  });

  it("removes a failed queued turn so the caller can safely requeue it", async () => {
    const sendError = new Error("send failed before IPC accepted it");
    const setIsLoading = vi.fn();
    const api: HarnessApi = {};
    render(
      <Harness
        api={api}
        initialLoading={false}
        sendViaDashboard={vi.fn(async () => {
          throw sendError;
        })}
        setIsLoading={setIsLoading}
      />,
    );
    const anchor: QueueAnchor = {
      afterMessageId: "tool-active",
      afterMessageIndex: 1,
      sequence: 1,
      turnId: "turn-active",
    };

    await act(async () => {
      await expect(
        api.actions?.handleSend("retry me", [], true, anchor),
      ).rejects.toThrow(sendError);
    });

    await waitFor(() => expect(api.messages).toEqual(initialMessages));
    expect(api.activeTurn?.current).toBeNull();
    expect(setIsLoading).toHaveBeenCalledWith(false);
  });
});
