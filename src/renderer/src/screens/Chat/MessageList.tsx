import { memo, useMemo } from "react";
import { HermesAvatar, MessageRow } from "./MessageRow";
import { ReasoningRow, ToolCallRow, ToolResultRow } from "./HistoryRow";
import type { ChatMessage } from "./types";

interface MessageListProps {
  messages: ChatMessage[];
  isLoading: boolean;
  toolProgress: string | null;
  onApprove: () => void;
  onDeny: () => void;
}

function TypingIndicator({
  toolProgress,
}: {
  toolProgress: string | null;
}): React.JSX.Element {
  return (
    <div className="chat-message chat-message-agent">
      <HermesAvatar />
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
}: MessageListProps): React.JSX.Element {
  // Bubbles with empty content are still hidden (live-stream placeholders).
  // History rows pass through unconditionally.
  const visibleMessages = useMemo(
    () =>
      messages.filter((m) => {
        if (!isBubble(m)) return true;
        return ((m.content as string) || "").trim().length > 0;
      }),
    [messages],
  );

  const lastBubble = [...messages].reverse().find(isBubble);
  const lastMessageIsAgent = !!lastBubble && lastBubble.role === "agent";

  return (
    <>
      {visibleMessages.map((msg, i) => {
        const k = (msg as { kind?: string }).kind;
        // One avatar per turn: show it only on the first row of a contiguous
        // run of same-role rows. An agent turn's thinking/tool rows + answer
        // bubble share one avatar; the continuation rows render a spacer.
        const prev = visibleMessages[i - 1];
        const showAvatar = !prev || prev.role !== msg.role;
        if (k === "reasoning") {
          return (
            <ReasoningRow
              key={msg.id}
              msg={msg as Extract<ChatMessage, { kind: "reasoning" }>}
              // Still "Thinking…" only while this is the last row and the turn
              // is streaming; once the answer arrives (or history loads) it
              // becomes a completed "Thought".
              active={isLoading && i === visibleMessages.length - 1}
              showAvatar={showAvatar}
            />
          );
        }
        if (k === "tool_call") {
          return (
            <ToolCallRow
              key={msg.id}
              msg={msg as Extract<ChatMessage, { kind: "tool_call" }>}
              showAvatar={showAvatar}
            />
          );
        }
        if (k === "tool_result") {
          return (
            <ToolResultRow
              key={msg.id}
              msg={msg as Extract<ChatMessage, { kind: "tool_result" }>}
              showAvatar={showAvatar}
            />
          );
        }
        const bubble = msg as Extract<ChatMessage, { role: "user" | "agent" }>;
        return (
          <MessageRow
            key={msg.id}
            msg={bubble}
            isLast={i === visibleMessages.length - 1}
            isLoading={isLoading}
            onApprove={onApprove}
            onDeny={onDeny}
            showAvatar={showAvatar}
          />
        );
      })}

      {isLoading && !lastMessageIsAgent && (
        <TypingIndicator toolProgress={toolProgress} />
      )}

      {isLoading && toolProgress && lastMessageIsAgent && (
        <div className="chat-tool-progress-inline">{toolProgress}</div>
      )}
    </>
  );
});
