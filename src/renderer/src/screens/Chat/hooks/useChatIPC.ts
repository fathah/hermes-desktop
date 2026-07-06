import { useCallback, useEffect, useRef } from "react";
import { isBubbleMessage, markActiveTurnFailed } from "../chatMessages";
import type { ActiveTurn, ChatMessage, UsageState } from "../types";
import {
  dbItemsToChatMessages,
  reconcileAfterDbRefresh,
  type DbHistoryItem,
} from "../sessionHistory";
import {
  liveToolEventFromProgress,
  upsertLiveToolEvent,
} from "../liveToolEvents";
import { upsertLiveReasoningChunk } from "../liveReasoningEvents";

interface UseChatIPCArgs {
  /** This conversation's run id. Events tagged with a different runId belong
   *  to another mounted/background chat and are ignored. */
  runId: string;
  /** The session currently visible in this Chat, if already known. */
  sessionScopeId: string | null;
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  setHermesSessionId: (id: string) => void;
  setToolProgress: (tool: string | null) => void;
  setIsLoading: (loading: boolean) => void;
  setUsage: React.Dispatch<React.SetStateAction<UsageState | null>>;
  activeTurnRef: React.MutableRefObject<ActiveTurn | null>;
}

/**
 * True when an incoming event belongs to this conversation. Multiple chats run
 * concurrently and share the same global IPC channels, so each listener must
 * drop events whose runId isn't ours.
 */
export function eventMatchesRun(eventRunId: string, ownRunId: string): boolean {
  return eventRunId === ownRunId;
}

/**
 * Registers all chat-related IPC listeners once and tears them down on unmount.
 *
 * The dashboard/gateway is the canonical event source where possible; the
 * polling refresh bridges persisted DB rows that the streaming API still omits
 * today, especially reasoning and tool result rows.
 */
