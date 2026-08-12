export const APPROVAL_CHOICES = ["once", "session", "always", "deny"] as const;

export type ApprovalChoice = (typeof APPROVAL_CHOICES)[number];

export interface ChatApprovalRequest {
  requestId: string;
  command: string;
  description: string;
  choices: ApprovalChoice[];
}

const VALID_CHOICES = new Set<string>(APPROVAL_CHOICES);

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function cleanText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return Array.from(value)
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code === 9 || code === 10 || code === 13 || code >= 32;
    })
    .join("")
    .trim()
    .slice(0, maxLength);
}

function firstText(
  sources: Array<Record<string, unknown> | null>,
  fields: string[],
  maxLength: number,
): string {
  for (const source of sources) {
    if (!source) continue;
    for (const field of fields) {
      const value = cleanText(source[field], maxLength);
      if (value) return value;
    }
  }
  return "";
}

export function normalizeApprovalRequest(
  payload: unknown,
  requestId: string,
): ChatApprovalRequest {
  const root = record(payload);
  const nested = [
    record(root?.approval),
    record(root?.request),
    record(root?.tool_call),
    record(root?.tool),
  ];
  const sources = [root, ...nested];
  const rawChoices = root?.choices;
  const hasExplicitChoices = Array.isArray(rawChoices);
  const choices: ApprovalChoice[] = [];

  if (hasExplicitChoices) {
    for (const rawChoice of rawChoices) {
      if (typeof rawChoice !== "string") continue;
      const choice = rawChoice.trim().toLowerCase();
      if (!VALID_CHOICES.has(choice)) continue;
      if (choice === "always" && root?.allow_permanent === false) continue;
      if (!choices.includes(choice as ApprovalChoice)) {
        choices.push(choice as ApprovalChoice);
      }
    }
  } else if (root?.smart_denied === true) {
    choices.push("once");
  } else {
    choices.push("once");
    if (typeof root?.allow_permanent === "boolean") choices.push("session");
    if (root?.allow_permanent === true) choices.push("always");
  }

  if (!choices.includes("deny")) choices.push("deny");

  return {
    requestId,
    command:
      firstText(
        sources,
        ["command", "cmd", "command_line", "input", "args", "action"],
        8192,
      ) || "Command details unavailable",
    description:
      firstText(
        sources,
        [
          "description",
          "reason",
          "message",
          "prompt",
          "summary",
          "pattern_description",
          "warning",
        ],
        2048,
      ) || "Hermes requires approval before continuing.",
    choices,
  };
}
