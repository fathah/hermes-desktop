import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { HermesAvatar, MessageRow } from "./MessageRow";
import { ReasoningRow, ToolActivityGroup } from "./HistoryRow";
import { ClarifyCard } from "./ClarifyCard";
import { useI18n } from "../../components/useI18n";
import type {
  ChatMessage,
  ClarifyMessage,
  ToolCallMessage,
  ToolResultMessage,
} from "./types";

/**
 * How many trailing rows are rendered by default in long transcripts.
 *
 * `content-visibility` (#769) bounds the *paint* cost of off-screen rows, but
 * every row still exists in the React tree: each streaming delta re-runs the
 * transcript render, so reconciliation stays O(all rows). In sessions with
 * hundreds of messages that competes with typing on the main thread — the
 * remaining half of the #748 input-lag issue. Windowing bounds the tree
 * itself; earlier rows stay one click away.
 */
export const TRANSCRIPT_WINDOW = 100;

function isToolRow(m: ChatMessage): m is ToolCallMessage | ToolResultMessage {
  const k = (m as { kind?: string }).kind;
  return k === "tool_call" || k === "tool_result";
}

interface MessageListProps {
  messages: ChatMessage[];
  isLoading: boolean;
  toolProgress: string | null;
  onApprove: () => void;
  onDeny: () => void;
  /** Mark an inline clarify card resolved once the user answers/skips. */
  onClarifyResolved: (requestId: string, answer: string) => void;
}

