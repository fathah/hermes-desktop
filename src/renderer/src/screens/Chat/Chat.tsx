import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatInput, type ChatInputHandle } from "./ChatInput";
import { ChatHeader } from "./ChatHeader";
import { useChatSignals } from "./useChatSignals";
import { ApprovalQueue } from "./ApprovalQueue";
import { DelegationTree } from "./DelegationTree";
import { listCommand } from "../../../../shared/checkpoints";
import { ChatEmptyState } from "./ChatEmptyState";
import { MessageList } from "./MessageList";
import { ModelPicker } from "./ModelPicker";
import { WorktreePanel } from "./WorktreePanel";
import { PreviewPanel } from "./PreviewPanel";
import { selectPreviewItem } from "./previewSelect";
import { useChatScroll } from "./hooks/useChatScroll";
import { useChatIPC } from "./hooks/useChatIPC";
import { useChatActions } from "./hooks/useChatActions";
import { useModelConfig } from "./hooks/useModelConfig";
import { useFastMode } from "./hooks/useFastMode";
import { useLocalCommands } from "./hooks/useLocalCommands";
import { useI18n } from "../../components/useI18n";
import { buildChatTranscript } from "./transcriptUtils";
import { ConfigHealthBanner } from "../../components/ConfigHealthBanner";
import { getDevMode, DEV_MODE_EVENT } from "../../lib/devMode";
import type { Attachment } from "../../../../shared/attachments";
import type { ChatMessage, UsageState } from "./types";

interface QueuedMessage {
  text: string;
  attachments: Attachment[];
}

export type { ChatMessage } from "./types";

interface ChatProps {
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  sessionId: string | null;
  profile?: string;
  onSessionStarted?: () => void;
  onNewChat?: () => void;
  contextFolderOverride?: string | null;
  compact?: boolean;
  /** Optional text to pre-fill into the composer once on mount (used by the
   *  SPS "guided chat" entry points: New chat, meeting/calendar cards). */
  initialInput?: string;
  /** Optional callback to navigate to Settings → Diagnose section
   *  when the user clicks "Show details" in the config-health banner. */
  onOpenDiagnose?: () => void;
}

