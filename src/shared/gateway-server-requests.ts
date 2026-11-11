/** The request half of Agent's peer-to-peer JSON-RPC channel (desktop contract 7+). */
export interface GatewayServerRequest {
  id: string;
  method: string;
  params: Record<string, unknown>;
  sessionId: string;
}

export interface GatewayClarifyQuestion {
  qid: string;
  question: string;
  choices: string[];
  multi_select: boolean;
}

export interface GatewayRequestEvent {
  type: string;
  session_id: string;
  payload: Record<string, unknown>;
}

export function gatewayRequestRecord(
  value: unknown,
): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function parseGatewayServerRequest(
  value: unknown,
): GatewayServerRequest | null {
  const frame = gatewayRequestRecord(value);
  const params = gatewayRequestRecord(frame?.params);
  if (
    !frame ||
    typeof frame.id !== "string" ||
    !/^srq-[A-Za-z0-9_-]{1,128}$/.test(frame.id) ||
    typeof frame.method !== "string" ||
    !/^[a-z][a-z0-9_.-]{0,127}$/.test(frame.method) ||
    !params ||
    typeof params.session_id !== "string" ||
    params.session_id.length > 512
  )
    return null;
  return {
    id: frame.id,
    method: frame.method,
    params,
    sessionId: params.session_id,
  };
}

export function normalizeGatewayClarifyQuestions(
  value: unknown,
): GatewayClarifyQuestion[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 5) return [];
  const ids = new Set<string>();
  const questions: GatewayClarifyQuestion[] = [];
  for (const item of value) {
    const question = gatewayRequestRecord(item);
    if (
      !question ||
      typeof question.qid !== "string" ||
      !question.qid.trim() ||
      question.qid.length > 256 ||
      ids.has(question.qid) ||
      typeof question.question !== "string" ||
      !question.question.trim() ||
      question.question.length > 16_384
    )
      return [];
    ids.add(question.qid);
    if (
      question.choices != null &&
      (!Array.isArray(question.choices) ||
        question.choices.length > 64 ||
        question.choices.some(
          (choice) => typeof choice !== "string" || choice.length > 16_384,
        ))
    )
      return [];
    const choices = Array.isArray(question.choices)
      ? question.choices
          .filter((choice): choice is string => typeof choice === "string")
          .slice(0, 64)
      : [];
    questions.push({
      qid: question.qid,
      question: question.question,
      choices,
      multi_select: question.multi_select === true,
    });
  }
  return questions;
}

/** Keep only bounded, typed answers for questions in this request. */
export function normalizeGatewayClarifyAnswers(
  value: unknown,
  questions: GatewayClarifyQuestion[],
): Record<string, string | null> | null {
  const answers: Record<string, string | null> = Object.create(null);
  if (value === undefined || value === null) return answers;
  const source = gatewayRequestRecord(value);
  if (!source) return null;
  for (const { qid } of questions) {
    if (!Object.hasOwn(source, qid)) continue;
    const answer = source[qid];
    if (
      answer !== null &&
      (typeof answer !== "string" || answer.length > 65_536)
    )
      return null;
    answers[qid] = answer as string | null;
  }
  return answers;
}

export function normalizeGatewayServerRequestEvent(
  request: GatewayServerRequest,
): GatewayRequestEvent | null {
  if (!["approval", "clarify", "sudo", "secret"].includes(request.method))
    return null;
  const payload: Record<string, unknown> = {
    ...request.params,
    ...(request.params.request_id
      ? { approval_request_id: request.params.request_id }
      : {}),
    request_id: request.id,
    server_request_id: request.id,
  };
  if (request.method === "clarify") {
    const questions = normalizeGatewayClarifyQuestions(
      request.params.questions,
    );
    if (!questions.length) return null;
    const answers = normalizeGatewayClarifyAnswers(
      request.params.answers,
      questions,
    );
    if (!answers) return null;
    payload.questions = questions;
    payload.answers = answers;
    payload.question = questions[0].question;
    payload.choices = [];
  }
  return {
    type: `${request.method}.request`,
    session_id: request.sessionId,
    payload,
  };
}

/** Only call for a known open clarify RPC; legacy literal answers must stay literal. */
export function gatewayClarifyResult(
  request: GatewayServerRequest,
  answer: string,
): { answers: Record<string, string | null> } | null {
  const questions = normalizeGatewayClarifyQuestions(request.params.questions);
  if (request.method !== "clarify" || !questions.length) return null;
  let supplied: Record<string, unknown> | null = null;
  try {
    supplied = gatewayRequestRecord(
      gatewayRequestRecord(JSON.parse(answer))?.answers,
    );
  } catch {
    /* A single composer answer can be plain text. */
  }
  if (!supplied && questions.length !== 1 && answer !== "") return null;
  const answers: Record<string, string | null> = Object.create(null);
  const locked = normalizeGatewayClarifyAnswers(
    request.params.answers,
    questions,
  );
  if (!locked) return null;
  for (const question of questions) {
    const value =
      locked && Object.hasOwn(locked, question.qid)
        ? locked[question.qid]
        : supplied
          ? supplied[question.qid]
          : answer || null;
    if (value !== null && (typeof value !== "string" || value.length > 65_536))
      return null;
    answers[question.qid] = value as string | null;
  }
  return { answers };
}

export const GATEWAY_WINDOW_REQUESTS = new Set([
  "preview.act",
  "preview.read",
  "terminal.read",
  "window.read",
  "theme.apply",
  "tour",
]);
