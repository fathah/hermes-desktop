import { memo, useState } from "react";
import { ChevronRight, Spinner, Wrench } from "../../assets/icons";
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

/* ── Tool activity (grouped) ──────────────────────────────────────────────
 *
 * A contiguous run of tool calls/results collapses into a single block —
 * the way ChatGPT and Claude fold a burst of tool use into one line. The
 * collapsed summary shows the most recent step (plus a total count); the
 * whole run expands smoothly to reveal every step, and each step in turn
 * expands to its full arguments/output. This keeps a 100-call turn from
 * exploding into 100 stacked bubbles.
 */

type ToolItem = ToolCallMessage | ToolResultMessage;

function summariseArgs(args: string): string {
  // Single-line snippet for the collapsed header — show the first ~80
  // chars, collapse whitespace so multi-line JSON doesn't break layout.
  const flat = args.replace(/\s+/g, " ").trim();
  if (flat.length <= 80) return flat;
  return flat.slice(0, 77) + "…";
}

function countLines(text: string): number {
  if (!text) return 0;
  return text.split("\n").length;
}

function isToolCall(msg: ToolItem): msg is ToolCallMessage {
  return msg.kind === "tool_call";
}

function resultMeta(msg: ToolResultMessage): string {
  const lines = countLines(msg.content);
  const base = `${lines} ${lines === 1 ? "line" : "lines"}`;
  const n = msg.attachments?.length ?? 0;
  return n > 0 ? `${base} · ${n} attachment${n === 1 ? "" : "s"}` : base;
}

function itemDetail(msg: ToolItem): string {
  return isToolCall(msg) ? summariseArgs(msg.args) : resultMeta(msg);
}

function itemTone(msg: ToolItem): "call" | "result" | "failed" {
  if (!isToolCall(msg)) return "result";
  return msg.status === "failed" ? "failed" : "call";
}

const ToolActivityItem = memo(function ToolActivityItem({
  msg,
}: {
  msg: ToolItem;
}): React.JSX.Element {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const call = isToolCall(msg);
  const hasAttachments =
    !call && !!msg.attachments && msg.attachments.length > 0;

  return (
    <div className="chat-tool-item">
      <button
        type="button"
        className="chat-tool-item-header"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <ChevronRight
          size={12}
          className={`chat-tool-item-chevron${
            open ? " chat-tool-item-chevron--open" : ""
          }`}
        />
        <span
          className={`chat-tool-item-dot chat-tool-item-dot--${itemTone(msg)}`}
        />
        <span className="chat-tool-item-kind">
          {call ? t("chat.toolCall") : t("chat.toolResult")}
        </span>
        <span className="chat-tool-item-name">{msg.name}</span>
        <span className="chat-tool-item-detail">{itemDetail(msg)}</span>
      </button>
      <div
        className={`chat-tool-collapse${open ? " chat-tool-collapse--open" : ""}`}
      >
        <div className="chat-tool-collapse-inner">
          <div className="chat-tool-item-body">
            {hasAttachments && (
              <div className="chat-history-attachments">
                {msg.attachments!.map((att: Attachment) => (
                  <AttachmentChip key={att.id} attachment={att} />
                ))}
              </div>
            )}
            <pre
              className={`chat-history-pre ${
                call ? "chat-history-pre--code" : "chat-history-pre--scroll"
              }`}
            >
              {call ? msg.args || "(no arguments)" : msg.content || "(empty)"}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
});

export const ToolActivityGroup = memo(function ToolActivityGroup({
  items,
  active = false,
  showAvatar = true,
}: {
  items: ToolItem[];
  /** True while the turn is still streaming and this is the trailing run —
   *  drives the spinner on the collapsed summary. */
  active?: boolean;
  showAvatar?: boolean;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const last = items[items.length - 1];
  const count = items.length;
  const detail = itemDetail(last);

  return (
    <div
      className={`chat-message chat-message-agent chat-message-history${
        showAvatar ? "" : " chat-message--grouped"
      }`}
    >
      {showAvatar ? <HermesAvatar /> : <AvatarSpacer />}
      <div
        className={`chat-tool-group${active ? " chat-tool-group--active" : ""}`}
      >
        <button
          type="button"
          className="chat-tool-group-summary"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <ChevronRight
            size={14}
            className={`chat-tool-group-chevron${
              open ? " chat-tool-group-chevron--open" : ""
            }`}
          />
          {active ? (
            <Spinner size={13} className="chat-tool-group-spinner" />
          ) : (
            <Wrench size={13} className="chat-tool-group-icon" />
          )}
          <span className="chat-tool-group-name">{last.name}</span>
          {detail && <span className="chat-tool-group-detail">{detail}</span>}
          <span className="chat-tool-group-count">
            {count} {count === 1 ? "step" : "steps"}
          </span>
        </button>
        <div
          className={`chat-tool-collapse${open ? " chat-tool-collapse--open" : ""}`}
        >
          <div className="chat-tool-collapse-inner">
            <div className="chat-tool-group-items">
              {items.map((it) => (
                <ToolActivityItem key={it.id} msg={it} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});
