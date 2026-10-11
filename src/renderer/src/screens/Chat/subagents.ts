import { useSyncExternalStore } from "react";

/**
 * Live subagent roster for one conversation.
 *
 * The gateway relays a delegated child's activity to the PARENT session as
 * `subagent.*` events (`tui_gateway/tool_progress.py::_progress_subagent`), so a
 * chat can render what its children are doing without opening the child's own
 * session. This module owns the projection: gateway payload -> display row.
 *
 * Event names and payload fields (all optional, older emitters omit some):
 *   subagent.start | subagent.progress | subagent.thinking | subagent.tool |
 *   subagent.complete
 *   { subagent_id, parent_id, child_session_id, delegation_id, depth, model,
 *     goal, task_count, task_index, status, tool_count, tool_name, tool_preview,
 *     text, summary, duration_seconds, output_tail }
 *
 * `subagent.text` (the child's per-token reply) is deliberately NOT relayed to
 * the parent by the gateway, so the parent-side transcript is built from tool
 * and progress lines, not from the child's raw stream.
 */

// @lat: [[subagents#Event projection and store]]
export type SubagentStatus =
  | "completed"
  | "failed"
  | "interrupted"
  | "queued"
  | "running";

export type SubagentStreamKind = "progress" | "summary" | "thinking" | "tool";

export interface SubagentStreamEntry {
  at: number;
  isError?: boolean;
  kind: SubagentStreamKind;
  text: string;
}

export interface SubagentProgress {
  id: string;
  parentId: string | null;
  goal: string;
  /** The child's own stored session id — lets a UI open its session later. */
  sessionId?: string;
  /** Batch (delegation) id: groups the workers of one fan-out. */
  delegationId?: string;
  model?: string;
  /** True when the row's only identity is a derived key: the backend never
   *  reported a `subagent_id` for it, so a roster snapshot cannot account for
   *  it and must never retire it by absence. */
  provisional?: boolean;
  status: SubagentStatus;
  taskCount: number;
  taskIndex: number;
  startedAt: number;
  durationSeconds?: number;
  toolCount?: number;
  stream: SubagentStreamEntry[];
  summary?: string;
  /** Active tool while running — cleared on terminal status. */
  currentTool?: string;
}

/** One entry of the `subagent.list` roster RPC (snake_case over the wire). */
export interface SubagentSnapshotEntry {
  accepting_steer?: boolean;
  delegation_id?: string;
  depth?: number;
  goal?: string;
  /** Null for a top-level child, and null/absent before it runs a tool. */
  last_tool?: string | null;
  model?: string;
  parent_id?: string | null;
  started_at?: number;
  status?: string;
  subagent_id?: string;
  tool_count?: number;
}

export interface SubagentTail {
  available: boolean;
  text: string;
  truncated: boolean;
}

/** Callable half of the feature: the RPCs this section needs from a transport. */
export interface SubagentControls {
  interrupt: (subagentId: string) => Promise<{ found?: boolean }>;
  list: () => Promise<SubagentSnapshotEntry[]>;
  steer: (subagentId: string, text: string) => Promise<{ status?: string }>;
  tail: (subagentId: string) => Promise<SubagentTail>;
}

const TERMINAL: ReadonlySet<SubagentStatus> = new Set([
  "completed",
  "failed",
  "interrupted",
]);
const MAX_STREAM = 24;
const PREVIEW_MAX = 220;
const TOOL_PREVIEW_MAX = 96;
const EMPTY: SubagentProgress[] = [];

const bySession = new Map<string, SubagentProgress[]>();
const listeners = new Set<() => void>();
const START_GRACE_MS = 10_000;
let eventRevision = 0;
interface RowEvidence {
  revision: number;
  lastEventAt: number;
  misses: number;
  terminal: boolean;
}
const evidenceByScope = new Map<string, Map<string, RowEvidence>>();
const snapshots = new Map<string, { next: number; applied: number }>();
export interface SubagentSnapshotToken {
  at: number;
  eventRevision: number;
  sequence: number;
}

export function subagentScopeKey(
  connectionId: string | undefined,
  profile: string | undefined,
  sessionId: string | null | undefined,
  connectionRevision = 0,
): string | null {
  return sessionId
    ? JSON.stringify([
        connectionId ?? "local",
        profile?.trim() || "default",
        connectionRevision,
        sessionId,
      ])
    : null;
}

