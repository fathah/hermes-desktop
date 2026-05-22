import { useCallback, useEffect, useRef, useState } from "react";
import { ChatInput, type ChatInputHandle } from "./ChatInput";
import { ChatHeader } from "./ChatHeader";
import { ChatEmptyState } from "./ChatEmptyState";
import { MessageList } from "./MessageList";
import { ModelPicker } from "./ModelPicker";
import { useChatScroll } from "./hooks/useChatScroll";
import { useChatIPC } from "./hooks/useChatIPC";
import { useChatActions } from "./hooks/useChatActions";
import { useModelConfig } from "./hooks/useModelConfig";
import { useFastMode } from "./hooks/useFastMode";
import { useLocalCommands } from "./hooks/useLocalCommands";
import { useI18n } from "../../components/useI18n";
import type { ChatMessage, UsageState } from "./types";
import type { Attachment } from "../../../../shared/attachments";

export type { ChatMessage } from "./types";

interface QueuedMessage {
  text: string;
  attachments: Attachment[];
}

interface ChatProps {
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  sessionId: string | null;
  profile?: string;
  onSessionStarted?: () => void;
  onNewChat?: () => void;
}

function Chat({
  messages,
  setMessages,
  sessionId,
  profile,
  onSessionStarted,
  onNewChat,
}: ChatProps): React.JSX.Element {
  const { t } = useI18n();
  const [isLoading, setIsLoading] = useState(false);
  const [hermesSessionId, setHermesSessionId] = useState<string | null>(null);
  const [toolProgress, setToolProgress] = useState<string | null>(null);
  const [usage, setUsage] = useState<UsageState | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [remoteMode, setRemoteMode] = useState(false);
  const dragCounter = useRef(0);
  const chatInputRef = useRef<ChatInputHandle>(null);
  // Follow-up messages typed while the agent is busy. They send automatically,
  // one per turn, once the current turn finishes.
  const queueRef = useRef<QueuedMessage[]>([]);
  const [queuedCount, setQueuedCount] = useState(0);

  const handleEnqueue = useCallback(
    (text: string, attachments: Attachment[]) => {
      queueRef.current.push({ text, attachments });
      setQueuedCount(queueRef.current.length);
    },
    [],
  );

  const clearQueue = useCallback(() => {
    queueRef.current = [];
    setQueuedCount(0);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async (): Promise<void> => {
      const flag = await window.hermesAPI.isRemoteMode();
      if (!cancelled) setRemoteMode(flag);
    })();
    return (): void => {
      cancelled = true;
    };
  }, []);

  const { containerRef, bottomRef } = useChatScroll(messages);
  const modelConfig = useModelConfig(profile);
  const {
    fastMode,
    toggle: toggleFastMode,
    set: setFastTier,
  } = useFastMode(profile);

  useChatIPC({
    setMessages,
    setHermesSessionId,
    setToolProgress,
    setIsLoading,
    setUsage,
  });

  // Reset hermes session when the parent clears messages (new chat).
  // Effect-driven sync because `messages` is owned by the parent; a key-based
  // remount would discard unrelated local state (model picker, etc.).
  useEffect(() => {
    if (messages.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHermesSessionId(null);
    }
  }, [messages]);

  // Cmd/Ctrl+N → new chat
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if ((e.metaKey || e.ctrlKey) && e.key === "n") {
        e.preventDefault();
        onNewChat?.();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onNewChat]);

  const addAgentMessage = useCallback(
    (content: string) => {
      setMessages((prev) => [
        ...prev,
        { id: `agent-local-${Date.now()}`, role: "agent", content },
      ]);
    },
    [setMessages],
  );

  const handleClear = useCallback(() => {
    if (isLoading) {
      window.hermesAPI.abortChat();
      setIsLoading(false);
    }
    const idToDelete = hermesSessionId ?? sessionId;
    if (idToDelete) {
      void window.hermesAPI.deleteSession(idToDelete);
      void window.hermesAPI.clearStagedAttachments(idToDelete);
    }
    setMessages([]);
    setHermesSessionId(null);
    setUsage(null);
    setToolProgress(null);
    clearQueue();
  }, [isLoading, hermesSessionId, sessionId, setMessages, clearQueue]);

  const localCommands = useLocalCommands({
    profile,
    usage,
    setFastMode: setFastTier,
    onNewChat,
    onClear: handleClear,
    addAgentMessage,
  });

  const actions = useChatActions({
    profile,
    hermesSessionId,
    messages,
    isLoading,
    setIsLoading,
    setMessages,
    onSessionStarted,
    chatInputRef,
    localCommands,
  });
  const { handleSend } = actions;

  // Drain the follow-up queue: once a turn finishes, send the next queued
  // message as a fresh turn. One item per completion; the chain continues
  // until the queue empties.
  useEffect(() => {
    if (isLoading || queueRef.current.length === 0) return;
    const next = queueRef.current.shift();
    setQueuedCount(queueRef.current.length);
    if (next) void handleSend(next.text, next.attachments);
  }, [isLoading, handleSend]);

  // Stop = stop everything: abort the current turn and drop queued follow-ups.
  function handleAbort(): void {
    clearQueue();
    actions.handleAbort();
  }

  const handleSuggestion = useCallback((text: string) => {
    chatInputRef.current?.setText(text);
  }, []);

  // Drag-and-drop: filter for dragenter events carrying files (suppresses
  // text-drag noise from the textarea autocomplete and other in-app drags).
  const eventHasFiles = useCallback((e: React.DragEvent): boolean => {
    const types = e.dataTransfer?.types;
    if (!types) return false;
    for (let i = 0; i < types.length; i++) {
      if (types[i] === "Files") return true;
    }
    return false;
  }, []);

  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      if (!eventHasFiles(e)) return;
      e.preventDefault();
      dragCounter.current += 1;
      if (dragCounter.current === 1) setDragActive(true);
    },
    [eventHasFiles],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!eventHasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    },
    [eventHasFiles],
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) setDragActive(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      if (!eventHasFiles(e)) return;
      e.preventDefault();
      dragCounter.current = 0;
      setDragActive(false);
      const files = Array.from(e.dataTransfer.files);
      if (files.length === 0) return;
      void chatInputRef.current?.addFiles(files);
    },
    [eventHasFiles],
  );

  return (
    <div
      className="chat-container"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <ChatHeader
        sessionId={sessionId}
        usage={usage}
        fastMode={fastMode}
        hasMessages={messages.length > 0}
        onToggleFast={toggleFastMode}
        onNewChat={onNewChat}
        onClear={handleClear}
      />

      <div className="chat-messages" ref={containerRef}>
        {messages.length === 0 ? (
          <ChatEmptyState onSelectSuggestion={handleSuggestion} />
        ) : (
          <MessageList
            messages={messages}
            isLoading={isLoading}
            toolProgress={toolProgress}
            onApprove={actions.handleApprove}
            onDeny={actions.handleDeny}
          />
        )}
        <div ref={bottomRef} />
      </div>

      <div className="chat-input-area">
        <ChatInput
          ref={chatInputRef}
          isLoading={isLoading}
          hasSession={!!hermesSessionId}
          sessionId={hermesSessionId}
          remoteMode={remoteMode}
          queuedCount={queuedCount}
          onSubmit={actions.handleSend}
          onEnqueue={handleEnqueue}
          onQuickAsk={actions.handleQuickAsk}
          onAbort={handleAbort}
        />
        <ModelPicker
          currentModel={modelConfig.currentModel}
          currentProvider={modelConfig.currentProvider}
          currentBaseUrl={modelConfig.currentBaseUrl}
          modelGroups={modelConfig.modelGroups}
          displayModel={modelConfig.displayModel}
          onOpen={modelConfig.reload}
          onSelectModel={modelConfig.selectModel}
        />
      </div>
      {dragActive && (
        <div className="chat-drop-overlay" aria-hidden>
          <div className="chat-drop-overlay-inner">
            {t("chat.dropToAttach")}
          </div>
        </div>
      )}
    </div>
  );
}

export default Chat;
