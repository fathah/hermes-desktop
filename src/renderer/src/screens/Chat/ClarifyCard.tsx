import { memo, useRef, useState } from "react";
import { useI18n } from "../../components/useI18n";
import type { ClarifyMessage } from "./types";
import {
  gatewayRequestRecord,
  normalizeGatewayClarifyAnswers,
} from "../../../../shared/gateway-server-requests";

/**
 * Sentinel answer for "skip — let Hermes decide". Mirrors the gateway's
 * autonomous-proceed convention: an empty answer tells the agent to choose a
 * reasonable default rather than block.
 */
const SKIP_ANSWER = "";

interface ClarifyCardProps {
  msg: ClarifyMessage;
  /** Mark the card resolved in parent state once the user answers/skips. */
  onRespond?: (msg: ClarifyMessage, answer: string) => Promise<boolean>;
  onResolved: (requestId: string, answer: string) => void;
}

/**
 * Inline card for a mid-turn `clarify.request`. Renders choice buttons when the
 * agent offered choices, otherwise an open-ended textarea, plus an auto-choose
 * toggle and a skip control. On answer it forwards to the main process via
 * `respondClarify` and flips the card to a resolved, read-only state.
 */
export const ClarifyCard = memo(function ClarifyCard({
  msg,
  onResolved,
  onRespond,
}: ClarifyCardProps): React.JSX.Element {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(false);

  const inFlight = useRef(false);
  const resolved = !!msg.resolved;
  const unavailable = !!msg.unavailable;

  const submit = async (answer: string): Promise<void> => {
    if (resolved || unavailable || inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setError(false);
    try {
      const ok = onRespond
        ? await onRespond(msg, answer)
        : msg.responsePath === "dashboard"
          ? false
          : await window.hermesAPI.respondClarify(msg.requestId, answer);
      // The IPC handler returns false when no pending request matched (e.g. the
      // turn already ended). Only flip the card to resolved on a confirmed
      // delivery; otherwise surface an error and let the user retry.
      if (ok === false) {
        setError(true);
        return;
      }
      onResolved(msg.requestId, answer);
    } catch {
      setError(true);
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  if (msg.questions?.length) {
    return (
      <BatchClarifyForm
        msg={msg}
        submitting={submitting}
        error={error}
        submit={submit}
      />
    );
  }

  if (resolved) {
    return (
      <div className="chat-clarify chat-clarify--resolved">
        <div className="chat-clarify-question">{msg.question}</div>
        <div className="chat-clarify-answer">
          {msg.answer && msg.answer.trim()
            ? msg.answer
            : t("chat.clarify.skipped")}
        </div>
      </div>
    );
  }

  const hasChoices = msg.choices.length > 0;

  return (
    <div className="chat-clarify">
      <div className="chat-clarify-question">
        {msg.question || t("chat.clarify.defaultQuestion")}
      </div>

      {hasChoices ? (
        <div className="chat-clarify-choices">
          {msg.choices.map((choice, i) => (
            <button
              key={`${msg.requestId}-${i}`}
              className="chat-clarify-choice"
              disabled={submitting || unavailable}
              onClick={() => void submit(choice)}
            >
              {choice}
            </button>
          ))}
        </div>
      ) : (
        <div className="chat-clarify-open">
          <textarea
            className="chat-clarify-textarea"
            rows={3}
            value={text}
            placeholder={t("chat.clarify.placeholder")}
            disabled={submitting || unavailable}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                void submit(text);
              }
            }}
          />
          <button
            className="chat-clarify-send"
            disabled={submitting || unavailable || !text.trim()}
            onClick={() => void submit(text)}
          >
            {t("chat.clarify.send")}
          </button>
        </div>
      )}

      <button
        className="chat-clarify-skip"
        disabled={submitting || unavailable}
        onClick={() => void submit(SKIP_ANSWER)}
      >
        {t("chat.clarify.skip")}
      </button>

      {(error || unavailable) && (
        <div className="chat-clarify-error" role="alert">
          {t(unavailable ? "chat.clarify.unavailable" : "chat.clarify.error")}
        </div>
      )}
    </div>
  );
});

