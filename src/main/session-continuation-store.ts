import type Database from "better-sqlite3";
import type { Attachment } from "../shared/attachments";
import type {
  DesktopSessionContinuationItem,
  DesktopSessionLocalError,
} from "../shared/session-continuation";
import { getDbConnection } from "./db";
import type { HistoryItem } from "./sessions";

const TABLE = "desktop_session_continuations";
const ERROR_TABLE = "desktop_session_local_errors";
const SYNTHETIC_ID_BASE = -900_000_000;
const ERROR_SYNTHETIC_ID_BASE = -800_000_000;

interface StoredContinuationRow {
  prefix_json: string;
}

interface StoredLocalErrorRow {
  id: number;
  user_content: string;
  error_text: string;
}

function ensureTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      session_id TEXT PRIMARY KEY,
      prefix_json TEXT NOT NULL,
      created_at REAL NOT NULL DEFAULT (strftime('%s', 'now')),
      updated_at REAL NOT NULL DEFAULT (strftime('%s', 'now'))
    );
    CREATE TABLE IF NOT EXISTS ${ERROR_TABLE} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      user_content TEXT NOT NULL,
      error_text TEXT NOT NULL,
      created_at REAL NOT NULL DEFAULT (strftime('%s', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_${ERROR_TABLE}_session
      ON ${ERROR_TABLE}(session_id);
  `);
}

function tableExists(db: Database.Database, table = TABLE): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(table) as { name: string } | undefined;
  return !!row;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cleanAttachments(value: unknown): Attachment[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((item): item is Attachment => isRecord(item));
  return out.length ? out : undefined;
}

export function normalizeContinuationItems(
  items: unknown,
): DesktopSessionContinuationItem[] {
  if (!Array.isArray(items)) return [];
  const out: DesktopSessionContinuationItem[] = [];

  for (const item of items) {
    if (!isRecord(item)) continue;
    const kind = String(item.kind || "");

    if (kind === "user") {
      const content = typeof item.content === "string" ? item.content : "";
      const attachments = cleanAttachments(item.attachments);
      if (!content.trim() && !attachments) continue;
      out.push({ kind, content, ...(attachments ? { attachments } : {}) });
      continue;
    }

    if (kind === "assistant") {
      const content = typeof item.content === "string" ? item.content : "";
      const error = typeof item.error === "string" ? item.error : "";
      const attachments = cleanAttachments(item.attachments);
      if (!content.trim() && !error.trim() && !attachments) continue;
      const visibleContent =
        error.trim() && normalizeText(content) === normalizeText(error)
          ? ""
          : content;
      out.push({
        kind,
        content: visibleContent,
        ...(error.trim() ? { error } : {}),
        ...(attachments ? { attachments } : {}),
      });
      continue;
    }

    if (kind === "reasoning") {
      const text = typeof item.text === "string" ? item.text : "";
      if (!text.trim()) continue;
      out.push({ kind, text });
      continue;
    }

    if (kind === "tool_call") {
      const callId = typeof item.callId === "string" ? item.callId : "";
      const name = typeof item.name === "string" ? item.name : "tool";
      const args = typeof item.args === "string" ? item.args : "";
      if (!callId && !name && !args.trim()) continue;
      out.push({ kind, callId, name, args });
      continue;
    }

    if (kind === "tool_result") {
      const callId = typeof item.callId === "string" ? item.callId : "";
      const name = typeof item.name === "string" ? item.name : "tool";
      const content = typeof item.content === "string" ? item.content : "";
      const attachments = cleanAttachments(item.attachments);
      if (!callId && !content.trim() && !attachments) continue;
      out.push({
        kind,
        callId,
        name,
        content,
        ...(attachments ? { attachments } : {}),
      });
    }
  }

  return out;
}

export function persistSessionContinuation(
  sessionId: string,
  items: unknown,
): void {
  const normalized = normalizeContinuationItems(items);
  if (!sessionId || normalized.length === 0) return;

  const db = getDbConnection(false);
  if (!db) return;

  ensureTable(db);
  db.prepare(
    `INSERT INTO ${TABLE} (session_id, prefix_json, updated_at)
     VALUES (?, ?, strftime('%s', 'now'))
     ON CONFLICT(session_id) DO UPDATE SET
       prefix_json = excluded.prefix_json,
       updated_at = excluded.updated_at`,
  ).run(sessionId, JSON.stringify(normalized));
}

export function persistSessionLocalError(
  sessionId: string,
  error: unknown,
  userContent: unknown,
): void {
  const errorText = typeof error === "string" ? error.trim() : "";
  const promptText = typeof userContent === "string" ? userContent.trim() : "";
  if (!sessionId || !errorText || !promptText) return;

  const db = getDbConnection(false);
  if (!db) return;

  ensureTable(db);
  const existing = db
    .prepare(
      `SELECT 1 FROM ${ERROR_TABLE}
       WHERE session_id = ? AND user_content = ? AND error_text = ?
       LIMIT 1`,
    )
    .get(sessionId, promptText, errorText);
  if (existing) return;

  db.prepare(
    `INSERT INTO ${ERROR_TABLE} (session_id, user_content, error_text)
     VALUES (?, ?, ?)`,
  ).run(sessionId, promptText, errorText);
}

export function loadSessionContinuationItems(
  db: Database.Database,
  sessionId: string,
): HistoryItem[] {
  if (!tableExists(db)) return [];
  const row = db
    .prepare(`SELECT prefix_json FROM ${TABLE} WHERE session_id = ?`)
    .get(sessionId) as StoredContinuationRow | undefined;
  if (!row?.prefix_json) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(row.prefix_json);
  } catch {
    return [];
  }

  return continuationItemsToHistory(normalizeContinuationItems(parsed));
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function mergeSessionLocalErrors(
  items: ReadonlyArray<HistoryItem>,
  errors: ReadonlyArray<DesktopSessionLocalError>,
): HistoryItem[] {
  if (errors.length === 0) return [...items];

  const output: HistoryItem[] = [];
  const used = new Set<number>();
  let errorOrdinal = 0;

  for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
    const item = items[itemIndex];
    output.push(item);
    if (item.kind !== "user") continue;

    const userText = normalizeText(item.content);
    const nextItem = items[itemIndex + 1];
    if (nextItem?.kind === "assistant" && normalizeText(nextItem.error || "")) {
      for (let i = 0; i < errors.length; i++) {
        if (used.has(i)) continue;
        const error = errors[i];
        if (
          normalizeText(error.userContent) === userText &&
          normalizeText(error.error) === normalizeText(nextItem.error || "")
        ) {
          used.add(i);
          break;
        }
      }
      continue;
    }

    for (let i = 0; i < errors.length; i++) {
      if (used.has(i)) continue;
      const error = errors[i];
      if (normalizeText(error.userContent) !== userText) continue;
      used.add(i);
      output.push({
        kind: "assistant",
        id: ERROR_SYNTHETIC_ID_BASE - errorOrdinal++,
        content: "",
        error: error.error,
        timestamp: item.timestamp + 0.000001,
      });
      break;
    }
  }

  for (let i = 0; i < errors.length; i++) {
    if (used.has(i)) continue;
    output.push({
      kind: "assistant",
      id: ERROR_SYNTHETIC_ID_BASE - errorOrdinal++,
      content: "",
      error: errors[i].error,
      timestamp: Number.MAX_SAFE_INTEGER,
    });
  }

  return output;
}

export function loadSessionLocalErrors(
  db: Database.Database,
  sessionId: string,
): DesktopSessionLocalError[] {
  if (!tableExists(db, ERROR_TABLE)) return [];
  const rows = db
    .prepare(
      `SELECT id, user_content, error_text
       FROM ${ERROR_TABLE}
       WHERE session_id = ?
       ORDER BY id`,
    )
    .all(sessionId) as StoredLocalErrorRow[];
  return rows
    .map((row) => ({
      userContent: row.user_content || "",
      error: row.error_text || "",
    }))
    .filter((row) => row.userContent.trim() && row.error.trim());
}

export function continuationItemsToHistory(
  items: ReadonlyArray<DesktopSessionContinuationItem>,
): HistoryItem[] {
  const history: HistoryItem[] = [];
  items.forEach((item, index) => {
    const id = SYNTHETIC_ID_BASE - index;
    const timestamp = index;

    switch (item.kind) {
      case "user":
        history.push({
          kind: "user",
          id,
          content: item.content,
          timestamp,
          ...(item.attachments?.length
            ? { attachments: item.attachments }
            : {}),
        });
        break;
      case "assistant":
        history.push({
          kind: "assistant",
          id,
          content: item.content,
          timestamp,
          ...(item.error ? { error: item.error } : {}),
          ...(item.attachments?.length
            ? { attachments: item.attachments }
            : {}),
        });
        break;
      case "reasoning":
        history.push({
          kind: "reasoning",
          id,
          assistantId: id,
          text: item.text,
          timestamp,
        });
        break;
      case "tool_call":
        history.push({
          kind: "tool_call",
          id,
          assistantId: id,
          callId: item.callId,
          name: item.name,
          args: item.args,
          timestamp,
        });
        break;
      case "tool_result":
        history.push({
          kind: "tool_result",
          id,
          callId: item.callId,
          name: item.name,
          content: item.content,
          timestamp,
          ...(item.attachments?.length
            ? { attachments: item.attachments }
            : {}),
        });
        break;
    }
  });
  return history;
}

export function deleteSessionContinuationForSession(
  db: Database.Database,
  sessionId: string,
): void {
  if (tableExists(db)) {
    db.prepare(`DELETE FROM ${TABLE} WHERE session_id = ?`).run(sessionId);
  }
  if (tableExists(db, ERROR_TABLE)) {
    db.prepare(`DELETE FROM ${ERROR_TABLE} WHERE session_id = ?`).run(
      sessionId,
    );
  }
}