function TypingIndicator({
  toolProgress,
}: {
  toolProgress: string | null;
}): React.JSX.Element {
  return (
    <div className="chat-message chat-message-agent">
      <HermesAvatar active />
      <div className="chat-bubble chat-bubble-agent">
        {toolProgress ? (
          <div className="chat-tool-progress">{toolProgress}</div>
        ) : (
          <div className="chat-typing">
            <span className="chat-typing-dot" />
            <span className="chat-typing-dot" />
            <span className="chat-typing-dot" />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Bubble messages are filtered to "has content". History items (reasoning,
 * tool_call, tool_result) are *always* shown — they're collapsed by default
 * and the user opens them. Filtering them by content would defeat the point.
 */
function isBubble(m: ChatMessage): m is import("./types").ChatBubbleMessage {
  // Bubble messages have no `kind` field (or kind === "user"/"assistant").
  // History items have kind === "reasoning" | "tool_call" | "tool_result".
  const k = (m as { kind?: string }).kind;
  return !k || k === "user" || k === "assistant";
}

export const MessageList = memo(function MessageList({
  messages,
  isLoading,
  toolProgress,
  onApprove,
  onDeny,
  onClarifyResolved,
}: MessageListProps): React.JSX.Element {
  const { t } = useI18n();
  // Rows the user expanded beyond the default window. Kept as a count of
  // *extra* rows (not an absolute index) so the mounted tree stays bounded:
  // the window slides forward as new rows stream in, re-collapsing the oldest
  // revealed rows rather than growing without limit. Native scroll anchoring
  // keeps the viewport steady when rows unmount above it.
  const [extraRows, setExtraRows] = useState(0);

  // Reset the expansion when the component is reused for a different
  // conversation (same mounted screen, new session/clear): otherwise a large
  // expanded budget carries over and re-mounts hundreds of rows in the next
  // long chat. The first message id is stable within a conversation
  // (transcripts are append-only), so it works as the conversation identity.
  const conversationId = messages[0]?.id;
  const [prevConversationId, setPrevConversationId] = useState(conversationId);
  if (conversationId !== prevConversationId) {
    setPrevConversationId(conversationId);
    setExtraRows(0);
  }

  // ── Scroll-driven expansion (infinite history) ────────────────────────────
  // Scrolling to the top marker reveals the next window automatically; the
  // button remains as a fallback (keyboard users, jsdom, old engines).
  const earlierMarkerRef = useRef<HTMLDivElement | null>(null);
  // Scroll-position snapshot taken just before rows are prepended, so the
  // content the user is reading doesn't jump when the window grows.
  const scrollAdjustRef = useRef<{
    container: HTMLElement;
    scrollHeight: number;
    scrollTop: number;
  } | null>(null);

  // Rows currently rendered (windowed count), snapshotted each render so
  // expandEarlier can derive the next budget from the *effective* cut.
  const renderedCountRef = useRef(0);

  const expandEarlier = useCallback(() => {
    const container = earlierMarkerRef.current?.closest(
      ".chat-messages",
    ) as HTMLElement | null;
    if (container) {
      scrollAdjustRef.current = {
        container,
        scrollHeight: container.scrollHeight,
        scrollTop: container.scrollTop,
      };
    }
    // Reveal exactly one window below the current effective cut. Deriving the
    // budget from the rendered count (instead of incrementing it) guarantees
    // every click makes progress even when the cut was nudged for a tool run.
    setExtraRows(renderedCountRef.current);
  }, []);

  // Restore the viewport after the newly revealed rows commit (pre-paint, so
  // there is no visible flicker): keep the previously-visible content where
  // it was by offsetting scrollTop by the height the new rows added.
  useLayoutEffect(() => {
    const adjust = scrollAdjustRef.current;
    if (!adjust) return;
    scrollAdjustRef.current = null;
    const { container, scrollHeight, scrollTop } = adjust;
    container.scrollTop = scrollTop + (container.scrollHeight - scrollHeight);
  }, [extraRows]);

  // Auto-expand when the marker approaches the viewport (Claude-style).
  // rootMargin preloads one step before the user actually hits the top, so
  // scrolling up feels continuous. After each expansion the restored scroll
  // position pushes the marker back out of view, naturally re-arming the
  // observer for the next step. (Effect lives below, after the window math
  // determines whether hidden rows exist.)

  // Bubbles with empty content are still hidden (live-stream placeholders).
  // History rows pass through unconditionally.
  const visibleMessages = useMemo(
    () =>
      messages.filter((m) => {
        if (!isBubble(m)) return true;
        return !!m.error || ((m.content as string) || "").trim().length > 0;
      }),
    [messages],
  );

  // The newest *visible* bubble carries the last-row marker (active avatar
  // while streaming, approval bar after). Keying this off the bubble — rather
  // than "is literally the trailing row" — keeps the approval controls when
  // reasoning/tool rows trail the bubble that asked for approval.
  let lastVisibleBubbleIndex = -1;
  for (let i = visibleMessages.length - 1; i >= 0; i--) {
    if (isBubble(visibleMessages[i])) {
      lastVisibleBubbleIndex = i;
      break;
    }
  }
  const lastVisibleBubbleId =
    lastVisibleBubbleIndex >= 0
      ? visibleMessages[lastVisibleBubbleIndex].id
      : undefined;

  // Window: render only the trailing rows; earlier ones collapse behind a
  // "show earlier" button. The cut is clamped so the newest bubble is never
  // sliced out (a long trailing run of reasoning/tool rows must not window
  // away the bubble that owns the approval bar), then nudged back to the
  // start of a tool run so a ToolActivityGroup is never split in half. The
  // nudge is bounded to one window: a pathological run of hundreds of
  // contiguous tool rows splits at the bound instead of walking the cut all
  // the way back and defeating the windowing cap.
  const windowLimit = TRANSCRIPT_WINDOW + extraRows;
  let windowStart = Math.max(0, visibleMessages.length - windowLimit);
  if (lastVisibleBubbleIndex >= 0 && windowStart > lastVisibleBubbleIndex) {
    windowStart = lastVisibleBubbleIndex;
  }
  const nudgeFloor = Math.max(0, windowStart - TRANSCRIPT_WINDOW);
  while (windowStart > nudgeFloor && isToolRow(visibleMessages[windowStart])) {
    windowStart--;
  }
  const hiddenCount = windowStart;
  const windowedMessages =
    windowStart > 0 ? visibleMessages.slice(windowStart) : visibleMessages;
  renderedCountRef.current = windowedMessages.length;

  // The button label counts hidden *messages* (user/agent bubbles), not raw
  // rows — reasoning and tool rows would triple the number in agentic
  // sessions. All-history heads (no hidden bubble at all) fall back to the
  // row count rather than showing zero.
  const hiddenMessageCount = useMemo(() => {
    let n = 0;
    for (let i = 0; i < windowStart; i++) {
      if (isBubble(visibleMessages[i])) n++;
    }
    return n;
  }, [visibleMessages, windowStart]);

  // Observe the top marker while rows are hidden (see comment block above).
  // `extraRows` is a dependency on purpose: IntersectionObserver only reports
  // *transitions*, so after an expansion whose revealed content is shorter
  // than the rootMargin (e.g. 100 tool rows folding into one collapsed group)
  // the marker never leaves the zone and a persistent observer would go
  // silent. Recreating it re-delivers an initial entry, which keeps the
  // auto-load going until the marker is genuinely out of range.
  const hasEarlier = hiddenCount > 0;
  useEffect(() => {
    const marker = earlierMarkerRef.current;
    if (!marker || !hasEarlier) return;
    if (typeof IntersectionObserver === "undefined") return; // jsdom/old engines
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) expandEarlier();
      },
      {
        root: marker.closest(".chat-messages"),
        rootMargin: "300px 0px 0px 0px",
      },
    );
    observer.observe(marker);
    return () => observer.disconnect();
  }, [hasEarlier, extraRows, expandEarlier]);

  // The row hidden just above the window cut. Avatar grouping consults it so
  // a continuation row at the cut doesn't masquerade as a new turn.
  const beforeWindow: ChatMessage | undefined =
    windowStart > 0 ? visibleMessages[windowStart - 1] : undefined;

  // Last bubble without cloning the array on every streaming delta.
  let lastBubble: ChatMessage | undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (isBubble(messages[i])) {
      lastBubble = messages[i];
      break;
    }
  }
  const lastMessageIsAgent = !!lastBubble && lastBubble.role === "agent";

  // Render plan: bubble/reasoning rows pass through one-to-one, but a
  // contiguous run of tool_call/tool_result rows folds into a single
  // ToolActivityGroup (collapsed by default) instead of one bubble per call.
  const rows: React.JSX.Element[] = [];
  for (let i = 0; i < windowedMessages.length; i++) {
    const msg = windowedMessages[i];
    // One avatar per turn: show it only on the first row of a contiguous run
    // of same-role rows. The agent turn's thinking/tool rows + answer bubble
    // share one avatar; the continuation rows render a spacer. At the window
    // cut, the hidden row above the cut is consulted so a mid-turn cut does
    // not fake a new turn.
    const prev = i === 0 ? beforeWindow : windowedMessages[i - 1];
    const showAvatar = !prev || prev.role !== msg.role;

    if (isToolRow(msg)) {
      // Collect the whole run of consecutive tool rows.
      const group: (ToolCallMessage | ToolResultMessage)[] = [];
      const start = i;
      while (i < windowedMessages.length && isToolRow(windowedMessages[i])) {
        group.push(windowedMessages[i] as ToolCallMessage | ToolResultMessage);
        i++;
      }
      i--; // step back: the for-loop's i++ advances past the run
      const groupPrev =
        start === 0 ? beforeWindow : windowedMessages[start - 1];
      rows.push(
        <ToolActivityGroup
          key={`${group[0].id}-${windowStart + start}`}
          items={group}
          // Active (spinner) only while streaming and this run is trailing.
          active={isLoading && i === windowedMessages.length - 1}
          showAvatar={!groupPrev || groupPrev.role !== "agent"}
        />,
      );
      continue;
    }

    const k = (msg as { kind?: string }).kind;
    if (k === "reasoning") {
      rows.push(
        <ReasoningRow
          key={msg.id}
          msg={msg as Extract<ChatMessage, { kind: "reasoning" }>}
          // Still "Thinking…" only while this is the last row and the turn is
          // streaming; once the answer arrives (or history loads) it becomes
          // a completed "Thought".
          active={isLoading && i === windowedMessages.length - 1}
          showAvatar={showAvatar}
        />,
      );
      continue;
    }

    if (k === "clarify") {
      rows.push(
        <ClarifyCard
          key={msg.id}
          msg={msg as ClarifyMessage}
          onResolved={onClarifyResolved}
        />,
      );
      continue;
    }

    const bubble = msg as Extract<ChatMessage, { role: "user" | "agent" }>;
    rows.push(
      <MessageRow
        key={msg.id}
        msg={bubble}
        // Last-bubble marker (approval bar, active avatar) belongs to the
        // newest visible bubble even when reasoning/tool rows trail it.
        isLast={msg.id === lastVisibleBubbleId}
        isLoading={isLoading}
        onApprove={onApprove}
        onDeny={onDeny}
        showAvatar={showAvatar}
      />,
    );
  }

  return (
    <>
      {hiddenCount > 0 && (
        <div className="chat-transcript-earlier" ref={earlierMarkerRef}>
          <button
            type="button"
            className="chat-transcript-earlier-btn"
            onClick={expandEarlier}
          >
            {t("chat.showEarlierMessages", {
              count: hiddenMessageCount > 0 ? hiddenMessageCount : hiddenCount,
            })}
          </button>
        </div>
      )}

      {rows}

      {isLoading && !lastMessageIsAgent && (
        <TypingIndicator toolProgress={toolProgress} />
      )}

      {isLoading && toolProgress && lastMessageIsAgent && (
        <div className="chat-tool-progress-inline">{toolProgress}</div>
      )}
    </>
  );
});
