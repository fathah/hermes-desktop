import { useCallback, useRef, useState } from "react";
import type { ChatMessage } from "../types";

/**
 * Transcript state with a write-through ref as the synchronous source of
 * truth.
 *
 * Streaming applies deltas to `messagesRef` between commits (the dashboard
 * transport coalesces `setMessages` to one commit per animation frame), so
 * React's committed state can be up to a frame behind the ref. Every other
 * transcript writer (user turns, `/btw`, clear, clarify, failure marking)
 * uses functional updates — and a functional update resolved against the
 * *committed* state would fork from a pre-delta snapshot and silently drop
 * the in-flight chunks once its commit landed.
 *
 * The returned `setMessages` therefore resolves updaters against the ref at
 * dispatch time and writes the result back to the ref before dispatching the
 * value to React. Two invariants follow, and the transport's coalescing
 * depends on both:
 *
 * 1. Every writer builds on the newest transcript, never a stale commit.
 * 2. The ref always holds the newest dispatched-or-streamed array, so a late
 *    coalesced flush (`setMessages(messagesRef.current)`) can only republish
 *    or advance state — it can never resurrect an older transcript.
 *
 * Nothing may call the raw state setter or re-adopt committed state into the
 * ref; that would reintroduce the dropped-chunk bug class (#757).
 */
export function useTranscriptState(initial?: ChatMessage[]): {
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  messagesRef: React.MutableRefObject<ChatMessage[]>;
} {
  const [messages, rawSetMessages] = useState<ChatMessage[]>(initial ?? []);
  const messagesRef = useRef<ChatMessage[]>(messages);
  const setMessages = useCallback(
    (action: React.SetStateAction<ChatMessage[]>): void => {
      const next =
        typeof action === "function" ? action(messagesRef.current) : action;
      messagesRef.current = next;
      rawSetMessages(next);
    },
    [],
  );
  return { messages, setMessages, messagesRef };
}
