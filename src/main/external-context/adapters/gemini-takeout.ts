/**
 * Gemini Takeout adapter — parses the `MyActivity.json` Google Takeout produces
 * for "Gemini Apps" activity ("My Activity → Gemini Apps"). Unlike the other
 * imports, Takeout is an activity LOG, not a conversation transcript: each record
 * is one prompt (the model's response is generally NOT exported for privacy), so
 * there is no thread structure to recover. We reconstruct PSEUDO-conversations by
 * sorting records by time and starting a new one whenever the gap to the previous
 * record exceeds 30 minutes — a good-enough "session" boundary.
 *
 *   [ { header: "Gemini Apps", title: "Prompted <text>" | "<text>",
 *       time: "2025-06-01T12:34:56.789Z", products: ["Gemini Apps"] }, … ]
 *
 * Schema-TOLERANT (records without a title or a parseable time are skipped +
 * counted, never thrown). Provenance surfaces as "Gemini (Takeout)" via the
 * source label. Redaction happens downstream in db.applyFragments.
 */
import {
  capMessage,
  deriveTitle,
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

/** Session boundary: a > 30-minute gap starts a new pseudo-conversation. */
export const SESSION_GAP_MS = 30 * 60 * 1000;

/** Output of the pure parser (skipped = records we couldn't use). */
export interface GeminiTakeoutParseResult {
  conversations: ParsedConversation[];
  messages: ParsedMessage[];
  skipped: number;
}

/** One usable activity record reduced to (text, ts). */
interface Activity {
  text: string;
  ts: number;
}

/** Strip Takeout's leading activity verb ("Prompted ") from a title. */
function cleanTitle(title: string): string {
  return title.replace(/^Prompted\s+/i, "").trim();
}

/** Reduce a raw MyActivity record to an {text, ts} activity, or null. */
function toActivity(raw: unknown): Activity | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const rawTitle = typeof r.title === "string" ? cleanTitle(r.title) : "";
  if (!rawTitle) return null;
  const ts = isoToEpoch(r.time);
  if (ts === null) return null; // time is required for session grouping
  return { text: capMessage(rawTitle), ts };
}

/**
 * Parse a Gemini Takeout MyActivity payload into pseudo-conversations grouped by
 * a > 30-minute time gap. Never throws; unusable records are counted in `skipped`.
 */
export function parseGeminiTakeout(
  raw: unknown,
  gapMs: number = SESSION_GAP_MS,
): GeminiTakeoutParseResult {
  const out: GeminiTakeoutParseResult = {
    conversations: [],
    messages: [],
    skipped: 0,
  };
  if (!Array.isArray(raw)) return out;

  const activities: Activity[] = [];
  for (const record of raw) {
    const activity = toActivity(record);
    if (!activity) {
      out.skipped += 1;
      continue;
    }
    activities.push(activity);
  }
  if (activities.length === 0) return out;

  // Chronological order, then split on the session gap.
  activities.sort((a, b) => a.ts - b.ts);

  let group: Activity[] = [];
  const flush = (): void => {
    if (group.length === 0) return;
    const startedAt = group[0].ts;
    const lastAt = group[group.length - 1].ts;
    const conversationId = `gemini-takeout-${startedAt}`;
    group.forEach((a, index) => {
      out.messages.push({
        conversationId,
        seq: index,
        role: "user",
        ts: a.ts,
        text: a.text,
      });
    });
    out.conversations.push({
      conversationId,
      projectPath: null,
      gitBranch: null,
      title: deriveTitle(group[0].text),
      startedAt,
      lastAt,
    });
    group = [];
  };

  let prevTs: number | null = null;
  for (const activity of activities) {
    if (prevTs !== null && activity.ts - prevTs > gapMs) flush();
    group.push(activity);
    prevTs = activity.ts;
  }
  flush();

  return out;
}

export const geminiTakeoutAdapter: SourceAdapter = {
  source: "gemini-takeout",

  roots() {
    return [importRootFor("gemini-takeout")];
  },

  available() {
    return statFile(importRootFor("gemini-takeout")) !== null;
  },

  async discoverFiles() {
    const root = importRootFor("gemini-takeout");
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
        source: "gemini-takeout",
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
    const parsed = parseGeminiTakeout(raw);
    return {
      conversation: null,
      conversations: parsed.conversations,
      messages: parsed.messages,
      bytesConsumed: file.size,
    };
  },
};
