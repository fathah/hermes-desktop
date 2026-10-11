import { useEffect, useRef, useState } from "react";
import {
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleDashed,
  CircleX,
  Send,
  Square,
} from "lucide-react";
import { useI18n } from "../../components/useI18n";
import {
  captureSubagentSnapshot,
  isTerminalSubagent,
  reconcileSubagentSnapshot,
  useSubagents,
  type SubagentControls,
  type SubagentProgress,
  type SubagentTail,
} from "./subagents";

// @lat: [[subagents#Rendering above the composer]]
interface SubagentSectionProps {
  /** Transport-bound RPCs for the CURRENT conversation, or null when the active
   *  transport cannot serve them (the section then stays event-fed only). */
  controls: SubagentControls | null;
  /** Opaque connection/profile/revision/session scope supplied by the transport. */
  sessionId: string | null;
}

const elapsedLabel = (seconds: number): string => {
  const total = Math.max(0, Math.floor(seconds));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  return `${minutes}m ${String(total % 60).padStart(2, "0")}s`;
};

const isLive = (item: SubagentProgress): boolean =>
  item.status === "running" || item.status === "queued";

/** Re-paints once a second so elapsed timers tick without a per-row interval. */
function useElapsedTicker(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

/**
 * The child's live output tail (`subagent.tail`). Polled only while this row is
 * expanded and on screen — an older backend without the RPC simply reports an
 * unavailable transcript instead of hot-looping.
 */
function SubagentTranscript({
  controls,
  subagentId,
}: {
  controls: SubagentControls;
  subagentId: string;
}): React.JSX.Element {
  const { t } = useI18n();
  const [tail, setTail] = useState<SubagentTail | null>(null);

  useEffect(() => {
    let cancelled = false;
    let pending = false;

    const refresh = async (): Promise<void> => {
      if (pending || document.visibilityState === "hidden") return;
      pending = true;
      try {
        const result = await controls.tail(subagentId);
        if (!cancelled) {
          setTail({
            available: result.available === true,
            text:
              typeof result.text === "string" ? result.text.slice(-16384) : "",
            truncated: result.truncated === true,
          });
        }
      } catch {
        if (!cancelled) {
          setTail({ available: false, text: "", truncated: false });
        }
      } finally {
        pending = false;
      }
    };

    void refresh();
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [controls, subagentId]);

  return (
    <div className="subagent-transcript">
      <span className="subagent-transcript-title">
        {t("chat.subagents.transcript")}
      </span>
      {tail?.truncated && (
        <span className="subagent-transcript-note">
          {t("chat.subagents.transcriptTruncated")}
        </span>
      )}
      {tail?.available ? (
        <pre className="subagent-transcript-body">{tail.text}</pre>
      ) : (
        <span className="subagent-transcript-note">
          {tail
            ? t("chat.subagents.transcriptUnavailable")
            : t("chat.subagents.waitingActivity")}
        </span>
      )}
    </div>
  );
}

/**
 * Child controls for one running subagent: steer it, or stop it. Never falls
 * back to a different conversation's transport — a rejected request surfaces.
 */
function SubagentControlsRow({
  controls,
  subagentId,
}: {
  controls: SubagentControls;
  subagentId: string;
}): React.JSX.Element {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [failed, setFailed] = useState(false);

  const send = async (action: "steer" | "interrupt"): Promise<void> => {
    setPending(true);
    setFeedback("");
    setFailed(false);
    try {
      if (action === "steer") {
        const result = await controls.steer(subagentId, text.trim());
        if (result?.status !== "queued") {
          throw new Error(t("chat.subagents.requestRejected"));
        }
        setText("");
        setFeedback(t("chat.subagents.steerQueued"));
      } else {
        const result = await controls.interrupt(subagentId);
        if (!result?.found) {
          throw new Error(t("chat.subagents.requestRejected"));
        }
        setFeedback(t("chat.subagents.stopRequested"));
      }
    } catch {
      setFailed(true);
      setFeedback(t("chat.subagents.requestRejected"));
    } finally {
      setPending(false);
    }
  };

  return (
    <form
      className="subagent-controls"
      onKeyDown={(event) => event.stopPropagation()}
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (text.trim() && !pending) void send("steer");
      }}
    >
      <input
        aria-label={t("chat.subagents.steerPlaceholder")}
        className="subagent-steer-input"
        disabled={pending}
        onChange={(event) => setText(event.target.value)}
        placeholder={t("chat.subagents.steerPlaceholder")}
        value={text}
      />
      <button
        className="subagent-control-btn"
        disabled={pending || !text.trim()}
        type="submit"
      >
        <Send size={12} />
        {t("chat.subagents.steer")}
      </button>
      <button
        className="subagent-control-btn subagent-control-stop"
        disabled={pending}
        onClick={() => void send("interrupt")}
        type="button"
      >
        <Square size={12} />
        {t("chat.subagents.stop")}
      </button>
      {feedback && (
        <span
          className="subagent-control-feedback"
          role={failed ? "alert" : "status"}
        >
          {feedback}
        </span>
      )}
    </form>
  );
}

