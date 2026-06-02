import { memo, useState } from "react";
import { useI18n } from "../../components/useI18n";
import { AttachmentChip } from "../../components/AttachmentChip";
import { HermesAvatar, AvatarSpacer } from "./MessageRow";
import type {
  Attachment,
  ReasoningMessage,
  ToolCallMessage,
  ToolResultMessage,
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
}: {
  msg: ReasoningMessage;
  /** True only while this turn's reasoning is still streaming. Controls the
   *  present-vs-past label ("Thinking…" vs "Thought"). */
  active?: boolean;
  /** False on continuation rows of a turn — render a spacer instead of an
   *  avatar so one turn shows a single avatar. */
  showAvatar?: boolean;
}): React.JSX.Element {
  const { t } = useI18n();
  const lineCount = msg.text.split("\n").length;
  return (
    <div
      className={`chat-message chat-message-agent chat-message-history${
        showAvatar ? "" : " chat-message--grouped"
      }`}
    >
      {showAvatar ? <HermesAvatar /> : <AvatarSpacer />}
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
}: {
  msg: ToolCallMessage;
  showAvatar?: boolean;
}): React.JSX.Element {
  const { t } = useI18n();
  const summary = summariseArgs(msg.args);
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
            <span className="chat-history-title">{t("chat.toolCall")}</span>
            <span className="chat-history-tool-name">{msg.name}</span>
            {summary && (
              <span className="chat-history-tool-summary">{summary}</span>
            )}
          </span>
        }
      >
        <pre className="chat-history-pre chat-history-pre--code">
          {msg.args || "(no arguments)"}
        </pre>
      </CollapsibleSection>
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
}: {
  msg: ToolResultMessage;
  showAvatar?: boolean;
}): React.JSX.Element {
  const { t } = useI18n();
  const lines = countLines(msg.content);
  const hasAttachments = !!msg.attachments && msg.attachments.length > 0;
  return (
    <div
      className={`chat-message chat-message-agent chat-message-history${
        showAvatar ? "" : " chat-message--grouped"
      }`}
    >
      {showAvatar ? <HermesAvatar /> : <AvatarSpacer />}
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
    </div>
  );
});
