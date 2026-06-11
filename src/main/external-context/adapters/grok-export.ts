/**
 * Grok export adapter — ingests a user-supplied Grok SESSION file (the same
 * `{type, content}` JSONL the live `grok.ts` adapter reads from
 * `~/.grok/sessions/.../chat_history.jsonl`, but uploaded from another machine /
 * a copied session rather than auto-discovered). This is the one Grok artifact
 * shape we can verify against; x.ai does not (as of writing) ship a distinct
 * web-export JSON. If/when it does, extend {@link parseGrokExport} — the parser
 * is schema-TOLERANT and quarantines anything it doesn't recognise, so an
 * unexpected shape indexes nothing rather than corrupting or throwing.
 *
 * Named `grok-export` (not `grok`) so it never collides with the live adapter.
 * One uploaded file == one conversation. Redaction happens downstream in
 * db.applyFragments (the single writer).
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import {
  capMessage,
  deriveTitle,
  extractText,
  isoToEpoch,
  statFile,
  walkFiles,
  type DiscoveredFile,
  type ParsedConversation,
  type ParsedMessage,
  type ParseResult,
  type SourceAdapter,
} from "./types";
import { importRootFor } from "../import-roots";

/** Output of the pure parser. */
export interface GrokExportParseResult {
  conversation: ParsedConversation | null;
  messages: ParsedMessage[];
}

function normaliseRole(raw: unknown): "user" | "assistant" | null {
  if (raw === "user") return "user";
  if (raw === "assistant") return "assistant";
  return null;
}

/**
 * Parse a Grok session's `{type, content}` JSONL into one conversation. Lines
 * that aren't objects, aren't user/assistant turns, or carry no text are
 * skipped. `conversationId` is supplied by the caller (the staged filename).
 */
export function parseGrokExport(
  rawText: string,
  conversationId: string,
  mtimeMs: number,
): GrokExportParseResult {
  const messages: ParsedMessage[] = [];
  let title: string | null = null;
  let seq = 0;

  for (const line of rawText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || (trimmed[0] !== "{" && trimmed[0] !== "[")) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) continue;
    const o = obj as Record<string, unknown>;
    const role = normaliseRole(o.type ?? o.role);
    if (!role) continue;
    const text = capMessage(extractText(o.content).trim());
    if (!text) continue;
    if (role === "user" && !title) title = deriveTitle(text);
    messages.push({
      conversationId,
      seq: seq++,
      role,
      ts: isoToEpoch(o.timestamp ?? o.create_time ?? o.ts),
      text,
    });
  }

  if (messages.length === 0) return { conversation: null, messages: [] };
  const conversation: ParsedConversation = {
    conversationId,
    projectPath: null,
    gitBranch: null,
    title,
    startedAt: null,
    lastAt: mtimeMs,
  };
  return { conversation, messages };
}

/** Stable conversation id from a staged filename (strip the extension). */
function conversationIdFor(absPath: string): string {
  return basename(absPath).replace(/\.[^.]+$/, "");
}

export const grokExportAdapter: SourceAdapter = {
  source: "grok-export",

  roots() {
    return [importRootFor("grok-export")];
  },

  available() {
    return statFile(importRootFor("grok-export")) !== null;
  },

  async discoverFiles() {
    const root = importRootFor("grok-export");
    const files = walkFiles(root, (name) => /\.(jsonl|json)$/i.test(name), 3);
    const out: DiscoveredFile[] = [];
    for (const absPath of files) {
      const stat = statFile(absPath);
      if (!stat) continue;
      out.push({
        source: "grok-export",
        absPath,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        strategy: "replace",
      });
    }
    return out;
  },

  async parseSlice(file: DiscoveredFile): Promise<ParseResult> {
    let rawText: string;
    try {
      rawText = readFileSync(file.absPath, "utf8");
    } catch {
      return { conversation: null, messages: [], bytesConsumed: file.size };
    }
    const parsed = parseGrokExport(
      rawText,
      conversationIdFor(file.absPath),
      file.mtimeMs,
    );
    return {
      conversation: parsed.conversation,
      messages: parsed.messages,
      bytesConsumed: file.size,
    };
  },
};
