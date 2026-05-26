import { useCallback, useEffect, useRef } from "react";
import type { ChatInputHandle } from "../ChatInput";
import type { Attachment, ChatMessage, ChatBubbleMessage } from "../types";

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
}: UseChatActionsArgs): UseChatActionsResult {
  const messagesRef = useRef(messages);
  const isLoadingRef = useRef(isLoading);
  useEffect(() => {
    messagesRef.current = messages;
    isLoadingRef.current = isLoading;
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
    async (text: string, attachments?: Attachment[]): Promise<void> => {
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

      if (text && localCommands.isLocal(text)) {
        const cmd = text.split(/\s+/)[0].toLowerCase();
        if (cmd !== "/new" && cmd !== "/clear") pushUser(text);
        await localCommands.executeLocal(text);
        return;
      }

      setIsLoading(true);
      pushUser(text, "user", attachments);
      onSessionStarted?.();
      await sendToAgent(text, attachments);
    },
    [localCommands, pushUser, onSessionStarted, sendToAgent, setIsLoading],
  );

  const handleQuickAsk = useCallback(
    async (text: string, attachments?: Attachment[]): Promise<void> => {
      if (!text || isLoadingRef.current) return;
      setIsLoading(true);
      pushUser(`💭 ${text}`, "user-btw", attachments);
      await sendToAgent(`/btw ${text}`, attachments);
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
