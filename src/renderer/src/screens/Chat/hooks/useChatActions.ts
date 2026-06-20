import { useCallback, useEffect, useRef } from "react";
import type { ChatInputHandle } from "../ChatInput";
import { createTurn, shouldSendToAgent } from "../chatMessages";
import type { SlashExecOutcome } from "../slashExec";
import type {
  ActiveTurn,
  Attachment,
  ChatMessage,
  QueueAnchor,
} from "../types";
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
  isLocal: (text: string) => boolean;
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
  /** Run a slash command through the gateway's slash pipeline (dashboard
   *  transport only). Undefined on the legacy transport, where slash commands
   *  fall back to being sent as plain text. */
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
    queueAnchor?: QueueAnchor,
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
    (
      content: string,
      idPrefix = "user",
      attachments?: Attachment[],
      queueAnchor?: QueueAnchor,
    ) => {
      const turn = createTurn(idPrefix);
      setMessages((prev) => [
        ...prev,
        {
          id: turn.userId,
          role: "user",
          content,
          turnId: turn.turnId,
          ...(attachments && attachments.length > 0 ? { attachments } : {}),
          ...(queueAnchor ? { queueAnchor } : {}),
        },
      ]);
      return turn;
    },
    [setMessages],
  );

  const sendToAgent = useCallback(
    async (
      text: string,
      attachments?: Attachment[],
      propagateError = false,
    ): Promise<void> => {
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
      } catch (error) {
        // onChatError IPC already surfaces this to the user
        if (propagateError) throw error;
      }
    },
    [runId, profile, hermesSessionId, contextFolder, sendViaDashboard],
  );

  const runAgentTurn = useCallback(
    async (
      prompt: string,
      displayText: string,
      attachments?: Attachment[],
      queueAnchor?: QueueAnchor,
    ): Promise<void> => {
      setIsLoading(true);
      const turn = pushUser(displayText, "user", attachments, queueAnchor);
      activeTurnRef.current = {
        ...turn,
        startIndex: messagesRef.current.length,
        status: "running",
      };
      onSessionStarted?.();
      try {
        await sendToAgent(prompt, attachments, !!queueAnchor);
      } catch (error) {
        // A queued item remains retryable only if its optimistic user row is
        // removed before the drain effect puts the item back at the front.
        setMessages((prev) =>
          prev.filter((message) => message.id !== turn.userId),
        );
        if (activeTurnRef.current?.turnId === turn.turnId) {
          activeTurnRef.current = null;
        }
        setIsLoading(false);
        throw error;
      }
    },
    [
      activeTurnRef,
      onSessionStarted,
      pushUser,
      sendToAgent,
      setIsLoading,
      setMessages,
    ],
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
      queueAnchor?: QueueAnchor,
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

      // Non-local slash command on the dashboard transport: route through the
      // gateway's slash.exec / command.dispatch pipeline instead of submitting
      // the literal text to the model (which would just echo it back as prose).
      // `slash.exec` runs on the gateway's persistent slash-worker subprocess —
      // concurrent with any in-flight turn — so commands like `/status` and
      // `/compact` must run instantly and NOT touch the main turn's loading or
      // active-turn state. Skipped on the legacy transport, for slash text with
      // attachments, and for approval responses (`/approve`, `/deny`) which have
      // dedicated prompt-level handling.
      if (
        execSlashViaDashboard &&
        text.startsWith("/") &&
        !RENDERER_NATIVE_SLASH.has(cmdName) &&
        (attachments?.length ?? 0) === 0
      ) {
        // `/queue` resolves to a normal prompt. Do not optimistically append
        // the command itself while another turn is streaming: that user row
        // would become the renderer's latest turn boundary and split the
        // active reasoning/tool/final output. Only the resolved prompt enters
        // the queue, whose separate visual marker preserves submission time.
        if (cmdName === "/queue") {
          let buffer = "";
          const collect = (chunk: string): void => {
            buffer = buffer ? `${buffer}\n${chunk}` : chunk;
          };
          const outcome = await execSlashViaDashboard(text, collect);
          if (outcome.kind === "send") {
            if (isLoadingRef.current) {
              enqueueMessage?.(outcome.message, attachments);
            } else {
              await runAgentTurn(outcome.message, outcome.message, attachments);
            }
          } else {
            pushUser(text);
            addAgentMessage?.(
              outcome.kind === "error"
                ? `error: ${outcome.message}`
                : buffer || "(done)",
            );
          }
          return;
        }

        const startIndex = messagesRef.current.length;
        const turn = pushUser(text);

        // These commands set no global loading state (they run concurrently on
        // the slash worker), so without an in-place indicator there'd be no
        // feedback at all while the gateway responds. Show a pending bubble and
        // replace it with the result. Buffer pipeline output so the single
        // bubble carries the final text rather than appending a second message.
        const pendingId = `slash-${createTurn("slash").turnId}`;
        setMessages((prev) => [
          ...prev,
          { id: pendingId, role: "agent", content: `⏳ Running ${text}…` },
        ]);
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
        const outcome = await execSlashViaDashboard(text, collect);

        if (outcome.kind === "error") {
          replacePending(`error: ${outcome.message}`);
        } else if (outcome.kind === "send") {
          // The command resolved to an agent prompt, which needs the
          // single-flight main session: run it now if idle, otherwise defer it
          // onto the queue rather than colliding with the running turn.
          removePending();
          if (buffer) addAgentMessage?.(buffer);
          if (isLoadingRef.current) {
            enqueueMessage?.(outcome.message, attachments);
          } else {
            setIsLoading(true);
            activeTurnRef.current = { ...turn, startIndex, status: "running" };
            onSessionStarted?.();
            await sendToAgent(outcome.message);
          }
        } else {
          replacePending(buffer || "(done)");
        }
        return;
      }

      await runAgentTurn(text, text, attachments, queueAnchor);
    },
    [
      activeTurnRef,
      localCommands,
      execSlashViaDashboard,
      addAgentMessage,
      enqueueMessage,
      runAgentTurn,
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
