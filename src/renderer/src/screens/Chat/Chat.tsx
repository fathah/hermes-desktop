import { useCallback, useEffect, useRef, useState } from "react";
import { Zap } from "lucide-react";
import { ChatInput, type ChatInputHandle } from "./ChatInput";
import { ChatEmptyState } from "./ChatEmptyState";
import { MessageList } from "./MessageList";
import { ModelPicker } from "./ModelPicker";
import { ReasoningEffortPicker } from "./ReasoningEffortPicker";
import { ContextFolderChip } from "./ContextFolderChip";
import { WorktreePanel } from "./WorktreePanel";
import { useChatScroll } from "./hooks/useChatScroll";
import { useChatIPC } from "./hooks/useChatIPC";
import { useChatActions } from "./hooks/useChatActions";
import { useModelConfig } from "./hooks/useModelConfig";
import { useFastMode } from "./hooks/useFastMode";
import { useReasoningEffort } from "./hooks/useReasoningEffort";
import { useLocalCommands } from "./hooks/useLocalCommands";
import {
  dashboardChatEnabledForConnection,
  useDashboardChatTransport,
} from "./hooks/useDashboardChatTransport";
import { useI18n } from "../../components/useI18n";
import { buildChatTranscript } from "./transcriptUtils";
import { ConfigHealthBanner } from "../../components/ConfigHealthBanner";
import type { Attachment } from "../../../../shared/attachments";
import type { ActiveTurn, ChatMessage, UsageState } from "./types";
import type { ContextUsage } from "./ContextGauge";
import { contextWindowForModel } from "./contextWindows";
import { QueuedMessages } from "./QueuedMessages";

interface QueuedMessage {
  text: string;
  attachments: Attachment[];
}

export type { ChatMessage } from "./types";

interface ChatProps {
  /** Stable id for this conversation/run. One <Chat> is mounted per run; all
   *  remain mounted (background sessions) and only the active one is shown. */
  runId: string;
  /** Seed transcript when re-opening a session from history; empty for new chats. */
  initialMessages?: ChatMessage[];
  /** Gateway session id when resuming a known session; null for a new chat. */
  initialSessionId?: string | null;
  /** Whether this run is the one currently shown (drives keyboard handlers). */
  active?: boolean;
  profile?: string;
  onSessionStarted?: () => void;
  onNewChat?: () => void;
  /** Optional callback to navigate to Settings → Diagnose section
   *  when the user clicks "Show details" in the config-health banner. */
  onOpenDiagnose?: () => void;
  /** Reports the agent generating state so the sidebar / active-sessions bar
   *  can show a spinner on each running session. */
  onLoadingChange?: (runId: string, loading: boolean) => void;
  /** Reports the gateway session id once known, so the parent can map
   *  runId ↔ sessionId (live re-attach, spinners, titles). */
  onSessionIdChange?: (runId: string, sessionId: string | null) => void;
  /** Reports the first user message as a best-effort conversation title. */
  onTitleChange?: (runId: string, title: string) => void;
}

