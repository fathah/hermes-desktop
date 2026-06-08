import { memo, useMemo, useState } from "react";
import { useI18n } from "../../components/useI18n";
import { AttachmentChip } from "../../components/AttachmentChip";
import { HermesAvatar, AvatarSpacer } from "./MessageRow";
import { ToolDiff } from "./ToolDiff";
import { parseFileEditToolCall } from "./toolEditParse";
import type {
  Attachment,
  ReasoningMessage,
  ToolCallMessage,
  ToolResultMessage,
  ToolGroupMessage,
} from "./types";

/* ── Shared primitive ─────────────────────────────────────────────────── */

interface CollapsibleSectionProps {
  variant: "reasoning" | "tool-call" | "tool-result";
  header: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

const Chevron = memo(function Chevron({
  open,
}: {
  open: boolean;
}): React.JSX.Element {
  return (
    <span
      className={`chat-history-chevron ${
        open ? "chat-history-chevron--open" : ""
      }`}
      aria-hidden="true"
    >
      ▸
    </span>
  );
});

const CollapsibleSection = memo(function CollapsibleSection({
  variant,
  header,
  defaultOpen = false,
  children,
}: CollapsibleSectionProps): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details
      className={`chat-history chat-history--${variant}`}
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="chat-history-header">
        <Chevron open={open} />
        {header}
      </summary>
      <div className="chat-history-body">{children}</div>
    </details>
  );
});

/* ── Reasoning ────────────────────────────────────────────────────────── */

export const ReasoningRow = memo(function ReasoningRow({
  msg,
  active = false,
  showAvatar = true,
  nested = false,
}: {
  msg: ReasoningMessage;
  /** True only while this turn's reasoning is still streaming. Controls the
   *  present-vs-past label ("Thinking…" vs "Thought"). */
  active?: boolean;
  /** False on continuation rows of a turn — render a spacer instead of an
   *  avatar so one turn shows a single avatar. */
  showAvatar?: boolean;
  nested?: boolean;
}): React.JSX.Element {
  const { t } = useI18n();
  const lineCount = msg.text.split("\n").length;
  const section = (
    <CollapsibleSection
      variant="reasoning"
      header={
        <span className="chat-history-label">
          <span className="chat-history-title">
            {active ? t("chat.thinking") : t("chat.thought")}
          </span>
          <span className="chat-history-meta">
            {lineCount} {lineCount === 1 ? "line" : "lines"}
          </span>
        </span>
      }
    >
      <pre className="chat-history-pre">{msg.text}</pre>
    </CollapsibleSection>
  );

  if (nested) return section;

  return (
    <div
      className={`chat-message chat-message-agent chat-message-history${
        showAvatar ? "" : " chat-message--grouped"
      }`}
    >
      {showAvatar ? <HermesAvatar /> : <AvatarSpacer />}
      {section}
    </div>
  );
});

/* ── Tool call ────────────────────────────────────────────────────────── */

function summariseArgs(args: string): string {
  // Single-line snippet for the collapsed header — show the first ~80
  // chars, collapse whitespace so multi-line JSON doesn't break layout.
  const flat = args.replace(/\s+/g, " ").trim();
  if (flat.length <= 80) return flat;
  return flat.slice(0, 77) + "…";
}

export const ToolCallRow = memo(function ToolCallRow({
  msg,
  showAvatar = true,
  nested = false,
}: {
  msg: ToolCallMessage;
  showAvatar?: boolean;
  nested?: boolean;
}): React.JSX.Element {
  const { t } = useI18n();
  const summary = summariseArgs(msg.args);
  // A file-editing tool call (write_file / edit_file …) renders an inline diff
  // instead of a wall of JSON args (idea A1). Falls back to raw args otherwise.
  const fileEdit = useMemo(
    () => parseFileEditToolCall(msg.name, msg.args),
    [msg.name, msg.args],
  );
  const section = (
    <CollapsibleSection
      variant="tool-call"
      header={
        <span className="chat-history-label">
          <span className="chat-history-title">{t("chat.toolCall")}</span>
          <span className="chat-history-tool-name">{msg.name}</span>
          {summary && (
            <span className="chat-history-tool-summary">{summary}</span>
          )}
        </span>
      }
    >
      {fileEdit ? (
        <ToolDiff
          fileName={fileEdit.fileName}
          oldText={fileEdit.oldText}
          newText={fileEdit.newText}
        />
      ) : (
        <pre className="chat-history-pre chat-history-pre--code">
          {msg.args || "(no arguments)"}
        </pre>
      )}
    </CollapsibleSection>
  );

  if (nested) return section;

  return (
    <div
      className={`chat-message chat-message-agent chat-message-history${
        showAvatar ? "" : " chat-message--grouped"
      }`}
    >
      {showAvatar ? <HermesAvatar /> : <AvatarSpacer />}
      {section}
    </div>
  );
});

