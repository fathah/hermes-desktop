// capture.ts — building a "raw source" capture for the second-brain inbox.
//
// Captures are immutable raw inputs (Karpathy's "Raw Sources" layer): the agent
// reads them during ingest but never rewrites their content. Each capture is one
// markdown row file under vault/_inbox/<id>.md whose frontmatter records
// provenance + processing status. We reuse the folder-backed-row serializer so
// the existing id-validated, traversal-safe write path (spsExportRow) carries it
// — no new write path — and the note-index picks it up for FTS/query.
//
// This module is intentionally pure (no IPC, no Date.now): the caller supplies
// the timestamp and id seed, so the logic is unit-testable under vitest.
import {
  rowToMarkdown,
  rowFromMarkdown,
  type RowProps,
} from "../editor/rowMarkdown";
import { uid } from "../lib/ids";

export type CaptureSource = "quick-note" | "web" | "voice" | "screenshot";

export type CaptureStatus =
  | "unprocessed"
  | "processing"
  | "processed"
  | "discarded";

/** The vault folder that holds raw captures. Valid id-safe segment (underscore
 *  is allowed by PAGE_ID_RE), not the reserved `assets` folder. */
export const INBOX_FOLDER = "_inbox";

export interface CaptureInput {
  source: CaptureSource;
  /** The raw text the user/gateway captured. */
  body: string;
  /** Optional explicit title; derived from the body's first line when absent. */
  title?: string;
  /** Who/what captured it: "user", a gateway id, etc. */
  via?: string;
  /** Origin URL for web-clips. */
  url?: string;
  /** User-selected source text from a web clip or share extension. */
  selection?: string;
  /** Highlight snippets captured from a clipper extension. */
  highlights?: string[];
  /** Epoch ms. Passed in so this stays pure (Date.now is the caller's job). */
  capturedAt: number;
  captureKind?: "note" | "source" | "project" | "person" | "decision" | "meeting" | "task" | "journal";
  schema?: string;
  links?: string[];
  provenance?: string;
}

export interface Capture {
  id: string;
  markdown: string;
}

/** First non-empty line of the body, clamped — a readable label for the list. */
export function deriveTitle(body: string): string {
  const first =
    body
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean) ?? "";
  if (first.length <= 80) return first;
  return `${first.slice(0, 79)}…`;
}

/** Build a capture's row id + markdown. Pure: caller supplies time + id seed. */
export function buildCapture(input: CaptureInput, id = uid("cap")): Capture {
  const explicitTitle = input.title?.trim();
  const title = explicitTitle || deriveTitle(input.body) || "Untitled capture";
  const props: RowProps = {
    title,
    source: input.source,
    status: "unprocessed" satisfies CaptureStatus,
    capturedAt: input.capturedAt,
  };
  if (input.via) props.via = input.via;
  if (input.url) props.url = input.url;
  if (input.selection?.trim()) props.selection = input.selection.trim();
  const highlights = input.highlights?.map((h) => h.trim()).filter(Boolean);
  if (highlights?.length) props.highlights = highlights;
  if (input.captureKind) props.captureKind = input.captureKind;
  if (input.schema) props.schema = input.schema;
  const links = input.links?.map((link) => link.trim()).filter(Boolean);
  if (links?.length) props.links = links;
  if (input.provenance?.trim()) props.provenance = input.provenance.trim();
  const markdown = rowToMarkdown(props, input.body.trim());
  return { id, markdown };
}

/** Rewrite a capture's status without touching its body (read → patch → write).
 *  Status is the one permitted mutation of an otherwise-immutable raw source. */
export function withStatus(markdown: string, status: CaptureStatus): string {
  const { props, body } = rowFromMarkdown(markdown);
  props.status = status;
  return rowToMarkdown(props, body.trim());
}
