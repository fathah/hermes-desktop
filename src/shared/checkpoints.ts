/**
 * Filesystem checkpoint parsing (idea B2) — pure core.
 *
 * The gateway exposes checkpoints via the `/rollback` slash command (no HTTP
 * endpoint). Sending `/rollback` returns a text listing; this module parses that
 * listing into structured rows the desktop panel can render, and builds the
 * command strings for listing / restoring.
 *
 * Expected line shape (tools/checkpoint_manager.format_checkpoint_list):
 *   "  1. <short_hash>  2026-06-03 14:30  <reason>  (3 files, +10/-5)"
 */

export interface Checkpoint {
  /** 1-based index used by `/rollback <N>`. */
  number: number;
  shortHash: string;
  timestamp: string;
  reason: string;
  filesChanged?: number;
  insertions?: number;
  deletions?: number;
}

const ROW_RE =
  /^\s*(\d+)\.\s+(\S+)\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})\s+(.*?)(?:\s+\((\d+)\s+files?,\s*\+(\d+)\/-(\d+)\))?\s*$/;

/** Parse the `/rollback` listing text into checkpoint rows. */
export function parseCheckpointList(text: string): Checkpoint[] {
  if (!text) return [];
  const out: Checkpoint[] = [];
  for (const line of text.split("\n")) {
    const m = ROW_RE.exec(line);
    if (!m) continue;
    const [, num, hash, ts, reason, files, ins, dels] = m;
    out.push({
      number: Number(num),
      shortHash: hash,
      timestamp: ts,
      reason: reason.trim(),
      filesChanged: files !== undefined ? Number(files) : undefined,
      insertions: ins !== undefined ? Number(ins) : undefined,
      deletions: dels !== undefined ? Number(dels) : undefined,
    });
  }
  return out;
}

/** True when the gateway reports checkpoints aren't enabled / none exist. */
export function isNoCheckpoints(text: string): boolean {
  return /no checkpoints|not enabled/i.test(text || "");
}

export function listCommand(): string {
  return "/rollback";
}

export function restoreCommand(n: number): string {
  return `/rollback ${n}`;
}

export function diffCommand(n: number): string {
  return `/rollback diff ${n}`;
}
