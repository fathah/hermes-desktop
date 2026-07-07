import { memo, useMemo, Fragment } from "react";
import type { RefObject } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Check,
  FilePlus2,
  ShieldAlert,
  Sparkles,
  Brain,
  Cpu,
  Bot,
} from "lucide-react";
import { HermesAvatar, AvatarSpacer, MessageRow } from "./MessageRow";
import { ToolGroupRow } from "./HistoryRow";
import { isCompressionSummary } from "./contextGauge";
import { useTtsPlayback } from "./hooks/useTtsPlayback";
import { StreamingText } from "./StreamingText";
import { AgentMarkdown } from "../../components/AgentMarkdown";
import type {
  ChatMessage,
  ToolGroupMessage,
  ReasoningMessage,
  ToolCallMessage,
  ToolResultMessage,
  CouncilTurnMessage,
} from "./types";

interface MessageListProps {
  messages: ChatMessage[];
  isLoading: boolean;
  toolProgress: string | null;
  /** Active profile — routes TTS synthesis to the right key. */
  profile?: string;
  onApprove: () => void;
  onDeny: () => void;
  onAdoptResponse?: (
    messageId: string | number,
    councilGroupId: string,
    responseContent: string,
    model: string,
    provider: string,
  ) => void;
  onSteelmanCritique?: (
    responses: Array<{
      seatName?: string;
      model: string;
      provider: string;
      content: string;
      verdict?: import("../../../../shared/council").CouncilVerdict;
    }>,
  ) => void;
  onSaveCouncilArtifact?: (turn: CouncilTurnMessage) => void;
  scrollRef?: RefObject<HTMLElement | null>;
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

function CouncilColumnHeader({
  provider,
  label,
  status,
  error,
}: {
  provider: string;
  label: string;
  status: string;
  error?: string;
}): React.JSX.Element {
  let Icon = Bot;
  let color = "#8e8e93";

  const p = provider.toLowerCase();
  if (p.includes("anthropic") || p.includes("claude")) {
    Icon = Sparkles;
    color = "#e05a47";
  } else if (p.includes("openai") || p.includes("gpt")) {
    Icon = Brain;
    color = "#10a37f";
  } else if (p.includes("google") || p.includes("gemini")) {
    Icon = Cpu;
    color = "#4285f4";
  } else if (p.includes("deepseek")) {
    Icon = Bot;
    color = "#0052ff";
  }

  return (
    <div className="chat-council-col-header">
      <div className="chat-council-col-title">
        <Icon size={13} style={{ color }} />
        <span>{label.split("/").pop()}</span>
      </div>
      <div
        className="chat-council-col-status"
        style={{ color: error ? "var(--btn-danger)" : undefined }}
      >
        {error ? "Error" : status}
      </div>
    </div>
  );
}

/**
 * Bubble messages have no `kind` field (or kind === "user"/"assistant").
 * History items have kind === "reasoning" | "tool_call" | "tool_result" | "council_turn".
 */
function isBubble(
  m: ChatMessage,
): m is
  | import("./types").ChatBubbleMessage
  | import("./types").CouncilTurnMessage {
  const k = (m as { kind?: string }).kind;
  return !k || k === "user" || k === "assistant" || k === "council_turn";
}

export const MessageList = memo(function MessageList({
  messages,
  isLoading,
  toolProgress,
  profile,
  onApprove,
  onDeny,
  onAdoptResponse,
  onSteelmanCritique,
  onSaveCouncilArtifact,
  scrollRef,
}: MessageListProps): React.JSX.Element {
  const tts = useTtsPlayback(profile);

  // Group consecutive non-bubble messages (reasoning, tool_call, tool_result)
  // into a single tool_group block.
  const groupedMessages = useMemo(() => {
    const list: ChatMessage[] = [];
    for (const m of messages) {
      if (isBubble(m)) {
        if (
          m.kind !== "council_turn" &&
          ((m.content as string) || "").trim().length === 0
        )
          continue;
        list.push(m);
      } else {
        const last = list[list.length - 1];
        if (last && last.kind === "tool_group") {
          (last as ToolGroupMessage).messages.push(
            m as ReasoningMessage | ToolCallMessage | ToolResultMessage,
          );
        } else {
          list.push({
            id: `group-${m.id}`,
            kind: "tool_group",
            role: "agent",
            messages: [
              m as ReasoningMessage | ToolCallMessage | ToolResultMessage,
            ],
          });
        }
      }
    }
    return list;
  }, [messages]);

  const lastBubble = [...messages].reverse().find(isBubble);
  const lastMessageIsAgent = !!lastBubble && lastBubble.role === "agent";

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual is intentionally left outside React Compiler memoization.
  const rowVirtualizer = useVirtualizer({
    count: groupedMessages.length,
    getScrollElement: () => scrollRef?.current ?? null,
    estimateSize: () => 112,
    overscan: 8,
    getItemKey: (index) => groupedMessages[index]?.id ?? index,
  });

  const renderRow = (msg: ChatMessage, i: number): React.JSX.Element => {
    const k = (msg as { kind?: string }).kind;
    // One avatar per turn: show it only on the first row of a contiguous
    // run of same-role rows. An agent turn's thinking/tool rows + answer
    // bubble share one avatar; the continuation rows render a spacer.
    const prev = groupedMessages[i - 1];
    const showAvatar = !prev || prev.role !== msg.role;

    if (k === "tool_group") {
      const active = isLoading && i === groupedMessages.length - 1;
      return (
        // Key on identity only — folding `active` into the key remounts the
        // row when the stream finishes, collapsing any <details> the user
        // expanded mid-stream. `active` is just a prop.
        <ToolGroupRow
          msg={msg as ToolGroupMessage}
          active={active}
          showAvatar={showAvatar}
        />
      );
    }

    if (k === "council_turn") {
      const councilMsg = msg as CouncilTurnMessage;
      const responses = Object.entries(councilMsg.responses);
      const isAnyLoading = responses.some(([, r]) => r.isLoading);

      return (
        <div className="chat-message chat-message-agent">
          {showAvatar ? <HermesAvatar /> : <AvatarSpacer />}
          <div style={{ width: "100%" }}>
            <div className="chat-council-turn">
              {responses.map(([key, r]) => {
                const statusText = r.isLoading ? "Streaming..." : "Done";
                return (
                  <div key={key} className="chat-council-col">
                    <CouncilColumnHeader
                      provider={r.provider}
                      label={
                        r.seatName
                          ? `${r.seatName} · ${r.modelLabel}`
                          : r.modelLabel
                      }
                      status={statusText}
                      error={r.error}
                    />
                    <div className="chat-council-col-body">
                      {(r.toolProgress || r.approval) && (
                        <div className="chat-council-status-stack">
                          {r.toolProgress && (
                            <div className="chat-tool-progress">
                              {r.toolProgress}
                            </div>
                          )}
                          {r.approval && (
                            <div className="chat-council-approval">
                              {r.approval}
                            </div>
                          )}
                        </div>
                      )}
                      {r.reasoning && (
                        <details className="chat-reasoning" open>
                          <summary>Thinking process</summary>
                          <div
                            className="chat-reasoning-text"
                            style={{ whiteSpace: "pre-wrap", opacity: 0.8 }}
                          >
                            {r.reasoning}
                          </div>
                        </details>
                      )}
                      {r.error ? (
                        <div
                          className="chat-error-text"
                          style={{ color: "var(--btn-danger)" }}
                        >
                          Error: {r.error}
                        </div>
                      ) : r.content && r.isLoading ? (
                        <StreamingText>{r.content}</StreamingText>
                      ) : r.content ? (
                        <AgentMarkdown>{r.content}</AgentMarkdown>
                      ) : (
                        <div className="chat-typing-inline">Thinking...</div>
                      )}
                    </div>
                    <div className="chat-council-col-footer">
                      {r.verdict && (
                        <span className={`chat-council-verdict ${r.verdict}`}>
                          {r.verdict}
                        </span>
                      )}
                      <button
                        className="chat-council-col-action"
                        disabled={r.isLoading || !r.content}
                        onClick={() => {
                          if (onAdoptResponse) {
                            onAdoptResponse(
                              r.messageId || key,
                              councilMsg.id,
                              r.content,
                              r.model,
                              r.provider,
                            );
                          }
                        }}
                        type="button"
                      >
                        <Check size={12} /> Adopt
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            {!isAnyLoading && (onSteelmanCritique || onSaveCouncilArtifact) && (
              <div className="chat-council-synthesize-bar">
                {onSteelmanCritique && (
                  <button
                    className="chat-council-synthesize-btn"
                    onClick={() => {
                      const allResponses = responses.map(([, r]) => ({
                        seatName: r.seatName,
                        model: r.model,
                        provider: r.provider,
                        content: r.content,
                        verdict: r.verdict,
                      }));
                      onSteelmanCritique(allResponses);
                    }}
                    type="button"
                  >
                    <ShieldAlert size={13} /> Synthesize Consensus & Steelman
                  </button>
                )}
                {onSaveCouncilArtifact && (
                  <button
                    className="chat-council-synthesize-btn"
                    onClick={() => onSaveCouncilArtifact(councilMsg)}
                    type="button"
                  >
                    <FilePlus2 size={13} /> Save to SPS
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      );
    }

    const bubble = msg as Extract<ChatMessage, { role: "user" | "agent" }>;
    // Mark the point where the gateway compacted context (idea A3) so a
    // mid-conversation summary doesn't read like the agent's own message.
    const compressed =
      bubble.role === "agent" &&
      isCompressionSummary(
        ((bubble as { content?: unknown }).content as string) || "",
      );
    return (
      <>
        {compressed && (
          <div className="chat-compress-marker">Context compressed</div>
        )}
        <MessageRow
          msg={bubble}
          isLast={i === groupedMessages.length - 1}
          isLoading={isLoading}
          onApprove={onApprove}
          onDeny={onDeny}
          streaming={
            isLoading &&
            bubble.role === "agent" &&
            i === groupedMessages.length - 1
          }
          showAvatar={showAvatar}
          ttsHasKey={tts.hasKey}
          ttsSpeaking={tts.playingId === bubble.id}
          ttsBusy={tts.busyId === bubble.id}
          onSpeak={() =>
            tts.playingId === bubble.id
              ? tts.stop()
              : tts.play(
                  bubble.id,
                  ((bubble as { content?: unknown }).content as string) || "",
                )
          }
        />
      </>
    );
  };

  const shouldVirtualize = !!scrollRef;

  return (
    <>
      {shouldVirtualize ? (
        <div
          className="chat-message-virtual-list"
          style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const msg = groupedMessages[virtualRow.index];
            return (
              <div
                key={virtualRow.key}
                className="chat-message-virtual-row"
                data-index={virtualRow.index}
                ref={rowVirtualizer.measureElement}
                style={{ transform: `translateY(${virtualRow.start}px)` }}
              >
                <div className="chat-message-virtual-row-inner">
                  {renderRow(msg, virtualRow.index)}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        groupedMessages.map((msg, i) => (
          <Fragment key={msg.id}>{renderRow(msg, i)}</Fragment>
        ))
      )}

      {isLoading && !lastMessageIsAgent && (
        <TypingIndicator toolProgress={toolProgress} />
      )}

      {isLoading && toolProgress && lastMessageIsAgent && (
        <div className="chat-tool-progress-inline">{toolProgress}</div>
      )}
    </>
  );
});
