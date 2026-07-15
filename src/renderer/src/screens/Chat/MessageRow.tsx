import { memo, useMemo, useState, useCallback, useEffect, useRef } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import { Grid } from "react-loader-spinner";
import { Copy, Check } from "lucide-react";
import loadingGif from "../../assets/loadingo.gif";
import ProfileAvatar from "../../components/common/ProfileAvatar";
import { AgentMarkdown } from "../../components/AgentMarkdown";
import { AttachmentChip } from "../../components/AttachmentChip";
import { MediaSegmentView } from "../../components/MediaImage";
import { useI18n } from "../../components/useI18n";
import { parseMediaTokens, cleanLeakedToolTags } from "./mediaUtils";
import type { ChatBubbleMessage, ChatMessage } from "./types";

export const APPROVAL_RE =
  /⚠️.*dangerous|requires? (your )?approval|\/approve.*\/deny|do you want (me )?to (proceed|continue|run|execute)/i;

/**
 * Coerce any DB, stream, or IPC timestamp value to valid epoch milliseconds.
 * Handles seconds (< 1e12), ms, us (> 1e14), ns (> 1e17), and ISO strings.
 */
const MS_THRESHOLD = 1e12;
const US_THRESHOLD = 1e14;
const NS_THRESHOLD = 1e17;

function coerceToEpochMs(raw: unknown): number {
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw <= 0) return 0;
    if (raw < MS_THRESHOLD) return raw * 1000;
    if (raw < US_THRESHOLD) return raw;
    if (raw < NS_THRESHOLD) return Math.floor(raw / 1000);
    return Math.floor(raw / 1_000_000);
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return 0;
    const num = Number(trimmed);
    if (Number.isFinite(num) && num > 0) {
      return coerceToEpochMs(num);
    }
    const parsed = new Date(trimmed).getTime();
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return 0;
}

// Earliest valid chat timestamp: Jan 1 2020 (1577836800000 ms).
// Anything before 2020 (e.g. 0, 1 => Jan 1970 => "57 years ago") is bogus/dummy.
const MIN_VALID_EPOCH_MS = 1_577_836_800_000;

function isValidEpochMs(ms: number): boolean {
  return (
    Number.isFinite(ms) &&
    ms >= MIN_VALID_EPOCH_MS &&
    !isNaN(new Date(ms).getTime())
  );
}

/**
 * Relative "time ago" label for the hover-time element.
 */
function formatBubbleTime(ms: number): string | null {
  try {
    if (Date.now() - ms < 10_000 && Date.now() >= ms) return "just now";
    return formatDistanceToNowStrict(ms, { addSuffix: true });
  } catch {
    return null;
  }
}

/** Absolute timestamp for the tooltip and `<time dateTime>` value. */
function formatBubbleTimeAbsolute(ms: number): string {
  try {
    return new Date(ms).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return "";
  }
}

function isChatBubbleMessage(msg: ChatMessage): msg is ChatBubbleMessage {
  return (
    msg.kind === "user" ||
    msg.kind === "assistant" ||
    (!msg.kind && (msg.role === "user" || msg.role === "agent"))
  );
}

/**
 * One full loop of `loadingo.gif`, in ms (119 frames × 40ms). Used to let the
 * animation finish its current loop after generation stops instead of freezing
 * mid-frame.
 */
const GIF_LOOP_MS = 4760;

/** Appearance of the agent whose turn a row belongs to, used to render its
 *  profile avatar while idle. Name drives the letter/logo + default colour. */
export interface AgentAvatarInfo {
  name: string;
  color?: string | null;
  avatar?: string | null;
}

/**
 * Agent avatar. While `active` (the turn is generating) it plays the looping
 * `loadingo.gif`. When `active` goes false it doesn't freeze instantly — it
 * keeps animating until the end of the current loop, then swaps to the agent's
 * profile avatar so idle turns are identified by who produced them (and the
 * chat isn't full of perpetually-spinning gifs). The swap lands on a clean loop
 * boundary rather than mid-frame.
 */
