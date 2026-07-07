export type CouncilVerdict = "endorse" | "challenge" | "reject" | "abstain";

export type CouncilToolPolicy = "full";

export interface CouncilSeatConfig {
  id: string;
  name: string;
  rolePrompt: string;
  rubric: string;
  provider: string;
  model: string;
  baseUrl: string;
  enabled: boolean;
}

export interface CouncilModeratorConfig {
  provider: string;
  model: string;
  baseUrl: string;
  prompt: string;
}

export interface CouncilConfig {
  enabled: boolean;
  seats: CouncilSeatConfig[];
  moderator: CouncilModeratorConfig;
  maxConcurrentSeats: number;
  toolPolicy: CouncilToolPolicy;
  defaultSaveToSps: boolean;
}

export interface CouncilSeatPromptArgs {
  originalPrompt: string;
  seat: CouncilSeatConfig;
  seatIndex: number;
  totalSeats: number;
}

export interface CouncilModeratorPromptArgs {
  originalPrompt: string;
  config: CouncilConfig;
  responses: Array<{
    seatName: string;
    provider: string;
    model: string;
    content: string;
    verdict?: CouncilVerdict;
  }>;
}

export const COUNCIL_VERDICTS: CouncilVerdict[] = [
  "endorse",
  "challenge",
  "reject",
  "abstain",
];

export const DEFAULT_COUNCIL_SEATS: CouncilSeatConfig[] = [
  {
    id: "builder",
    name: "Builder",
    rolePrompt:
      "Answer the user's request directly. Prefer the smallest complete path that works.",
    rubric:
      "Reward concrete implementation detail, reuse of existing seams, and clear verification.",
    provider: "",
    model: "",
    baseUrl: "",
    enabled: true,
  },
  {
    id: "skeptic",
    name: "Skeptic",
    rolePrompt:
      "Look for hidden assumptions, missing tests, and failure modes before endorsing a path.",
    rubric:
      "Reward falsifiable objections, security/privacy checks, and precise blockers.",
    provider: "",
    model: "",
    baseUrl: "",
    enabled: true,
  },
  {
    id: "synthesizer",
    name: "Synthesizer",
    rolePrompt:
      "Combine the strongest points into a recommendation that is useful to execute.",
    rubric:
      "Reward clear tradeoffs, decisive next steps, and honest uncertainty.",
    provider: "",
    model: "",
    baseUrl: "",
    enabled: true,
  },
];

export const DEFAULT_COUNCIL_CONFIG: CouncilConfig = {
  enabled: true,
  seats: DEFAULT_COUNCIL_SEATS,
  moderator: {
    provider: "",
    model: "",
    baseUrl: "",
    prompt:
      "Moderate independent LLM council answers. Identify consensus, dissent, verification gaps, and the recommended final answer.",
  },
  maxConcurrentSeats: 3,
  toolPolicy: "full",
  defaultSaveToSps: true,
};

