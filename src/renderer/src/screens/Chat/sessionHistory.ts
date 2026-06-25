import type { Attachment } from "../../../../shared/attachments";
import {
  isAssistantError,
  isBubbleMessage,
  normalizeMessageText,
} from "./chatMessages";
import type { ActiveTurn, ChatMessage, ChatBubbleMessage } from "./types";

/**
 * Shape of one row from the main process's `getSessionMessages` IPC.
 * Mirrors `src/main/sessions.ts:HistoryItem` (kept loose here so the
 * renderer doesn't have to import main-process types).
 */
export interface DbHistoryItem {
  kind: "user" | "assistant" | "reasoning" | "tool_call" | "tool_result";
  id: number;
  content?: string;
  error?: string;
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
            ...(typeof it.timestamp === "number"
              ? { timestamp: it.timestamp }
              : {}),
            ...(it.attachments && it.attachments.length > 0
              ? { attachments: it.attachments }
              : {}),
          };
        case "assistant":
          return {
            id: `db-${it.id}`,
            role: "agent",
            content: it.content || "",
            ...(typeof it.timestamp === "number"
              ? { timestamp: it.timestamp }
              : {}),
            ...(it.error ? { error: it.error, localOnly: true } : {}),
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

const LEGACY_TEXT_FILE_WRAPPER_RE =
  /(?:\s*<file\b[^>]*>[\s\S]*?<\/file>\s*)+$/i;

function normalizeBubbleContentForMatch(s: string): string {
  return normalizeWhitespace(
    s.replace(LEGACY_TEXT_FILE_WRAPPER_RE, ""),
  ).replace(/(?:\s+\[(?:screenshot|image)\])+$/i, "");
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
  if (bubble.error || bubble.localOnly) return null;
  return `${bubble.role}:${normalizeBubbleContentForMatch(bubble.content || "").slice(0, 200)}`;
}

function isSyntheticLiveToolMessage(m: ChatMessage): boolean {
  return (
    "kind" in m &&
    (m.kind === "tool_call" || m.kind === "tool_result") &&
    (m.callId.startsWith("live-tool:") || m.id.includes("live-tool:"))
  );
}

function toolNameMatchKey(m: ChatMessage): string | null {
  if (!("kind" in m)) return null;
  if (m.kind !== "tool_call" && m.kind !== "tool_result") return null;
  return `${m.kind}:${m.name}`;
}

function consumeCanonicalToolMatch(
  canonicalToolMatchCounts: Map<string, number>,
  live: ChatMessage,
): boolean {
  if (!isSyntheticLiveToolMessage(live)) return false;
  const key = toolNameMatchKey(live);
  if (!key) return false;
  const remaining = canonicalToolMatchCounts.get(key) || 0;
  if (remaining <= 0) return false;
  if (remaining === 1) canonicalToolMatchCounts.delete(key);
  else canonicalToolMatchCounts.set(key, remaining - 1);
  return true;
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
  // The canonical DB row carries the recorded timestamp the live stream
  // never had — adopt it so the hover time matches history after refresh.
  const timestamp =
    s.timestamp ?? (typeof d.timestamp === "number" ? d.timestamp : undefined);
  // Attachments from the DB that the stream didn't deliver.
  const needsAttachments =
    !!d.attachments &&
    d.attachments.length > 0 &&
    (!s.attachments || s.attachments.length === 0);
  if (
    needsAttachments ||
    (timestamp !== undefined && timestamp !== s.timestamp)
  ) {
    return {
      ...s,
      ...(needsAttachments ? { attachments: d.attachments } : {}),
      ...(timestamp !== undefined ? { timestamp } : {}),
    };
  }
  return s;
}

function bubbleContentKey(m: ChatBubbleMessage): string {
  return `${m.role}:${normalizeBubbleContentForMatch(m.content || "")}`;
}

function seedSeenBubbleKeys(
  seen: Set<string>,
  items: ReadonlyArray<ChatMessage>,
): void {
  for (const m of items) {
    if (!("kind" in m)) {
      seen.add(bubbleContentKey(m as ChatBubbleMessage));
    }
  }
}

function dedupeMessageIds(items: ReadonlyArray<ChatMessage>): ChatMessage[] {
  const seen = new Set<string>();
  const output: ChatMessage[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    output.push(item);
  }
  return output;
}

function compactOrphanDuplicateUserRuns(
  streamed: ReadonlyArray<ChatMessage>,
  db: ReadonlyArray<ChatMessage>,
): ChatMessage[] {
  const dbUserKeys = new Set<string>();
  for (const m of db) {
    if (isBubbleMessage(m) && m.role === "user") {
      dbUserKeys.add(bubbleContentKey(m));
    }
  }
  if (dbUserKeys.size === 0) return [...streamed];

  const output: ChatMessage[] = [];
  let run: ChatBubbleMessage[] = [];

  const flushRun = (): void => {
    if (run.length === 0) return;

    const lastIndexByKey = new Map<string, number>();
    for (let i = 0; i < run.length; i++) {
      const key = bubbleContentKey(run[i]);
      if (dbUserKeys.has(key)) lastIndexByKey.set(key, i);
    }

    for (let i = 0; i < run.length; i++) {
      const key = bubbleContentKey(run[i]);
      const lastIndex = lastIndexByKey.get(key);
      if (lastIndex !== undefined && i < lastIndex) continue;
      output.push(run[i]);
    }
    run = [];
  };

  for (const m of streamed) {
    if (isBubbleMessage(m) && m.role === "user") {
      run.push(m);
      continue;
    }

    flushRun();
    output.push(m);
  }
  flushRun();

  return output;
}

function firstConsumedInSameTurn(
  streamed: ReadonlyArray<ChatMessage>,
  userIndex: number,
  consumedIds: ReadonlySet<string>,
): ChatMessage | null {
  for (let i = userIndex + 1; i < streamed.length; i++) {
    const m = streamed[i];
    if (!("kind" in m) && (m as ChatBubbleMessage).role === "user") break;
    if (consumedIds.has(m.id)) return m;
  }
  return null;
}

function anchorUnmatchedUsersBeforeConsumedTurnRows(
  result: ChatMessage[],
  streamed: ReadonlyArray<ChatMessage>,
  consumedIds: Set<string>,
): void {
  const seen = new Set<string>();
  seedSeenBubbleKeys(seen, result);

  for (let i = 0; i < streamed.length; i++) {
    const m = streamed[i];
    if (consumedIds.has(m.id) || "kind" in m) continue;
    const user = m as ChatBubbleMessage;
    if (user.role !== "user") continue;

    const anchor = firstConsumedInSameTurn(streamed, i, consumedIds);
    if (!anchor) continue;

    const key = bubbleContentKey(user);
    if (seen.has(key)) continue;

    const resultIndex = result.findIndex((row) => row.id === anchor.id);
    if (resultIndex < 0) continue;

    result.splice(resultIndex, 0, user);
    consumedIds.add(user.id);
    seen.add(key);
  }
}

function previousUserBefore(
  items: ReadonlyArray<ChatMessage>,
  index: number,
): ChatBubbleMessage | null {
  for (let i = index - 1; i >= 0; i--) {
    const m = items[i];
    if (isBubbleMessage(m) && m.role === "user") return m;
  }
  return null;
}

function localErrorUserIds(items: ReadonlyArray<ChatMessage>): Set<string> {
  const ids = new Set<string>();
  for (let i = 0; i < items.length; i++) {
    if (!isAssistantError(items[i])) continue;
    const user = previousUserBefore(items, i);
    if (user) ids.add(user.id);
  }
  return ids;
}

function sameAttachments(a: ChatBubbleMessage, b: ChatBubbleMessage): boolean {
  const aAttachments = a.attachments ?? [];
  const bAttachments = b.attachments ?? [];
  if (aAttachments.length !== bAttachments.length) return false;
  return aAttachments.every(
    (att, index) =>
      `${att.kind}\n${att.name}\n${att.mime}\n${att.size}\n${att.path || ""}` ===
      `${bAttachments[index].kind}\n${bAttachments[index].name}\n${bAttachments[index].mime}\n${bAttachments[index].size}\n${bAttachments[index].path || ""}`,
  );
}

function userContentKey(m: ChatBubbleMessage): string {
  return `${normalizeMessageText(m.content)}\n${(m.attachments ?? [])
    .map(
      (att) =>
        `${att.kind}\n${att.name}\n${att.mime}\n${att.size}\n${att.path || ""}`,
    )
    .join("\n")}`;
}

function hasUniqueCurrentUserContent(
  current: ReadonlyArray<ChatMessage>,
  user: ChatBubbleMessage,
): boolean {
  const key = userContentKey(user);
  let count = 0;
  for (const m of current) {
    if (!isBubbleMessage(m) || m.role !== "user") continue;
    if (userContentKey(m) === key) count++;
  }
  return count === 1;
}

function findMatchingUserIndex(
  output: ReadonlyArray<ChatMessage>,
  current: ReadonlyArray<ChatMessage>,
  user: ChatBubbleMessage,
): number {
  const exact = output.findIndex(
    (m) =>
      isBubbleMessage(m) &&
      m.role === "user" &&
      (m.id === user.id || (!!m.turnId && m.turnId === user.turnId)),
  );
  if (exact >= 0) return exact;

  if (!hasUniqueCurrentUserContent(current, user)) return -1;

  return output.findIndex(
    (m) =>
      isBubbleMessage(m) &&
      m.role === "user" &&
      normalizeBubbleContentForMatch(m.content) ===
        normalizeBubbleContentForMatch(user.content) &&
      sameAttachments(m, user),
  );
}

function findNextOutputAnchorIndex(
  output: ReadonlyArray<ChatMessage>,
  current: ReadonlyArray<ChatMessage>,
  afterCurrentIndex: number,
): number {
  for (let i = afterCurrentIndex + 1; i < current.length; i++) {
    const anchorIndex = output.findIndex((m) => m.id === current[i].id);
    if (anchorIndex >= 0) return anchorIndex;
  }
  return output.length;
}

function insertAt<T>(items: ReadonlyArray<T>, index: number, rows: T[]): T[] {
  return [...items.slice(0, index), ...rows, ...items.slice(index)];
}

function hasEquivalentAssistantError(
  output: ReadonlyArray<ChatMessage>,
  current: ReadonlyArray<ChatMessage>,
  error: ChatBubbleMessage & { role: "agent"; error: string },
  localUser: ChatBubbleMessage | null,
): boolean {
  const wantedError = normalizeMessageText(error.error);
  const wantedContent = normalizeMessageText(error.content || "");

  let start = 0;
  if (localUser) {
    const matchedUserIndex = findMatchingUserIndex(output, current, localUser);
    if (matchedUserIndex < 0) return false;
    start = matchedUserIndex + 1;
  }

  for (let i = start; i < output.length; i++) {
    const candidate = output[i];
    if (i > start && isBubbleMessage(candidate) && candidate.role === "user") {
      break;
    }
    if (!isAssistantError(candidate)) continue;
    if (normalizeMessageText(candidate.error) !== wantedError) continue;
    if (normalizeMessageText(candidate.content || "") !== wantedContent)
      continue;
    return true;
  }
  return false;
}

export function preserveLocalAssistantErrors(
  nextMessages: ReadonlyArray<ChatMessage>,
  currentMessages: ReadonlyArray<ChatMessage>,
): ChatMessage[] {
  let output = nextMessages.map((message) => {
    const local = currentMessages.find((m) => m.id === message.id);
    if (
      isBubbleMessage(message) &&
      message.role === "agent" &&
      !message.error &&
      local &&
      isAssistantError(local)
    ) {
      return { ...message, error: local.error, pending: false };
    }
    return message;
  });

  const existingIds = new Set(output.map((m) => m.id));

  for (let i = 0; i < currentMessages.length; i++) {
    const error = currentMessages[i];
    if (!isAssistantError(error) || existingIds.has(error.id)) continue;

    const localUser = previousUserBefore(currentMessages, i);
    if (
      hasEquivalentAssistantError(output, currentMessages, error, localUser)
    ) {
      continue;
    }

    const rows: ChatMessage[] = [];
    let insertIndex = output.length;

    if (localUser) {
      const matchedUserIndex = findMatchingUserIndex(
        output,
        currentMessages,
        localUser,
      );
      if (matchedUserIndex >= 0) {
        insertIndex = matchedUserIndex + 1;
      } else {
        insertIndex = findNextOutputAnchorIndex(output, currentMessages, i);
        if (!existingIds.has(localUser.id)) {
          rows.push(localUser);
        }
      }
    }

    rows.push({ ...error, pending: false });
    output = insertAt(output, insertIndex, rows);
    for (const row of rows) existingIds.add(row.id);
  }

  return output;
}

function isDbSyncable(
  m: ChatMessage,
  failedUserIds: ReadonlySet<string>,
): boolean {
  if (isAssistantError(m)) return false;
  if (isBubbleMessage(m)) {
    if (m.localOnly) return false;
    if (failedUserIds.has(m.id)) return false;
  }
  return true;
}

function clearPending(messages: ReadonlyArray<ChatMessage>): ChatMessage[] {
  return messages.map((m) =>
    isBubbleMessage(m) && m.pending ? { ...m, pending: false } : m,
  );
}

function nextUserIndex(
  items: ReadonlyArray<ChatMessage>,
  afterIndex: number,
): number {
  for (let i = afterIndex + 1; i < items.length; i++) {
    const m = items[i];
    if (isBubbleMessage(m) && m.role === "user") return i;
  }
  return items.length;
}

function firstDbIndexMatchingActiveTurnOutput(
  current: ReadonlyArray<ChatMessage>,
  db: ReadonlyArray<ChatMessage>,
  activeUserIndex: number,
): number {
  const stop = nextUserIndex(current, activeUserIndex);
  const activeTurnKeys = new Set<string>();
  for (let i = activeUserIndex + 1; i < stop; i++) {
    const key = reconciliationKey(current[i]);
    if (key) activeTurnKeys.add(key);
  }

  if (activeTurnKeys.size === 0) return -1;

  for (let i = 0; i < db.length; i++) {
    const key = reconciliationKey(db[i]);
    if (key && activeTurnKeys.has(key)) return i;
  }
  return -1;
}

function findPreviousLocalErrorIndex(
  items: ReadonlyArray<ChatMessage>,
  beforeIndex: number,
): number {
  for (let i = beforeIndex - 1; i >= 0; i--) {
    if (isAssistantError(items[i])) return i;
  }
  return -1;
}

function dbWithActiveUserAnchor(
  db: ReadonlyArray<ChatMessage>,
  current: ReadonlyArray<ChatMessage>,
  activeTurn?: ActiveTurn | null,
): ChatMessage[] {
  if (!activeTurn || activeTurn.status === "failed") return [...db];

  const currentActiveUserIndex = current.findIndex(
    (m) => m.id === activeTurn.userId,
  );
  if (currentActiveUserIndex < 0) return [...db];

  const activeUser = current[currentActiveUserIndex];
  if (!isBubbleMessage(activeUser) || activeUser.role !== "user")
    return [...db];

  if (findMatchingUserIndex(db, current, activeUser) >= 0) return [...db];

  let insertIndex = firstDbIndexMatchingActiveTurnOutput(
    current,
    db,
    currentActiveUserIndex,
  );

  if (insertIndex < 0) {
    const previousErrorIndex = findPreviousLocalErrorIndex(
      current,
      currentActiveUserIndex,
    );
    const failedUser =
      previousErrorIndex >= 0
        ? previousUserBefore(current, previousErrorIndex)
        : null;
    const failedUserDbIndex = failedUser
      ? findMatchingUserIndex(db, current, failedUser)
      : -1;
    if (failedUserDbIndex >= 0) {
      insertIndex = failedUserDbIndex + 1;
    }
  }

  if (insertIndex < 0) insertIndex = db.length;
  return insertAt(db, insertIndex, [activeUser]);
}

export function reconcileAfterDbRefresh(
  current: ReadonlyArray<ChatMessage>,
  db: ReadonlyArray<ChatMessage>,
  options: {
    activeTurn?: ActiveTurn | null;
  } = {},
): ChatMessage[] {
  if (options.activeTurn?.status === "failed") return [...current];

  const failedUserIds = localErrorUserIds(current);
  const syncableCurrent = current.filter((m) => isDbSyncable(m, failedUserIds));
  const anchoredDb = dbWithActiveUserAnchor(db, current, options.activeTurn);
  const reconciled = reconcileStreamedWithDb(syncableCurrent, anchoredDb);
  const withLocalErrors = preserveLocalAssistantErrors(reconciled, current);
  return clearPending(withLocalErrors);
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
  streamed = compactOrphanDuplicateUserRuns(streamed, db);

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
  const canonicalToolMatchCounts = new Map<string, number>();
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
      const toolKey = toolNameMatchKey(dbMsg);
      if (toolKey && !isSyntheticLiveToolMessage(dbMsg)) {
        canonicalToolMatchCounts.set(
          toolKey,
          (canonicalToolMatchCounts.get(toolKey) || 0) + 1,
        );
      }
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

  // Include anchored streamed user rows before building maps or dedupe sets
  // from `result`; the anchor mutates the DB-ordered result in place.
  anchorUnmatchedUsersBeforeConsumedTurnRows(result, streamed, consumedIds);

  // Map each consumed streamed message to its position in the DB-ordered result.
  const resultPosById = new Map<string, number>();
  for (let i = 0; i < result.length; i++) {
    resultPosById.set(result[i].id, i);
  }

  // Seed a dedup set from all result items so unconsumed streamed messages
  // never duplicate what the DB already provided.
  const seenBubbleKeys = new Set<string>();
  seedSeenBubbleKeys(seenBubbleKeys, result);

  // Check whether an unconsumed streamed message should be kept, applying
  // the same dedup / canonical-tool-match / DB-split-artifact rules as before.
  const shouldKeepUnconsumed = (m: ChatMessage): boolean => {
    if (consumedIds.has(m.id)) return false;
    if (consumeCanonicalToolMatch(canonicalToolMatchCounts, m)) return false;
    // Only bubble messages (user/agent content) need dedup and split checks.
    if (!("kind" in m)) {
      const bubble = m as ChatBubbleMessage;
      const contentKey = bubbleContentKey(bubble);
      if (seenBubbleKeys.has(contentKey)) return false;
      if (
        bubble.role === "agent" &&
        isCoveredByDbBubbleSplit(bubble, dbAssistantSplitSequences)
      ) {
        return false;
      }
      // Only mark as seen if we're actually keeping this message.
      seenBubbleKeys.add(contentKey);
    }
    return true;
  };

  // Interleave unconsumed streamed messages at their correct chronological
  // positions instead of dumping them all into a suffix (which caused messages
  // from the *middle* of the conversation to jump to the bottom — issue #431).
  const merged: ChatMessage[] = [];
  let resultIdx = 0;

  for (let si = 0; si < streamed.length; si++) {
    const sm = streamed[si];
    if (consumedIds.has(sm.id)) {
      // Flush result items up to (and including) this consumed message.
      const rpos = resultPosById.get(sm.id);
      if (rpos !== undefined && rpos >= resultIdx) {
        while (resultIdx <= rpos) {
          merged.push(result[resultIdx]);
          resultIdx++;
        }
      }
    } else if (shouldKeepUnconsumed(sm)) {
      // Unconsumed streamed message — insert at current chronological slot.
      merged.push(sm);
    }
  }

  // Append any remaining result items (DB-only rows past the last consumed
  // streamed message).
  while (resultIdx < result.length) {
    merged.push(result[resultIdx]);
    resultIdx++;
  }

  // Reposition inline clarify cards to their original chronological slot.
  // A clarify card is renderer-only — it's never written to state.db, so it
  // has no reconciliationKey and would otherwise be flushed to the suffix,
  // landing *below* any agent content the gateway streamed after the user
  // answered (the reverse of what the user saw live). Re-anchor each card
  // immediately after the streamed message that preceded it.
  return repositionClarifyCards(dedupeMessageIds(merged), streamed);
}

/**
 * Move `kind === "clarify"` cards from wherever the reconcile placed them back
 * to their streamed position: directly after the message that immediately
 * preceded them in `streamed`. Pure, order-preserving for all other rows.
 */
function repositionClarifyCards(
  merged: ChatMessage[],
  streamed: ReadonlyArray<ChatMessage>,
): ChatMessage[] {
  const isClarify = (m: ChatMessage): boolean =>
    "kind" in m && m.kind === "clarify";
  if (!streamed.some(isClarify)) return merged;

  // Pull clarify cards out of the merged list; remember each card's streamed
  // predecessor id so we can re-anchor it.
  const cards = merged.filter(isClarify);
  if (cards.length === 0) return merged;
  const without = merged.filter((m) => !isClarify(m));

  const predecessorIdByCardId = new Map<string, string | null>();
  for (let i = 0; i < streamed.length; i++) {
    const m = streamed[i];
    if (!isClarify(m)) continue;
    // Nearest preceding non-clarify message in the streamed order.
    let predId: string | null = null;
    for (let j = i - 1; j >= 0; j--) {
      if (!isClarify(streamed[j])) {
        predId = streamed[j].id;
        break;
      }
    }
    predecessorIdByCardId.set(m.id, predId);
  }

  const out: ChatMessage[] = [];
  const cardsByPredId = new Map<string | null, ChatMessage[]>();
  for (const card of cards) {
    const predId = predecessorIdByCardId.get(card.id) ?? null;
    const bucket = cardsByPredId.get(predId);
    if (bucket) bucket.push(card);
    else cardsByPredId.set(predId, [card]);
  }

  // Cards whose predecessor is absent (or that led the turn) go up front,
  // preserving their streamed order.
  const leading = cardsByPredId.get(null) ?? [];
  for (const card of leading) out.push(card);

  const presentIds = new Set(without.map((m) => m.id));
  for (const m of without) {
    out.push(m);
    const bucket = cardsByPredId.get(m.id);
    if (bucket) for (const card of bucket) out.push(card);
  }

  // Safety net: any card whose predecessor id wasn't found in the merged
  // list (predecessor was deduped away) is appended so it's never dropped.
  for (const card of cards) {
    if (out.includes(card)) continue;
    const predId = predecessorIdByCardId.get(card.id) ?? null;
    if (predId === null || !presentIds.has(predId)) out.push(card);
  }

  return out;
}
