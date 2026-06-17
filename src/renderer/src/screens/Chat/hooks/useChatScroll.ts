import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../types";

/**
 * Auto-scroll behavior for the chat messages container.
 *
 * - Tracks whether the user has manually scrolled up; pauses auto-scroll in that case.
 * - Re-engages auto-scroll when a new user message is sent.
 * - Exposes the container ref, bottom sentinel ref, and scroll state.
 */
export function useChatScroll(messages: ChatMessage[]): {
  containerRef: React.RefObject<HTMLDivElement | null>;
  bottomRef: React.RefObject<HTMLDivElement | null>;
  isScrolledUp: boolean;
  scrollToBottomNow: () => void;
} {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);
  const prevMessageCountRef = useRef(messages.length);
  const [isScrolledUp, setIsScrolledUp] = useState(false);

  const scrollToBottom = useCallback((force?: boolean) => {
    if (!force && userScrolledUpRef.current) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const scrollToBottomNow = useCallback(() => {
    userScrolledUpRef.current = false;
    setIsScrolledUp(false);
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Track manual scroll position
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    function handleScroll(): void {
      const el = container!;
      const atBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight < 60;
      userScrolledUpRef.current = !atBottom;
      setIsScrolledUp(!atBottom);
    }
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  // Auto-scroll on incoming messages; force-scroll when user sends a new one
  useEffect(() => {
    const prevCount = prevMessageCountRef.current;
    prevMessageCountRef.current = messages.length;
    const userJustSent =
      messages.length > prevCount &&
      messages[messages.length - 1]?.role === "user";
    if (userJustSent) {
      userScrolledUpRef.current = false;
      setIsScrolledUp(false);
      scrollToBottom(true);
    } else {
      scrollToBottom();
    }
  }, [messages, scrollToBottom]);

  return { containerRef, bottomRef, isScrolledUp, scrollToBottomNow };
}
