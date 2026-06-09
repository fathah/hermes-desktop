// ChatSurface.tsx — the AI Chats surface. Wraps the shared <Chat> with local
// transcript state, loads the active session (Recents → list-sessions), and
// consumes a one-shot pending prompt from the guided entry points (New chat,
// meeting/calendar cards). Mirrors how Layout.tsx drives Chat.
import { useEffect, useRef, useState } from "react";
import Chat, { type ChatMessage } from "../../Chat/Chat";
import { dbItemsToChatMessages } from "../../Chat/sessionHistory";
import type { DbHistoryItem } from "../../Chat/sessionHistory";
import { useStore } from "../store";
import { openSettings } from "../../../lib/openSettings";

export function ChatSurface() {
  const activeChatSession = useStore((s) => s.activeChatSession);
  const setActiveChatSession = useStore((s) => s.setActiveChatSession);
  const pendingChatPrompt = useStore((s) => s.pendingChatPrompt);
  const setPendingChatPrompt = useStore((s) => s.setPendingChatPrompt);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // Capture the pending prompt once at mount/selection so clearing it from the
  // store doesn't blank the composer mid-render.
  const initialInput = useRef<string | undefined>(
    pendingChatPrompt ?? undefined,
  ).current;

  // Clear the one-shot prompt from the store after we've captured it.
  useEffect(() => {
    if (pendingChatPrompt) setPendingChatPrompt(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load the selected session's transcript (or start empty for a fresh chat).
  useEffect(() => {
    let cancelled = false;
    if (!activeChatSession) {
      setMessages([]);
      return;
    }
    const api = window.hermesAPI;
    if (!api?.getSessionMessages) return;
    api
      .getSessionMessages(activeChatSession)
      .then((items) => {
        if (cancelled) return;
        setMessages(dbItemsToChatMessages(items as DbHistoryItem[]));
      })
      .catch(() => {
        if (!cancelled) setMessages([]);
      });
    return () => {
      cancelled = true;
    };
  }, [activeChatSession]);

  return (
    <Chat
      messages={messages}
      setMessages={setMessages}
      sessionId={activeChatSession}
      profile="default"
      initialInput={initialInput}
      onNewChat={() => {
        setMessages([]);
        setActiveChatSession(null);
      }}
      onOpenDiagnose={() => openSettings()}
    />
  );
}
