// Several callbacks below read non-reactive refs/helpers, so the React Compiler
// can't preserve their hand-written dependency arrays. Correcting the deps would
// change when each callback is recreated — a behavioural change we won't make in
// this admin Chat screen, which is slated for removal. Keep the manual deps.
/* eslint-disable react-hooks/preserve-manual-memoization */
import { useCallback, useEffect, useRef } from "react";
import type { ChatInputHandle } from "../ChatInput";
import type {
  Attachment,
  ChatMessage,
  ChatBubbleMessage,
  CouncilTurnMessage,
} from "../types";
import { getGroundInWorkspace } from "../../../lib/grounding";
import { buildHandoffPrompt } from "../handoff";

function hasContent(msg: ChatMessage): msg is ChatBubbleMessage {
  return (
    msg.kind === "user" ||
    msg.kind === "assistant" ||
    (!msg.kind && (msg.role === "user" || msg.role === "agent"))
  );
}

interface LocalCommands {
  isLocal: (text: string) => boolean;
  executeLocal: (text: string) => Promise<boolean>;
}

interface UseChatActionsArgs {
  profile?: string;
  hermesSessionId: string | null;
  messages: ChatMessage[];
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  onSessionStarted?: () => void;
  chatInputRef: React.RefObject<ChatInputHandle | null>;
  localCommands: LocalCommands;
  /** Working folder bound to this conversation (issue #27), or null. */
  contextFolder: string | null;
  /** Called when a `/compact` turn is sent, so the host can seed a fresh
   *  session with the resulting handoff brief once the turn completes. */
  onCompactRequested?: () => void;
  selectedModels: Array<{
    provider: string;
    model: string;
    baseUrl: string;
    label: string;
  }>;
}

interface UseChatActionsResult {
  handleSend: (
    text: string,
    attachments?: Attachment[],
    skipLoadingCheck?: boolean,
  ) => Promise<void>;
  handleQuickAsk: (text: string, attachments?: Attachment[]) => Promise<void>;
  handleAbort: () => void;
  handleApprove: () => void;
  handleDeny: () => void;
}

/**
 * Encapsulates the chat's user-facing actions (send, quick-ask, abort,
 * approve, deny). All returned callbacks have stable identities so that
 * memoized children don't re-render on every streaming chunk — `messages`
 * and `isLoading` are read via live refs that update via `useEffect`.
 */
