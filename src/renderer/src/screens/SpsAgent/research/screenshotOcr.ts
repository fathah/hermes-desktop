import type { SpsRecentScreenshotImportResult } from "../../../../../shared/recent-screenshots";

const OCR_HEADING_RE = /\n## OCR Text\n\n[\s\S]*$/;

export function appendScreenshotOcr(markdown: string, ocrText: string): string {
  const text = ocrText.trim();
  if (!text) return markdown;
  const base = markdown.replace(OCR_HEADING_RE, "").trimEnd();
  return `${base}\n\n## OCR Text\n\n${text}`;
}

export function buildScreenshotStudyCorpus(
  result: Extract<SpsRecentScreenshotImportResult, { ok: true }>,
  ocrText?: string,
): string {
  const text = ocrText?.trim();
  const lines = [
    `Screenshot Inbox capture: ${result.captureId}`,
    `Original file name: ${result.originalName}`,
    `Stored asset: ${result.assetPath}`,
  ];
  if (text) {
    lines.push("", "OCR text:", text);
  } else {
    lines.push(
      "",
      "OCR has not been run yet, so study should use this as a screenshot capture reference and avoid text-grounded claims until text is extracted.",
    );
  }
  return lines.join("\n");
}