/** A current Agent asks the whole set once, and receives one answer keyed by question ID. */
function BatchClarifyForm({
  msg,
  submitting,
  error,
  submit,
}: {
  msg: ClarifyMessage;
  submitting: boolean;
  error: boolean;
  submit: (answer: string) => Promise<void>;
}): React.JSX.Element {
  const { t } = useI18n();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [selections, setSelections] = useState<Record<string, string[]>>({});
  const questions = msg.questions ?? [];
  const lockedAnswers =
    normalizeGatewayClarifyAnswers(msg.answers, questions) ??
    Object.create(null);
  const disabled = submitting || !!msg.unavailable || !!msg.resolved;
  let submitted: Record<string, string | null> = Object.create(null);
  if (msg.resolved && msg.answer) {
    let answerMap: Record<string, unknown> | null = null;
    try {
      answerMap = gatewayRequestRecord(
        gatewayRequestRecord(JSON.parse(msg.answer))?.answers,
      );
    } catch {
      /* A single-question composer reply remains literal text. */
    }
    if (answerMap)
      submitted = Object.assign(
        Object.create(null),
        normalizeGatewayClarifyAnswers(answerMap, questions),
        lockedAnswers,
      );
    else if (questions.length === 1) {
      const qid = questions[0].qid;
      submitted[qid] = Object.hasOwn(lockedAnswers, qid)
        ? lockedAnswers[qid]
        : msg.answer;
    }
  }
  const readableAnswer = (qid: string, answer: string): string => {
    if (!questions.find((question) => question.qid === qid)?.multi_select)
      return answer;
    try {
      const values: unknown = JSON.parse(answer);
      if (
        Array.isArray(values) &&
        values.every((value) => typeof value === "string")
      )
        return values.join(", ");
    } catch {
      /* Free-text answers remain literal. */
    }
    return answer;
  };
  const valueFor = (qid: string): string =>
    Object.hasOwn(lockedAnswers, qid)
      ? readableAnswer(qid, lockedAnswers[qid] ?? "")
      : Object.hasOwn(drafts, qid)
        ? drafts[qid]
        : "";
  const answerSet = (skip = false): string =>
    JSON.stringify({
      answers: Object.fromEntries(
        questions.map(({ qid, multi_select }) => [
          qid,
          Object.hasOwn(lockedAnswers, qid)
            ? (lockedAnswers[qid] ?? null)
            : skip
              ? null
              : multi_select && Object.hasOwn(selections, qid)
                ? selections[qid].length
                  ? JSON.stringify(selections[qid])
                  : null
                : valueFor(qid).trim() || null,
        ]),
      ),
    });
  return (
    <div
      className={`chat-clarify chat-clarify-group${msg.resolved ? " chat-clarify--resolved" : ""}`}
    >
      {questions.map((question) => {
        const locked = Object.hasOwn(lockedAnswers, question.qid);
        if (msg.resolved)
          return (
            <div key={question.qid}>
              <div className="chat-clarify-question">{question.question}</div>
              <div className="chat-clarify-answer">
                {readableAnswer(
                  question.qid,
                  (Object.hasOwn(submitted, question.qid)
                    ? submitted[question.qid]
                    : "") || "",
                ) || t("chat.clarify.skipped")}
              </div>
            </div>
          );
        return (
          <fieldset key={question.qid} disabled={disabled || locked}>
            <legend className="chat-clarify-question">
              {question.question}
            </legend>
            {!!question.choices.length && (
              <div className="chat-clarify-choices">
                {question.choices.map((choice, index) => (
                  <button
                    key={index}
                    type="button"
                    className="chat-clarify-choice"
                    aria-pressed={
                      question.multi_select
                        ? (Object.hasOwn(selections, question.qid)
                            ? selections[question.qid]
                            : []
                          ).includes(choice)
                        : valueFor(question.qid) === choice
                    }
                    onClick={() => {
                      if (question.multi_select) {
                        const before = Object.hasOwn(selections, question.qid)
                          ? selections[question.qid]
                          : [];
                        const next = before.includes(choice)
                          ? before.filter((item) => item !== choice)
                          : [...before, choice];
                        setSelections((current) => ({
                          ...current,
                          [question.qid]: next,
                        }));
                        setDrafts((current) => ({
                          ...current,
                          [question.qid]: next.join(", "),
                        }));
                      } else
                        setDrafts((current) => ({
                          ...current,
                          [question.qid]: choice,
                        }));
                    }}
                  >
                    {choice}
                  </button>
                ))}
              </div>
            )}
            <textarea
              className="chat-clarify-textarea"
              aria-label={question.question}
              rows={2}
              placeholder={t("chat.clarify.placeholder")}
              value={valueFor(question.qid)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  if (questions.some(({ qid }) => valueFor(qid).trim()))
                    void submit(answerSet());
                }
              }}
              onChange={(event) => {
                setSelections((current) => {
                  const next = { ...current };
                  delete next[question.qid];
                  return next;
                });
                setDrafts((current) => ({
                  ...current,
                  [question.qid]: event.target.value,
                }));
              }}
            />
          </fieldset>
        );
      })}
      {!msg.resolved && (
        <>
          <button
            className="chat-clarify-send"
            disabled={
              disabled || !questions.some(({ qid }) => valueFor(qid).trim())
            }
            onClick={() => void submit(answerSet())}
          >
            {t("chat.clarify.send")}
          </button>
          <button
            className="chat-clarify-skip"
            disabled={disabled}
            onClick={() => void submit(answerSet(true))}
          >
            {t("chat.clarify.skip")}
          </button>
        </>
      )}
      {(error || msg.unavailable) && (
        <div className="chat-clarify-error" role="alert">
          {t(
            msg.unavailable ? "chat.clarify.unavailable" : "chat.clarify.error",
          )}
        </div>
      )}
    </div>
  );
}
