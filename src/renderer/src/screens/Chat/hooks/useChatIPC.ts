import { useEffect } from "react";
import type { ChatMessage, UsageState } from "../types";
import {
  dbItemsToChatMessages,
  reconcileStreamedWithDb,
  type DbHistoryItem,
} from "../sessionHistory";
import { upsertLiveToolEvent } from "../liveToolEvents";

interface UseChatIPCArgs {
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  setHermesSessionId: (id: string) => void;
  setToolProgress: (tool: string | null) => void;
  setIsLoading: (loading: boolean) => void;
  setUsage: React.Dispatch<React.SetStateAction<UsageState | null>>;
}

/**
 * Registers all chat-related IPC listeners once and tears them down on unmount.
 *
 * Each listener writes through the provided setters; consumers should pass
 * stable `useState`/`useDispatch` setters (React guarantees identity).
 */
export function useChatIPC({
  setMessages,
  setHermesSessionId,
  setToolProgress,
  setIsLoading,
  setUsage,
}: UseChatIPCArgs): void {
  useEffect(() => {
    const cleanupChunk = window.hermesAPI.onChatChunk((chunk) => {
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (
          last &&
          last.role === "agent" &&
          "content" in last &&
          typeof last.content === "string"
        ) {
          return [
            ...prev.slice(0, -1),
            { ...last, content: last.content + chunk },
          ];
        }
        // Skip empty initial chunks so we don't create an empty bubble
        if (!chunk || !chunk.trim()) return prev;
        return [
          ...prev,
          { id: `agent-${Date.now()}`, role: "agent", content: chunk },
        ];
      });
    });

    // Streaming reasoning / thinking bubbles for the current turn (#352).
    // Reasoning typically arrives BEFORE content (DeepSeek, o1/o3), but
    // we don't rely on that order — we find the reasoning row for the
    // active turn (last agent reasoning row since the most recent user
    // message) and append to it. If no such row exists yet, create one
    // and place it BEFORE any assistant content bubbles in the same
    // turn so the visual order is reasoning → answer.
    const cleanupReasoning = window.hermesAPI.onChatReasoningChunk((chunk) => {
      if (!chunk) return;
      setMessages((prev) => {
        let insertAt = prev.length;
        for (let i = prev.length - 1; i >= 0; i--) {
          const m = prev[i];
          if (m.role === "user") break;
          // Append to the active turn's reasoning row if one exists.
          if ("kind" in m && m.kind === "reasoning") {
            return [
              ...prev.slice(0, i),
              { ...m, text: m.text + chunk },
              ...prev.slice(i + 1),
            ];
          }
          // Otherwise track the earliest in-turn agent row so the new
          // reasoning bubble lands ahead of it (typical case: content
          // bubble started first because reasoning arrived a tick late).
          insertAt = i;
        }
        return [
          ...prev.slice(0, insertAt),
          {
            id: `reasoning-${Date.now()}`,
            kind: "reasoning",
            role: "agent",
            text: chunk,
          },
          ...prev.slice(insertAt),
        ];
      });
    });

    const cleanupDone = window.hermesAPI.onChatDone(async (sessionId) => {
      if (sessionId) setHermesSessionId(sessionId);
      setToolProgress(null);
      setIsLoading(false);
      // End-of-stream merge from state.db. The gateway doesn't forward
      // streaming reasoning_content / tool deltas over the OpenAI-compatible
      // SSE (NousResearch/hermes-agent#30449) — the agent writes them to
      // state.db at finalisation instead. Without this merge, the
      // reasoning / tool bubbles only materialise when something else
      // triggers a re-sync (window focus change, tab switch). Doing it
      // here makes them appear immediately on stream completion (#352).
      //
      // We *merge* (not replace) so that once #30449 lands and reasoning
      // does stream, the already-rendered streamed bubble keeps its
      // React identity instead of being re-mounted by a DB-id swap.
      // `reconcileStreamedWithDb` does the matching — see its doc block.
      if (!sessionId) return;
      try {
        const items = (await window.hermesAPI.getSessionMessages(
          sessionId,
        )) as DbHistoryItem[];
        const dbMessages = dbItemsToChatMessages(items);
        if (dbMessages.length === 0) return;
        setMessages((prev) => reconcileStreamedWithDb(prev, dbMessages));
      } catch {
        // Merge is a UX nicety — don't break the chat flow if it fails.
      }
    });

    const cleanupError = window.hermesAPI.onChatError((error) => {
      setMessages((prev) => [
        ...prev,
        {
          id: `error-${Date.now()}`,
          role: "agent",
          content: `Error: ${error}`,
        },
      ]);
      setToolProgress(null);
      setIsLoading(false);
    });

    const cleanupToolProgress = window.hermesAPI.onChatToolProgress((tool) => {
      setToolProgress(tool);
    });

    const cleanupToolEvent = window.hermesAPI.onChatToolEvent((toolEvent) => {
      setToolProgress(null);
      setMessages((prev) => upsertLiveToolEvent(prev, toolEvent));
    });

    const cleanupUsage = window.hermesAPI.onChatUsage((u) => {
      setUsage((prev) => ({
        promptTokens: (prev?.promptTokens || 0) + u.promptTokens,
        completionTokens: (prev?.completionTokens || 0) + u.completionTokens,
        totalTokens: (prev?.totalTokens || 0) + u.totalTokens,
        cost: u.cost != null ? (prev?.cost || 0) + u.cost : prev?.cost,
        // Latest-turn values (overwrite, not sum) for the context gauge.
        contextTokens: u.promptTokens || prev?.contextTokens,
        cacheReadTokens: u.cacheReadTokens ?? prev?.cacheReadTokens,
        cacheWriteTokens: u.cacheWriteTokens ?? prev?.cacheWriteTokens,
      }));
    });

    return () => {
      cleanupChunk();
      cleanupReasoning();
      cleanupDone();
      cleanupError();
      cleanupToolProgress();
      cleanupToolEvent();
      cleanupUsage();
    };
  }, [
    setMessages,
    setHermesSessionId,
    setToolProgress,
    setIsLoading,
    setUsage,
  ]);
}
