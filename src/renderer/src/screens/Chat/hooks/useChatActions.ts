import { useCallback, useEffect, useRef } from "react";
import type { ChatInputHandle } from "../ChatInput";
import { createTurn, shouldSendToAgent } from "../chatMessages";
import type { SlashExecOutcome } from "../slashExec";
import { handleSlashCommand } from "../slash/handleSlashCommand";
import { parseSlashCommand } from "../slash/parseSlashCommand";
import type {
  PreparedModelSubmission,
  SlashCommandCatalog,
} from "../slash/types";
import type { ActiveTurn, Attachment, ChatMessage } from "../types";
import type { SessionModelOverride } from "../../../../../shared/model-override";

/** Slash commands the desktop handles through its own renderer flow rather
 *  than the gateway slash pipeline: the approval responses, which the gateway
 *  expects as prompt-level input (the side-question commands are handled
 *  separately by `parseBackgroundCommand`). */
const RENDERER_NATIVE_SLASH = new Set(["/approve", "/deny"]);

/** Side-question commands (`/btw` is an alias of `/background`/`/bg`). They run
 *  on a concurrent background agent via `prompt.background`, so they bypass the
 *  busy queue entirely. Returns the question text (possibly ""), or null when
 *  `text` isn't a background command. */
const BACKGROUND_COMMANDS = new Set(["/btw", "/bg", "/background"]);
export function parseBackgroundCommand(text: string): string | null {
  if (!text.startsWith("/")) return null;
  const sp = text.search(/\s/);
  const name = (sp === -1 ? text : text.slice(0, sp)).toLowerCase();
  if (!BACKGROUND_COMMANDS.has(name)) return null;
  return sp === -1 ? "" : text.slice(sp + 1).trim();
}

interface LocalCommands {
  executeLocal: (text: string) => Promise<boolean>;
}

interface UseChatActionsArgs {
  /** This conversation's run id — threaded to the main process so its events
   *  are tagged and its abort targets only this run. */
  runId: string;
  profile?: string;
  hermesSessionId: string | null;
  messages: ChatMessage[];
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  onSessionStarted?: () => void;
  chatInputRef: React.RefObject<ChatInputHandle | null>;
  localCommands: LocalCommands;
  slashCatalog: SlashCommandCatalog;
  /** Open Desktop settings, optionally scrolling to a named section
   *  (e.g. `/settings appearance`). */
  onOpenSettings?: (section?: string) => void;
  activeTurnRef: React.MutableRefObject<ActiveTurn | null>;
  /** Working folder bound to this conversation (issue #27), or null. */
  contextFolder: string | null;
  /** Session-local model override — selected via the chat picker without
   *  persisting to config.yaml (issue #688). Carries the full identity so a
   *  cross-provider switch routes to the right backend, not just the model. */
  sessionModel?: SessionModelOverride;
  sendViaDashboard?: (
    text: string,
    attachments?: Attachment[],
  ) => Promise<boolean>;
  /** Run an Agent-owned slash command through the gateway pipeline. Undefined
   *  on legacy transport; the central router reports it as unavailable. */
  execSlashViaDashboard?: (
    command: string,
    sys: (text: string) => void,
  ) => Promise<SlashExecOutcome>;
  /** Launch a concurrent background (`/btw`) prompt. Undefined on the legacy
   *  transport, where the side question falls back to the blocking flow. */
  runBackgroundViaDashboard?: (
    text: string,
  ) => Promise<{ taskId?: string; error?: string }>;
  /** Render an agent/system message into the transcript (slash output). */
  addAgentMessage?: (content: string) => void;
  /** Defer a message onto the busy queue. Used when a slash command resolves to
   *  an agent prompt while a turn is already in flight. */
  enqueueMessage?: (text: string, attachments?: Attachment[]) => void;
  abortDashboard?: () => void;
}

