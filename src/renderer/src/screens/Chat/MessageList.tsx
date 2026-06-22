import { memo, useMemo } from "react";
import { HermesAvatar, MessageRow } from "./MessageRow";
import { ReasoningRow, ToolActivityGroup } from "./HistoryRow";
import { ClarifyCard } from "./ClarifyCard";
import { QueuedPromptRow } from "./QueuedMessages";
import { buildQueueAwareRenderPlan } from "./queueAnchoring";
import type {
  ChatMessage,
  ClarifyMessage,
  QueuedMessage,
  ToolCallMessage,
  ToolResultMessage,
} from "./types";

function isToolRow(m: ChatMessage): m is ToolCallMessage | ToolResultMessage {
  const k = (m as { kind?: string }).kind;
  return k === "tool_call" || k === "tool_result";
}

interface MessageListProps {
  messages: ChatMessage[];
  queuedMessages: QueuedMessage[];
  isLoading: boolean;
  toolProgress: string | null;
  onApprove: () => void;
  onDeny: () => void;
  /** Mark an inline clarify card resolved once the user answers/skips. */
  onClarifyResolved: (requestId: string, answer: string) => void;
  onRemoveQueued: (id: string) => void;
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
  queuedMessages,
  isLoading,
  toolProgress,
  onApprove,
  onDeny,
  onClarifyResolved,
  onRemoveQueued,
}: MessageListProps): React.JSX.Element {
  // Queue markers and already-sent queued prompts are placed only in this
  // visual plan. The canonical array remains untouched for stream reducers.
  const visibleItems = useMemo(
    () =>
      buildQueueAwareRenderPlan(messages, queuedMessages).filter((item) => {
        if (item.type === "queued") return true;
        const message = item.message;
        if (!isBubble(message)) return true;
        return (
          !!message.error ||
          ((message.content as string) || "").trim().length > 0
        );
      }),
    [messages, queuedMessages],
  );

  const lastBubble = [...messages].reverse().find(isBubble);
  const lastMessageIsAgent = !!lastBubble && lastBubble.role === "agent";

  // Render plan: bubble/reasoning rows pass through one-to-one, but a
  // contiguous run of tool_call/tool_result rows folds into a single
  // ToolActivityGroup (collapsed by default) instead of one bubble per call.
  const rows: React.JSX.Element[] = [];
  let previousMessage: ChatMessage | undefined;
  for (let i = 0; i < visibleItems.length; i++) {
    const item = visibleItems[i];
    if (item.type === "queued") {
      rows.push(
        <QueuedPromptRow
          key={item.message.id}
          message={item.message}
          onRemove={onRemoveQueued}
        />,
      );
      continue;
    }

    const msg = item.message;
    // One avatar per turn: show it only on the first row of a contiguous run
    // of same-role rows. The agent turn's thinking/tool rows + answer bubble
    // share one avatar; the continuation rows render a spacer.
    const previousTurnId =
      previousMessage && isBubble(previousMessage)
        ? previousMessage.turnId
        : undefined;
    const currentTurnId = isBubble(msg) ? msg.turnId : undefined;
    const showAvatar =
      !previousMessage ||
      previousMessage.role !== msg.role ||
      (!!previousTurnId && !!currentTurnId && previousTurnId !== currentTurnId);

    if (isToolRow(msg)) {
      // Collect the whole run of consecutive tool rows.
      const group: (ToolCallMessage | ToolResultMessage)[] = [];
      const start = i;
      while (i < visibleItems.length) {
        const candidate = visibleItems[i];
        if (candidate.type !== "message" || !isToolRow(candidate.message)) {
          break;
        }
        group.push(candidate.message);
        i++;
      }
      i--; // step back: the for-loop's i++ advances past the run
      const hasMessageAfter = visibleItems
        .slice(i + 1)
        .some((candidate) => candidate.type === "message");
      rows.push(
        <ToolActivityGroup
          key={`${group[0].id}-${start}`}
          items={group}
          // Active (spinner) only while streaming and this run is trailing.
          active={isLoading && !hasMessageAfter}
          showAvatar={showAvatar}
        />,
      );
      previousMessage = group[group.length - 1];
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
          active={
            isLoading &&
            !visibleItems
              .slice(i + 1)
              .some((candidate) => candidate.type === "message")
          }
          showAvatar={showAvatar}
        />,
      );
      previousMessage = msg;
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
      previousMessage = msg;
      continue;
    }

    const bubble = msg as Extract<ChatMessage, { role: "user" | "agent" }>;
    rows.push(
      <MessageRow
        key={msg.id}
        msg={bubble}
        isLast={
          !visibleItems
            .slice(i + 1)
            .some((candidate) => candidate.type === "message")
        }
        isLoading={isLoading}
        onApprove={onApprove}
        onDeny={onDeny}
        showAvatar={showAvatar}
      />,
    );
    // A visually relocated queued user bubble is an annotation inside the
    // earlier agent turn, not a boundary for grouping that turn's remaining
    // reasoning/tool rows. The next real turn still gets a fresh avatar via
    // its distinct turnId at the canonical end of the transcript.
    if (!(isBubble(msg) && msg.role === "user" && msg.queueAnchor)) {
      previousMessage = msg;
    }
  }

  return (
    <>
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
