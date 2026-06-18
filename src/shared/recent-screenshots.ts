export type SpsRecentScreenshotImportFailureReason =
  | "not-found"
  | "stale-candidate"
  | "read-failed"
  | "write-failed"
  | "clipboard-empty";

export interface SpsRecentScreenshotCandidate {
  id: string;
  originalName: string;
  modifiedAt: number;
  size: number;
  previewDataUrl?: string;
}

export interface SpsRecentScreenshotImportInput {
  candidateId?: string;
  note?: string;
  runOcr?: boolean;
}

export interface SpsClipboardScreenshotImportInput {
  note?: string;
}

export type SpsRecentScreenshotImportResult =
  | {
      ok: true;
      captureId: string;
      assetPath: string;
      originalName: string;
      modifiedAt: number;
      source: "recent-file" | "clipboard";
      ocrText?: string;
    }
  | {
      ok: false;
      reason: SpsRecentScreenshotImportFailureReason;
      error: string;
    };
