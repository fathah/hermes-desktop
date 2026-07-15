import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Zap, Globe } from "lucide-react";
import { ChatInput, type ChatInputHandle } from "./ChatInput";
import { ChatEmptyState } from "./ChatEmptyState";
import { MessageList } from "./MessageList";
import { ModelPicker } from "./ModelPicker";
import { ReasoningEffortPicker } from "./ReasoningEffortPicker";
import { ContextFolderChip } from "./ContextFolderChip";
import { WorktreePanel } from "./WorktreePanel";
import { RemoteFolderPicker } from "./RemoteFolderPicker";
import { WebPreviewPanel } from "./WebPreviewPanel";
import { useChatScroll } from "./hooks/useChatScroll";
import { useChatIPC } from "./hooks/useChatIPC";
import { useChatActions, parseBackgroundCommand } from "./hooks/useChatActions";
import {
  useModelConfig,
  effectiveOverrideBaseUrl,
} from "./hooks/useModelConfig";
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
import FollowUsModal from "../../components/FollowUsModal";
import type { Attachment } from "../../../../shared/attachments";
import type { SessionModelOverride } from "../../../../shared/model-override";
import type { ActiveTurn, ChatMessage, UsageState } from "./types";
import type { ContextUsage } from "./ContextGauge";
import { contextWindowForModel } from "./contextWindows";
import { QueuedMessages } from "./QueuedMessages";
import { SLASH_COMMANDS, type SlashCommand } from "./slashCommands";
import { reconcileSlashCatalog } from "./slash/commandCatalog";
import {
  DESKTOP_SLASH_COMMANDS,
  LOCAL_DESKTOP_SLASH_COMMANDS,
} from "./slash/desktopCommands";
import type {
  AgentCommandsCatalogResponse,
  AgentSlashCommand,
} from "./slash/types";

interface QueuedMessage {
  text: string;
  attachments: Attachment[];
}

export type { ChatMessage } from "./types";

