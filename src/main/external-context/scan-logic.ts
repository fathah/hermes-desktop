/**
 * Pure cursor logic for incremental scanning — decides, for each discovered
 * file, whether to skip it, parse only the appended tail, or re-parse the whole
 * file. No fs/sqlite imports so it runs under vitest.
 */
import type { DiscoveredFile } from "./adapters/types";

/** Persisted cursor for a file (mirrors the `files` table). */
export interface FileRecord {
  path: string;
  strategy: "append" | "replace";
  /** Byte offset already consumed (append); for replace this tracks size. */
  offset: number;
  size: number;
  mtimeMs: number;
}

export type FileAction =
  | { kind: "skip" }
  | { kind: "parse"; fromOffset: number; reparse: boolean };

/**
 * Decide what to do with a discovered file given its last-known record.
 *
 *  - No record           → parse from 0 (fresh).
 *  - replace strategy     → re-parse from 0 whenever size or mtime changed.
 *  - append, grew         → parse the tail from the stored offset.
 *  - append, shrank       → file was truncated/rotated → re-parse from 0.
 *  - append, unchanged    → skip.
 */
export function decideFileAction(
  file: DiscoveredFile,
  record: FileRecord | undefined,
  olderThanMs?: number,
): FileAction {
  // Recency filter: skip files whose last-modified is older than the cutoff
  // (the "only index sessions newer than N days" knob). mtime is a good-enough
  // proxy for session recency for append-only logs and whole-file chats alike.
  if (olderThanMs && Date.now() - file.mtimeMs > olderThanMs) {
    return { kind: "skip" };
  }
  if (!record) {
    return { kind: "parse", fromOffset: 0, reparse: false };
  }

  if (file.strategy === "replace") {
    const changed =
      file.size !== record.size || file.mtimeMs !== record.mtimeMs;
    return changed
      ? { kind: "parse", fromOffset: 0, reparse: true }
      : { kind: "skip" };
  }

  // append strategy
  if (file.size < record.offset || file.size < record.size) {
    // Truncated or rotated under the same path — start over.
    return { kind: "parse", fromOffset: 0, reparse: true };
  }
  if (file.size > record.offset) {
    return { kind: "parse", fromOffset: record.offset, reparse: false };
  }
  // size === offset and not shrunk → nothing new.
  return { kind: "skip" };
}
