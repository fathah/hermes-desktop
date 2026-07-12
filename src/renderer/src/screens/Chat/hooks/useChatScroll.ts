import { useCallback, useEffect, useRef } from "react";
import type { ChatMessage } from "../types";

/**
 * Auto-scroll behavior for the chat messages container.
 *
 * - Tracks whether the user has manually scrolled up; pauses auto-scroll in that case.
 * - Re-engages auto-scroll when a new user message is sent.
 * - Exposes the container ref and a bottom sentinel ref to be placed in JSX.
 */
export function useChatScroll(messages: ChatMessage[]): {
  containerRef: React.RefObject<HTMLDivElement | null>;
  bottomRef: React.RefObject<HTMLDivElement | null>;
} {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);
  const prevMessageCountRef = useRef(messages.length);
  const initialScrollDoneRef = useRef(false);

  const scrollToBottom = useCallback((force?: boolean, instant?: boolean) => {
    if (!force && userScrolledUpRef.current) return;
    bottomRef.current?.scrollIntoView({
      behavior: instant ? "auto" : "smooth",
    });
  }, []);

  // Track manual scroll position
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    function handleScroll(): void {
      const el = container!;
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
      userScrolledUpRef.current = !atBottom;
    }
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  // Auto-scroll on incoming messages; force-scroll when user sends a new one
  useEffect(() => {
    const prevCount = prevMessageCountRef.current;
    prevMessageCountRef.current = messages.length;
    // History (re)load — first non-empty paint of a transcript: jump to the
    // bottom instantly. A smooth multi-frame scroll from the top races the
    // transcript windowing's auto-expand observer (the top marker is still in
    // view when the observer's first callback is delivered), and its scroll
    // restore would abort the smooth scroll and strand the view mid-transcript.
    const historyLoaded =
      messages.length > 0 &&
      (!initialScrollDoneRef.current || prevCount === 0);
    if (messages.length > 0) initialScrollDoneRef.current = true;
    if (historyLoaded) {
      userScrolledUpRef.current = false;
      scrollToBottom(true, true);
      return;
    }
    const userJustSent =
      messages.length > prevCount &&
      messages[messages.length - 1]?.role === "user";
    if (userJustSent) {
      userScrolledUpRef.current = false;
      scrollToBottom(true);
    } else {
      scrollToBottom();
    }
  }, [messages, scrollToBottom]);

  return { containerRef, bottomRef };
}
