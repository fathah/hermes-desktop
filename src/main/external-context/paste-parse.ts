/**
 * Heuristic parser for a PASTED conversation transcript (P5.1). Tools without an
 * export — chiefly Perplexity — can't be brought in via the file-import adapters,
 * so the user copies the rendered conversation and pastes it. This turns that raw
 * text into the same `ParsedConversation` + `ParsedMessage[]` shape every other
 * adapter emits, so it flows through the identical `applyFragments` writer (index-
 * time redaction + fencing ride along unchanged).
 *
 * PURE node (crypto + the shared adapter helpers; no electron/sqlite) → vitest-
 * testable like every other parser. Redaction happens downstream in db.applyFragments.
 *
 * Strategy (best-effort, never throws):
 *   1. Fence-aware: never split a turn inside a ``` code fence.
 *   2. Role markers: a line that IS a known role label ("You", "ChatGPT", "Answer",
 *      "Perplexity", …) — whole-line or inline `Label: text` — starts a new turn.
 *   3. Fallback: no markers anywhere → alternate user/assistant over blank-line
 *      paragraphs (the natural shape of a Q/A copy).
 *
 * Provenance: `origin` (the tool the paste came from) is carried in `projectPath`
 * and folded into the stable `conversationId` hash so an identical paste re-imports
 * idempotently while a different origin is a distinct capture. `ts` is the staged
 * file's mtime (capture time) injected by the caller, so re-scans stay stable.
 */
import { createHash } from "node:crypto";
import {
  capMessage,
  deriveTitle,
  type ParsedConversation,
  type ParsedMessage,
} from "./adapters/types";

/** Caller-supplied context: the tool of origin + the capture timestamp. */
export interface PasteParseOptions {
  /** The tool the conversation was copied from (e.g. "Perplexity"); "" = none. */
  origin?: string | null;
  /** Capture time (staged-file mtime), used as every message's ts. */
  mtimeMs?: number | null;
}

/** Output of the pure parser (skipped = turns that reduced to empty text). */
export interface PasteParseResult {
  conversation: ParsedConversation | null;
  messages: ParsedMessage[];
  skipped: number;
}

type Role = "user" | "assistant";

interface Turn {
  role: Role;
  lines: string[];
}

/** Whole-line labels that mark the start of a user turn. */
const USER_LABELS = ["you", "user", "me", "human", "prompt", "question", "q"];
/** Whole-line labels that mark the start of an assistant turn. */
const ASSISTANT_LABELS = [
  "chatgpt",
  "gpt",
  "assistant",
  "claude",
  "perplexity",
  "answer",
  "ai",
  "bot",
  "copilot",
  "gemini",
  "grok",
  "a",
];

/** Map a known label to its role, or null when unknown. */
function roleForLabel(label: string): Role | null {
  if (USER_LABELS.includes(label)) return "user";
  if (ASSISTANT_LABELS.includes(label)) return "assistant";
  return null;
}

/**
 * A whole-line role header: just a label, optionally `said` and/or a trailing `:`
 * and nothing else (e.g. "You", "You said:", "ChatGPT", "Answer", "Q:"). The
 * single-letter `q`/`a` only count WITH a colon (a bare "A" line is usually prose).
 */
function classifyHeader(line: string): Role | null {
  const match = line.trim().match(/^([a-z]+)\s*(said)?\s*(:)?\s*$/i);
  if (!match) return null;
  const label = match[1].toLowerCase();
  const hasColon = Boolean(match[3]);
  if ((label === "q" || label === "a") && !hasColon) return null;
  return roleForLabel(label);
}

/** An inline header `Label: rest…` on one line (e.g. "Q: What is X"). */
function classifyInline(line: string): { role: Role; rest: string } | null {
  const match = line.match(/^\s*([a-z]+)\s*:\s+(\S.*)$/i);
  if (!match) return null;
  const role = roleForLabel(match[1].toLowerCase());
  if (!role) return null;
  return { role, rest: match[2] };
}