export function useChatIPC({
  runId,
  sessionScopeId,
  setMessages,
  setHermesSessionId,
  setToolProgress,
  setIsLoading,
  setUsage,
  activeTurnRef,
}: UseChatIPCArgs): void {
  const reasoningSegmentClosedRef = useRef(false);
  const dbPollRef = useRef<ReturnType<typeof window.setInterval> | null>(null);
  const dbPollInFlightRef = useRef(false);
  const acceptedSessionIdRef = useRef<string | null>(sessionScopeId);

  const stopDbPolling = useCallback((): void => {
    if (dbPollRef.current !== null) {
      window.clearInterval(dbPollRef.current);
      dbPollRef.current = null;
    }
    dbPollInFlightRef.current = false;
  }, []);

  useEffect(() => {
    if (sessionScopeId === acceptedSessionIdRef.current) return;
    acceptedSessionIdRef.current = sessionScopeId;
    reasoningSegmentClosedRef.current = false;
    stopDbPolling();
  }, [sessionScopeId, stopDbPolling]);

  useEffect(() => {
    let disposed = false;

    const refreshFromDb = async (sessionId: string): Promise<void> => {
      if (
        !sessionId ||
        disposed ||
        dbPollInFlightRef.current ||
        acceptedSessionIdRef.current !== sessionId
      ) {
        return;
      }
      dbPollInFlightRef.current = true;
      const activeTurn = activeTurnRef.current ?? undefined;
      try {
        const items = (await window.hermesAPI.getSessionMessages(
          sessionId,
        )) as DbHistoryItem[];
        if (
          disposed ||
          acceptedSessionIdRef.current !== sessionId ||
          items.length === 0
        ) {
          return;
        }
        const dbMessages = dbItemsToChatMessages(items);
        if (dbMessages.length === 0) return;
        setMessages((prev) =>
          reconcileAfterDbRefresh(prev, dbMessages, { activeTurn }),
        );
      } catch {
        // Mid-stream DB refresh is opportunistic; final refresh still runs.
      } finally {
        dbPollInFlightRef.current = false;
      }
    };

    const startDbPolling = (sessionId: string): void => {
      stopDbPolling();
      void refreshFromDb(sessionId);
      dbPollRef.current = window.setInterval(() => {
        void refreshFromDb(sessionId);
      }, 750);
    };

    const cleanupSessionStarted = window.hermesAPI.onChatSessionStarted(
      (eventRunId, sessionId) => {
        if (!eventMatchesRun(eventRunId, runId) || !sessionId) return;
        acceptedSessionIdRef.current = sessionId;
        setHermesSessionId(sessionId);
        startDbPolling(sessionId);
      },
    );

    const cleanupChunk = window.hermesAPI.onChatChunk((eventRunId, chunk) => {
      if (!eventMatchesRun(eventRunId, runId)) return;
      if (!activeTurnRef.current) return;
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (
          last &&
          last.role === "agent" &&
          isBubbleMessage(last) &&
          !last.error
        ) {
          return [
            ...prev.slice(0, -1),
            {
              ...last,
              content: last.content + chunk,
              pending: true,
              turnId: last.turnId || activeTurnRef.current?.turnId,
            },
          ];
        }
        if (!chunk || !chunk.trim()) return prev;
        return [
          ...prev,
          {
            id: `agent-${Date.now()}`,
            role: "agent",
            content: chunk,
            pending: true,
            ...(activeTurnRef.current?.turnId
              ? { turnId: activeTurnRef.current.turnId }
              : {}),
          },
        ];
      });
    });

    const cleanupReasoning = window.hermesAPI.onChatReasoningChunk(
      (eventRunId, chunk) => {
        if (!eventMatchesRun(eventRunId, runId)) return;
        if (!activeTurnRef.current) return;
        if (!chunk) return;
        const forceNewSegment = reasoningSegmentClosedRef.current;
        reasoningSegmentClosedRef.current = false;
        setMessages((prev) =>
          upsertLiveReasoningChunk(prev, chunk, Date.now(), forceNewSegment),
        );
      },
    );

    const cleanupDone = window.hermesAPI.onChatDone(
      async (eventRunId, sessionId) => {
        if (!eventMatchesRun(eventRunId, runId)) return;
        reasoningSegmentClosedRef.current = false;
        stopDbPolling();
        const activeTurn = activeTurnRef.current;
        const acceptedSessionId = acceptedSessionIdRef.current;
        if (sessionId && acceptedSessionId && acceptedSessionId !== sessionId) {
          return;
        }
        if (sessionId && !acceptedSessionId && !activeTurn) {
          return;
        }
        if (sessionId) {
          acceptedSessionIdRef.current = sessionId;
          setHermesSessionId(sessionId);
        }
        if (!sessionId || activeTurn?.status === "failed") {
          activeTurnRef.current = null;
          setToolProgress(null);
          setIsLoading(false);
          return;
        }
        try {
          const items = (await window.hermesAPI.getSessionMessages(
            sessionId,
          )) as DbHistoryItem[];
          const dbMessages = dbItemsToChatMessages(items);
          if (dbMessages.length > 0) {
            setMessages((prev) =>
              reconcileAfterDbRefresh(prev, dbMessages, { activeTurn }),
            );
          }
          if (activeTurn) activeTurn.status = "completed";
        } catch {
          // Merge is a UX nicety; do not break chat completion on failure.
        } finally {
          setToolProgress(null);
          setIsLoading(false);
          if (activeTurnRef.current === activeTurn) {
            activeTurnRef.current = null;
          }
        }
      },
    );

    const cleanupError = window.hermesAPI.onChatError((eventRunId, error) => {
      if (!eventMatchesRun(eventRunId, runId)) return;
      reasoningSegmentClosedRef.current = false;
      stopDbPolling();
      const activeTurn = activeTurnRef.current;
      if (!activeTurn) return;
      activeTurn.status = "failed";
      setMessages((prev) => markActiveTurnFailed(prev, error, activeTurn));
      setToolProgress(null);
      setIsLoading(false);
    });

    const cleanupClarify = window.hermesAPI.onClarifyRequest(
      (eventRunId, req) => {
        if (!eventMatchesRun(eventRunId, runId)) return;
        reasoningSegmentClosedRef.current = true;
        setToolProgress(null);
        setIsLoading(true);
        setMessages((prev) => {
          if (
            prev.some(
              (m) => m.kind === "clarify" && m.requestId === req.requestId,
            )
          ) {
            return prev;
          }
          return [
            ...prev,
            {
              id: `clarify-${req.requestId}`,
              kind: "clarify",
              role: "agent",
              requestId: req.requestId,
              question: req.question,
              choices: Array.isArray(req.choices) ? req.choices : [],
            },
          ];
        });
      },
    );

    const cleanupToolProgress = window.hermesAPI.onChatToolProgress(
      (eventRunId, tool) => {
        if (!eventMatchesRun(eventRunId, runId)) return;
        if (!activeTurnRef.current) return;
        setToolProgress(null);
        if (!tool.trim()) return;
        reasoningSegmentClosedRef.current = true;
        setMessages((prev) =>
          upsertLiveToolEvent(prev, liveToolEventFromProgress(tool)),
        );

        // Also check progress text for URLs, but only if it's a web tool
        const toolEventName =
          liveToolEventFromProgress(tool).name.toLowerCase();
        const isWebTool = [
          "browser",
          "web",
          "browse",
          "web_search",
          "search_web",
          "computer_use",
          "computer",
        ].includes(toolEventName);

        if (isWebTool) {
          const urlMatch = tool.match(/https?:\/\/[^\s)]+/i);
          if (urlMatch) {
            const event = new CustomEvent("web-preview:navigate", {
              detail: urlMatch[0],
            });
            document.dispatchEvent(event);
          }
        }
      },
    );

    const cleanupToolEvent = window.hermesAPI.onChatToolEvent(
      (eventRunId, toolEvent) => {
        if (!eventMatchesRun(eventRunId, runId)) return;
        if (!activeTurnRef.current) return;
        setToolProgress(null);
        reasoningSegmentClosedRef.current = true;
        setMessages((prev) => upsertLiveToolEvent(prev, toolEvent));

        // Auto-open webview if the agent is using a browser/web tool to navigate
        const isWebTool = [
          "browser",
          "web",
          "browse",
          "web_search",
          "search_web",
          "computer_use",
          "computer",
        ].includes(toolEvent.name.toLowerCase());
        if (isWebTool) {
          const textToSearch = `${toolEvent.preview || ""} ${toolEvent.result || ""}`;
          const urlMatch = textToSearch.match(/https?:\/\/[^\s)]+/i);
          if (urlMatch) {
            const url = urlMatch[0];
            const event = new CustomEvent("web-preview:navigate", {
              detail: url,
            });
            document.dispatchEvent(event);
          }
        }
      },
    );

    const cleanupUsage = window.hermesAPI.onChatUsage((eventRunId, u) => {
      if (!eventMatchesRun(eventRunId, runId)) return;
      setUsage((prev) => ({
        promptTokens: (prev?.promptTokens || 0) + u.promptTokens,
        completionTokens: (prev?.completionTokens || 0) + u.completionTokens,
        totalTokens: (prev?.totalTokens || 0) + u.totalTokens,
        cost: u.cost != null ? (prev?.cost || 0) + u.cost : prev?.cost,
        contextTokens: u.promptTokens || prev?.contextTokens,
        cacheReadTokens: u.cacheReadTokens ?? prev?.cacheReadTokens,
        cacheWriteTokens: u.cacheWriteTokens ?? prev?.cacheWriteTokens,
      }));
    });

    return () => {
      disposed = true;
      stopDbPolling();
      cleanupSessionStarted();
      cleanupChunk();
      cleanupReasoning();
      cleanupDone();
      cleanupError();
      cleanupClarify();
      cleanupToolProgress();
      cleanupToolEvent();
      cleanupUsage();
    };
  }, [
    runId,
    setMessages,
    setHermesSessionId,
    setToolProgress,
    setIsLoading,
    setUsage,
    activeTurnRef,
    stopDbPolling,
  ]);
}