/* ── Tool result ──────────────────────────────────────────────────────── */

function countLines(text: string): number {
  if (!text) return 0;
  return text.split("\n").length;
}

export const ToolResultRow = memo(function ToolResultRow({
  msg,
  showAvatar = true,
  nested = false,
}: {
  msg: ToolResultMessage;
  showAvatar?: boolean;
  nested?: boolean;
}): React.JSX.Element {
  const { t } = useI18n();
  const lines = countLines(msg.content);
  const hasAttachments = !!msg.attachments && msg.attachments.length > 0;
  const section = (
    <CollapsibleSection
      variant="tool-result"
      header={
        <span className="chat-history-label">
          <span className="chat-history-title">{t("chat.toolResult")}</span>
          <span className="chat-history-tool-name">{msg.name}</span>
          <span className="chat-history-meta">
            {lines} {lines === 1 ? "line" : "lines"}
            {hasAttachments
              ? ` · ${msg.attachments!.length} attachment${
                  msg.attachments!.length === 1 ? "" : "s"
                }`
              : ""}
          </span>
        </span>
      }
    >
      {hasAttachments && (
        <div className="chat-history-attachments">
          {msg.attachments!.map((att: Attachment) => (
            <AttachmentChip key={att.id} attachment={att} />
          ))}
        </div>
      )}
      <pre className="chat-history-pre chat-history-pre--scroll">
        {msg.content || "(empty)"}
      </pre>
    </CollapsibleSection>
  );

  if (nested) return section;

  return (
    <div
      className={`chat-message chat-message-agent chat-message-history${
        showAvatar ? "" : " chat-message--grouped"
      }`}
    >
      {showAvatar ? <HermesAvatar /> : <AvatarSpacer />}
      {section}
    </div>
  );
});

/* ── Tool Group Row ───────────────────────────────────────────────────── */

export const ToolGroupRow = memo(function ToolGroupRow({
  msg,
  active = false,
  showAvatar = true,
}: {
  msg: ToolGroupMessage;
  active?: boolean;
  showAvatar?: boolean;
}): React.JSX.Element {
  const summary = useMemo(() => {
    const counts = { reasoning: 0, toolCall: 0, toolResult: 0 };
    for (const m of msg.messages) {
      if (m.kind === "reasoning") counts.reasoning++;
      else if (m.kind === "tool_call") counts.toolCall++;
      else if (m.kind === "tool_result") counts.toolResult++;
    }
    const parts: string[] = [];
    if (counts.reasoning > 0) {
      parts.push(
        `${counts.reasoning} thought${counts.reasoning === 1 ? "" : "s"}`,
      );
    }
    const toolsCount = counts.toolCall;
    if (toolsCount > 0) {
      parts.push(`${toolsCount} tool call${toolsCount === 1 ? "" : "s"}`);
    }
    return parts.join(", ") || "execution steps";
  }, [msg.messages]);

  return (
    <div
      className={`chat-message chat-message-agent chat-message-history${
        showAvatar ? "" : " chat-message--grouped"
      }`}
    >
      {showAvatar ? <HermesAvatar /> : <AvatarSpacer />}
      <CollapsibleSection
        variant="tool-call"
        header={
          <span className="chat-history-label">
            <span className="chat-history-title">
              {active ? "Executing tools…" : "Thoughts & Tool Execution"}
            </span>
            <span className="chat-history-meta">({summary})</span>
          </span>
        }
        defaultOpen={active}
      >
        <div className="chat-history-group-list">
          {msg.messages.map((innerMsg, idx) => {
            if (innerMsg.kind === "reasoning") {
              return (
                <ReasoningRow
                  key={innerMsg.id}
                  msg={innerMsg}
                  active={active && idx === msg.messages.length - 1}
                  showAvatar={false}
                  nested={true}
                />
              );
            }
            if (innerMsg.kind === "tool_call") {
              return (
                <ToolCallRow
                  key={innerMsg.id}
                  msg={innerMsg}
                  showAvatar={false}
                  nested={true}
                />
              );
            }
            if (innerMsg.kind === "tool_result") {
              return (
                <ToolResultRow
                  key={innerMsg.id}
                  msg={innerMsg}
                  showAvatar={false}
                  nested={true}
                />
              );
            }
            return null;
          })}
        </div>
      </CollapsibleSection>
    </div>
  );
});