// A single shared AudioContext for the "agent finished" chime. Creating a new
// context per turn leaks them — Chromium caps concurrent contexts (~6) and
// never reclaims unclosed ones, after which construction throws and the chime
// silently dies. One lazily-created, reused context avoids the leak entirely.
let finishChimeCtx: AudioContext | null = null;
function playFinishChime(): void {
  try {
    finishChimeCtx ??= new AudioContext();
    const ctx = finishChimeCtx;
    // Autoplay policy may park the context as "suspended"; the user has been
    // interacting with the composer, so resuming is permitted.
    if (ctx.state === "suspended") void ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    // Two quick ascending tones.
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.08);
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.2);
  } catch {
    // AudioContext may be unavailable in some environments — ignore.
  }
}

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
  /** Optional callback to open Settings — from the config-health banner's
   *  "Show details" (no section) or a `/settings <section>` command, which
   *  passes the section name to scroll to. */
  onOpenDiagnose?: (section?: string) => void;
  /** Reports the agent generating state so the sidebar / active-sessions bar
   *  can show a spinner on each running session. */
  onLoadingChange?: (runId: string, loading: boolean) => void;
  /** Reports the gateway session id once known, so the parent can map
   *  runId ↔ sessionId (live re-attach, spinners, titles). */
  onSessionIdChange?: (runId: string, sessionId: string | null) => void;
  /** Reports the first user message as a best-effort conversation title. */
  onTitleChange?: (runId: string, title: string) => void;
  /** Resolved avatar/colour of `profile`, so idle agent avatars in the
   *  transcript show the agent's profile picture instead of the loading gif. */
  agentAppearance?: { color?: string | null; avatar?: string | null };
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
  agentAppearance,
}: ChatProps): React.JSX.Element {
  const { t } = useI18n();
  // Identity + appearance of the agent this conversation is with. Passed to the
  // transcript so idle avatars render the agent's profile picture (the loading
  // gif is only shown while a turn is generating).
  const agentAvatar = useMemo(
    () => ({
      name: profile ?? "default",
      color: agentAppearance?.color,
      avatar: agentAppearance?.avatar,
    }),
    [profile, agentAppearance?.color, agentAppearance?.avatar],
  );
  const [messages, setMessages] = useState<ChatMessage[]>(
    initialMessages ?? [],
  );
  const [isLoading, setIsLoading] = useState(false);
  useEffect(() => {
    onLoadingChange?.(runId, isLoading);
  }, [runId, isLoading, onLoadingChange]);

  // Play a notification sound when the agent finishes responding
  const prevLoadingRef = useRef(isLoading);
  useEffect(() => {
    const wasLoading = prevLoadingRef.current;
    prevLoadingRef.current = isLoading;
    if (!wasLoading || isLoading) return;
    // Agent just finished — play a short notification chime (shared context).
    playFinishChime();
  }, [isLoading]);
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
  // Working folder bound to this conversation (issue #27). Per-conversation;
  // persisted per session so a re-opened conversation restores its folder, and
  // reset on new chat below.
  const [contextFolder, setContextFolder] = useState<string | null>(null);
  // Gate folder persistence until the stored value for a resumed session has
  // been loaded — otherwise the initial null would overwrite the saved folder
  // before the load resolves. A brand-new chat (no initialSessionId) has
  // nothing to load, so it starts unblocked.
  const contextFolderLoadedRef = useRef<boolean>(!initialSessionId);

  // Restore the folder linked to a resumed session (once, on mount).
  useEffect(() => {
    if (!initialSessionId) return;
    let cancelled = false;
    void (async () => {
      try {
        const folder =
          await window.hermesAPI.getSessionContextFolder(initialSessionId);
        if (!cancelled && folder) setContextFolder(folder);
      } catch {
        /* best-effort — a missing folder just leaves the session unlinked */
      } finally {
        if (!cancelled) contextFolderLoadedRef.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialSessionId]);

  // Persist the linked folder for this session whenever it changes, once a
  // gateway session id exists. Gated on the load above so a resumed session's
  // stored folder is never clobbered by the initial null.
  useEffect(() => {
    if (!hermesSessionId || !contextFolderLoadedRef.current) return;
    void window.hermesAPI
      .setSessionContextFolder(hermesSessionId, contextFolder)
      .then(() => {
        window.dispatchEvent(
          new CustomEvent("hermes-session-context-folder-changed", {
            detail: { sessionId: hermesSessionId },
          }),
        );
      })
      .catch(() => {
        /* best-effort sidebar refresh signal */
      });
  }, [hermesSessionId, contextFolder]);
  // Whether the worktree panel is visible (only applies when contextFolder is set)
  // Default false so the panel doesn't open automatically and interfere with scrolling
  const [worktreeVisible, setWorktreeVisible] = useState<boolean>(false);
  const [folderPickerOpen, setFolderPickerOpen] = useState<boolean>(false);
  const [webPreviewVisible, setWebPreviewVisible] = useState<boolean>(false);
  const [webPreviewUrl, setWebPreviewUrl] =
    useState<string>("https://google.com");
  // Explicit session-scoped model override — set only when the user picks
  // from the chat-screen picker (persist:false). Undefined until then so the
  // TUI gateway bypass in sendMessageViaBestApi is not triggered for normal
  // chats where the user never changed the model (issue #688).
  const [sessionModelOverride, setSessionModelOverride] = useState<
    SessionModelOverride | undefined
  >(undefined);
  const sessionModelOverrideLoadedRef = useRef<boolean>(!initialSessionId);
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
        let remoteAuthMode = conn.remoteAuthMode ?? "auto";
        if (conn.mode === "remote" && conn.remoteUrl.trim()) {
          try {
            remoteAuthMode = (
              await window.hermesAPI.probeRemoteAuthMode(conn.remoteUrl)
            ).authMode;
          } catch {
            // Keep stored transport choice when public status is unreachable.
          }
        }
        if (!cancelled) {
          setConnectionMode(conn.mode);
          setRemoteMode(conn.mode !== "local");
          setChatTransportPreference(
            conn.mode === "local"
              ? "auto"
              : conn.mode === "ssh"
                ? (conn.sshChatTransport ?? "auto")
                : remoteAuthMode === "oauth"
                  ? "dashboard"
                  : (conn.remoteChatTransport ?? "auto"),
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
            ? (conn.sshChatTransport ?? "auto")
            : conn.remoteAuthMode === "oauth"
              ? "dashboard"
              : (conn.remoteChatTransport ?? "auto"),
      );
    });
    return (): void => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const { containerRef, bottomRef } = useChatScroll(messages);
  const modelConfig = useModelConfig(profile);
  const chatCurrentModel =
    sessionModelOverride?.model ?? modelConfig.currentModel;
  const chatCurrentProvider =
    sessionModelOverride?.provider ?? modelConfig.currentProvider;
  const chatCurrentBaseUrl =
    sessionModelOverride?.baseUrl ?? modelConfig.currentBaseUrl;
  const chatDisplayModel = sessionModelOverride?.model
    ? sessionModelOverride.model.split("/").pop() || sessionModelOverride.model
    : modelConfig.displayModel;

  // Restore the model/provider linked to a resumed session. The saved value is
  // applied only to this chat's local picker state (`persist:false`) so it never
  // rewrites the global config.yaml default.
  useEffect(() => {
    if (!initialSessionId) return;
    let cancelled = false;
    void (async () => {
      try {
        const override =
          await window.hermesAPI.getSessionModelOverride(initialSessionId);
        if (!cancelled && override) {
          setSessionModelOverride(override);
          await modelConfig.selectModel(
            override.provider,
            override.model,
            override.baseUrl,
            { persist: false },
          );
        }
      } catch {
        /* best-effort — sessions without a saved pick use the global default */
      } finally {
        if (!cancelled) sessionModelOverrideLoadedRef.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialSessionId, modelConfig.selectModel]);

  // Persist the chat-local model/provider once a session exists. This stores
  // only routing identity, never API keys, and is gated so a resumed session's
  // initial undefined state cannot erase its saved model before restore.
  useEffect(() => {
    if (!hermesSessionId || !sessionModelOverrideLoadedRef.current) return;
    void window.hermesAPI.setSessionModelOverride(
      hermesSessionId,
      sessionModelOverride ?? null,
    );
  }, [hermesSessionId, sessionModelOverride]);

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
  }, [profile, chatCurrentModel, chatCurrentProvider, chatCurrentBaseUrl]);

  // Authoritative context-window size for the active model, resolved from the
  // provider's /models catalogue (issue #597). Null until/unless the provider
  // advertises it — the gauge then falls back to the static heuristic.
  const [realContextWindow, setRealContextWindow] = useState<number | null>(
    null,
  );
  useEffect(() => {
    let cancelled = false;
    setRealContextWindow(null);
    if (!chatCurrentModel) return;
    window.hermesAPI
      .getModelContextWindow(
        chatCurrentProvider,
        chatCurrentModel,
        chatCurrentBaseUrl,
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
  }, [profile, chatCurrentModel, chatCurrentProvider, chatCurrentBaseUrl]);

  const visibleSessionScopeId = messages.length === 0 ? null : hermesSessionId;

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

  // Listen for in-app link clicks to load in the split-screen Web Preview panel
  useEffect(() => {
    if (!active) return;
    const handleNavigate = (e: Event): void => {
      const customEvent = e as CustomEvent<string>;
      const url = customEvent.detail;
      if (url) {
        setWebPreviewUrl(url);
        setWebPreviewVisible(true);
      }
    };
    document.addEventListener("web-preview:navigate", handleNavigate);
    return () => {
      document.removeEventListener("web-preview:navigate", handleNavigate);
    };
  }, [active]);

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
    // Clearing the conversation reverts to the global default model — the
    // session-scoped pick belongs to the conversation being cleared (#688).
    setSessionModelOverride(undefined);
    void modelConfig.reload();
    activeTurnRef.current = null;
    setUsage(null);
    setToolProgress(null);
    queueRef.current = [];
    setQueuedMessages([]);
  }, [isLoading, runId, hermesSessionId, setMessages, modelConfig.reload]);

  const localCommands = useLocalCommands({
    profile,
    usage,
    setFastMode: setFastTier,
    onNewChat,
    onClear: handleClear,
    addAgentMessage,
  });

  // Fired once per connection when the dashboard WebSocket transport can't
  // connect (e.g. SSH tunnel → `hermes gateway`, which has no `/api/ws`, issue
  // #667) and we fall back to legacy chat. A fixed toast id dedupes.
  const handleDashboardUnavailable = useCallback(() => {
    toast(t("chat.dashboardUnavailableFallback"), {
      id: "dashboard-unavailable-fallback",
      icon: "ℹ️",
      duration: 8000,
    });
  }, [t]);

  const dashboardTransport = useDashboardChatTransport({
    activeTurnRef,
    contextFolder,
    connectionMode,
    enabled: dashboardChatEnabled,
    fallbackOnUnavailable: chatTransportPreference === "auto",
    hermesSessionId,
    messages,
    model: chatCurrentModel,
    modelBaseUrl: chatCurrentBaseUrl,
    profile,
    provider: chatCurrentProvider,
    setHermesSessionId,
    setIsLoading,
    setMessages,
    setToolProgress,
    setUsage,
    onDashboardUnavailable: handleDashboardUnavailable,
  });

  const [agentCommandCatalog, setAgentCommandCatalog] =
    useState<AgentCommandsCatalogResponse | null>(null);
  const getCommandCatalog = dashboardTransport.getCommandCatalog;
  const commandCatalogEnabled = dashboardTransport.enabled;

  useEffect(() => {
    if (!commandCatalogEnabled) {
      setAgentCommandCatalog(null);
      return;
    }
    if (!active) return;
    let cancelled = false;
    void getCommandCatalog()
      .then((catalog) => {
        if (!cancelled) setAgentCommandCatalog(catalog);
      })
      .catch(() => {
        if (!cancelled) setAgentCommandCatalog(null);
      });
    return () => {
      cancelled = true;
    };
  }, [active, commandCatalogEnabled, getCommandCatalog, profile]);

  const slashCatalog = useMemo(() => {
    const desktopCommands = [
      ...DESKTOP_SLASH_COMMANDS,
      ...LOCAL_DESKTOP_SLASH_COMMANDS,
    ];
    const desktopNames = new Set(
      desktopCommands.map((command) => command.name),
    );
    const fallbackAgentCommands: AgentSlashCommand[] = SLASH_COMMANDS.filter(
      (command) => !desktopNames.has(command.name.replace(/^\//, "")),
    ).map((command) => ({
      name: command.name,
      description: command.description,
      category: command.category,
      source: "agent",
      target: "agent",
      allowWhileBusy: true,
      supportsAttachments: false,
    }));

    return reconcileSlashCatalog({
      catalog: agentCommandCatalog,
      desktopCommands,
      fallbackAgentCommands,
    });
  }, [agentCommandCatalog]);

  const slashMenuCommands = useMemo<SlashCommand[]>(
    () =>
      slashCatalog.commands.map((command) => ({
        name: `/${command.name}`,
        description: command.description,
        category:
          command.target === "desktop"
            ? "info"
            : command.target === "model"
              ? "tools"
              : "agent",
        local: command.target === "desktop",
        takesArgs:
          command.target === "agent" ||
          command.target === "model" ||
          Boolean(command.argsHint),
      })),
    [slashCatalog],
  );

  // Defer a message onto the busy queue (used when a slash command resolves to
  // an agent prompt while a turn is already in flight).
  const enqueueMessage = useCallback(
    (text: string, attachments: Attachment[] = []) => {
      queueRef.current.push({ text, attachments });
      setQueuedMessages([...queueRef.current]);
    },
    [],
  );

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
    slashCatalog,
    onOpenSettings: onOpenDiagnose,
    activeTurnRef,
    contextFolder,
    sessionModel: sessionModelOverride,
    sendViaDashboard: dashboardTransport.enabled
      ? dashboardTransport.sendMessage
      : undefined,
    execSlashViaDashboard: dashboardTransport.enabled
      ? dashboardTransport.execSlash
      : undefined,
    runBackgroundViaDashboard: dashboardTransport.enabled
      ? dashboardTransport.runBackground
      : undefined,
    addAgentMessage,
    enqueueMessage,
    abortDashboard: dashboardTransport.enabled
      ? dashboardTransport.abort
      : undefined,
  });

  // Stable ref to handleSend so the drain effect doesn't re-trigger on
  // identity changes (regression #5 from PR #315).
  const handleSendRef = useRef(actions.handleSend);
  const handleBackgroundRef = useRef(actions.handleBackground);
  useEffect(() => {
    handleSendRef.current = actions.handleSend;
    handleBackgroundRef.current = actions.handleBackground;
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
      // Side questions (`/btw`) run on a concurrent background agent, so they
      // must never queue — fire them immediately even while the main turn is in
      // flight. This is the whole point of "ask without affecting context".
      const bgQuestion = parseBackgroundCommand(text);
      if (bgQuestion !== null) {
        if (bgQuestion)
          void handleBackgroundRef.current(bgQuestion, attachments);
        return;
      }
      // The central slash router owns queueing policy. Dispatch every slash
      // command immediately so Desktop commands can run, Agent commands can use
      // the concurrent worker, and model-bound commands can format once before
      // they are queued.
      if (text.startsWith("/")) {
        void handleSendRef.current(text, attachments, true);
        return;
      }
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

  const handlePickFolder = useCallback(async () => {
    if (remoteMode) {
      setFolderPickerOpen(true);
      return;
    }
    const path = await window.hermesAPI.selectFolder();
    if (path) setContextFolder(path);
  }, [remoteMode]);

  const handleClearFolder = useCallback(() => {
    setContextFolder(null);
  }, []);

  // Stable toolbar callbacks so the memoized ModelPicker / ContextFolderChip
  // don't re-render on every streaming chunk (each chunk re-renders <Chat>).
  const handleSelectModel = useCallback(
    (provider: string, model: string, baseUrl: string) => {
      void modelConfig.selectModel(provider, model, baseUrl, {
        persist: false,
      });
      // Carry the full identity (not just the model name) so a cross-provider
      // switch reaches the right backend. Mirror the baseUrl rule selectModel
      // applies so they can't drift.
      setSessionModelOverride(
        model
          ? {
              provider,
              model,
              baseUrl: effectiveOverrideBaseUrl(provider, baseUrl),
            }
          : undefined,
      );
    },
    [modelConfig.selectModel],
  );

  const handleSelectRecentFolder = useCallback((path: string) => {
    setContextFolder(path);
  }, []);

  const handleToggleWorktree = useCallback(() => {
    setWorktreeVisible((v) => !v);
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
  // Denominator priority: gateway-reported context_max (authoritative — knows
  // the actual model config) > provider /models catalogue > static heuristic.
  const contextUsage: ContextUsage | null = usage?.contextTokens
    ? {
        used: usage.contextTokens,
        window:
          usage.contextWindowTokens ??
          realContextWindow ??
          contextWindowForModel(chatCurrentModel),
        cacheReadTokens: usage.cacheReadTokens,
        cacheWriteTokens: usage.cacheWriteTokens,
      }
    : null;

  const prettyPrintHTML = (html: string): string => {
    const formatNode = (node: Node, level: number = 0): string => {
      const indent = "  ".repeat(level);
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent?.trim();
        return text ? `${indent}${text}\n` : "";
      }
      if (node.nodeType === Node.COMMENT_NODE) {
        return `${indent}<!--${node.textContent}-->\n`;
      }
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as Element;
        const tagName = el.tagName.toLowerCase();
        let attrs = "";
        for (let i = 0; i < el.attributes.length; i++) {
          const attr = el.attributes[i];
          attrs += ` ${attr.name}="${attr.value}"`;
        }
        const isVoid = [
          "area",
          "base",
          "br",
          "col",
          "embed",
          "hr",
          "img",
          "input",
          "link",
          "meta",
          "param",
          "source",
          "track",
          "wbr",
        ].includes(tagName);
        if (isVoid) {
          return `${indent}<${tagName}${attrs}>\n`;
        }
        if (
          el.childNodes.length === 1 &&
          el.firstChild?.nodeType === Node.TEXT_NODE
        ) {
          const text = el.firstChild.textContent?.trim();
          return text
            ? `${indent}<${tagName}${attrs}>${text}</${tagName}>\n`
            : `${indent}<${tagName}${attrs}></${tagName}>\n`;
        }
        if (el.childNodes.length === 0) {
          return `${indent}<${tagName}${attrs}></${tagName}>\n`;
        }
        let childrenHtml = "";
        for (let i = 0; i < el.childNodes.length; i++) {
          childrenHtml += formatNode(el.childNodes[i], level + 1);
        }
        return `${indent}<${tagName}${attrs}>\n${childrenHtml}${indent}</${tagName}>\n`;
      }
      return "";
    };

    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");
      const body = doc.body;
      if (body.childNodes.length > 0) {
        let result = "";
        for (let i = 0; i < body.childNodes.length; i++) {
          result += formatNode(body.childNodes[i], 0);
        }
        return result.trim();
      }
    } catch (e) {
      console.error("Failed to pretty print HTML", e);
    }
    return html;
  };

  const handleInspectElement = useCallback(
    (payload: {
      tagName: string;
      id: string;
      className: string;
      outerHTML: string;
    }) => {
      const formattedHtml = prettyPrintHTML(payload.outerHTML);
      const formatted = `Here is the HTML for the \`<${payload.tagName}>\` component to debug:\n\`\`\`html\n${formattedHtml}\n\`\`\``;
      chatInputRef.current?.appendText(formatted);
    },
    [],
  );

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
              agentAvatar={agentAvatar}
            />
          )}
          <div ref={bottomRef} />
        </div>

        {contextFolder && worktreeVisible && (
          <WorktreePanel folderPath={contextFolder} />
        )}

        {webPreviewVisible && (
          <WebPreviewPanel
            initialUrl={webPreviewUrl}
            onClose={() => setWebPreviewVisible(false)}
            onInspectElement={handleInspectElement}
          />
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
          slashCommands={slashMenuCommands}
          onSubmit={handleSubmitOrQueue}
          onQuickAsk={actions.handleQuickAsk}
          onAbort={actions.handleAbort}
          toolbarExtras={
            <>
              <ModelPicker
                active={active}
                currentModel={chatCurrentModel}
                currentProvider={chatCurrentProvider}
                currentBaseUrl={chatCurrentBaseUrl}
                modelGroups={modelConfig.modelGroups}
                displayModel={chatDisplayModel}
                onOpen={modelConfig.reload}
                onSelectModel={handleSelectModel}
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
                show
                worktreeVisible={worktreeVisible}
                onPickFolder={handlePickFolder}
                onClearFolder={handleClearFolder}
                onToggleWorktree={handleToggleWorktree}
                onSelectRecentFolder={handleSelectRecentFolder}
              />
              <button
                type="button"
                className={`btn-ghost chat-tool-btn ${webPreviewVisible ? "chat-tool-btn-active" : ""}`}
                onClick={() => setWebPreviewVisible((v) => !v)}
                title={
                  webPreviewVisible ? "Hide web preview" : "Show web preview"
                }
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 28,
                  height: 28,
                  padding: 0,
                  borderRadius: 6,
                  color: webPreviewVisible
                    ? "var(--accent-text)"
                    : "var(--text-secondary)",
                  background: webPreviewVisible
                    ? "color-mix(in srgb, var(--accent-text) 10%, transparent)"
                    : "transparent",
                }}
              >
                <Globe size={14} />
              </button>
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
      <RemoteFolderPicker
        initialPath={contextFolder}
        open={folderPickerOpen}
        onCancel={() => setFolderPickerOpen(false)}
        onSelect={(path) => {
          setContextFolder(path);
          setFolderPickerOpen(false);
        }}
      />
      {/* Show follow-us modal only after setup is complete */}
      {active && connectionModeLoaded && readiness.ok && <FollowUsModal />}
    </div>
  );
}

export default Chat;