export function useChatActions({
  profile,
  hermesSessionId,
  messages,
  isLoading,
  setIsLoading,
  setMessages,
  onSessionStarted,
  chatInputRef,
  localCommands,
  contextFolder,
  onCompactRequested,
  selectedModels,
}: UseChatActionsArgs): UseChatActionsResult {
  const messagesRef = useRef(messages);
  const isLoadingRef = useRef(isLoading);
  const selectedModelsRef = useRef(selectedModels);
  useEffect(() => {
    messagesRef.current = messages;
    isLoadingRef.current = isLoading;
    selectedModelsRef.current = selectedModels;
  });

  const pushUser = useCallback(
    (content: string, idPrefix = "user", attachments?: Attachment[]) => {
      setMessages((prev) => [
        ...prev,
        {
          id: `${idPrefix}-${Date.now()}`,
          role: "user",
          content,
          ...(attachments && attachments.length > 0 ? { attachments } : {}),
        },
      ]);
    },
    [setMessages],
  );

  const sendToAgent = useCallback(
    async (
      text: string,
      attachments?: Attachment[],
      modelOverride?: { model?: string; provider?: string; baseUrl?: string },
      runId?: string,
    ): Promise<void> => {
      try {
        await window.hermesAPI.sendMessage(
          text,
          profile,
          hermesSessionId || undefined,
          messagesRef.current.filter(hasContent).map((m) => ({
            role: m.role,
            content: m.content,
          })),
          attachments,
          contextFolder ?? undefined,
          getGroundInWorkspace(),
          runId,
          modelOverride,
        );
      } catch {
        // onChatError IPC already surfaces this to the user
      }
    },
    [profile, hermesSessionId, contextFolder],
  );

  const handleSend = useCallback(
    async (
      text: string,
      attachments?: Attachment[],
      skipLoadingCheck = false,
    ): Promise<void> => {
      const hasPayload = text.length > 0 || (attachments?.length ?? 0) > 0;
      if (!hasPayload) return;
      if (!skipLoadingCheck && isLoadingRef.current) return;

      // /compact [focus] — rewrite into an explicit handoff-brief instruction
      // (doc ch.6.2/15.2) and send it to the agent with the full conversation
      // in context, so the brief is produced regardless of backend support.
      if (text.trim().toLowerCase().split(/\s+/)[0] === "/compact") {
        const focus = text.trim().slice("/compact".length).trim();
        onCompactRequested?.();
        setIsLoading(true);
        pushUser(text);
        onSessionStarted?.();
        await sendToAgent(buildHandoffPrompt(focus));
        return;
      }

      if (text && localCommands.isLocal(text)) {
        const cmd = text.split(/\s+/)[0].toLowerCase();
        if (cmd !== "/new" && cmd !== "/clear") pushUser(text);
        await localCommands.executeLocal(text);
        return;
      }

      setIsLoading(true);
      pushUser(text, "user", attachments);
      onSessionStarted?.();

      const activeModels = selectedModelsRef.current;
      if (activeModels.length > 1) {
        // Council Mode: Query multiple models in parallel
        const turnId = `council-turn-${Date.now()}`;
        const responses = activeModels.reduce(
          (acc, m) => {
            const modelKey = `${m.provider}:${m.model}`;
            acc[modelKey] = {
              modelLabel: m.label,
              provider: m.provider,
              model: m.model,
              content: "",
              isLoading: true,
            };
            return acc;
          },
          {} as CouncilTurnMessage["responses"],
        );

        setMessages((prev) => [
          ...prev,
          {
            id: turnId,
            kind: "council_turn",
            role: "agent",
            responses,
          },
        ]);

        try {
          await Promise.all(
            activeModels.map((m) => {
              const modelKey = `${m.provider}:${m.model}`;
              const runId = `${turnId}::${modelKey}`;
              return sendToAgent(
                text,
                attachments,
                { model: m.model, provider: m.provider, baseUrl: m.baseUrl },
                runId,
              );
            }),
          );
        } catch {
          // A synchronous send failure would otherwise strand isLoading=true
          // (the per-stream onChatError IPC never fires). Reset so the input
          // isn't frozen.
          setIsLoading(false);
        }
      } else {
        // Standard Single-Model Mode with override
        const primaryModel = activeModels[0];
        const override = primaryModel
          ? {
              model: primaryModel.model,
              provider: primaryModel.provider,
              baseUrl: primaryModel.baseUrl,
            }
          : undefined;
        await sendToAgent(text, attachments, override);
      }
    },
    [
      localCommands,
      pushUser,
      onSessionStarted,
      sendToAgent,
      setIsLoading,
      onCompactRequested,
    ],
  );

  const handleQuickAsk = useCallback(
    async (text: string, attachments?: Attachment[]): Promise<void> => {
      if (!text || isLoadingRef.current) return;
      setIsLoading(true);
      pushUser(`💭 ${text}`, "user-btw", attachments);
      const activeModels = selectedModelsRef.current;
      const primaryModel = activeModels[0];
      const override = primaryModel
        ? {
            model: primaryModel.model,
            provider: primaryModel.provider,
            baseUrl: primaryModel.baseUrl,
          }
        : undefined;
      await sendToAgent(`/btw ${text}`, attachments, override);
    },
    [pushUser, sendToAgent, setIsLoading],
  );

  const handleAbort = useCallback(() => {
    window.hermesAPI.abortChat();
    setIsLoading(false);
    setTimeout(() => chatInputRef.current?.focus(), 50);
  }, [chatInputRef, setIsLoading]);

  const handleApprove = useCallback(() => {
    chatInputRef.current?.clear();
    setIsLoading(true);
    pushUser("/approve", "user-approve");
    sendToAgent("/approve").catch(() => setIsLoading(false));
  }, [chatInputRef, pushUser, sendToAgent, setIsLoading]);

  const handleDeny = useCallback(() => {
    chatInputRef.current?.clear();
    setIsLoading(true);
    pushUser("/deny", "user-deny");
    sendToAgent("/deny").catch(() => setIsLoading(false));
  }, [chatInputRef, pushUser, sendToAgent, setIsLoading]);

  return { handleSend, handleQuickAsk, handleAbort, handleApprove, handleDeny };
}
