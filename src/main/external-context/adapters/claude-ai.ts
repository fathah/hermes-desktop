/**
 * Claude.ai export adapter — parses the `conversations.json` a user downloads
 * from claude.ai ("Settings → Privacy → Export data"). Unlike the node-graph
 * ChatGPT export, Claude.ai conversations are LINEAR: each conversation has an
 * ordered `chat_messages` array (no branching), so parsing is a straight walk.
 *
 *   [ { uuid, name, created_at, updated_at,
 *       chat_messages: [ { sender: "human"|"assistant",
 *                          text, content: [{type:"text",text}], created_at }, … ] }, … ]
 *
 * One export holds MANY conversations → multi-conversation ParseResult. Parsing
 * is schema-TOLERANT (unknown shapes are skipped + counted, never thrown).
 * Redaction happens downstream in db.applyFragments (the single writer).
 */
import {
  capMessage,
  deriveTitle,
  extractText,
  isoToEpoch,
  readWholeJson,
  statFile,
  walkFiles,
  type DiscoveredFile,
  type ParsedConversation,
  type ParsedMessage,
  type ParseResult,
  type SourceAdapter,
} from "./types";
import { importRootFor } from "../import-roots";

/** Output of the pure parser (skipped = conversations we couldn't parse). */
export interface ClaudeAiParseResult {
  conversations: ParsedConversation[];
  messages: ParsedMessage[];
  skipped: number;
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function minNull(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
}

function maxNull(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

/** Claude.ai sender → our normalised role. */
function normaliseSender(raw: unknown): "user" | "assistant" | null {
  if (raw === "human" || raw === "user") return "user";
  if (raw === "assistant") return "assistant";
  return null;
}

/**
 * Message text: prefer structured `content` blocks ([{type:"text",text}], which
 * {@link extractText} handles), fall back to the flattened `text` string older
 * exports carry.
 */
function messageText(m: Record<string, unknown>): string {
  const fromBlocks = extractText(m.content).trim();
  if (fromBlocks) return fromBlocks;
  return typeof m.text === "string" ? m.text.trim() : "";
}

function parseOneConversation(
  item: unknown,
): { conversation: ParsedConversation; messages: ParsedMessage[] } | null {
  if (!item || typeof item !== "object") return null;
  const conv = item as Record<string, unknown>;
  const rawMessages = conv.chat_messages;
  if (!Array.isArray(rawMessages)) return null;

  const conversationId = strOrNull(conv.uuid) ?? strOrNull(conv.id);
  if (!conversationId) return null;

  const messages: ParsedMessage[] = [];
  let firstUserText: string | null = null;
  let minTs: number | null = null;
  let maxTs: number | null = null;
  let seq = 0;

  for (const raw of rawMessages) {
    if (!raw || typeof raw !== "object") continue;
    const m = raw as Record<string, unknown>;
    const role = normaliseSender(m.sender ?? m.role);
    if (!role) continue;
    const text = capMessage(messageText(m));
    if (!text) continue;
    const ts = isoToEpoch(m.created_at);
    minTs = minNull(minTs, ts);
    maxTs = maxNull(maxTs, ts);
    if (role === "user" && firstUserText === null) firstUserText = text;
    messages.push({ conversationId, seq: seq++, role, ts, text });
  }
  if (messages.length === 0) return null;

  const title =
    strOrNull(conv.name) ?? (firstUserText ? deriveTitle(firstUserText) : null);
  const conversation: ParsedConversation = {
    conversationId,
    projectPath: null,
    gitBranch: null,
    title,
    startedAt: isoToEpoch(conv.created_at) ?? minTs,
    lastAt: isoToEpoch(conv.updated_at) ?? maxTs,
  };
  return { conversation, messages };
}

/**
 * Parse a whole Claude.ai export payload (the top-level array, or a
 * `{ conversations: [...] }` wrapper) into normalised conversations + messages.
 * Never throws; unparseable conversations are counted in `skipped`.
 */
export function parseClaudeAiExport(raw: unknown): ClaudeAiParseResult {
  const out: ClaudeAiParseResult = {
    conversations: [],
    messages: [],
    skipped: 0,
  };
  let list: unknown[] | null = null;
  if (Array.isArray(raw)) {
    list = raw;
  } else if (raw && typeof raw === "object") {
    const wrapped = (raw as Record<string, unknown>).conversations;
    if (Array.isArray(wrapped)) list = wrapped;
  }
  if (!list) return out;

  for (const item of list) {
    const parsed = parseOneConversation(item);
    if (!parsed) {
      out.skipped += 1;
      continue;
    }
    out.conversations.push(parsed.conversation);
    out.messages.push(...parsed.messages);
  }
  return out;
}

export const claudeAiAdapter: SourceAdapter = {
  source: "claude-ai",

  roots() {
    return [importRootFor("claude-ai")];
  },

  available() {
    return statFile(importRootFor("claude-ai")) !== null;
  },

  async discoverFiles() {
    const root = importRootFor("claude-ai");
    const files = walkFiles(
      root,
      (name) => name.toLowerCase().endsWith(".json"),
      3,
    );
    const out: DiscoveredFile[] = [];
    for (const absPath of files) {
      const stat = statFile(absPath);
      if (!stat) continue;
      out.push({
        source: "claude-ai",
        absPath,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        strategy: "replace",
      });
    }
    return out;
  },

  async parseSlice(file: DiscoveredFile): Promise<ParseResult> {
    const raw = readWholeJson(file.absPath);
    const parsed = parseClaudeAiExport(raw);
    return {
      conversation: null,
      conversations: parsed.conversations,
      messages: parsed.messages,
      bytesConsumed: file.size,
    };
  },
};
