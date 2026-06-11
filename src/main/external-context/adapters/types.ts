/**
 * Source-adapter contract + shared parsing helpers for the External Context
 * Bridge. Adapters are PURE parsers: they read files (fs/readline) and emit
 * normalised fragments, but import NO electron and NO sqlite — so the whole
 * layer runs under vitest. Redaction and persistence happen downstream in the
 * db layer; adapters only cap text length.
 */
import fs from "node:fs";
import readline from "node:readline";
import type { ExternalSource } from "../../../shared/external-context";

/** Hard cap on indexed message text (scale guard — long blobs are truncated). */
export const MESSAGE_CHAR_CAP = 4000;

/** Cap on a derived conversation title. */
export const TITLE_CHAR_CAP = 80;

/** A file the adapter found on disk and how its cursor should advance. */
export interface DiscoveredFile {
  source: ExternalSource;
  absPath: string;
  size: number;
  mtimeMs: number;
  /** "append" = append-only JSONL (byte-offset cursor); "replace" = whole-file rewrite. */
  strategy: "append" | "replace";
}

/** Best-effort conversation metadata extracted from a slice (merged in the db). */
export interface ParsedConversation {
  conversationId: string;
  projectPath: string | null;
  gitBranch: string | null;
  title: string | null;
  startedAt: number | null;
  lastAt: number | null;
}

/** One normalised message — capped but NOT yet redacted. */
export interface ParsedMessage {
  conversationId: string;
  /** Monotonic per-conversation ordinal (byte offset for append, index for replace). */
  seq: number;
  role: "user" | "assistant";
  ts: number | null;
  text: string;
}

/** What one parseSlice call produces. */
export interface ParseResult {
  /** Single-conversation sources (one file ≈ one conversation). */
  conversation: ParsedConversation | null;
  /**
   * Multi-conversation sources — one EXPORT file holds many conversations
   * (ChatGPT/Claude.ai/Gemini Takeout). When present this takes precedence over
   * `conversation`: the db merges metadata for EACH entry and, on a `replace`
   * pass, clears each one's messages before re-inserting. `messages` still
   * carries every conversation's rows, keyed by their own `conversationId`.
   */
  conversations?: ParsedConversation[];
  messages: ParsedMessage[];
  /** Total bytes scanned (== file size); the db advances the cursor to here. */
  bytesConsumed: number;
}

/** The adapter interface every source implements. */
export interface SourceAdapter {
  source: ExternalSource;
  /** Base directories scanned (env-overridable for tests/smoke). */
  roots(): string[];
  /** Whether at least one root exists on this machine. */
  available(): boolean;
  /** Enumerate candidate files with their stat + cursor strategy. */
  discoverFiles(): Promise<DiscoveredFile[]>;
  /** Parse a file (append: from byte `fromOffset`; replace: whole file). */
  parseSlice(file: DiscoveredFile, fromOffset: number): Promise<ParseResult>;
}

// ─── shared helpers ────────────────────────────────────────────────────────

/** ISO-8601 (or any Date-parseable) string → epoch ms, or null. */
export function isoToEpoch(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || value.length === 0) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** Trim a message to the per-message cap. */
export function capMessage(text: string): string {
  if (text.length <= MESSAGE_CHAR_CAP) return text;
  return text.slice(0, MESSAGE_CHAR_CAP);
}

/** Derive a short single-line title from the first user message text. */
export function deriveTitle(text: string): string {
  const firstLine = text.replace(/\s+/g, " ").trim();
  if (firstLine.length <= TITLE_CHAR_CAP) return firstLine;
  return firstLine.slice(0, TITLE_CHAR_CAP).trimEnd();
}

/**
 * Extract plain text from a message `content` field that may be a string or a
 * list of content blocks. Only text-bearing blocks are kept (`text` /
 * `input_text` / `output_text`); tool_use / tool_result / thinking / image
 * blocks are dropped (scale + injection-surface reduction).
 */
export function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (typeof block === "string") {
      parts.push(block);
      continue;
    }
    if (block && typeof block === "object") {
      const b = block as Record<string, unknown>;
      const type = typeof b.type === "string" ? b.type : "";
      const isTextBlock =
        type === "text" ||
        type === "input_text" ||
        type === "output_text" ||
        type === "";
      if (isTextBlock && typeof b.text === "string") {
        parts.push(b.text);
      }
    }
  }
  return parts.join("\n").trim();
}

/**
 * Stream a JSONL file from a byte offset, yielding each parsed object with the
 * byte offset of its line. Tolerant: blank lines and lines that don't start
 * with `{`/`[` (prefix-sniff) or fail JSON.parse are skipped, so format drift
 * degrades gracefully instead of throwing.
 */
export async function* readJsonlFrom(
  absPath: string,
  fromOffset: number,
): AsyncGenerator<{ obj: Record<string, unknown>; offset: number }> {
  const stream = fs.createReadStream(absPath, {
    start: fromOffset > 0 ? fromOffset : 0,
    encoding: "utf8",
  });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let offset = fromOffset > 0 ? fromOffset : 0;
  for await (const line of rl) {
    const lineOffset = offset;
    offset += Buffer.byteLength(line, "utf8") + 1; // +1 ≈ newline
    const trimmed = line.trim();
    if (!trimmed) continue;
    const first = trimmed[0];
    if (first !== "{" && first !== "[") continue; // prefix-sniff
    let obj: unknown;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (obj && typeof obj === "object") {
      yield { obj: obj as Record<string, unknown>, offset: lineOffset };
    }
  }
}

/** Read + JSON.parse a whole file with a prefix-sniff; null on any failure. */
export function readWholeJson(absPath: string): unknown {
  let raw: string;
  try {
    raw = fs.readFileSync(absPath, "utf8");
  } catch {
    return null;
  }
  const trimmed = raw.trimStart();
  const first = trimmed[0];
  if (first !== "{" && first !== "[") return null; // prefix-sniff
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

/**
 * Recursively collect files under `root` matching `match`, with a depth cap to
 * bound work. Returns absolute paths; missing roots yield []. Symlinks are not
 * followed.
 */
export function walkFiles(
  root: string,
  match: (name: string, absPath: string) => boolean,
  maxDepth = 8,
): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > maxDepth) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(abs, depth + 1);
      } else if (entry.isFile() && match(entry.name, abs)) {
        out.push(abs);
      }
    }
  };
  walk(root, 0);
  return out;
}

/** stat → {size, mtimeMs}, or null if the file vanished. */
export function statFile(
  absPath: string,
): { size: number; mtimeMs: number } | null {
  try {
    const s = fs.statSync(absPath);
    return { size: s.size, mtimeMs: s.mtimeMs };
  } catch {
    return null;
  }
}