function Chat({
  runId,
  initialMessages,
  initialSessionId,
  active = true,
  profile,
  onSessionStarted,
  onNewChat,
  onOpenDiagnose,
  onLoadingChange,
  onSessionIdChange,
  onTitleChange,
}: ChatProps): React.JSX.Element {
  const { t } = useI18n();
  const [messages, setMessages] = useState<ChatMessage[]>(
    initialMessages ?? [],
  );
  const [isLoading, setIsLoading] = useState(false);
  useEffect(() => {
    onLoadingChange?.(runId, isLoading);
  }, [runId, isLoading, onLoadingChange]);
  const [hermesSessionId, setHermesSessionId] = useState<string | null>(
    initialSessionId ?? null,
  );
  // Surface the gateway session id upward whenever it resolves/changes.
  useEffect(() => {
    onSessionIdChange?.(runId, hermesSessionId);
  }, [runId, hermesSessionId, onSessionIdChange]);
  // Best-effort title from the first user bubble (for the active-sessions bar).
  const reportedTitleRef = useRef(false);
  useEffect(() => {
    if (reportedTitleRef.current) return;
    const firstUser = messages.find(
      (m) => m.role === "user" && "content" in m && m.content.trim(),
    );
    if (firstUser && "content" in firstUser) {
      reportedTitleRef.current = true;
      onTitleChange?.(runId, firstUser.content.slice(0, 60));
    }
  }, [runId, messages, onTitleChange]);
  const [toolProgress, setToolProgress] = useState<string | null>(null);
  const [usage, setUsage] = useState<UsageState | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [remoteMode, setRemoteMode] = useState(false);
  const [connectionMode, setConnectionMode] = useState<
    "local" | "remote" | "ssh"
  >("local");
  const [chatTransportPreference, setChatTransportPreference] = useState<
    "auto" | "dashboard" | "legacy"
  >("auto");
  const [connectionModeLoaded, setConnectionModeLoaded] = useState(false);
  // Working folder bound to this conversation (issue #27). Per-conversation,
  // held in memory; reset on session switch / new chat below.
  const [contextFolder, setContextFolder] = useState<string | null>(null);
  // Whether the worktree panel is visible (only applies when contextFolder is set)
  // Default false so the panel doesn't open automatically and interfere with scrolling
  const [worktreeVisible, setWorktreeVisible] = useState<boolean>(false);
  const dragCounter = useRef(0);
  const chatInputRef = useRef<ChatInputHandle>(null);
  const queueRef = useRef<QueuedMessage[]>([]);
  const [queuedMessages, setQueuedMessages] = useState<QueuedMessage[]>([]);
  const activeTurnRef = useRef<ActiveTurn | null>(null);
  const dashboardChatEnabled = dashboardChatEnabledForConnection(
    import.meta.env.VITE_HERMES_DESKTOP_DASHBOARD_CHAT,
    connectionModeLoaded,
    connectionMode,
    chatTransportPreference,
  );

  useEffect(() => {
    let cancelled = false;
    const loadConnectionConfig = async (): Promise<void> => {
      try {
        const conn = await window.hermesAPI.getConnectionConfig();
        if (!cancelled) {
          setConnectionMode(conn.mode);
          setRemoteMode(conn.mode !== "local");
          setChatTransportPreference(
            conn.mode === "local"
              ? "auto"
              : conn.mode === "ssh"
              ? conn.sshChatTransport ?? "auto"
              : conn.remoteChatTransport ?? "auto",
          );
        }
      } catch {
        if (!cancelled) {
          setConnectionMode("ssh");
          setRemoteMode(true);
          setChatTransportPreference("legacy");
        }
      } finally {
        if (!cancelled) setConnectionModeLoaded(true);
      }
    };
    void loadConnectionConfig();
    const unsubscribe = window.hermesAPI.onConnectionConfigChanged((conn) => {
      setConnectionModeLoaded(true);
      setConnectionMode(conn.mode);
      setRemoteMode(conn.mode !== "local");
      setChatTransportPreference(
        conn.mode === "local"
          ? "auto"
          : conn.mode === "ssh"
          ? conn.sshChatTransport ?? "auto"
          : conn.remoteChatTransport ?? "auto",
      );
    });
    return (): void => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const { containerRef, bottomRef } = useChatScroll(messages);
  const modelConfig = useModelConfig(profile);
  const {
    fastMode,
    toggle: toggleFastMode,
    set: setFastTier,
  } = useFastMode(profile);
  const { reasoningEffort, setReasoningEffort } = useReasoningEffort(profile);

  // Pre-send readiness — fail-open check that disables Send + shows
  // an inline banner when the desktop can predict that the gateway
  // will reject the request (e.g. provider configured but its API
  // key is missing from .env). Re-runs on profile/model/baseUrl
  // change so the banner reflects the current state.
  const [readiness, setReadiness] = useState<{
    ok: boolean;
    code?: string;
    message?: string;
    fixLocation?: string;
    expectedEnvKey?: string;
  }>({ ok: true });
  useEffect(() => {
    let cancelled = false;
    (async (): Promise<void> => {
      try {
        const r = await window.hermesAPI.validateChatReadiness(profile);
        if (!cancelled) setReadiness(r);
      } catch {
        // Fail open on IPC error — never block Send on validation failure
        if (!cancelled) setReadiness({ ok: true });
      }
    })();
    return (): void => {
      cancelled = true;
    };
  }, [
    profile,
    modelConfig.currentModel,
    modelConfig.currentProvider,
    modelConfig.currentBaseUrl,
  ]);

  // Authoritative context-window size for the active model, resolved from the
  // provider's /models catalogue (issue #597). Null until/unless the provider
  // advertises it — the gauge then falls back to the static heuristic.
  const [realContextWindow, setRealContextWindow] = useState<number | null>(
    null,
  );
  useEffect(() => {
    let cancelled = false;
    setRealContextWindow(null);
    if (!modelConfig.currentModel) return;
    window.hermesAPI
      .getModelContextWindow(
        modelConfig.currentProvider,
        modelConfig.currentModel,
        modelConfig.currentBaseUrl,
        profile,
      )
      .then((w) => {
        if (!cancelled && typeof w === "number" && w > 0) {
          setRealContextWindow(w);
        }
      })
      .catch(() => {
        /* fall back to heuristic */
      });
    return (): void => {
      cancelled = true;
    };
  }, [
    profile,
    modelConfig.currentModel,
    modelConfig.currentProvider,
    modelConfig.currentBaseUrl,
  ]);

  const visibleSessionScopeId =
    messages.length === 0 ? null : hermesSessionId;

  useChatIPC({
    runId,
    sessionScopeId: visibleSessionScopeId,
    setMessages,
    setHermesSessionId,
    setToolProgress,
    setIsLoading,
    setUsage,
    activeTurnRef,
  });

  // No parent-driven reset effects: each run is its own <Chat key={runId}>
  // instance. A new chat is a fresh mount, and switching sessions just flips
  // which mounted instance is shown — local state (session id, context folder,
  // queue) belongs to this run and persists while it streams in the background.

  // Cmd/Ctrl+N → new chat. Only the active (visible) run handles it; otherwise
  // every mounted background Chat would fire onNewChat in parallel.
  useEffect(() => {
    if (!active) return;
    function onKey(e: KeyboardEvent): void {
      if ((e.metaKey || e.ctrlKey) && e.key === "n") {
        e.preventDefault();
        onNewChat?.();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, onNewChat]);

  // "Copy entire chat" context-menu items (issue #298) — serialise the whole
  // conversation in the requested format and copy it. A ref keeps the latest
  // messages without re-registering the IPC listener on every chunk.
  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  });
  useEffect(() => {
    if (!active) return;
    return window.hermesAPI.onContextMenuCopyChat((format) => {
      const msgs = messagesRef.current;
      if (msgs.length === 0) return;
      void window.hermesAPI.copyToClipboard(buildChatTranscript(msgs, format));
    });
  }, [active]);

  // "Select All" on a message (issue #298): the native selectAll role would
  // select the entire window, so scope it to the .chat-bubble under the
  // cursor — the user can then Copy that message.
  useEffect(() => {
    if (!active) return;
    return window.hermesAPI.onContextMenuSelectBubble(({ x, y }) => {
      const bubble = document.elementFromPoint(x, y)?.closest(".chat-bubble");
      if (!bubble) return;
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.selectAllChildren(bubble);
    });
  }, [active]);

  // Restrict the native context menu to chat bubbles and editable fields
  // so it doesn't appear on random UI chrome (sessions list, settings, etc.).
  useEffect(() => {
    if (!active) return;
    const onContextMenu = (e: MouseEvent): void => {
      const target = e.target as Element | null;
      const inBubble = target?.closest(".chat-bubble") != null;
      const inEditable =
        target?.closest("input, textarea, [contenteditable='true']") != null;
      if (!inBubble && !inEditable) {
        e.preventDefault();
      }
    };
    document.addEventListener("contextmenu", onContextMenu);
    return () => document.removeEventListener("contextmenu", onContextMenu);
  }, [active]);

  const addAgentMessage = useCallback(
    (content: string) => {
      setMessages((prev) => [
        ...prev,
        { id: `agent-local-${Date.now()}`, role: "agent", content },
      ]);
    },
    [setMessages],
  );

  // Flip an inline clarify card to its resolved (read-only) state once the user
  // has answered or skipped. The gateway resumes the turn from here, so loading
  // stays active until the next onChatDone.
  const handleClarifyResolved = useCallback(
    (requestId: string, answer: string) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.kind === "clarify" && m.requestId === requestId
            ? { ...m, answer, resolved: true }
            : m,
        ),
      );
    },
    [setMessages],
  );

  const handleClear = useCallback(() => {
    if (isLoading) {
      window.hermesAPI.abortChat(runId);
      setIsLoading(false);
    }
    const idToDelete = hermesSessionId;
    if (idToDelete) {
      void window.hermesAPI.deleteSession(idToDelete);
      void window.hermesAPI.clearStagedAttachments(idToDelete);
    }
    setMessages([]);
    setHermesSessionId(null);
    setContextFolder(null);
    activeTurnRef.current = null;
    setUsage(null);
    setToolProgress(null);
    queueRef.current = [];
    setQueuedMessages([]);
  }, [isLoading, runId, hermesSessionId, setMessages]);

  const localCommands = useLocalCommands({
    profile,
    usage,
    setFastMode: setFastTier,
    onNewChat,
    onClear: handleClear,
    addAgentMessage,
  });

  const dashboardTransport = useDashboardChatTransport({
    activeTurnRef,
    contextFolder,
    connectionMode,
    enabled: dashboardChatEnabled,
    fallbackOnUnavailable: chatTransportPreference === "auto",
    hermesSessionId,
    messages,
    model: modelConfig.currentModel,
    modelBaseUrl: modelConfig.currentBaseUrl,
    profile,
    provider: modelConfig.currentProvider,
    setHermesSessionId,
    setIsLoading,
    setMessages,
    setToolProgress,
    setUsage,
  });

  const actions = useChatActions({
    runId,
    profile,
    hermesSessionId,
    messages,
    isLoading,
    setIsLoading,
    setMessages,
    onSessionStarted,
    chatInputRef,
    localCommands,
    activeTurnRef,
    contextFolder,
    sendViaDashboard: dashboardTransport.enabled
      ? dashboardTransport.sendMessage
      : undefined,
    abortDashboard: dashboardTransport.enabled
      ? dashboardTransport.abort
      : undefined,
  });

  // Stable ref to handleSend so the drain effect doesn't re-trigger on
  // identity changes (regression #5 from PR #315).
  const handleSendRef = useRef(actions.handleSend);
  useEffect(() => {
    handleSendRef.current = actions.handleSend;
  });

  // Drain queued messages one at a time when the agent finishes.
  useEffect(() => {
    if (isLoading) return;
    const next = queueRef.current.shift();
    if (!next) return;
    setQueuedMessages([...queueRef.current]);
    handleSendRef.current(next.text, next.attachments, true).catch(() => {
      // Put the message back at the front so it isn't silently lost if
      // the send fails (e.g. IPC error before onChatError fires).
      queueRef.current.unshift(next);
      setQueuedMessages([...queueRef.current]);
    });
  }, [isLoading]);

  const handleRemoveQueued = useCallback((index: number) => {
    queueRef.current.splice(index, 1);
    setQueuedMessages([...queueRef.current]);
  }, []);

  const handleSubmitOrQueue = useCallback(
    (text: string, attachments: Attachment[]) => {
      if (isLoading) {
        queueRef.current.push({ text, attachments });
        setQueuedMessages([...queueRef.current]);
        return;
      }
      void handleSendRef.current(text, attachments);
    },
    [isLoading],
  );

  const handleSuggestion = useCallback((text: string) => {
    chatInputRef.current?.setText(text);
  }, []);

  // Regenerate: re-send the last user message to get a new agent response
  const handleRegenerate = useCallback(() => {
    const lastUser = [...messages]
      .reverse()
      .find((m) => m.role === "user") as
      | import("./types").ChatBubbleMessage
      | undefined;
    if (!lastUser?.content) return;
    void handleSendRef.current(lastUser.content, lastUser.attachments || []);
  }, [messages]);

  const handlePickFolder = useCallback(async () => {
    const path = await window.hermesAPI.selectFolder();
    if (path) setContextFolder(path);
  }, []);

  const handleClearFolder = useCallback(() => {
    setContextFolder(null);
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

  // Context-gauge data: the latest turn's prompt tokens vs the model's window.
  const contextUsage: ContextUsage | null = usage?.contextTokens
    ? {
        used: usage.contextTokens,
        window:
          realContextWindow ?? contextWindowForModel(modelConfig.currentModel),
        cacheReadTokens: usage.cacheReadTokens,
        cacheWriteTokens: usage.cacheWriteTokens,
      }
    : null;

  return (
    <div
      className="chat-container"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <ConfigHealthBanner profile={profile} onOpenDiagnose={onOpenDiagnose} />

      <div className="chat-body">
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
              onClarifyResolved={handleClarifyResolved}
              onRegenerate={handleRegenerate}
            />
          )}
          <div ref={bottomRef} />
        </div>

        {contextFolder && worktreeVisible && (
          <WorktreePanel folderPath={contextFolder} />
        )}
      </div>

      <div className="chat-input-area">
        <QueuedMessages
          messages={queuedMessages}
          onRemove={handleRemoveQueued}
        />
        <ChatInput
          ref={chatInputRef}
          isLoading={isLoading}
          hasSession={!!hermesSessionId}
          sessionId={hermesSessionId}
          remoteMode={remoteMode}
          profile={profile}
          contextUsage={contextUsage}
          readiness={readiness}
          onSubmit={handleSubmitOrQueue}
          onQuickAsk={actions.handleQuickAsk}
          onAbort={actions.handleAbort}
          toolbarExtras={
            <>
              <ModelPicker
                currentModel={modelConfig.currentModel}
                currentProvider={modelConfig.currentProvider}
                currentBaseUrl={modelConfig.currentBaseUrl}
                modelGroups={modelConfig.modelGroups}
                displayModel={modelConfig.displayModel}
                onOpen={modelConfig.reload}
                onSelectModel={modelConfig.selectModel}
              />
              <ReasoningEffortPicker
                value={reasoningEffort}
                onChange={setReasoningEffort}
              />
              <div className="chat-fast-wrapper">
                <button
                  type="button"
                  className={`btn-ghost chat-fast-btn ${fastMode ? "chat-fast-active" : ""}`}
                  onClick={toggleFastMode}
                >
                  <Zap size={14} />
                </button>
                <div className="chat-fast-popover">
                  <strong>
                    {fastMode ? t("chat.fastModeOn") : t("chat.fastMode")}
                  </strong>
                  <span>
                    {fastMode
                      ? t("chat.fastModeActive")
                      : t("chat.fastModeInactive")}
                  </span>
                </div>
              </div>
              <ContextFolderChip
                contextFolder={contextFolder}
                show={!remoteMode}
                worktreeVisible={worktreeVisible}
                onPickFolder={handlePickFolder}
                onClearFolder={handleClearFolder}
                onToggleWorktree={() => setWorktreeVisible((v) => !v)}
              />
            </>
          }
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