export function captureSubagentSnapshot(scope: string): SubagentSnapshotToken {
  const state = snapshots.get(scope) ?? { next: 0, applied: 0 };
  snapshots.set(scope, state);
  return { at: Date.now(), eventRevision, sequence: ++state.next };
}

function rowEvidence(scope: string): Map<string, RowEvidence> {
  let records = evidenceByScope.get(scope);
  if (!records) {
    records = new Map();
    evidenceByScope.set(scope, records);
  }
  return records;
}

function emit(): void {
  for (const listener of listeners) listener();
}

function setSessionRows(sessionId: string, rows: SubagentProgress[]): void {
  if (rows.length === 0) {
    bySession.delete(sessionId);
  } else {
    bySession.set(sessionId, rows);
  }
  emit();
}

export function subscribeSubagents(listener: () => void): () => void {
  listeners.add(listener);
  return (): void => {
    listeners.delete(listener);
  };
}

/**
 * Stable snapshot per session: the array identity only changes when the rows
 * change, which is what `useSyncExternalStore` requires to avoid a render loop.
 */
export function getSubagents(
  sessionId: string | null | undefined,
): SubagentProgress[] {
  if (!sessionId) return EMPTY;
  return bySession.get(sessionId) ?? EMPTY;
}

export function useSubagents(
  sessionId: string | null | undefined,
): SubagentProgress[] {
  return useSyncExternalStore(
    subscribeSubagents,
    () => getSubagents(sessionId),
    () => EMPTY,
  );
}