export const HermesAvatar = memo(function HermesAvatar({
  size = 30,
  active = false,
  agent,
}: {
  size?: number;
  /** True only for the avatar of the turn currently being generated. */
  active?: boolean;
  /** The agent whose profile avatar shows once the turn is idle. When absent
   *  (e.g. the live typing indicator) the loading gif is used as the fallback. */
  agent?: AgentAvatarInfo;
}): React.JSX.Element {
  const [playing, setPlaying] = useState(active);
  // Re-keying the <img> on each play session restarts the gif from frame 0 so
  // the loop clock below is accurate.
  const [playKey, setPlayKey] = useState(0);
  // Timestamp (performance.now) of the current play session's frame 0; set in
  // the effect, never during render. 0 = not yet started.
  const playStartRef = useRef(0);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  useEffect(() => {
    if (active) {
      // (Re)start the animation immediately when generation begins.
      if (stopTimer.current) clearTimeout(stopTimer.current);
      if (!playing) {
        setPlayKey((k) => k + 1);
        playStartRef.current = performance.now();
        setPlaying(true);
      } else if (playStartRef.current === 0) {
        // Mounted already playing (active on first render): anchor the loop clock.
        playStartRef.current = performance.now();
      }
    } else if (playing) {
      // Generation stopped: run out the rest of the current loop, then swap to
      // the profile avatar.
      const elapsed = (performance.now() - playStartRef.current) % GIF_LOOP_MS;
      const remaining = GIF_LOOP_MS - elapsed;
      if (stopTimer.current) clearTimeout(stopTimer.current);
      stopTimer.current = setTimeout(() => setPlaying(false), remaining);
    }
    return () => {
      if (stopTimer.current) clearTimeout(stopTimer.current);
    };
  }, [active, playing]);

  // Idle with no known agent (e.g. the typing indicator before any turn) still
  // falls back to the gif's first frame rather than a blank/"?" avatar.
  const showGif = playing || !agent;

  return (
    <div className="chat-avatar chat-avatar-agent">
      {showGif ? (
        <img key={playKey} src={loadingGif} width={size} height={size} alt="" />
      ) : (
        <ProfileAvatar
          name={agent.name}
          color={agent.color}
          avatar={agent.avatar}
          size={size}
        />
      )}
    </div>
  );
});

/**
 * Empty box the size of an avatar. Rendered in place of the avatar on
 * continuation rows of a turn (the thinking/tool rows and answer bubble that
 * follow the first row) so one turn shows a single avatar while every row
 * stays aligned to the same content column.
 */
export const AvatarSpacer = memo(function AvatarSpacer(): React.JSX.Element {
  return <div className="chat-avatar" aria-hidden="true" />;
});

interface MessageRowProps {
  msg: ChatMessage;
  isLast: boolean;
  isLoading: boolean;
  onApprove: () => void;
  onDeny: () => void;
  /** False on continuation rows of a turn — render a spacer instead of the
   *  avatar so the turn reads as one grouped block. Defaults to true. */
  showAvatar?: boolean;
  /** Appearance of the chatting agent, shown once the avatar goes idle. */
  agent?: AgentAvatarInfo;
}

