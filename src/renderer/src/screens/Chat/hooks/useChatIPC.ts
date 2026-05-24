import { useEffect } from "react";
import type { ChatMessage, UsageState } from "../types";

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

    const cleanupDone = window.hermesAPI.onChatDone((sessionId) => {
      if (sessionId) setHermesSessionId(sessionId);
      setToolProgress(null);
      setIsLoading(false);
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

    const cleanupUsage = window.hermesAPI.onChatUsage((u) => {
      setUsage((prev) => ({
        promptTokens: (prev?.promptTokens || 0) + u.promptTokens,
        completionTokens: (prev?.completionTokens || 0) + u.completionTokens,
        totalTokens: (prev?.totalTokens || 0) + u.totalTokens,
        cost: u.cost != null ? (prev?.cost || 0) + u.cost : prev?.cost,
      }));
    });

    return () => {
      cleanupChunk();
      cleanupDone();
      cleanupError();
      cleanupToolProgress();
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