function stringOrDefault(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function boolOrDefault(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeSeat(
  raw: unknown,
  fallback: CouncilSeatConfig,
): CouncilSeatConfig {
  const item = raw && typeof raw === "object" ? raw : {};
  const record = item as Record<string, unknown>;
  return {
    id: stringOrDefault(record.id, fallback.id).trim() || fallback.id,
    name: stringOrDefault(record.name, fallback.name).trim() || fallback.name,
    rolePrompt:
      stringOrDefault(record.rolePrompt, fallback.rolePrompt).trim() ||
      fallback.rolePrompt,
    rubric:
      stringOrDefault(record.rubric, fallback.rubric).trim() || fallback.rubric,
    provider: stringOrDefault(record.provider, fallback.provider).trim(),
    model: stringOrDefault(record.model, fallback.model).trim(),
    baseUrl: stringOrDefault(record.baseUrl, fallback.baseUrl).trim(),
    enabled: boolOrDefault(record.enabled, fallback.enabled),
  };
}

function normalizeModerator(raw: unknown): CouncilModeratorConfig {
  const record = raw && typeof raw === "object" ? raw : {};
  const item = record as Record<string, unknown>;
  return {
    provider: stringOrDefault(item.provider, "").trim(),
    model: stringOrDefault(item.model, "").trim(),
    baseUrl: stringOrDefault(item.baseUrl, "").trim(),
    prompt:
      stringOrDefault(
        item.prompt,
        DEFAULT_COUNCIL_CONFIG.moderator.prompt,
      ).trim() || DEFAULT_COUNCIL_CONFIG.moderator.prompt,
  };
}

export function normalizeCouncilConfig(raw: unknown): CouncilConfig {
  const record = raw && typeof raw === "object" ? raw : {};
  const item = record as Record<string, unknown>;
  const rawSeats = Array.isArray(item.seats) ? item.seats : [];
  const fallbackSeats = DEFAULT_COUNCIL_CONFIG.seats;
  const seats =
    rawSeats.length > 0
      ? rawSeats.map((seat, index) =>
          normalizeSeat(seat, fallbackSeats[index] ?? fallbackSeats[0]),
        )
      : fallbackSeats.map((seat) => ({ ...seat }));
  const maxConcurrentSeats =
    typeof item.maxConcurrentSeats === "number"
      ? Math.round(item.maxConcurrentSeats)
      : DEFAULT_COUNCIL_CONFIG.maxConcurrentSeats;

  return {
    enabled: boolOrDefault(item.enabled, DEFAULT_COUNCIL_CONFIG.enabled),
    seats,
    moderator: normalizeModerator(item.moderator),
    maxConcurrentSeats: Math.min(Math.max(maxConcurrentSeats, 1), 5),
    toolPolicy: "full",
    defaultSaveToSps: boolOrDefault(
      item.defaultSaveToSps,
      DEFAULT_COUNCIL_CONFIG.defaultSaveToSps,
    ),
  };
}

export function buildCouncilSeatPrompt({
  originalPrompt,
  seat,
  seatIndex,
  totalSeats,
}: CouncilSeatPromptArgs): string {
  return [
    `You are ${seat.name}. Seat ${seatIndex + 1} of ${totalSeats} in an independent LLM council.`,
    "",
    "Work independently. Use the available tools when they would materially improve correctness.",
    "Do not defer to other council members; they are answering separately.",
    "",
    "Role:",
    seat.rolePrompt,
    "",
    "Rubric:",
    seat.rubric,
    "",
    "Return a concise answer followed by a final line in this exact form:",
    "Verdict: endorse | challenge | reject | abstain",
    "",
    "User request:",
    originalPrompt,
  ].join("\n");
}

export function buildCouncilModeratorPrompt({
  originalPrompt,
  config,
  responses,
}: CouncilModeratorPromptArgs): string {
  const sections = responses.map((response, index) =>
    [
      `Seat ${index + 1}: ${response.seatName} (${response.provider}/${response.model})`,
      response.verdict ? `Declared verdict: ${response.verdict}` : null,
      response.content,
    ]
      .filter(Boolean)
      .join("\n"),
  );

  return [
    config.moderator.prompt,
    "",
    "Original request:",
    originalPrompt,
    "",
    "Council responses:",
    sections.join("\n\n---\n\n"),
    "",
    "Produce these sections:",
    "Consensus",
    "Dissent",
    "Verification gaps",
    "Recommended final answer",
  ].join("\n");
}

export function parseCouncilVerdict(text: string): {
  verdict?: CouncilVerdict;
  rationale?: string;
} {
  const match = text.match(
    /^\s*Verdict:\s*(endorse|challenge|reject|abstain)\b(.*)$/im,
  );
  if (!match) return {};
  const verdict = match[1].toLowerCase() as CouncilVerdict;
  const rationale = match[2]?.trim();
  return rationale ? { verdict, rationale } : { verdict };
}