function statusIcon(item: SubagentProgress): React.JSX.Element {
  if (item.status === "queued") {
    return <CircleDashed size={14} className="subagent-icon-queued" />;
  }
  if (item.status === "completed") {
    return <Check size={14} className="subagent-icon-completed" />;
  }
  if (item.status === "failed") {
    return <CircleAlert size={14} className="subagent-icon-failed" />;
  }
  if (item.status === "interrupted") {
    return <CircleX size={14} className="subagent-icon-interrupted" />;
  }
  return <span className="subagent-spinner" aria-hidden="true" />;
}

/**
 * In-chat roster of this conversation's delegated children.
 *
 * Delegated work belongs to the turn that spawned it: the child's activity is
 * relayed to the parent as `subagent.*` events, so the chat shows what is
 * running, what each child is doing right now, and lets the user steer or stop
 * it — without the child appearing as a separate conversation.
 */
export function SubagentSection(
  props: SubagentSectionProps,
): React.JSX.Element {
  return <ScopedSubagentSection key={props.sessionId} {...props} />;
}

function ScopedSubagentSection({
  controls,
  sessionId,
}: SubagentSectionProps): React.JSX.Element | null {
  const { t } = useI18n();
  const rows = useSubagents(sessionId);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const controlsRef = useRef(controls);
  controlsRef.current = controls;

  const live = rows.filter(isLive);
  const now = useElapsedTicker(live.length > 0);

  useEffect(() => {
    if (!sessionId && !controls) return;
    let cancelled = false;
    let pending = false;
    let failures = 0;

    const refresh = async (): Promise<void> => {
      const current = controlsRef.current;
      const target = sessionId;
      if (!current || !target || cancelled || pending || failures >= 3) return;
      pending = true;
      const token = captureSubagentSnapshot(target);
      try {
        const entries = await current.list();
        if (!cancelled) reconcileSubagentSnapshot(target, entries ?? [], token);
        failures = 0;
      } catch {
        // Older backends keep their event-fed frame; don't hot-loop a missing RPC.
        failures += 1;
      } finally {
        pending = false;
      }
    };

    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 5000);
    const onFocus = (): void => {
      failures = 0;
      void refresh();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [controls, sessionId]);

  if (!sessionId || live.length === 0) return null;

  return (
    <div className="subagent-section" data-slot="chat-subagents">
      <div className="subagent-section-head">
        <Bot size={13} className="subagent-section-icon" />
        <span>{t("chat.subagents.title", { count: live.length })}</span>
      </div>
      <ul className="subagent-list">
        {live.map((item) => {
          const expanded = expandedId === item.id;
          const latest = item.stream.at(-1);
          return (
            <li className="subagent-item" key={item.id}>
              <button
                aria-expanded={expanded}
                className="subagent-row"
                onClick={() => setExpandedId(expanded ? null : item.id)}
                type="button"
              >
                {statusIcon(item)}
                <span className="subagent-row-text">
                  <span className="subagent-goal" title={item.goal}>
                    {item.goal || t("chat.subagents.untitled")}
                  </span>
                  <span className="subagent-activity">
                    {latest?.text ||
                      (item.status === "queued"
                        ? t("chat.subagents.queued")
                        : item.currentTool
                          ? item.currentTool
                          : t("chat.subagents.waitingActivity"))}
                  </span>
                </span>
                <span className="subagent-elapsed">
                  {elapsedLabel((now - item.startedAt) / 1000)}
                </span>
                {expanded ? (
                  <ChevronDown size={13} className="subagent-chevron" />
                ) : (
                  <ChevronRight size={13} className="subagent-chevron" />
                )}
              </button>
              {expanded && (
                <div className="subagent-detail">
                  {item.stream.length > 0 && (
                    <ul className="subagent-stream">
                      {item.stream.map((entry, index) => (
                        <li
                          className={`subagent-stream-entry subagent-stream-${entry.kind}${
                            entry.isError ? " subagent-stream-error" : ""
                          }`}
                          key={`${entry.at}-${index}`}
                        >
                          {entry.text}
                        </li>
                      ))}
                    </ul>
                  )}
                  {controls &&
                    !item.provisional &&
                    !isTerminalSubagent(item.status) && (
                      <SubagentControlsRow
                        controls={controls}
                        subagentId={item.id}
                      />
                    )}
                  {controls && (
                    <SubagentTranscript
                      controls={controls}
                      subagentId={item.id}
                    />
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
