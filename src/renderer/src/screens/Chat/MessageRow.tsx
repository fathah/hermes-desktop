import { memo, useMemo, useState } from "react";
import {
  Volume2,
  Square as StopIcon,
  Sparkles,
  Brain,
  Cpu,
  Bot,
} from "lucide-react";
import icon from "../../assets/icon.png";
import { AgentMarkdown } from "../../components/AgentMarkdown";
import { AttachmentChip } from "../../components/AttachmentChip";
import { MediaSegmentView } from "../../components/MediaImage";
import { useI18n } from "../../components/useI18n";
import { parseMediaTokens } from "./mediaUtils";
import { StreamingText } from "./StreamingText";
import type { Attachment, ChatBubbleMessage, ChatMessage } from "./types";

function ModelBadge({
  model,
  provider,
}: {
  model?: string;
  provider?: string;
}): React.JSX.Element | null {
  if (!model) return null;
  const p = (provider || "").toLowerCase() || (model || "").toLowerCase();

  let Icon = Bot;
  let color = "#8e8e93";

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

  const modelName = model.split("/").pop() || model;

  return (
    <div className="chat-model-badge" style={{ borderColor: `${color}40` }}>
      <span className="chat-model-badge-icon" style={{ color }}>
        <Icon size={10} />
      </span>
      <span className="chat-model-badge-name">{modelName}</span>
    </div>
  );
}

export const APPROVAL_RE =
  /⚠️.*dangerous|requires? (your )?approval|\/approve.*\/deny|do you want (me )?to (proceed|continue|run|execute)/i;

function isChatBubbleMessage(msg: ChatMessage): msg is ChatBubbleMessage {
  return (
    msg.kind === "user" ||
    msg.kind === "assistant" ||
    (!msg.kind && (msg.role === "user" || msg.role === "agent"))
  );
}

export const HermesAvatar = memo(function HermesAvatar({
  size = 30,
}: {
  size?: number;
}): React.JSX.Element {
  return (
    <div className="chat-avatar chat-avatar-agent">
      <img src={icon} width={size} height={size} alt="" />
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
  /** Voice TTS (WS4): whether a key is configured (shows the speaker button). */
  ttsHasKey?: boolean;
  /** This message's reply is currently being spoken. */
  ttsSpeaking?: boolean;
  /** This message's audio is being synthesized (request in flight). */
  ttsBusy?: boolean;
  /** Toggle speaking this message's reply. */
  onSpeak?: () => void;
  /** Render active agent output as plain text until the final markdown pass. */
  streaming?: boolean;
}

export const MessageRow = memo(function MessageRow({
  msg,
  isLast,
  isLoading,
  onApprove,
  onDeny,
  showAvatar = true,
  ttsHasKey = false,
  ttsSpeaking = false,
  ttsBusy = false,
  onSpeak,
  streaming = false,
}: MessageRowProps): React.JSX.Element {
  const { t } = useI18n();
  const [previewAttachment, setPreviewAttachment] = useState<Attachment | null>(
    null,
  );

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
  const shouldStreamPlainText = streaming && msg.role === "agent";
  const segments = useMemo(
    () =>
      msg.role === "agent" && bubbleContent && !shouldStreamPlainText
        ? parseMediaTokens(bubbleContent)
        : null,
    [msg.role, bubbleContent, shouldStreamPlainText],
  );

  // Only chat bubble messages have content/attachments
  if (!isChatBubbleMessage(msg)) {
    return (
      <div className={`chat-message chat-message-${msg.role}`}>
        {showAvatar ? <HermesAvatar /> : <AvatarSpacer />}
        <div className={`chat-bubble chat-bubble-${msg.role}`}>
          {/* Reasoning/tool messages handled separately */}
        </div>
      </div>
    );
  }

  const showApprovalBar =
    msg.role === "agent" &&
    !isLoading &&
    isLast &&
    APPROVAL_RE.test(msg.content);
  const hasAttachments = !!msg.attachments && msg.attachments.length > 0;

  return (
    <div
      className={`chat-message chat-message-${msg.role}${
        showAvatar ? "" : " chat-message--grouped"
      }`}
    >
      {!showAvatar ? (
        <AvatarSpacer />
      ) : msg.role === "user" ? (
        <div className="chat-avatar chat-avatar-user">U</div>
      ) : (
        <HermesAvatar />
      )}
      <div className={`chat-bubble chat-bubble-${msg.role}`}>
        {msg.role === "agent" && (
          <ModelBadge
            model={(msg as ChatBubbleMessage).model}
            provider={(msg as ChatBubbleMessage).provider}
          />
        )}
        {hasAttachments && (
          <div className="chat-message-attachments">
            {msg.attachments!.map((att) => (
              <AttachmentChip
                key={att.id}
                attachment={att}
                onPreview={(a) => a.kind === "image" && setPreviewAttachment(a)}
              />
            ))}
          </div>
        )}
        {msg.content &&
          (shouldStreamPlainText ? (
            <StreamingText>{msg.content}</StreamingText>
          ) : msg.role === "agent" && segments ? (
            segments.map((segment) =>
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
          ) : (
            msg.content
          ))}
      </div>
      {msg.role === "agent" && ttsHasKey && !!msg.content && onSpeak && (
        <div className="chat-msg-actions">
          <button
            className={`chat-speak-btn ${ttsSpeaking ? "chat-speak-active" : ""}`}
            onClick={onSpeak}
            disabled={ttsBusy}
            title={
              ttsBusy
                ? t("chat.voiceSynthesizing")
                : ttsSpeaking
                  ? t("chat.voiceStopPlayback")
                  : t("chat.voicePlay")
            }
            aria-label={t("chat.voicePlay")}
            type="button"
          >
            {ttsSpeaking ? <StopIcon size={13} /> : <Volume2 size={13} />}
          </button>
        </div>
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
      {previewAttachment && previewAttachment.dataUrl && (
        <div
          className="chat-image-preview-backdrop"
          onClick={() => setPreviewAttachment(null)}
          role="dialog"
          aria-modal="true"
        >
          <img
            src={previewAttachment.dataUrl}
            alt={previewAttachment.name}
            className="chat-image-preview-image"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
});