/** True for a line that opens or closes a fenced code block. */
function isFenceLine(line: string): boolean {
  return /^\s*```/.test(line);
}

/** Split text into blank-line paragraphs, never breaking inside a code fence. */
function splitParagraphs(text: string): string[] {
  const blocks: string[] = [];
  let buf: string[] = [];
  let inFence = false;
  const flush = (): void => {
    const joined = buf.join("\n").trim();
    if (joined) blocks.push(joined);
    buf = [];
  };
  for (const line of text.split("\n")) {
    if (isFenceLine(line)) {
      inFence = !inFence;
      buf.push(line);
      continue;
    }
    if (!inFence && line.trim() === "") {
      flush();
      continue;
    }
    buf.push(line);
  }
  flush();
  return blocks;
}

/** Fallback when no role markers exist: alternate user/assistant over paragraphs. */
function alternateFromParagraphs(text: string): Turn[] {
  return splitParagraphs(text).map((block, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    lines: [block],
  }));
}

/** Walk the lines marker-by-marker into role turns (fence-aware). */
function turnsFromMarkers(lines: string[]): {
  turns: Turn[];
  sawHeader: boolean;
} {
  const turns: Turn[] = [];
  let current: Turn | null = null;
  let inFence = false;
  let sawHeader = false;

  const start = (role: Role, firstLine?: string): Turn => {
    const turn: Turn = {
      role,
      lines: firstLine === undefined ? [] : [firstLine],
    };
    turns.push(turn);
    return turn;
  };

  for (const line of lines) {
    if (isFenceLine(line)) {
      inFence = !inFence;
      current = current ?? start("user");
      current.lines.push(line);
      continue;
    }
    if (!inFence) {
      const header = classifyHeader(line);
      if (header) {
        sawHeader = true;
        current = start(header);
        continue;
      }
      const inline = classifyInline(line);
      if (inline) {
        sawHeader = true;
        current = start(inline.role, inline.rest);
        continue;
      }
    }
    current = current ?? start("user");
    current.lines.push(line);
  }
  return { turns, sawHeader };
}

/**
 * Parse a pasted conversation into normalised fragments. Never throws; an empty
 * or unrecognised paste returns `{ conversation: null, messages: [], skipped }`.
 */
export function parsePastedConversation(
  rawText: string,
  opts: PasteParseOptions = {},
): PasteParseResult {
  const empty: PasteParseResult = {
    conversation: null,
    messages: [],
    skipped: 0,
  };
  if (typeof rawText !== "string") return empty;
  const normalized = rawText.replace(/\r\n?/g, "\n").trim();
  if (!normalized) return empty;

  const { turns, sawHeader } = turnsFromMarkers(normalized.split("\n"));
  const finalTurns = sawHeader ? turns : alternateFromParagraphs(normalized);

  const origin = typeof opts.origin === "string" ? opts.origin.trim() : "";
  const ts =
    typeof opts.mtimeMs === "number" && Number.isFinite(opts.mtimeMs)
      ? Math.floor(opts.mtimeMs)
      : null;
  // Stable id from origin + content → identical re-paste is idempotent; a
  // different origin is a distinct capture. (No timestamp in the hash.)
  const hash = createHash("sha256")
    .update(`${origin}\n${normalized}`)
    .digest("hex")
    .slice(0, 16);
  const conversationId = `paste-${hash}`;

  const messages: ParsedMessage[] = [];
  let skipped = 0;
  for (const turn of finalTurns) {
    const text = capMessage(turn.lines.join("\n").trim());
    if (!text) {
      skipped += 1;
      continue;
    }
    messages.push({
      conversationId,
      seq: messages.length,
      role: turn.role,
      ts,
      text,
    });
  }
  if (messages.length === 0) return { ...empty, skipped };

  const firstUser = messages.find((m) => m.role === "user") ?? messages[0];
  const conversation: ParsedConversation = {
    conversationId,
    projectPath: origin || null,
    gitBranch: null,
    title: deriveTitle(firstUser.text),
    startedAt: ts,
    lastAt: ts,
  };
  return { conversation, messages, skipped };
}
