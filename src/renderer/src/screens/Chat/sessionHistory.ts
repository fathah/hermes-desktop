import type { Attachment } from "../../../../shared/attachments";
import type { ChatMessage, ChatBubbleMessage } from "./types";

/**
 * Shape of one row from the main process's `getSessionMessages` IPC.
 * Mirrors `src/main/sessions.ts:HistoryItem` (kept loose here so the
 * renderer doesn't have to import main-process types).
 */
export interface DbHistoryItem {
  kind: "user" | "assistant" | "reasoning" | "tool_call" | "tool_result";
  id: number;
  content?: string;
  text?: string;
  callId?: string;
  name?: string;
  args?: string;
  timestamp?: number;
  attachments?: Attachment[];
}

/**
 * Convert a stream of `getSessionMessages` rows into renderer-ready
 * `ChatMessage`s. Extracted from `Layout.handleResumeSession` so both
 * "resume a saved session from the Sessions tab" and "refresh the
 * active chat's transcript from state.db at end of stream" can share
 * the same mapping.
 *
 * The end-of-stream refresh is the desktop's user-side mitigation for
 * NousResearch/hermes-agent#30449 ("API server: reasoning_content and
 * reasoning_effort never reach OpenAI-compatible SSE stream"). Until
 * the gateway forwards reasoning chunks during the stream, the agent
 * still writes them to state.db at finalisation — refreshing here
 * makes them appear without the user having to focus-change to
 * trigger a re-sync (issue #352).
 */
export function dbItemsToChatMessages(
  items: ReadonlyArray<DbHistoryItem>,
): ChatMessage[] {
  return items
    .map((it): ChatMessage | null => {
      switch (it.kind) {
        case "user":
          return {
            id: `db-${it.id}`,
            role: "user",
            content: it.content || "",
            ...(it.attachments && it.attachments.length > 0
              ? { attachments: it.attachments }
              : {}),
          };
        case "assistant":
          return {
            id: `db-${it.id}`,
            role: "agent",
            content: it.content || "",
            ...(it.attachments && it.attachments.length > 0
              ? { attachments: it.attachments }
              : {}),
          };
        case "reasoning":
          return {
            id: `db-r-${it.id}`,
            kind: "reasoning",
            role: "agent",
            text: it.text || "",
          };
        case "tool_call":
          return {
            id: `db-tc-${it.id}-${it.callId || "x"}`,
            kind: "tool_call",
            role: "agent",
            callId: it.callId || "",
            name: it.name || "",
            args: it.args || "",
          };
        case "tool_result":
          return {
            id: `db-tr-${it.id}`,
            kind: "tool_result",
            role: "agent",
            callId: it.callId || "",
            name: it.name || "",
            content: it.content || "",
            ...(it.attachments && it.attachments.length > 0
              ? { attachments: it.attachments }
              : {}),
          };
        default:
          return null;
      }
    })
    .filter((m): m is ChatMessage => m !== null);
}

/**
 * Match key for cross-source reconciliation between streamed in-memory
 * messages and DB-loaded equivalents. Returned key matches when two
 * messages represent the same logical row regardless of which side
 * produced them.
 *
 * The strategy:
 *
 *   - For the chat-bubble kinds (user / agent content) we key on
 *     `role:contentSnippet`. Trimming guards against trailing
 *     whitespace drift between the stream-accumulated string and the
 *     DB-finalised one. The snippet length is intentionally short
 *     (first 200 chars) so a very long assistant reply doesn't blow
 *     out the map for no incremental matching benefit — collisions
 *     across two distinct turns at the same prefix are vanishingly
 *     unlikely.
 *   - For `tool_call` / `tool_result` we key on the OpenAI callId,
 *     which the agent generates and is stable across the streamed
 *     callback (when one exists) and the DB row.
 *   - For `reasoning`, key on the trimmed text. Reasoning has no
 *     callId. When streaming concatenates many tiny tokens into one
 *     reasoning message, the result text equals the DB row text
 *     because both sides see the same agent output.
 *
 * `null` opts a message out of matching — there's no equivalent on
 * the other side and the reconciliation should treat it as unique.
 */
/**
 * Collapse all runs of whitespace (spaces, tabs, newlines) into a single
 * space and trim.  This prevents the reconciliation key from diverging
 * when the stream-accumulated string and the DB-finalised string differ
 * only in interior whitespace (e.g. "\n\n" vs " ").
 */
function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function normalizeBubbleContentForMatch(s: string): string {
  return normalizeWhitespace(s).replace(
    /(?:\s+\[(?:screenshot|image)\])+$/i,
    "",
  );
}