interface UseChatActionsResult {
  handleSend: (
    text: string,
    attachments?: Attachment[],
    skipLoadingCheck?: boolean,
  ) => Promise<void>;
  handleQuickAsk: (text: string, attachments?: Attachment[]) => Promise<void>;
  /** Launch a side-question (`/btw`) background prompt. Bypasses the busy queue;
   *  `question` is the text after the command. */
  handleBackground: (
    question: string,
    attachments?: Attachment[],
  ) => Promise<void>;
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
// @lat: [[chat-commands#Slash command execution#Local vs gateway commands]]
export function useChatActions({
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
  onOpenSettings,
  activeTurnRef,
  contextFolder,
  sessionModel,
  sendViaDashboard,
  execSlashViaDashboard,
  runBackgroundViaDashboard,
  addAgentMessage,
  enqueueMessage,
  abortDashboard,
}: UseChatActionsArgs): UseChatActionsResult {
  const messagesRef = useRef(messages);
  const isLoadingRef = useRef(isLoading);
  const sessionModelRef = useRef(sessionModel);
  useEffect(() => {
    messagesRef.current = messages;
    isLoadingRef.current = isLoading;
    sessionModelRef.current = sessionModel;
  });

  const pushUser = useCallback(
    (content: string, idPrefix = "user", attachments?: Attachment[]) => {
      const turn = createTurn(idPrefix);
      setMessages((prev) => [
        ...prev,
        {
          id: turn.userId,
          role: "user",
          content,
          turnId: turn.turnId,
          ...(attachments && attachments.length > 0 ? { attachments } : {}),
        },
      ]);
      return turn;
    },
    [setMessages],
  );

  const sendToAgent = useCallback(
    async (text: string, attachments?: Attachment[]): Promise<void> => {
      try {
        if (sendViaDashboard) {
          const handled = await sendViaDashboard(text, attachments);
          if (handled) return;
        }
        await window.hermesAPI.sendMessage(
          text,
          profile,
          hermesSessionId || undefined,
          messagesRef.current.filter(shouldSendToAgent).map((m) => ({
            role: m.role,
            content: m.content,
          })),
          attachments,
          contextFolder ?? undefined,
          runId,
          sessionModelRef.current || undefined,
        );
      } catch {
        // onChatError IPC already surfaces this to the user
      }
    },
    [runId, profile, hermesSessionId, contextFolder, sendViaDashboard],
  );

  // Shared "side question" flow (the 💭 quick-ask button and a typed `/btw`).
  // Renders a distinct user bubble and sends `/btw <question>` so the agent
  // answers without folding it into the main context.
  const runQuickAsk = useCallback(
    async (question: string, attachments?: Attachment[]): Promise<void> => {
      if (!question) return;
      setIsLoading(true);
      const turn = pushUser(`💭 ${question}`, "user-btw", attachments);
      activeTurnRef.current = {
        ...turn,
        startIndex: messagesRef.current.length,
        status: "running",
      };
      await sendToAgent(`/btw ${question}`, attachments);
    },
    [activeTurnRef, pushUser, sendToAgent, setIsLoading],
  );

  // Side question (`/btw` and the 💭 button). On the dashboard transport it runs
  // on a concurrent background agent (`prompt.background`) that never blocks the
  // main turn — so it must NOT set isLoading or own the active turn; the answer
  // arrives later as a `background.complete` message. The legacy transport has
  // no background RPC, so it falls back to the blocking quick-ask.
  const runBackground = useCallback(
    async (question: string, attachments?: Attachment[]): Promise<void> => {
      if (!question) return;
      // `prompt.background` is text-only — it can't carry attachments. When the
      // side question has attachments, fall back to the (blocking) quick-ask
      // path, which sends them via `prompt.submit` and shows them in the bubble,
      // so they're never silently dropped. Concurrent background is used only
      // for the attachment-free case.
      const hasAttachments = (attachments?.length ?? 0) > 0;
      if (runBackgroundViaDashboard && !hasAttachments) {
        pushUser(`💭 ${question}`, "user-btw");
        const r = await runBackgroundViaDashboard(question);
        if (r.error) addAgentMessage?.(`error: ${r.error}`);
        return;
      }
      if (!isLoadingRef.current) await runQuickAsk(question, attachments);
    },
    [runBackgroundViaDashboard, pushUser, addAgentMessage, runQuickAsk],
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

      const cmdName = text.startsWith("/")
        ? text.split(/\s+/)[0].toLowerCase()
        : "";

      // Side-question commands (`/btw`, `/bg`, `/background`) run on a
      // concurrent background agent, not the gateway slash pipeline. (Normally
      // intercepted earlier so they bypass the busy queue; handled here too for
      // the queue-drain path and completeness.)
      const bgQuestion = parseBackgroundCommand(text);
      if (bgQuestion !== null) {
        if (bgQuestion) await runBackground(bgQuestion, attachments);
        return;
      }

      if (text.startsWith("/") && !RENDERER_NATIVE_SLASH.has(cmdName)) {
        const parsed = parseSlashCommand(text);
        const definition = parsed.ok
          ? slashCatalog.resolve(parsed.command.normalizedName)
          : undefined;
        // Pure UI desktop actions (open a page/picker, toggle a mode, reset
        // the chat) leave no transcript output, so echoing a `/command` user
        // bubble would just be a dangling artifact. Output-producing desktop
        // commands (/help, /memory, …) still show it.
        const shouldShowUser = !(
          definition?.target === "desktop" && definition.uiAction === true
        );
        const turn = shouldShowUser ? pushUser(text) : createTurn("slash");
        const startIndex = messagesRef.current.length;
        // Reuse this turn's id for the pending loader bubble rather than
        // minting a second throwaway turn — keeps the loader correlated to it.
        const pendingId = `slash-${turn.turnId}`;
        const showPending = definition?.target === "agent";
        if (showPending) {
          setMessages((prev) => [
            ...prev,
            {
              id: pendingId,
              role: "agent",
              isSlashLoader: true,
              content: `Running ${text}…`,
            },
          ]);
        }
        const replacePending = (content: string): void =>
          setMessages((prev) =>
            prev.map((m) =>
              m.id === pendingId
                ? { id: pendingId, role: "agent", content }
                : m,
            ),
          );
        const removePending = (): void =>
          setMessages((prev) => prev.filter((m) => m.id !== pendingId));

        let buffer = "";
        const collect = (chunk: string): void => {
          buffer = buffer ? `${buffer}\n${chunk}` : chunk;
        };

        const result = await handleSlashCommand(text, slashCatalog, {
          profile,
          sessionId: hermesSessionId ?? undefined,
          attachments: attachments ?? [],
          isModelBusy: isLoadingRef.current,
          executeAgentSlash:
            execSlashViaDashboard ??
            (async () => ({
              kind: "error",
              message:
                "This command requires the Hermes Agent gateway. Switch chat transport to Auto or Dashboard and try again.",
            })),
          submitPrompt: async (submission: PreparedModelSubmission) => {
            removePending();
            setIsLoading(true);
            activeTurnRef.current = { ...turn, startIndex, status: "running" };
            onSessionStarted?.();
            await sendToAgent(submission.content, submission.attachments);
          },
          enqueuePrompt: (submission) => {
            removePending();
            enqueueMessage?.(submission.content, submission.attachments);
          },
          addSystemMessage: collect,
          executeDesktopSlash: localCommands.executeLocal,
          renderSlashHelp: () => {
            const grouped = new Map<string, typeof slashCatalog.commands>();
            for (const command of slashCatalog.commands) {
              const rows = grouped.get(command.category) ?? [];
              rows.push(command);
              grouped.set(command.category, rows);
            }
            const sections = Array.from(grouped.entries()).map(
              ([category, commands]) =>
                `**${category}**\n${commands
                  .map(
                    (command) =>
                      `\`/${command.name}\` — ${command.description}`,
                  )
                  .join("\n")}`,
            );
            return `**Available commands**\n\n${sections.join("\n\n")}`;
          },
          openSettings: (section) => onOpenSettings?.(section),
          openDialog: () => undefined,
          startNewChat: () => onSessionStarted?.(),
          clearTranscript: () => undefined,
        });

        if (result.type === "error") {
          if (showPending) replacePending(`error: ${result.message}`);
          else addAgentMessage?.(`error: ${result.message}`);
        } else if (result.type === "handled") {
          const out = buffer || result.output;
          if (out) {
            if (showPending) replacePending(out);
            else addAgentMessage?.(out);
          } else {
            removePending();
          }
        } else {
          removePending();
          if (buffer) addAgentMessage?.(buffer);
        }
        return;
      }

      setIsLoading(true);
      const turn = pushUser(text, "user", attachments);
      activeTurnRef.current = {
        ...turn,
        startIndex: messagesRef.current.length,
        status: "running",
      };
      onSessionStarted?.();
      await sendToAgent(text, attachments);
    },
    [
      activeTurnRef,
      hermesSessionId,
      localCommands,
      profile,
      slashCatalog,
      onOpenSettings,
      execSlashViaDashboard,
      addAgentMessage,
      enqueueMessage,
      runBackground,
      pushUser,
      onSessionStarted,
      sendToAgent,
      setIsLoading,
      setMessages,
    ],
  );

  // The 💭 quick-ask button is a side question — same concurrent background flow.
  const handleQuickAsk = useCallback(
    async (text: string, attachments?: Attachment[]): Promise<void> => {
      await runBackground(text.trim(), attachments);
    },
    [runBackground],
  );

  const handleAbort = useCallback(() => {
    abortDashboard?.();
    window.hermesAPI.abortChat(runId);
    activeTurnRef.current = null;
    setIsLoading(false);
    setTimeout(() => chatInputRef.current?.focus(), 50);
  }, [abortDashboard, runId, activeTurnRef, chatInputRef, setIsLoading]);

  const handleApprove = useCallback(() => {
    chatInputRef.current?.clear();
    setIsLoading(true);
    const turn = pushUser("/approve", "user-approve");
    activeTurnRef.current = {
      ...turn,
      startIndex: messagesRef.current.length,
      status: "running",
    };
    sendToAgent("/approve").catch(() => setIsLoading(false));
  }, [activeTurnRef, chatInputRef, pushUser, sendToAgent, setIsLoading]);

  const handleDeny = useCallback(() => {
    chatInputRef.current?.clear();
    setIsLoading(true);
    const turn = pushUser("/deny", "user-deny");
    activeTurnRef.current = {
      ...turn,
      startIndex: messagesRef.current.length,
      status: "running",
    };
    sendToAgent("/deny").catch(() => setIsLoading(false));
  }, [activeTurnRef, chatInputRef, pushUser, sendToAgent, setIsLoading]);

  return {
    handleSend,
    handleQuickAsk,
    handleBackground: runBackground,
    handleAbort,
    handleApprove,
    handleDeny,
  };
}
