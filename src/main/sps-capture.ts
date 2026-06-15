import { randomBytes } from "crypto";
import { exportRowMarkdownTo } from "./sps-vault";
import type { SpsCaptureInput } from "../shared/sps-types";

export const SPS_INBOX_FOLDER = "_inbox";

export interface SpsCaptureWriteResult {
  success: boolean;
  id?: string;
  error?: string;
}

export function buildSpsCaptureMarkdown(input: SpsCaptureInput): string {
  const body = input.body.trim();
  const props: Record<string, unknown> = {
    title: captureTitle(input),
    source: input.source,
    status: "unprocessed",
    capturedAt: input.capturedAt,
  };
  if (input.via) props.via = input.via;
  if (input.url) props.url = input.url;
  if (input.description?.trim()) props.description = input.description.trim();
  if (input.selection?.trim()) props.selection = input.selection.trim();
  const highlights = input.highlights?.map((h) => h.trim()).filter(Boolean);
  if (highlights?.length) props.highlights = highlights;
  if (input.captureKind) props.captureKind = input.captureKind;
  if (input.schema) props.schema = input.schema;
  const links = input.links?.map((link) => link.trim()).filter(Boolean);
  if (links?.length) props.links = links;
  if (input.provenance?.trim()) props.provenance = input.provenance.trim();
  return rowToMarkdown(props, body);
}

export async function writeSpsCapture(
  vaultDir: string,
  input: SpsCaptureInput,
  id = captureId(),
): Promise<SpsCaptureWriteResult> {
  const ok = await exportRowMarkdownTo(
    vaultDir,
    SPS_INBOX_FOLDER,
    id,
    buildSpsCaptureMarkdown(input),
  );
  return ok ? { success: true, id } : { success: false, error: "Could not write capture." };
}

function captureTitle(input: SpsCaptureInput): string {
  const explicit = input.title?.trim();
  if (explicit) return explicit;
  const firstLine = input.body
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return "Untitled capture";
  return firstLine.length <= 80 ? firstLine : `${firstLine.slice(0, 79)}...`;
}

function captureId(): string {
  return `cap_${Date.now()}_${randomBytes(4).toString("hex")}`;
}

function rowToMarkdown(props: Record<string, unknown>, body = ""): string {
  const lines = Object.keys(props)
    .filter((key) => props[key] !== undefined && props[key] !== "")
    .map((key) => `${key}: ${JSON.stringify(props[key])}`);
  if (lines.length === 0) return body;
  return `---\n${lines.join("\n")}\n---\n${body ? `\n${body}` : ""}`;
}
