// task-triage.ts — the "can I do it / who should do it" brain of the Tasks-Dump
// inbox. Given a captured thought, it asks the Hermes gateway (an LLM call, not
// the rule-based email classifier) to perform the GTD "clarify" step: is this
// actionable, can the AGENT do it, is it risky, when is it due, who owns it.
//
// Hard rule: this NEVER throws. If the gateway is down or the Hermes CLI is
// absent, classification falls back to the human lane assigned to self, so a
// captured task is never lost — it just lands on the ToDo page instead of being
// auto-dispatched.
import { gatewayChat, extractJson, type ChatMessage } from "./gateway-chat";
import { SELF_PERSON_ID, type PersonRef } from "../shared/contacts";
import type { NagCadence, TaskTriageResult } from "../shared/tasks-dump";
import type { TaskRoute } from "../shared/sps-types";

export interface ClassifyTaskOptions {
  profile?: string;
  /** Known contacts, so the classifier can match an assignee by name/alias. */
  persons?: PersonRef[];
  /** Installed agent skills — the agent-doability hint for the "ai" lane. */
  skills?: string[];
  /** Today's date (YYYY-MM-DD) for due-date parsing; defaults to today. */
  today?: string;
}

const ROUTES: TaskRoute[] = ["ai", "human"];
const CADENCES: NagCadence[] = ["none", "daily", "weekly"];
const MAX_PERSONS_IN_PROMPT = 50;
const DUE_RE = /^\d{4}-\d{2}-\d{2}$/;

function fallbackResult(): TaskTriageResult {
  return {
    route: "human",
    assigneeId: SELF_PERSON_ID,
    nagCadence: "daily",
    risky: false,
    reason: "classifier unavailable — defaulted to the human lane",
    confidence: 0,
  };
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function personLine(p: PersonRef): string {
  const aliases = p.aliases?.length ? ` (aka ${p.aliases.join(", ")})` : "";
  return `- ${p.id}: ${p.name}${aliases}`;
}

function buildMessages(text: string, opts: ClassifyTaskOptions): ChatMessage[] {
  const today = opts.today || todayIso();
  const skills = opts.skills?.length
    ? opts.skills.join(", ")
    : "(no special skills installed)";
  const persons = (opts.persons || []).slice(0, MAX_PERSONS_IN_PROMPT);
  const peopleBlock = persons.length
    ? persons.map(personLine).join("\n")
    : `- ${SELF_PERSON_ID}: You (the owner)`;
  const system = [
    "You triage a single captured to-do for a personal GTD inbox.",
    "Decide who should do it and how to handle it. Respond with ONE JSON object, no prose.",
    "",
    "Fields:",
    '- route: "ai" if the AI agent can fully complete it ALONE using its skills',
    '  (research, drafting, data lookups, file/code work); "human" if it needs a',
    "  person to act in the real world, make a judgement call, or contact someone.",
    "- risky: true if doing it is irreversible or has external side effects",
    "  (sending money/messages on the user's behalf, deleting data, public posts).",
    `- due: the deadline as YYYY-MM-DD relative to today (${today}), or "" if none.`,
    '- nagCadence: how often to chase a human task — "none", "daily", or "weekly".',
    "- assigneeId: the id of the person this task is about/delegated to, chosen",
    `  from the list below by name, alias, or context; use "${SELF_PERSON_ID}" if it`,
    "  is the owner's own task or the person is unclear.",
    "- reason: one short sentence.",
    "- confidence: 0 to 1.",
    "",
    `Agent skills: ${skills}`,
    "Known people:",
    peopleBlock,
  ].join("\n");
  return [
    { role: "system", content: system },
    { role: "user", content: text.trim() },
  ];
}

/**
 * Coerce a parsed LLM response into a safe TaskTriageResult. Pure + total:
 * unknown routes/cadences and out-of-set assignees fall back to safe defaults,
 * and AI-lane tasks are never nagged.
 */
export function parseTriageResult(
  raw: unknown,
  knownPersonIds: Set<string>,
): TaskTriageResult {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  const route: TaskRoute = ROUTES.includes(obj.route as TaskRoute)
    ? (obj.route as TaskRoute)
    : "human";
  const risky = obj.risky === true;
  const dueRaw = typeof obj.due === "string" ? obj.due.trim() : "";
  const due = DUE_RE.test(dueRaw) ? dueRaw : undefined;
  const assigneeRaw =
    typeof obj.assigneeId === "string" ? obj.assigneeId.trim() : "";
  const assigneeId = knownPersonIds.has(assigneeRaw)
    ? assigneeRaw
    : SELF_PERSON_ID;
  const cadenceRaw = obj.nagCadence as NagCadence;
  const suggestedCadence: NagCadence = CADENCES.includes(cadenceRaw)
    ? cadenceRaw
    : "daily";
  // AI tasks are executed by the agent, never chased on the human.
  const nagCadence: NagCadence = route === "ai" ? "none" : suggestedCadence;
  const reason = typeof obj.reason === "string" ? obj.reason : undefined;
  const confidenceNum =
    typeof obj.confidence === "number" ? obj.confidence : undefined;
  const confidence =
    confidenceNum == null ? undefined : Math.max(0, Math.min(1, confidenceNum));
  return {
    route,
    risky,
    nagCadence,
    assigneeId,
    ...(due ? { due } : {}),
    ...(reason ? { reason } : {}),
    ...(confidence != null ? { confidence } : {}),
  };
}

/** Classify one captured task. Never throws; degrades to the human lane. */
export async function classifyTaskCandidate(
  text: string,
  opts: ClassifyTaskOptions = {},
): Promise<TaskTriageResult> {
  if (!text.trim()) return fallbackResult();
  try {
    const messages = buildMessages(text, opts);
    const content = await gatewayChat(messages, 400, opts.profile);
    const parsed = extractJson(content);
    if (parsed == null) return fallbackResult();
    const knownIds = new Set((opts.persons || []).map((p) => p.id));
    return parseTriageResult(parsed, knownIds);
  } catch {
    return fallbackResult();
  }
}