export function isSubagentEvent(eventType: string | undefined): boolean {
  return typeof eventType === "string" && eventType.startsWith("subagent.");
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const str = (value: unknown): string =>
  typeof value === "string" ? value : "";

const num = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const capitalize = (text: string): string =>
  text ? text[0].toUpperCase() + text.slice(1) : text;

const compact = (text: string, max = PREVIEW_MAX): string => {
  const line = text.replace(/\s+/g, " ").trim();
  if (!line) return "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

export const subagentToolLabel = (name: string): string =>
  name.split("_").filter(Boolean).map(capitalize).join(" ") || name;

const formatTool = (name: string, preview = ""): string => {
  const snippet = compact(preview, TOOL_PREVIEW_MAX);
  return snippet
    ? `${subagentToolLabel(name)}("${snippet}")`
    : subagentToolLabel(name);
};

function asStatus(value: unknown, terminalEvent = false): SubagentStatus {
  if (value === "completed" || value === "failed" || value === "interrupted") {
    return value;
  }
  if (value === "timeout" || value === "error") return "failed";
  if (value === "cancelled" || value === "canceled") return "interrupted";
  // A `subagent.complete` event is terminal by definition: an unrecognized (or
  // still "running") status there must not leave a dead row spinning forever.
  if (terminalEvent) return "failed";
  return value === "queued" ? "queued" : "running";
}

const idOf = (payload: Record<string, unknown>): string =>
  str(payload.subagent_id) ||
  `${str(payload.parent_id) || "root"}:${num(payload.task_index) ?? 0}:${str(payload.goal)}`;

interface TailEntry {
  isError?: boolean;
  preview?: string;
  tool?: string;
}

const asTail = (value: unknown): TailEntry[] =>
  Array.isArray(value)
    ? value.filter(isRecord).map((item) => ({
        isError: item.is_error === true,
        preview: str(item.preview) || undefined,
        tool: str(item.tool) || undefined,
      }))
    : [];

const appendStream = (
  stream: SubagentStreamEntry[],
  entry: SubagentStreamEntry,
): SubagentStreamEntry[] => {
  const last = stream.at(-1);
  if (
    last?.kind === entry.kind &&
    last.text === entry.text &&
    last.isError === entry.isError
  ) {
    return stream;
  }
  return [...stream, entry].slice(-MAX_STREAM);
};

// A hard child timeout arrives with only a preview ("Timed out after 612.3s")
// plus duration_seconds — synthesize the summary so the row says why it failed.
const timeoutSummary = (payload: Record<string, unknown>): string => {
  const seconds = num(payload.duration_seconds);
  return str(payload.status) === "timeout"
    ? `Timed out after ${seconds ?? "?"}s`
    : "";
};

function streamFromPayload(
  payload: Record<string, unknown>,
  status: SubagentStatus,
  eventType: string,
  at: number,
): SubagentStreamEntry[] {
  const out: SubagentStreamEntry[] = [];
  const tool = str(payload.tool_name);
  const preview = str(payload.tool_preview) || str(payload.text);
  const text = compact(str(payload.text) || preview);

  for (const tail of asTail(payload.output_tail)) {
    const line = tail.tool
      ? formatTool(tail.tool, tail.preview ?? "")
      : compact(tail.preview ?? "");
    if (line) {
      out.push({
        at,
        isError: tail.isError,
        kind: tail.tool ? "tool" : "progress",
        text: line,
      });
    }
  }

  if (tool) {
    out.push({
      at,
      isError: payload.error === true,
      kind: "tool",
      text: formatTool(tool, preview),
    });
  }

  if (eventType === "subagent.progress" && text) {
    out.push({ at, isError: payload.error === true, kind: "progress", text });
  }

  if (eventType === "subagent.thinking" && text) {
    out.push({ at, kind: "thinking", text });
  }

  const summary = compact(
    str(payload.summary) || str(payload.text) || timeoutSummary(payload),
  );
  if (TERMINAL.has(status) && summary) {
    out.push({
      at,
      isError: status === "failed",
      kind: "summary",
      text: summary,
    });
  }

  return out;
}

function toProgress(
  payload: Record<string, unknown>,
  prev: SubagentProgress | undefined,
  eventType = "",
): SubagentProgress {
  const at = Date.now();
  const status = asStatus(payload.status, eventType === "subagent.complete");
  const tool = str(payload.tool_name);
  const stream = streamFromPayload(payload, status, eventType, at).reduce(
    appendStream,
    prev?.stream ?? [],
  );
  // Roster rows carry epoch seconds; live events carry no start time at all.
  const startedAtSeconds = num(payload.started_at);
  const startedAt =
    prev?.startedAt ??
    (startedAtSeconds !== undefined ? startedAtSeconds * 1000 : at);

  return {
    id: prev?.id ?? idOf(payload),
    parentId: str(payload.parent_id) || prev?.parentId || null,
    goal: str(payload.goal) || prev?.goal || "",
    sessionId: str(payload.child_session_id) || prev?.sessionId,
    delegationId: str(payload.delegation_id) || prev?.delegationId,
    model: str(payload.model) || prev?.model,
    provisional: prev?.provisional ?? !str(payload.subagent_id),
    status,
    taskCount: num(payload.task_count) ?? prev?.taskCount ?? 1,
    taskIndex: num(payload.task_index) ?? prev?.taskIndex ?? 0,
    startedAt,
    durationSeconds: num(payload.duration_seconds) ?? prev?.durationSeconds,
    toolCount: num(payload.tool_count) ?? prev?.toolCount,
    stream,
    summary:
      str(payload.summary) ||
      timeoutSummary(payload) ||
      prev?.summary ||
      undefined,
    currentTool: TERMINAL.has(status) ? undefined : tool || prev?.currentTool,
  };
}

function sameRow(
  a: SubagentProgress | undefined,
  b: SubagentProgress,
): boolean {
  return a !== undefined && JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Fold one relayed `subagent.*` event into the session's roster.
 *
 * Returns true when the event belonged to this feature (so the caller can stop
 * before handing it to the message-stream adapter), false when it must be
 * ignored — unknown payloads and sessions we cannot attribute are dropped
 * rather than inventing a row.
 */
export function applySubagentEvent(
  sessionId: string | null | undefined,
  event: { payload?: unknown; type: string },
): boolean {
  if (!isSubagentEvent(event.type)) return false;
  if (!sessionId || !isRecord(event.payload)) return true;

  const payload = event.payload;
  const rows = bySession.get(sessionId) ?? [];
  const id = idOf(payload);
  const index = rows.findIndex((item) => item.id === id);
  const prev = index >= 0 ? rows[index] : undefined;
  const records = rowEvidence(sessionId);
  if (
    (records.get(id)?.terminal || (prev && TERMINAL.has(prev.status))) &&
    event.type !== "subagent.start"
  )
    return true;
  const next = toProgress(
    payload,
    prev && TERMINAL.has(prev.status) ? undefined : prev,
    event.type,
  );
  records.set(id, {
    revision: ++eventRevision,
    lastEventAt: Date.now(),
    misses: 0,
    terminal: TERMINAL.has(next.status),
  });

  if (sameRow(prev, next)) return true;

  const updated =
    index >= 0
      ? [...rows.slice(0, index), next, ...rows.slice(index + 1)]
      : [...rows, next];
  setSessionRows(sessionId, updated);
  return true;
}

/** Reconcile successful snapshots with a bounded start-registration grace.
 * Events newer than a request and newer successful snapshots own the row. */
export function reconcileSubagentSnapshot(
  sessionId: string,
  entries: SubagentSnapshotEntry[],
  token = captureSubagentSnapshot(sessionId),
): void {
  const snapshot = snapshots.get(sessionId);
  if (!snapshot) return;
  if (token.sequence <= snapshot.applied) return;
  snapshot.applied = token.sequence;
  const previous = bySession.get(sessionId) ?? [];
  const records = rowEvidence(sessionId);
  const ids = new Set(
    entries.map((entry) => str(entry.subagent_id)).filter(Boolean),
  );
  const next = previous.filter((item) => {
    const evidence = records.get(item.id) ?? {
      revision: 0,
      lastEventAt: 0,
      misses: 0,
      terminal: TERMINAL.has(item.status),
    };
    records.set(item.id, evidence);
    if (
      TERMINAL.has(item.status) ||
      item.provisional ||
      evidence.revision > token.eventRevision
    )
      return true;
    if (ids.has(item.id)) {
      evidence.misses = 0;
      return true;
    }
    evidence.misses++;
    if (evidence.misses < 2 || token.at - evidence.lastEventAt < START_GRACE_MS)
      return true;
    records.delete(item.id);
    return false;
  });
  let changed = next.length !== previous.length;

  entries.forEach((entry, position) => {
    const id = str(entry.subagent_id);
    if (!id) return;
    const index = next.findIndex((item) => item.id === id);
    const prev = index >= 0 ? next[index] : undefined;
    if (
      records.get(id)?.terminal ||
      (records.get(id)?.revision ?? 0) > token.eventRevision ||
      (prev && TERMINAL.has(prev.status))
    )
      return;

    const projected = toProgress(entry as Record<string, unknown>, prev);
    const evidence = records.get(id) ?? {
      revision: 0,
      lastEventAt: 0,
      misses: 0,
      terminal: false,
    };
    evidence.terminal = TERMINAL.has(projected.status);
    records.set(id, evidence);
    // The roster records the LAST tool, not a call still executing: seed a cold
    // row once, never append over newer live text on a repeat snapshot.
    if (!projected.stream.length && str(entry.last_tool)) {
      projected.stream = [
        {
          at: projected.startedAt,
          kind: "tool",
          text: formatTool(str(entry.last_tool)),
        },
      ];
    }

    if (index < 0) {
      next.push(projected);
      changed = true;
      return;
    }
    if (!sameRow(prev, projected)) {
      next[index] = projected;
      changed = true;
    }
    void position;
  });

  if (changed) setSessionRows(sessionId, next);
}

/**
 * Drop rows the previous turn already finished, leaving live children (which
 * can outlive the turn that spawned them) in place. Called at the
 * `message.start` boundary of a new turn.
 */
export function pruneFinishedSubagents(sessionId: string): void {
  const rows = bySession.get(sessionId);
  if (!rows?.length) return;
  const next = rows.filter(
    (item) => item.status === "running" || item.status === "queued",
  );
  if (next.length !== rows.length) setSessionRows(sessionId, next);
}

export function clearSessionSubagents(sessionId: string): void {
  if (!bySession.has(sessionId)) {
    evidenceByScope.delete(sessionId);
    snapshots.delete(sessionId);
    return;
  }
  bySession.delete(sessionId);
  evidenceByScope.delete(sessionId);
  snapshots.delete(sessionId);
  emit();
}

/** Test seam: drop every session's roster. */
export function resetSubagents(): void {
  evidenceByScope.clear();
  snapshots.clear();
  eventRevision = 0;
  if (bySession.size === 0) return;
  bySession.clear();
  emit();
}

export function isTerminalSubagent(status: SubagentStatus): boolean {
  return TERMINAL.has(status);
}
