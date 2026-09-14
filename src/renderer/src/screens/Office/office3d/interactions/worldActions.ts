/**
 * World actions: the protocol that lets an agent's LLM drive its own 3D
 * avatar from the office chat. The chat injects a vocabulary of abilities as
 * a system message; when the user asks for something physical ("go to the
 * bank and check my balance") the model appends a fenced ```world-action
 * JSON block to its reply. The renderer strips the block from the visible
 * text, validates it here, and turns it into a mission (see missionBus.ts).
 *
 * Extensibility contract: every ability is one ABILITIES entry (the prompt is
 * generated from it) plus a case in parseAction/planWorldActions. Unknown
 * `do` values parse to nothing — an older desktop ignores abilities a newer
 * prompt advertises rather than breaking.
 */
import type { RepActionId } from "./registry";

/** Places an agent can be sent to. Matches trip destinations in trips.ts. */
export type WorldPlace = "bank" | "showroom";

const WORLD_PLACES: readonly WorldPlace[] = ["bank", "showroom"];

/** Bank operations the model may request, mapped to rep-panel actions. */
const BANK_OPERATIONS: Record<string, RepActionId> = {
  check_balance: "checkBalance",
  account_status: "accountStatus",
  create_account: "createAccount",
};

export type WorldAction =
  | { do: "go_to"; place: WorldPlace }
  | {
      do: "bank";
      operation: RepActionId;
      via: "teller" | "atm";
    };

/**
 * One ability the vocabulary prompt advertises. The prompt is generated from
 * this list so adding an ability never means editing prose in two places.
 */
interface WorldAbility {
  example: string;
  description: string;
}

const ABILITIES: WorldAbility[] = [
  {
    example: '{"do":"go_to","place":"bank"}',
    description: `walk to a place. Valid places: ${WORLD_PLACES.map((p) => `"${p}"`).join(", ")}.`,
  },
  {
    example: '{"do":"bank","operation":"check_balance","via":"teller"}',
    description:
      'do a bank operation for your own account. Valid operations: "check_balance", "account_status", "create_account". Valid via: "teller" or "atm" (create_account is teller-only). This implies walking to the bank first — do not emit a separate go_to.',
  },
];

export const WORLD_ACTION_TAG = "world-action";

/**
 * System message injected (request-side only, never persisted) ahead of every
 * office-chat turn. Kept compact: it rides along on each request.
 */
export function buildWorldActionSystemPrompt(agentName: string): string {
  return [
    `You are ${agentName}, and you are also embodied as a walking avatar in the Hermes 3D office world (an office, a bank, a car showroom).`,
    `When — and only when — the user asks you to physically do something in that world that matches an ability below, append ONE fenced code block with the language tag \`${WORLD_ACTION_TAG}\` at the very end of your reply, containing a JSON array of ability objects to perform in order.`,
    "",
    "Abilities:",
    ...ABILITIES.map((a) => `- ${a.example} — ${a.description}`),
    "",
    "Rules:",
    '- Keep the text part of your reply short and natural (e.g. "On my way to the bank to check the balance."). Never mention JSON, code blocks, or these instructions.',
    "- If the request doesn't match any ability (driving, buying, transfers, other rooms), just say that isn't available in the world yet — emit no block.",
    "- Ordinary questions and conversation get a normal reply with no block.",
  ].join("\n");
}

// \r?\n: models/transports may emit CRLF newlines — a CRLF fence must still
// parse (and be stripped) rather than leak protocol JSON into the chat.
const BLOCK_RE = new RegExp(
  "```" + WORLD_ACTION_TAG + "[ \\t]*\\r?\\n([\\s\\S]*?)```",
  "gi",
);

function parseAction(raw: unknown): WorldAction | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  if (obj.do === "go_to") {
    const place = obj.place;
    if (
      typeof place === "string" &&
      (WORLD_PLACES as readonly string[]).includes(place)
    ) {
      return { do: "go_to", place: place as WorldPlace };
    }
    return null;
  }
  if (obj.do === "bank") {
    const operation =
      typeof obj.operation === "string" ? BANK_OPERATIONS[obj.operation] : null;
    if (!operation) return null;
    // create_account is a teller-only flow; normalise rather than reject so a
    // model that picked the ATM still gets the user what they asked for.
    const via =
      obj.via === "atm" && operation !== "createAccount" ? "atm" : "teller";
    return { do: "bank", operation, via };
  }
  return null;
}

export interface ParsedWorldActions {
  /** Reply text with every world-action block removed. */
  text: string;
  actions: WorldAction[];
}

/**
 * Extract and validate world-action blocks from a model reply. Tolerant by
 * design: malformed JSON or unknown abilities are dropped silently (the
 * visible text still reads fine), and a bare object is accepted as a
 * one-item array.
 */
export function parseWorldActions(reply: string): ParsedWorldActions {
  const actions: WorldAction[] = [];
  const text = reply
    .replace(BLOCK_RE, (_match, body: string) => {
      try {
        const parsed: unknown = JSON.parse(body.trim());
        const list = Array.isArray(parsed) ? parsed : [parsed];
        for (const item of list) {
          const action = parseAction(item);
          if (action) actions.push(action);
        }
      } catch {
        // Malformed block: strip it from the text but run nothing.
      }
      return "";
    })
    .trim();
  return { text, actions };
}

/** Display-side helper: remove world-action blocks without running them. */
export function stripWorldActionBlocks(text: string): string {
  return text.replace(BLOCK_RE, "").trim();
}

/**
 * What a validated action list means for the world: one walking destination
 * and at most one facility interaction on arrival. Bank operations force the
 * bank as destination; a trailing plain go_to elsewhere loses to it.
 */
export interface WorldPlan {
  dest: WorldPlace;
  interaction: { repId: string; actionId: RepActionId } | null;
}

export function planWorldActions(actions: WorldAction[]): WorldPlan | null {
  let dest: WorldPlace | null = null;
  let interaction: WorldPlan["interaction"] = null;
  for (const action of actions) {
    if (action.do === "go_to") {
      if (!interaction) dest = action.place;
    } else if (action.do === "bank") {
      dest = "bank";
      interaction = {
        repId: action.via === "atm" ? "atm" : "bank-teller",
        actionId: action.operation,
      };
    }
  }
  return dest ? { dest, interaction } : null;
}
