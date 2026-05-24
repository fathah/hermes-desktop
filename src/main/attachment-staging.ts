import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { HERMES_HOME } from "./installer";

/**
 * Staging area for pasted attachments.  Picker / drag-drop attachments
 * keep their original filesystem path; pasted attachments have no origin
 * path, so we write their bytes to disk here and pass that path to the
 * agent.
 *
 * Layout:
 *   %LOCALAPPDATA%/hermes/desktop-staging/<sessionId>/<filename>
 *
 * Files persist across desktop restarts so the agent can re-read them
 * on session resume.  Per-session subdirs are cleaned up when the
 * session is deleted.
 */
const STAGING_ROOT = join(HERMES_HOME, "desktop-staging");

function sanitizeSegment(value: string, fallback: string): string {
  // Strip path separators, null bytes, and any other dodgy chars; collapse
  // whitespace to underscores.  Keeps the original name human-readable but
  // refuses anything that could escape the staging dir.
  const cleaned = value
    .replace(/[\x00-\x1F<>:"/\\|?*]/g, "") // eslint-disable-line no-control-regex
    .replace(/\s+/g, "_")
    .replace(/\.{2,}/g, ".")
    .trim();
  if (!cleaned || cleaned === "." || cleaned === "..") return fallback;
  return cleaned.slice(0, 200);
}

function uniquePath(dir: string, filename: string): string {
  const base = sanitizeSegment(filename, "file");
  let candidate = join(dir, base);
  if (!existsSync(candidate)) return candidate;
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : "";
  for (let i = 1; i < 1000; i++) {
    candidate = join(dir, `${stem}_${i}${ext}`);
    if (!existsSync(candidate)) return candidate;
  }
  // Astronomically unlikely fallback — append a timestamp.
  return join(dir, `${stem}_${Date.now()}${ext}`);
}

/**
 * Write a base64-encoded attachment to the staging area and return the
 * absolute path.  Caller is the renderer (via IPC); we don't trust the
 * filename and re-sanitize the session id segment too.
 */
export function stageAttachment(
  sessionId: string,
  filename: string,
  base64Bytes: string,
): string {
  const sessionSegment = sanitizeSegment(sessionId || "default", "default");
  const dir = join(STAGING_ROOT, sessionSegment);
  mkdirSync(dir, { recursive: true });
  const target = uniquePath(dir, filename);
  writeFileSync(target, Buffer.from(base64Bytes, "base64"));
  return target;
}

/**
 * Remove an entire session's staging directory.  Called when a chat
 * session is deleted from the UI.
 */
export function clearStagedAttachments(sessionId: string): void {
  if (!sessionId) return;
  const sessionSegment = sanitizeSegment(sessionId, "");
  if (!sessionSegment) return;
  const dir = join(STAGING_ROOT, sessionSegment);
  if (existsSync(dir)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Files may be locked (open in another app); best-effort cleanup.
    }
  }
}