export const MessageRow = memo(function MessageRow({
  msg,
  isLast,
  isLoading,
  onApprove,
  onDeny,
  showAvatar = true,
  agent,
}: MessageRowProps): React.JSX.Element {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  // MessageRow is wrapped in memo() but still re-renders on any prop change
  // (e.g. isLoading toggling at the end of a stream), and `parseMediaTokens`
  // runs a full regex pipeline. Cache the result against the message content
  // so a long conversation doesn't reparse every row on every render.
  // Only agent bubbles need media parsing — user bubbles render content
  // verbatim — so this is gated on the role to skip the work entirely for
  // user rows. (Follow-up item from PR #303 review.)
  const bubbleContent = isChatBubbleMessage(msg)
    ? (msg as ChatBubbleMessage).content
    : null;
  const segments = useMemo(
    () =>
      msg.role === "agent" && bubbleContent
        ? // Recover any tool/skill call the model leaked as text (e.g. a raw
          // `<skill_view>{"answer": …}</skill_view>` tag) before tokenizing.
          parseMediaTokens(cleanLeakedToolTags(bubbleContent))
        : null,
    [msg.role, bubbleContent],
  );

  const handleCopy = useCallback(async () => {
    if (!bubbleContent) return;
    try {
      await window.hermesAPI.copyToClipboard(bubbleContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: clipboard write may fail in some environments
    }
  }, [bubbleContent]);

  // Only chat bubble messages have content/attachments
  if (!isChatBubbleMessage(msg)) {
    return (
      <div className={`chat-message chat-message-${msg.role}`}>
        {showAvatar ? (
          <HermesAvatar active={isLoading && isLast} agent={agent} />
        ) : (
          <AvatarSpacer />
        )}
        <div className={`chat-bubble chat-bubble-${msg.role}`}>
          {/* Reasoning/tool messages handled separately */}
        </div>
      </div>
    );
  }

  const showApprovalBar =
    msg.role === "agent" &&
    !msg.error &&
    !isLoading &&
    isLast &&
    APPROVAL_RE.test(msg.content);
  const hasAttachments = !!msg.attachments && msg.attachments.length > 0;
  const epochMs = coerceToEpochMs(msg.timestamp);
  const isTimeValid = isValidEpochMs(epochMs);
  const bubbleTime = isTimeValid ? formatBubbleTime(epochMs) : null;

  return (
    <div
      className={`chat-message chat-message-${msg.role}${
        showAvatar ? "" : " chat-message--grouped"
      }`}
    >
      {/* User messages stand alone (right-aligned bubble, no avatar). Only the
          agent turn carries an avatar; its continuation rows get a spacer. */}
      {msg.role === "user" ? null : !showAvatar ? (
        <AvatarSpacer />
      ) : (
        <HermesAvatar active={isLoading && isLast} agent={agent} />
      )}
      <div
        className={`chat-bubble chat-bubble-${msg.role}${
          msg.error ? " chat-bubble-error" : ""
        }`}
      >
        {msg.content && !isLoading && !msg.isSlashLoader && (
          <div className="chat-bubble-actions">
            <button
              type="button"
              className="chat-bubble-copy"
              onClick={handleCopy}
              title={copied ? t("common.copied") : t("chat.copyMessage")}
              aria-label={copied ? t("common.copied") : t("chat.copyMessage")}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
          </div>
        )}
        {hasAttachments && (
          <div className="chat-message-attachments">
            {msg.attachments!.map((att) => (
              <AttachmentChip key={att.id} attachment={att} />
            ))}
          </div>
        )}
        {msg.isSlashLoader ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Grid
              visible={true}
              height={13}
              width={13}
              radius={15}
              color="#8b7cf6"
              ariaLabel="running-command"
            />
            <span>{msg.content}</span>
          </div>
        ) : (
          msg.content &&
          (msg.role === "agent" && segments
            ? segments.map((segment) =>
                segment.type === "text" ? (
                  segment.value.trim() ? (
                    // Keyed on the segment's character offset rather than its
                    // array index — a MEDIA: token appearing mid-stream shifts
                    // every subsequent index, which would otherwise re-mount
                    // each downstream MediaSegmentView and re-fire its
                    // `mediaFileExists` probe.
                    <AgentMarkdown key={`t-${segment.start}`}>
                      {segment.value}
                    </AgentMarkdown>
                  ) : null
                ) : (
                  <MediaSegmentView
                    key={`m-${segment.start}`}
                    token={segment.token}
                    raw={segment.raw}
                    source={segment.source}
                  />
                ),
              )
            : msg.content)
        )}
        {msg.error && (
          <div className="chat-error-message" role="alert">
            {msg.error}
          </div>
        )}
      </div>
      {bubbleTime && isTimeValid && (
        <time
          className="chat-bubble-time"
          dateTime={new Date(epochMs).toISOString()}
          title={formatBubbleTimeAbsolute(epochMs)}
        >
          {bubbleTime}
        </time>
      )}
      {showApprovalBar && (
        <div className="chat-approval-bar">
          <button
            className="chat-approval-btn chat-approve"
            onClick={onApprove}
          >
            {t("chat.approve")}
          </button>
          <button className="chat-approval-btn chat-deny" onClick={onDeny}>
            {t("chat.deny")}
          </button>
        </div>
      )}
    </div>
  );
});
