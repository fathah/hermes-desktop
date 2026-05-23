import { memo, useMemo } from "react";
import { HermesAvatar, MessageRow } from "./MessageRow";
import { ReasoningRow, ToolCallRow, ToolResultRow } from "./HistoryRow";
import type { ChatMessage } from "./types";
import { isBubbleMessage } from "./types";

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

// Bubble messages are filtered to "has content". History items (reasoning,
// tool_call, tool_result) are *always* shown — they're collapsed by default
// and the user opens them. Filtering them by content would defeat the point.
// The `isBubbleMessageMessage` type guard lives in `./types` so the other consumers
// (transcript builder, send-to-agent history, live-stream chunk append) can
// share the exact same narrowing rule.

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
        if (!isBubbleMessage(m)) return true;
        return ((m.content as string) || "").trim().length > 0;
      }),
    [messages],
  );

  const lastBubble = [...messages].reverse().find(isBubbleMessage);
  const lastMessageIsAgent = !!lastBubble && lastBubble.role === "agent";

  return (
    <>
      {visibleMessages.map((msg, i) => {
        // Discriminated-union dispatch — TS narrows `msg` to each variant
        // exhaustively, so the per-row component receives the correctly
        // typed value with no manual cast.
        if (msg.kind === "reasoning") {
          return <ReasoningRow key={msg.id} msg={msg} />;
        }
        if (msg.kind === "tool_call") {
          return <ToolCallRow key={msg.id} msg={msg} />;
        }
        if (msg.kind === "tool_result") {
          return <ToolResultRow key={msg.id} msg={msg} />;
        }
        // After the discriminant checks above, `msg` is `ChatBubbleMessage`.
        return (
          <MessageRow
            key={msg.id}
            msg={msg}
            isLast={i === visibleMessages.length - 1}
            isLoading={isLoading}
            onApprove={onApprove}
            onDeny={onDeny}
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
