import Database from "better-sqlite3";
import { basename, extname } from "path";
import { existsSync, readFileSync, statSync } from "fs";
import { activeStateDbPath } from "./utils";
import type { Attachment } from "../shared/attachments";
import { isImageMime, MAX_IMAGE_BYTES } from "../shared/attachments";

const TABLE = "desktop_message_attachments";

interface StoredAttachmentRow {
  message_id: number;
  ordinal: number;
  name: string;
  mime: string;
  size: number;
  data: Buffer;
}

function ensureTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL,
      session_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      kind TEXT NOT NULL DEFAULT 'image',
      name TEXT NOT NULL,
      mime TEXT NOT NULL,
      size INTEGER NOT NULL DEFAULT 0,
      data BLOB NOT NULL,
      created_at REAL NOT NULL DEFAULT (strftime('%s', 'now')),
      UNIQUE(message_id, ordinal)
    );
    CREATE INDEX IF NOT EXISTS idx_${TABLE}_session
      ON ${TABLE}(session_id);
    CREATE INDEX IF NOT EXISTS idx_${TABLE}_message
      ON ${TABLE}(message_id);
  `);
}

function tableExists(db: Database.Database): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(TABLE) as { name: string } | undefined;
  return !!row;
}

export function stripTrailingImagePlaceholders(text: string): string {
  let out = text || "";
  for (;;) {
    const next = out.replace(/(?:\s*\[(?:screenshot|image)\]\s*)$/i, "");
    if (next === out) return out.trim();
    out = next;
  }
}

const VISION_IMAGE_FALLBACK_RE =
  /^\s*\[The user attached an image(?:\s+but analysis failed\.|:[\s\S]*?)\]\s*\[You can examine it with vision_analyze using image_url:\s*([\s\S]*?)\]\s*/i;

const IMAGE_ATTACHED_AT_RE =
  /(?:^|\r?\n)\s*\[Image attached at:\s*([\s\S]*?)\]\s*(?:\[(?:screenshot|image)\]\s*)*$/i;

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

function cleanFallbackImagePath(value: string): string {
  return value
    .replace(/\r?\n/g, "")
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "");
}

export function extractLeadingVisionImageFallback(text: string): {
  content: string;
  imagePath: string | null;
} {
  const raw = text || "";
  const match = VISION_IMAGE_FALLBACK_RE.exec(raw);
  if (match) {
    return {
      content: raw.slice(match[0].length).trimStart(),
      imagePath: cleanFallbackImagePath(match[1] || "") || null,
    };
  }

  const attachedAt = IMAGE_ATTACHED_AT_RE.exec(raw);
  if (attachedAt) {
    return {
      content: `${raw.slice(0, attachedAt.index)}${raw.slice(
        attachedAt.index + attachedAt[0].length,
      )}`.trim(),
      imagePath: cleanFallbackImagePath(attachedAt[1] || "") || null,
    };
  }

  return { content: raw, imagePath: null };
}

export function stripLeadingVisionImageFallback(text: string): string {
  return extractLeadingVisionImageFallback(text).content;
}

export function attachmentFromLocalVisionImagePath(
  filePath: string | null | undefined,
  id: string,
): Attachment | null {
  if (!filePath || filePath.startsWith("data:")) return null;
  const ext = extname(filePath).toLowerCase();
  const mime = IMAGE_MIME_BY_EXT[ext];
  if (!mime || !isImageMime(mime)) return null;

  try {
    const stat = statSync(filePath);
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_IMAGE_BYTES) {
      return null;
    }
    const data = readFileSync(filePath);
    if (data.length <= 0 || data.length > MAX_IMAGE_BYTES) return null;
    return {
      id,
      kind: "image",
      name: basename(filePath) || `image${ext}`,
      mime,
      size: data.length,
      dataUrl: `data:${mime};base64,${data.toString("base64")}`,
      path: filePath,
    };
  } catch {
    return null;
  }
}

function normalizedPromptText(text: string): string {
  return stripTrailingImagePlaceholders(stripLeadingVisionImageFallback(text))
    .replace(/\s+/g, " ")
    .trim();
}

function hasTrailingImagePlaceholder(text: string): boolean {
  return /\[(?:screenshot|image)\]\s*$/i.test(text || "");
}

function parseImageDataUrl(
  dataUrl: string,
): { mime: string; data: Buffer } | null {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl || "");
  if (!match) return null;
  const mime = match[1].toLowerCase();
  if (!isImageMime(mime)) return null;
  const data = Buffer.from(match[2], "base64");
  if (data.length <= 0 || data.length > MAX_IMAGE_BYTES) return null;
  return { mime, data };
}

function imageAttachments(attachments?: Attachment[]): Attachment[] {
  return (attachments || []).filter(
    (a) => a.kind === "image" && typeof a.dataUrl === "string",
  );
}

function findMatchingUserMessageId(
  db: Database.Database,
  sessionId: string,
  promptText: string,
): number | null {
  const target = normalizedPromptText(promptText);

  const rows = db
    .prepare(
      `SELECT id, content
       FROM messages
       WHERE session_id = ? AND role = 'user'
       ORDER BY id DESC
       LIMIT 50`,
    )
    .all(sessionId) as Array<{ id: number; content: string | null }>;

  const hasAttachments = db.prepare(
    `SELECT 1 FROM ${TABLE} WHERE message_id = ? LIMIT 1`,
  );

  for (const row of rows) {
    const content = row.content || "";
    if (content.startsWith("\x00json:")) continue;
    if (normalizedPromptText(content) !== target) continue;
    if (!target && !hasTrailingImagePlaceholder(content)) continue;
    if (hasAttachments.get(row.id)) continue;
    return row.id;
  }

  return null;
}

export function persistPromptImageAttachments(
  sessionId: string | undefined,
  promptText: string,
  attachments?: Attachment[],
): void {
  if (!sessionId) return;
  const images = imageAttachments(attachments);
  if (images.length === 0) return;

  const dbPath = activeStateDbPath();
  if (!existsSync(dbPath)) return;

  const db = new Database(dbPath);
  try {
    ensureTable(db);
    const messageId = findMatchingUserMessageId(db, sessionId, promptText);
    if (!messageId) return;

    const insert = db.prepare(
      `INSERT OR REPLACE INTO ${TABLE}
       (message_id, session_id, ordinal, kind, name, mime, size, data)
       VALUES (?, ?, ?, 'image', ?, ?, ?, ?)`,
    );

    const tx = db.transaction(() => {
      images.forEach((attachment, index) => {
        const parsed = parseImageDataUrl(attachment.dataUrl || "");
        if (!parsed) return;
        insert.run(
          messageId,
          sessionId,
          index,
          attachment.name || `image-${index + 1}`,
          parsed.mime,
          attachment.size || parsed.data.length,
          parsed.data,
        );
      });
    });
    tx();
  } finally {
    db.close();
  }
}

export function loadPromptImageAttachments(
  db: Database.Database,
  sessionId: string,
): Map<number, Attachment[]> {
  const byMessageId = new Map<number, Attachment[]>();
  if (!tableExists(db)) return byMessageId;

  const rows = db
    .prepare(
      `SELECT message_id, ordinal, name, mime, size, data
       FROM ${TABLE}
       WHERE session_id = ? AND kind = 'image'
       ORDER BY message_id, ordinal`,
    )
    .all(sessionId) as StoredAttachmentRow[];

  for (const row of rows) {
    if (!isImageMime(row.mime)) continue;
    const bucket = byMessageId.get(row.message_id) || [];
    bucket.push({
      id: `db-att-${row.message_id}-${row.ordinal}`,
      kind: "image",
      name: row.name,
      mime: row.mime,
      size: row.size,
      dataUrl: `data:${row.mime};base64,${Buffer.from(row.data).toString("base64")}`,
    });
    byMessageId.set(row.message_id, bucket);
  }

  return byMessageId;
}

export function deletePromptImageAttachmentsForSession(
  db: Database.Database,
  sessionId: string,
): void {
  if (!tableExists(db)) return;
  db.prepare(`DELETE FROM ${TABLE} WHERE session_id = ?`).run(sessionId);
}
