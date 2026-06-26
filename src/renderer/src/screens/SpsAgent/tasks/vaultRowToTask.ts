// vaultRowToTask.ts — F1: map a folder-backed VaultRow onto the embedded Task
// shape so the shared TasksDB views (board/table/list/gallery/calendar) can
// render query-database rows. Pure + total: a missing or hand-edited property
// falls back to a safe default so a view never crashes on a stray row file.
import type { VaultRow } from "../hooks/useNoteIndex";
import type { PrioKey, StatusKey, Task, TaskRoute } from "../types";

const STATUS_KEYS: StatusKey[] = ["todo", "doing", "review", "done"];
const PRIO_KEYS: PrioKey[] = ["high", "med", "low"];
const ROUTE_KEYS: TaskRoute[] = ["ai", "human"];
// Properties that map onto first-class Task fields; everything else is "custom".
const KNOWN_PROPS = new Set([
  "title",
  "status",
  "prio",
  "who",
  "due",
  "est",
  "route",
  "delegatedTo",
  "assigneeId",
  "autoSendOnEscalate",
]);

function asStatus(value: unknown): StatusKey {
  return STATUS_KEYS.includes(value as StatusKey)
    ? (value as StatusKey)
    : "todo";
}

function asPrio(value: unknown): PrioKey {
  return PRIO_KEYS.includes(value as PrioKey) ? (value as PrioKey) : "med";
}

function asText(value: unknown): string {
  return value == null ? "" : String(value);
}

function asRoute(value: unknown): TaskRoute | undefined {
  return ROUTE_KEYS.includes(value as TaskRoute)
    ? (value as TaskRoute)
    : undefined;
}

/** Map a vault row onto a Task. `row.path` is the stable id (basename ⇒ rowId). */
export function vaultRowToTask(row: VaultRow): Task {
  const props = row.props || {};
  const custom: Record<string, string> = {};
  for (const key of Object.keys(props)) {
    if (KNOWN_PROPS.has(key)) continue;
    custom[key] = asText(props[key]);
  }
  const route = asRoute(props.route);
  const delegatedTo = asText(props.delegatedTo) || undefined;
  const assigneeId = asText(props.assigneeId) || undefined;
  const autoSendOnEscalate = props.autoSendOnEscalate === true;
  return {
    id: row.path,
    title: row.title || "Untitled",
    status: asStatus(props.status),
    prio: asPrio(props.prio),
    who: asText(props.who),
    due: asText(props.due),
    est: asText(props.est),
    custom,
    ...(route ? { route } : {}),
    ...(delegatedTo ? { delegatedTo } : {}),
    ...(assigneeId ? { assigneeId } : {}),
    ...(autoSendOnEscalate ? { autoSendOnEscalate } : {}),
  };
}
