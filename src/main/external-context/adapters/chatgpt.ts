/**
 * ChatGPT export adapter — parses the `conversations.json` a user downloads from
 * ChatGPT ("Settings → Data controls → Export"). Unlike the live-scan sources,
 * the export is a single file holding MANY conversations, each a node-graph:
 *
 *   [ { title, create_time, update_time, current_node,
 *       mapping: { <nodeId>: { id, message, parent, children }, … } }, … ]
 *
 * A conversation's mapping can branch (regenerated/edited turns). The CANONICAL
 * transcript is the path the user last had selected: walk from `current_node`
 * up the `parent` links to the root, then reverse. tool/system nodes are
 * dropped (scale + injection-surface). Parsing is schema-TOLERANT: any shape we
 * don't recognise is skipped and counted, never thrown — one bad conversation
 * must not abort a 5,000-conversation export.
 *
 * Files are staged into the import root by the import IPC (3.6); this adapter
 * only discovers + parses them. Redaction happens downstream in db.applyFragments
 * (the single writer) — adapters never see knownSecrets.
 */
import {
  capMessage,
  deriveTitle,
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

/** One node in a conversation's `mapping` object. */
interface ChatGptNode {
  id?: string;
  message?: {
    author?: { role?: string };
    create_time?: number | null;
    content?: unknown;
  } | null;
  parent?: string | null;
  children?: string[];
}

/** Output of the pure parser (skipped = conversations we couldn't parse). */
export interface ChatGptParseResult {
  conversations: ParsedConversation[];
  messages: ParsedMessage[];
  skipped: number;
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function epochMs(seconds: unknown): number | null {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return null;
  return Math.round(seconds * 1000);
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

/**
 * Extract plain text from a ChatGPT `message.content`. Text turns carry
 * `parts: string[]`; code turns carry `text`; multimodal turns mix strings with
 * image-pointer objects (kept-strings-only). Anything else → "".
 */
function contentText(content: unknown): string {
  if (!content || typeof content !== "object") return "";
  const c = content as Record<string, unknown>;
  if (Array.isArray(c.parts)) {
    return c.parts
      .filter((p): p is string => typeof p === "string")
      .join("\n")
      .trim();
  }
  if (typeof c.text === "string") return c.text.trim();
  return "";
}

/**
 * The canonical, in-order node ids for one conversation. Walks `current_node` →
 * root via `parent` (the user's last-selected branch), then reverses. Falls back
 * to "every message node, sorted by create_time" when `current_node` is missing
 * or its chain is empty (older/partial exports).
 */
function canonicalBranch(
  mapping: Record<string, ChatGptNode>,
  currentNode: string | null,
): string[] {
  const chain: string[] = [];
  const seen = new Set<string>();
  let cursor = currentNode;
  while (cursor && mapping[cursor] && !seen.has(cursor)) {
    seen.add(cursor);
    chain.push(cursor);
    cursor = strOrNull(mapping[cursor].parent);
  }
  if (chain.length > 0) return chain.reverse();

  return Object.keys(mapping)
    .filter((id) => mapping[id]?.message)
    .sort(
      (a, b) =>
        (epochMs(mapping[a].message?.create_time) ?? 0) -
        (epochMs(mapping[b].message?.create_time) ?? 0),
    );
}

/** Parse one conversation object; null when it has no usable user/assistant turn. */
function parseOneConversation(
  item: unknown,
): { conversation: ParsedConversation; messages: ParsedMessage[] } | null {
  if (!item || typeof item !== "object") return null;
  const conv = item as Record<string, unknown>;
  const mapping = conv.mapping;
  if (!mapping || typeof mapping !== "object") return null;
  const map = mapping as Record<string, ChatGptNode>;

  const conversationId = strOrNull(conv.conversation_id) ?? strOrNull(conv.id);
  if (!conversationId) return null;

  const order = canonicalBranch(map, strOrNull(conv.current_node));
  const messages: ParsedMessage[] = [];
  let firstUserText: string | null = null;
  let minTs: number | null = null;
  let maxTs: number | null = null;
  let seq = 0;

  for (const nodeId of order) {
    const message = map[nodeId]?.message;
    if (!message || typeof message !== "object") continue;
    const role = message.author?.role;
    if (role !== "user" && role !== "assistant") continue; // drop system/tool
    const text = capMessage(contentText(message.content));
    if (!text) continue;
    const ts = epochMs(message.create_time);
    minTs = minNull(minTs, ts);
    maxTs = maxNull(maxTs, ts);
    if (role === "user" && firstUserText === null) firstUserText = text;
    messages.push({ conversationId, seq: seq++, role, ts, text });
  }
  if (messages.length === 0) return null;

  const title =
    strOrNull(conv.title) ??
    (firstUserText ? deriveTitle(firstUserText) : null);
  const conversation: ParsedConversation = {
    conversationId,
    projectPath: null,
    gitBranch: null,
    title,
    startedAt: epochMs(conv.create_time) ?? minTs,
    lastAt: epochMs(conv.update_time) ?? maxTs,
  };
  return { conversation, messages };
}

/**
 * Parse a whole ChatGPT export payload (the top-level array, or a
 * `{ conversations: [...] }` wrapper some variants use) into normalised
 * conversations + messages. Never throws; unparseable conversations are counted
 * in `skipped`.
 */
export function parseChatGptExport(raw: unknown): ChatGptParseResult {
  const out: ChatGptParseResult = {
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

export const chatgptAdapter: SourceAdapter = {
  source: "chatgpt",

  roots() {
    return [importRootFor("chatgpt")];
  },

  available() {
    return statFile(importRootFor("chatgpt")) !== null;
  },

  async discoverFiles() {
    const root = importRootFor("chatgpt");
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
        source: "chatgpt",
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
    const parsed = parseChatGptExport(raw);
    return {
      conversation: null,
      conversations: parsed.conversations,
      messages: parsed.messages,
      bytesConsumed: file.size,
    };
  },
};
