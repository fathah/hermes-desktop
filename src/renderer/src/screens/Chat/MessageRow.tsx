import { memo, useMemo, useState, useCallback, useEffect, useRef } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import { Copy, Check } from "lucide-react";
import loadingGif from "../../assets/loadingo.gif";
import { AgentMarkdown } from "../../components/AgentMarkdown";
import { AttachmentChip } from "../../components/AttachmentChip";
import { MediaSegmentView } from "../../components/MediaImage";
import { useI18n } from "../../components/useI18n";
import { parseMediaTokens, cleanLeakedToolTags } from "./mediaUtils";
import type { ChatBubbleMessage, ChatMessage } from "./types";

export const APPROVAL_RE =
  /⚠️.*dangerous|requires? (your )?approval|\/approve.*\/deny|do you want (me )?to (proceed|continue|run|execute)/i;

/**
 * Coerce a DB timestamp to epoch milliseconds. The agent's state.db stores
 * message times in seconds, but other paths hand us milliseconds — anything
 * below this threshold (≈ year 2001 in ms) is far too small to be a real ms
 * time, so it's a seconds value and gets scaled up. Without this a seconds
 * value renders as ~Jan 1970.
 */
const MS_THRESHOLD = 1e12;
function toEpochMs(ts: number): number {
  return ts < MS_THRESHOLD ? ts * 1000 : ts;
}

/**
 * Relative "time ago" label for the hover-time element — e.g. "5 minutes
 * ago", "2 hours ago", "3 days ago". Uses date-fns rather than hand-rolled
 * thresholds. Times within the last few seconds read "just now".
 */
function formatBubbleTime(ts: number): string {
  const ms = toEpochMs(ts);
  if (Date.now() - ms < 10_000) return "just now";
  return formatDistanceToNowStrict(ms, { addSuffix: true });
}

/** Absolute timestamp for the tooltip and `<time dateTime>` value. */
function formatBubbleTimeAbsolute(ts: number): string {
  return new Date(toEpochMs(ts)).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
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

/**
 * Captures the gif's first frame as a static PNG data URL, once, shared across
 * every avatar instance. Idle avatars (past turns) render this frozen frame so
 * the chat isn't full of perpetually-spinning gifs — only the in-flight turn's
 * avatar runs the live animation.
 */
let frozenFramePromise: Promise<string> | null = null;
function getFrozenFrame(): Promise<string> {
  if (!frozenFramePromise) {
    frozenFramePromise = new Promise<string>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext("2d");
          if (!ctx) return reject(new Error("no 2d context"));
          // drawImage right after load captures frame 0 (not yet advanced).
          ctx.drawImage(img, 0, 0);
          resolve(canvas.toDataURL("image/png"));
        } catch (err) {
          reject(err as Error);
        }
      };
      img.onerror = () => reject(new Error("failed to load loadingo.gif"));
      img.src = loadingGif;
    });
  }
  return frozenFramePromise;
}

/**
 * Agent avatar. While `active` (the turn is generating) it plays the looping
 * `loadingo.gif`. When `active` goes false it doesn't freeze instantly — it
 * keeps animating until the end of the current loop, then swaps to a static
 * frozen frame so the stop lands on a clean loop boundary.
 */
export const HermesAvatar = memo(function HermesAvatar({
  size = 30,
  active = false,
}: {
  size?: number;
  /** True only for the avatar of the turn currently being generated. */
  active?: boolean;
}): React.JSX.Element {
  const [frozenSrc, setFrozenSrc] = useState<string | null>(null);
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
    let cancelled = false;
    getFrozenFrame()
      .then((src) => {
        if (!cancelled) setFrozenSrc(src);
      })
      .catch(() => {
        /* fall back to the live gif if the snapshot can't be built */
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
      // Generation stopped: run out the rest of the current loop, then freeze.
      const elapsed = (performance.now() - playStartRef.current) % GIF_LOOP_MS;
      const remaining = GIF_LOOP_MS - elapsed;
      if (stopTimer.current) clearTimeout(stopTimer.current);
      stopTimer.current = setTimeout(() => setPlaying(false), remaining);
    }
    return () => {
      if (stopTimer.current) clearTimeout(stopTimer.current);
    };
  }, [active, playing]);

  return (
    <div className="chat-avatar chat-avatar-agent">
      {playing ? (
        <img key={playKey} src={loadingGif} width={size} height={size} alt="" />
      ) : (
        <img src={frozenSrc ?? loadingGif} width={size} height={size} alt="" />
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
}

export const MessageRow = memo(function MessageRow({
  msg,
  isLast,
  isLoading,
  onApprove,
  onDeny,
  showAvatar = true,
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
          <HermesAvatar active={isLoading && isLast} />
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
  const bubbleTime =
    typeof msg.timestamp === "number" && msg.timestamp > 0
      ? formatBubbleTime(msg.timestamp)
      : null;

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
        <HermesAvatar active={isLoading && isLast} />
      )}
      <div
        className={`chat-bubble chat-bubble-${msg.role}${
          msg.error ? " chat-bubble-error" : ""
        }`}
      >
        {msg.content && !isLoading && (
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
        {msg.content &&
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
            : msg.content)}
        {msg.error && (
          <div className="chat-error-message" role="alert">
            {msg.error}
          </div>
        )}
      </div>
      {bubbleTime && (
        <time
          className="chat-bubble-time"
          dateTime={new Date(toEpochMs(msg.timestamp!)).toISOString()}
          title={formatBubbleTimeAbsolute(msg.timestamp!)}
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