function nonWhitespaceLength(s: string): number {
  return s.replace(/\s+/g, "").length;
}

function buildDbAssistantSplitSequences(
  items: ReadonlyArray<ChatMessage>,
): string[][] {
  const sequences: string[][] = [];
  let current: string[] = [];

  const flush = (): void => {
    if (current.length >= 2) sequences.push(current);
    current = [];
  };

  for (const m of items) {
    if (!("kind" in m)) {
      const bubble = m as ChatBubbleMessage;
      if (bubble.role === "user") {
        flush();
        continue;
      }
      const text = normalizeBubbleContentForMatch(bubble.content || "");
      if (text) current.push(text);
    }
  }

  flush();
  return sequences;
}

/**
 * Detect the artifact behind issue #420/#431: the live stream can append
 * several assistant DB rows into one renderer bubble because chunk events do
 * not carry row-boundary markers. When the final DB refresh returns the
 * canonical split rows, keeping the concatenated streamed bubble repeats large
 * chunks of the answer.
 */
function isCoveredByDbBubbleSplit(
  bubble: ChatBubbleMessage,
  dbAssistantSplitSequences: ReadonlyArray<ReadonlyArray<string>>,
): boolean {
  if (bubble.role !== "agent") return false;

  const text = normalizeBubbleContentForMatch(bubble.content || "");
  if (!text) return false;

  for (const sequence of dbAssistantSplitSequences) {
    let searchFrom = 0;
    let matchedSegments = 0;
    let matchedNonWhitespaceLength = 0;

    for (const dbText of sequence) {
      if (!dbText) continue;
      const index = text.indexOf(dbText, searchFrom);
      if (index < 0) continue;

      matchedSegments++;
      matchedNonWhitespaceLength += nonWhitespaceLength(dbText);
      searchFrom = index + dbText.length;
    }

    if (matchedSegments < 2) continue;

    const textNonWhitespaceLength = nonWhitespaceLength(text);
    if (textNonWhitespaceLength === 0) return false;

    if (matchedNonWhitespaceLength / textNonWhitespaceLength >= 0.85) {
      return true;
    }
  }

  return false;
}

function reconciliationKey(m: ChatMessage): string | null {
  if ("kind" in m) {
    switch (m.kind) {
      case "reasoning":
        return `reasoning:${normalizeWhitespace(m.text || "").slice(0, 200)}`;
      case "tool_call":
        return `tool_call:${m.callId || m.id}`;
      case "tool_result":
        return `tool_result:${m.callId || m.id}`;
      default:
        return null;
    }
  }
  const bubble = m as ChatBubbleMessage;
  return `${bubble.role}:${normalizeBubbleContentForMatch(bubble.content || "").slice(0, 200)}`;
}

/**
 * Merge DB-only metadata (e.g. attachments) into a streamed message
 * while preserving the streamed message's React identity (id).
 * This prevents React from remounting the DOM node, which would
 * disrupt scroll position and cause visual reordering.
 */
function mergeDbMetadataIntoStreamed(
  streamed: ChatMessage,
  db: ChatMessage,
): ChatMessage {
  // Only bubble messages carry mergeable metadata.
  if ("kind" in streamed) return streamed;
  const s = streamed as ChatBubbleMessage;
  const d = db as ChatBubbleMessage;
  // Attachments from the DB that the stream didn't deliver.
  if (
    d.attachments &&
    d.attachments.length > 0 &&
    (!s.attachments || s.attachments.length === 0)
  ) {
    return { ...s, attachments: d.attachments };
  }
  return s;
}

/**
 * Merge an in-memory streamed transcript with the canonical state.db
 * transcript at end-of-stream.
 *
 * The desktop streams `user` + `agent content` in real time (and, once
 * `NousResearch/hermes-agent#30449` lands, `reasoning` too). `tool_call`
 * and `tool_result` rows never stream — they only exist in `state.db`
 * after the agent finalises the message. So at end-of-stream we need
 * to surface the DB rows the streaming pass didn't deliver.
 *
 * The naive approach — replace the whole transcript with the DB version
 * — works today but will cause a one-frame re-mount flicker once
 * reasoning streaming starts working: the streamed reasoning bubble
 * (id `reasoning-${ts}`) would be replaced by a DB-loaded one (id
 * `db-r-${row}`) with identical text but a new React key. Solving it
 * properly: walk the DB rows in their canonical order, but when a
 * streamed equivalent already exists in memory, keep the streamed
 * row's React identity. New DB rows that have no streamed counterpart
 * (tool_call / tool_result today, plus any agent-finalised text the
 * stream dropped) appear in the merged result in the DB's order.
 *
 * Issue #352. Pure function, no state — testable in isolation.
 */