function Chat({
  messages,
  setMessages,
  sessionId,
  profile,
  onSessionStarted,
  onNewChat,
  contextFolderOverride,
  compact,
  initialInput,
  onOpenDiagnose,
}: ChatProps): React.JSX.Element {
  const { t } = useI18n();
  const [isLoading, setIsLoading] = useState(false);
  const [hermesSessionId, setHermesSessionId] = useState<string | null>(null);
  const [toolProgress, setToolProgress] = useState<string | null>(null);
  // Gateway approval (B1) + delegation (B3) signals, forward-compatible.
  const { approvals, respond, delegationTree, approvalTimeout, now } =
    useChatSignals(profile);
  const [usage, setUsage] = useState<UsageState | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [remoteMode, setRemoteMode] = useState(false);
  // Working folder bound to this conversation (issue #27). Per-conversation,
  // held in memory; reset on session switch / new chat below.
  const [contextFolder, setContextFolder] = useState<string | null>(null);
  // Whether the worktree panel is visible (only applies when contextFolder is set)
  const [worktreeVisible, setWorktreeVisible] = useState<boolean>(true);
  // Developer mode (off by default) gates the niche power-user controls — the
  // worktree panel + filesystem checkpoints. Reacts live to the Settings toggle.
  const [devMode, setDevMode] = useState(getDevMode());
  useEffect(() => {
    const onChange = (): void => setDevMode(getDevMode());
    window.addEventListener(DEV_MODE_EVENT, onChange);
    return () => window.removeEventListener(DEV_MODE_EVENT, onChange);
  }, []);
  // Preview pane (WS2): the most recent visual tool output (screenshot / HTML
  // doc), and whether the pane is shown. Auto-opens once per conversation the
  // first time something previewable appears; reset on session switch below.
  const previewItem = useMemo(() => selectPreviewItem(messages), [messages]);
  const [previewVisible, setPreviewVisible] = useState<boolean>(false);
  const previewAutoOpenedRef = useRef(false);
  const dragCounter = useRef(0);
  const chatInputRef = useRef<ChatInputHandle>(null);
  const queueRef = useRef<QueuedMessage[]>([]);
  const [queuedCount, setQueuedCount] = useState(0);

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
  const [selectedModels, setSelectedModels] = useState<
    Array<{ provider: string; model: string; baseUrl: string; label: string }>
  >([]);

  // Sync selectedModels with modelConfig on load/change
  useEffect(() => {
    if (modelConfig.currentModel) {
      setSelectedModels([
        {
          provider: modelConfig.currentProvider,
          model: modelConfig.currentModel,
          baseUrl: modelConfig.currentBaseUrl,
          label: modelConfig.displayModel,
        },
      ]);
    }
  }, [
    modelConfig.currentModel,
    modelConfig.currentProvider,
    modelConfig.currentBaseUrl,
    modelConfig.displayModel,
  ]);

  const handleSelectModel = useCallback(
    async (provider: string, model: string, baseUrl: string) => {
      let label = model.split("/").pop() || model;
      for (const group of modelConfig.modelGroups) {
        const found = group.models.find(
          (m) => m.model === model && m.provider === provider,
        );
        if (found) {
          label = found.label;
          break;
        }
      }
      await modelConfig.selectModel(provider, model, baseUrl);
      setSelectedModels([{ provider, model, baseUrl, label }]);
    },
    [modelConfig],
  );

  const handleToggleCouncilModel = useCallback(
    (provider: string, model: string, baseUrl: string, label: string) => {
      setSelectedModels((prev) => {
        const exists = prev.some(
          (m) => m.model === model && m.provider === provider,
        );
        if (exists) {
          if (prev.length <= 1) return prev;
          return prev.filter(
            (m) => !(m.model === model && m.provider === provider),
          );
        } else {
          return [...prev, { provider, model, baseUrl, label }];
        }
      });
    },
    [],
  );

  const {
    fastMode,
    toggle: toggleFastMode,
    set: setFastTier,
  } = useFastMode(profile);

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
      setHermesSessionId(null);
      setContextFolder(null);
      queueRef.current = [];
      setQueuedCount(0);
      setPreviewVisible(false);
      previewAutoOpenedRef.current = false;
    }
  }, [messages]);

  // Auto-open the preview pane once per conversation, the first time a
  // previewable tool output appears. After that, visibility is user-driven
  // (the header toggle) — we never re-open it on subsequent outputs.
  useEffect(() => {
    if (previewItem && !previewAutoOpenedRef.current) {
      previewAutoOpenedRef.current = true;
      setPreviewVisible(true);
    }
  }, [previewItem]);

  // When the parent swaps to a different session, sync local state to it:
  // the gateway session id (a stale one resumes/deletes the WRONG session —
  // issue #276) and the per-conversation context folder (issue #27). Chat is
  // not remounted on session switch, so this must be done explicitly.
  useEffect(() => {
    setHermesSessionId(sessionId);
    setContextFolder(null);
    queueRef.current = [];
    setQueuedCount(0);
    setPreviewVisible(false);
    previewAutoOpenedRef.current = false;
  }, [sessionId]);

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

  // "Copy entire chat" context-menu items (issue #298) — serialise the whole
  // conversation in the requested format and copy it. A ref keeps the latest
  // messages without re-registering the IPC listener on every chunk.
  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  });
  useEffect(() => {
    return window.hermesAPI.onContextMenuCopyChat((format) => {
      const msgs = messagesRef.current;
      if (msgs.length === 0) return;
      void window.hermesAPI.copyToClipboard(buildChatTranscript(msgs, format));
    });
  }, []);

  // "Select All" on a message (issue #298): the native selectAll role would
  // select the entire window, so scope it to the .chat-bubble under the
  // cursor — the user can then Copy that message.
  useEffect(() => {
    return window.hermesAPI.onContextMenuSelectBubble(({ x, y }) => {
      const bubble = document.elementFromPoint(x, y)?.closest(".chat-bubble");
      if (!bubble) return;
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.selectAllChildren(bubble);
    });
  }, []);

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
    setContextFolder(null);
    setUsage(null);
    setToolProgress(null);
    queueRef.current = [];
    setQueuedCount(0);
  }, [isLoading, hermesSessionId, sessionId, setMessages]);

  const localCommands = useLocalCommands({
    profile,
    usage,
    setFastMode: setFastTier,
    onNewChat,
    onClear: handleClear,
    addAgentMessage,
  });
  const effectiveContextFolder = contextFolderOverride ?? contextFolder;

  // `/compact` handoff: when a compact turn is in flight, this flag tells the
  // completion effect below to seed a fresh session with the produced brief.
  const compactPendingRef = useRef(false);
  const markCompactPending = useCallback(() => {
    compactPendingRef.current = true;
  }, []);

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
    contextFolder: effectiveContextFolder,
    onCompactRequested: markCompactPending,
    selectedModels,
  });

  // When the `/compact` turn finishes, carry its handoff brief into a fresh
  // session: start a new chat and pre-fill the composer with the brief, so the
  // user reviews it and sends to continue with a clean context (doc ch.15.2).
  const prevLoadingRef = useRef(false);
  useEffect(() => {
    const was = prevLoadingRef.current;
    prevLoadingRef.current = isLoading;
    if (!was || isLoading || !compactPendingRef.current) return;
    compactPendingRef.current = false;
    const brief = [...messages].reverse().find((m) => {
      if (!("content" in m) || typeof m.content !== "string") return false;
      if (m.content.trim().length <= 40) return false;
      const kind = "kind" in m ? m.kind : undefined;
      if (kind === "assistant") return true;
      const role = "role" in m ? (m as { role?: string }).role : undefined;
      return !kind && role === "agent";
    });
    const text =
      brief && "content" in brief && typeof brief.content === "string"
        ? brief.content
        : "";
    if (!text) return;
    onNewChat?.();
    const seed = `Context carried over from my previous session — continue from here:\n\n${text}`;
    window.setTimeout(() => chatInputRef.current?.setText(seed), 80);
  }, [isLoading, messages, onNewChat]);

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
    setQueuedCount(queueRef.current.length);
    handleSendRef.current(next.text, next.attachments, true).catch(() => {
      // Put the message back at the front so it isn't silently lost if
      // the send fails (e.g. IPC error before onChatError fires).
      queueRef.current.unshift(next);
      setQueuedCount(queueRef.current.length);
    });
  }, [isLoading]);

  const handleSubmitOrQueue = useCallback(
    (text: string, attachments: Attachment[]) => {
      if (isLoading) {
        queueRef.current.push({ text, attachments });
        setQueuedCount(queueRef.current.length);
        return;
      }
      void handleSendRef.current(text, attachments);
    },
    [isLoading],
  );

  const handleSuggestion = useCallback((text: string) => {
    chatInputRef.current?.setText(text);
  }, []);

  // Pre-fill the composer once from an external "guided chat" entry point.
  const didPrefill = useRef(false);
  useEffect(() => {
    if (didPrefill.current) return;
    if (!initialInput) return;
    didPrefill.current = true;
    chatInputRef.current?.setText(initialInput);
    chatInputRef.current?.focus();
  }, [initialInput]);

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

  const handleAdoptResponse = useCallback(
    async (
      messageId: string | number,
      councilGroupId: string,
      responseContent: string,
      model: string,
      provider: string,
    ) => {
      const activeSessionId = hermesSessionId ?? sessionId;
      if (!activeSessionId) return;

      // Replace the council turn with the adopted single assistant message
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id === councilGroupId) {
            return {
              id: typeof messageId === "string" ? messageId : `db-${messageId}`,
              role: "agent",
              content: responseContent,
              model,
              provider,
            };
          }
          return m;
        }),
      );

      let dbId: number | null = null;
      if (typeof messageId === "number") {
        dbId = messageId;
      } else if (typeof messageId === "string" && messageId.startsWith("db-")) {
        dbId = parseInt(messageId.replace("db-", ""), 10);
      }

      if (dbId !== null && !isNaN(dbId)) {
        try {
          await window.hermesAPI.adoptCouncilResponse(
            dbId,
            activeSessionId,
            councilGroupId,
          );
        } catch (err) {
          console.error("Failed to adopt response on DB:", err);
        }
      }
    },
    [hermesSessionId, sessionId, setMessages],
  );

  const handleSteelmanCritique = useCallback(
    async (
      responses: Array<{ model: string; provider: string; content: string }>,
    ) => {
      const responsesText = responses
        .map((r) => `[${r.model}]:\n${r.content}`)
        .join("\n\n---\n\n");

      const promptText =
        `You are the Council Moderator. Below are the responses from the Council of LLMs (different models) to my original query. ` +
        `Please synthesize them into a single, cohesive response that steelmans my original thought, reconciles the best parts of each answer, and critiques any weaknesses or blind spots:\n\n${responsesText}`;

      // Reset selection back to standard single model before sending critique
      if (selectedModels.length > 1) {
        setSelectedModels([selectedModels[0]]);
      }

      void actions.handleSend(promptText);
    },
    [actions, selectedModels],
  );

  return (
    <div
      className={`chat-container${compact ? " chat-container-compact" : ""}`}
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
        contextFolder={effectiveContextFolder}
        showContextFolder={!remoteMode && !contextFolderOverride}
        worktreeVisible={worktreeVisible}
        devMode={devMode}
        previewAvailable={!!previewItem}
        previewVisible={previewVisible}
        onPickFolder={handlePickFolder}
        onClearFolder={handleClearFolder}
        onToggleFast={toggleFastMode}
        onToggleWorktree={() => setWorktreeVisible((v) => !v)}
        onTogglePreview={() => setPreviewVisible((v) => !v)}
        onNewChat={onNewChat}
        onClear={handleClear}
        model={modelConfig.currentModel}
        onCompress={() => {
          void actions.handleSend("/compress", []);
        }}
        onCheckpoints={
          devMode
            ? () => {
                void actions.handleSend(listCommand(), []);
              }
            : undefined
        }
      />

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
              profile={profile}
              onApprove={actions.handleApprove}
              onDeny={actions.handleDeny}
              onAdoptResponse={handleAdoptResponse}
              onSteelmanCritique={handleSteelmanCritique}
            />
          )}
          <DelegationTree tree={delegationTree} />
          <ApprovalQueue
            state={approvals}
            onRespond={respond}
            timeoutSeconds={approvalTimeout}
            now={now}
          />
          <div ref={bottomRef} />
        </div>

        {devMode &&
          effectiveContextFolder &&
          worktreeVisible &&
          !contextFolderOverride && (
            <WorktreePanel folderPath={effectiveContextFolder} />
          )}

        {previewItem && previewVisible && (
          <PreviewPanel
            item={previewItem}
            toolProgress={toolProgress}
            onClose={() => setPreviewVisible(false)}
          />
        )}
      </div>

      {queuedCount > 0 && (
        <div className="chat-queue-indicator">
          {t("chat.queued", { count: queuedCount })}
        </div>
      )}
      <div className="chat-input-area">
        <ChatInput
          ref={chatInputRef}
          isLoading={isLoading}
          hasSession={!!hermesSessionId}
          sessionId={hermesSessionId}
          profile={profile}
          remoteMode={remoteMode}
          readiness={readiness}
          onSubmit={handleSubmitOrQueue}
          onQuickAsk={actions.handleQuickAsk}
          onAbort={actions.handleAbort}
        />
        <ModelPicker
          currentModel={modelConfig.currentModel}
          currentProvider={modelConfig.currentProvider}
          currentBaseUrl={modelConfig.currentBaseUrl}
          modelGroups={modelConfig.modelGroups}
          displayModel={modelConfig.displayModel}
          onOpen={modelConfig.reload}
          onSelectModel={handleSelectModel}
          selectedModels={selectedModels}
          onToggleCouncilModel={handleToggleCouncilModel}
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
