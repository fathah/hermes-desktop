import {
  rowFromMarkdown,
  rowToMarkdown,
  type RowProps,
} from "../editor/rowMarkdown";

const OCR_HEADING_RE = /\n## OCR Text\n\n[\s\S]*$/;

export function appendVisualCaptureOcr(
  markdown: string,
  ocrText: string,
  status?: "complete" | "failed",
): string {
  const { props, body } = rowFromMarkdown(markdown);
  const text = ocrText.trim();
  const nextBody = body.replace(OCR_HEADING_RE, "").trimEnd();
  props.ocrStatus = status ?? (text ? "complete" : "failed");
  const bodyWithOcr = text ? `${nextBody}\n\n## OCR Text\n\n${text}` : nextBody;
  return rowToMarkdown(props, bodyWithOcr.trim());
}

export function isVisualCaptureProps(props: Record<string, unknown>): boolean {
  const source = props.source;
  return (
    (source === "image" || source === "screenshot") &&
    typeof props.assetPath === "string" &&
    props.assetPath.trim().length > 0
  );
}

export function buildTeachCaptureCorpus(input: {
  captureId: string;
  title?: string;
  markdown: string;
}): string {
  const { props, body } = rowFromMarkdown(input.markdown);
  const assetPath = typeof props.assetPath === "string" ? props.assetPath : "";
  const ocrText = extractOcrText(body);
  const lines = [
    `Inbox capture: ${input.captureId}`,
    `Title: ${input.title?.trim() || String(props.title ?? "Untitled capture")}`,
  ];
  if (assetPath) lines.push(`Stored asset: ${assetPath}`);
  if (typeof props.ocrStatus === "string")
    lines.push(`OCR status: ${props.ocrStatus}`);
  if (ocrText) {
    lines.push("", "OCR text:", ocrText);
  } else {
    lines.push(
      "",
      "OCR has not been run yet, so teach from the capture metadata only and avoid text-grounded claims until text is extracted.",
    );
  }
  return lines.join("\n");
}

export function extractOcrText(markdownOrBody: string): string {
  const match = /\n## OCR Text\n\n([\s\S]*)$/.exec(markdownOrBody);
  return match?.[1]?.trim() ?? "";
}

export function visualAssetPath(props: RowProps): string | null {
  return typeof props.assetPath === "string" && props.assetPath.trim()
    ? props.assetPath.trim()
    : null;
}
