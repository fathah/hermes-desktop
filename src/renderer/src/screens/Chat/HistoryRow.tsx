import { memo, useState } from "react";
import { Grid } from "react-loader-spinner";
import { Brain, ChevronRight, Wrench } from "../../assets/icons";
import { useI18n } from "../../components/useI18n";
import { AttachmentChip } from "../../components/AttachmentChip";
import { ToolGlyph, humanizeToolName } from "../../components/toolMeta";
import { HermesAvatar, AvatarSpacer } from "./MessageRow";
import type { AgentAvatarInfo } from "./MessageRow";
import type {
  Attachment,
  ReasoningMessage,
  ToolCallMessage,
  ToolResultMessage,
} from "./types";

/* ── Reasoning ────────────────────────────────────────────────────────── */

export const ReasoningRow = memo(function ReasoningRow({
  msg,
  active = false,
  showAvatar = true,
  agent,
}: {
  msg: ReasoningMessage;
  /** True only while this turn's reasoning is still streaming. Controls the
   *  present-vs-past label ("Thinking…" vs "Thought"). */
  active?: boolean;
  /** False on continuation rows of a turn — render a spacer instead of an
   *  avatar so one turn shows a single avatar. */
  showAvatar?: boolean;
  /** Appearance of the chatting agent, shown once the avatar goes idle. */
  agent?: AgentAvatarInfo;
}): React.JSX.Element {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <div
      className={`chat-message chat-message-agent chat-message-history${
        showAvatar ? "" : " chat-message--grouped"
      }`}
    >
      {showAvatar ? (
        <HermesAvatar active={active} agent={agent} />
      ) : (
        <AvatarSpacer />
      )}
      <div
        className={`chat-reasoning-group${
          active ? " chat-reasoning-group--active" : ""
        }`}
      >
        <button
          type="button"
          className="chat-reasoning-group-summary"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {active ? (
            <Grid
              visible={true}
              height={13}
              width={13}
              radius={15}
              color="#8b7cf6"
              ariaLabel="thinking-loading"
              wrapperClass="chat-reasoning-group-spinner"
            />
          ) : (
            <Brain size={13} className="chat-reasoning-group-icon" />
          )}
          <span className="chat-reasoning-group-title">
            {active ? t("chat.thinking") : t("chat.thought")}
          </span>
          <ChevronRight
            size={14}
            className={`chat-reasoning-group-chevron${
              open ? " chat-reasoning-group-chevron--open" : ""
            }`}
          />
        </button>
        <div
          className={`chat-tool-collapse${
            open ? " chat-tool-collapse--open" : ""
          }`}
        >
          <div className="chat-tool-collapse-inner">
            <pre className="chat-history-pre">{msg.text}</pre>
          </div>
        </div>
      </div>
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

export function toolActivityGroupTitle(items: ToolItem[]): string {
  const toolCallCount = items.filter(isToolCall).length;
  if (toolCallCount > 1) return `${toolCallCount} tools called`;
  const name = items[items.length - 1]?.name;
  return name ? humanizeToolName(name) : "Tool";
}

/** The single tool name in a group, or null when the group spans several. */
function singleToolName(items: ToolItem[]): string | null {
  if (items.filter(isToolCall).length > 1) return null;
  return items[items.length - 1]?.name ?? null;
}

export function orderToolActivityItems(items: ToolItem[]): ToolItem[] {
  const callIds = new Set(
    items
      .filter(isToolCall)
      .map((item) => item.callId)
      .filter(Boolean),
  );
  const resultsByCallId = new Map<string, ToolResultMessage[]>();
  for (const item of items) {
    if (isToolCall(item) || !item.callId) continue;
    const bucket = resultsByCallId.get(item.callId) ?? [];
    bucket.push(item);
    resultsByCallId.set(item.callId, bucket);
  }

  const emittedResults = new Set<ToolResultMessage>();
  const ordered: ToolItem[] = [];
  for (const item of items) {
    if (isToolCall(item)) {
      ordered.push(item);
      for (const result of resultsByCallId.get(item.callId) ?? []) {
        ordered.push(result);
        emittedResults.add(result);
      }
      continue;
    }

    if (emittedResults.has(item)) continue;
    if (item.callId && callIds.has(item.callId)) continue;
    ordered.push(item);
    emittedResults.add(item);
  }

  return ordered;
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

const ToolActivityItem = memo(function ToolActivityItem({
  msg,
}: {
  msg: ToolItem;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const call = isToolCall(msg);
  const failed = call && msg.status === "failed";
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
        <ToolGlyph
          toolName={msg.name}
          size={13}
          className={`chat-tool-item-glyph${
            failed ? " chat-tool-item-glyph--failed" : ""
          }`}
        />
        <span className="chat-tool-item-name">
          {humanizeToolName(msg.name)}
        </span>
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
  agent,
}: {
  items: ToolItem[];
  /** True while the turn is still streaming and this is the trailing run —
   *  drives the spinner on the collapsed summary. */
  active?: boolean;
  showAvatar?: boolean;
  /** Appearance of the chatting agent, shown once the avatar goes idle. */
  agent?: AgentAvatarInfo;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const last = items[items.length - 1];
  const detail = itemDetail(last);
  const title = toolActivityGroupTitle(items);
  const soloTool = singleToolName(items);
  const orderedItems = orderToolActivityItems(items);

  return (
    <div
      className={`chat-message chat-message-agent chat-message-history${
        showAvatar ? "" : " chat-message--grouped"
      }`}
    >
      {showAvatar ? (
        <HermesAvatar active={active} agent={agent} />
      ) : (
        <AvatarSpacer />
      )}
      <div
        className={`chat-tool-group${active ? " chat-tool-group--active" : ""}`}
      >
        <button
          type="button"
          className="chat-tool-group-summary"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {active ? (
            <Grid
              visible={true}
              height={13}
              width={13}
              radius={15}
              color="#4aa8ff"
              ariaLabel="tool-loading"
              wrapperClass="chat-tool-group-spinner"
            />
          ) : soloTool ? (
            <ToolGlyph
              toolName={soloTool}
              size={13}
              className="chat-tool-group-icon"
            />
          ) : (
            <Wrench size={13} className="chat-tool-group-icon" />
          )}
          <span className="chat-tool-group-name">{title}</span>
          {detail && <span className="chat-tool-group-detail">{detail}</span>}
          <ChevronRight
            size={14}
            className={`chat-tool-group-chevron${
              open ? " chat-tool-group-chevron--open" : ""
            }`}
          />
        </button>
        <div
          className={`chat-tool-collapse${open ? " chat-tool-collapse--open" : ""}`}
        >
          <div className="chat-tool-collapse-inner">
            <div className="chat-tool-group-items">
              {orderedItems.map((it, index) => (
                <ToolActivityItem key={`${it.id}-${index}`} msg={it} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});