export function reconcileStreamedWithDb(
  streamed: ReadonlyArray<ChatMessage>,
  db: ReadonlyArray<ChatMessage>,
): ChatMessage[] {
  // Index streamed messages by their reconciliation key. Duplicate
  // keys (same text in two turns) are tracked as a FIFO queue so the
  // walk below consumes them in the original order rather than
  // collapsing both DB occurrences onto the first streamed one.
  const streamedByKey = new Map<string, ChatMessage[]>();
  for (const m of streamed) {
    const key = reconciliationKey(m);
    if (!key) continue;
    const bucket = streamedByKey.get(key);
    if (bucket) bucket.push(m);
    else streamedByKey.set(key, [m]);
  }

  const dbAssistantSplitSequences = buildDbAssistantSplitSequences(db);
  const result: ChatMessage[] = [];
  for (const dbMsg of db) {
    const key = reconciliationKey(dbMsg);
    const bucket = key ? streamedByKey.get(key) : undefined;
    const streamedMatch = bucket?.shift();
    if (streamedMatch) {
      // Preserve the streamed message's React identity (id) so React
      // doesn't remount the DOM node.  Carry over any DB-only metadata
      // (e.g. attachments that the stream didn't deliver) into the
      // streamed copy.
      result.push(mergeDbMetadataIntoStreamed(streamedMatch, dbMsg));
    } else {
      result.push(dbMsg);
    }
  }

  // Pathological case: the in-memory transcript carried something the
  // DB doesn't have yet (e.g. a renderer-side error bubble inserted by
  // `onChatError`). Preserve those tail-of-stream additions so the
  // reconciliation never silently drops UI-only state.
  //
  // But first, deduplicate by normalised content: if a streamed bubble
  // has the same role + normalised text as a DB bubble already in the
  // result, skip it — it's a near-duplicate that slipped past the
  // key-based match (e.g. trailing-whitespace drift, one-frame delta
  // that didn't round-trip through the DB identically).
  const consumedIds = new Set(result.map((m) => m.id));
  const consumedStreamIndexes: number[] = [];
  for (let i = 0; i < streamed.length; i++) {
    if (consumedIds.has(streamed[i].id)) consumedStreamIndexes.push(i);
  }
  const firstConsumedIndex =
    consumedStreamIndexes.length > 0 ? Math.min(...consumedStreamIndexes) : -1;

  const seedSeenBubbleKeys = (
    seen: Set<string>,
    items: ReadonlyArray<ChatMessage>,
  ): void => {
    for (const m of items) {
      if (!("kind" in m)) {
        const bubble = m as ChatBubbleMessage;
        seen.add(
          `${bubble.role}:${normalizeBubbleContentForMatch(bubble.content || "")}`,
        );
      }
    }
  };

  const appendIfUnique = (
    target: ChatMessage[],
    m: ChatMessage,
    seen: Set<string>,
    dropDbSplitArtifacts = true,
  ): boolean => {
    if (consumedIds.has(m.id)) return false;
    // For bubble messages, check if an equivalent already exists in the
    // result set.  Non-bubble messages (tool_call, tool_result, reasoning)
    // always pass through — they're either matched by callId above or are
    // genuinely new.
    if (!("kind" in m)) {
      const bubble = m as ChatBubbleMessage;
      const contentKey = `${bubble.role}:${normalizeBubbleContentForMatch(bubble.content || "")}`;
      if (seen.has(contentKey)) return false;
      if (
        dropDbSplitArtifacts &&
        isCoveredByDbBubbleSplit(bubble, dbAssistantSplitSequences)
      ) {
        return false;
      }
      seen.add(contentKey);
    }
    target.push(m);
    return true;
  };

  const prefix: ChatMessage[] = [];
  const seenPrefixBubbleKeys = new Set<string>();
  for (let i = 0; i < streamed.length; i++) {
    const m = streamed[i];
    if (firstConsumedIndex >= 0 && i < firstConsumedIndex) {
      appendIfUnique(prefix, m, seenPrefixBubbleKeys, false);
    }
  }

  const suffix: ChatMessage[] = [];
  const seenSuffixBubbleKeys = new Set<string>();
  seedSeenBubbleKeys(seenSuffixBubbleKeys, prefix);
  seedSeenBubbleKeys(seenSuffixBubbleKeys, result);
  for (let i = 0; i < streamed.length; i++) {
    const m = streamed[i];
    if (firstConsumedIndex >= 0 && i < firstConsumedIndex) continue;
    appendIfUnique(suffix, m, seenSuffixBubbleKeys);
  }

  return [...prefix, ...result, ...suffix];
}
