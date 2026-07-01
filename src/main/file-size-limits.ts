import { statSync } from "fs";

export const MAX_STAGED_ATTACHMENT_BYTES = 50 * 1024 * 1024;
export const MAX_GRANTED_FILE_BYTES = 50 * 1024 * 1024;

function decodedBase64Length(base64Bytes: string): number {
  const normalized = base64Bytes.replace(/\s/g, "");
  if (!normalized) return 0;
  const padding = normalized.endsWith("==")
    ? 2
    : normalized.endsWith("=")
      ? 1
      : 0;
  return Math.floor((normalized.length * 3) / 4) - padding;
}

export function assertBase64DecodedByteLimit(
  base64Bytes: string,
  maxBytes = MAX_STAGED_ATTACHMENT_BYTES,
): void {
  if (decodedBase64Length(base64Bytes) > maxBytes) {
    throw new Error(
      `Attachment is too large to stage. Maximum size is ${maxBytes} bytes.`,
    );
  }
}

export function assertFileWithinByteLimit(
  filePath: string,
  maxBytes = MAX_GRANTED_FILE_BYTES,
): void {
  const stat = statSync(filePath);
  if (!stat.isFile() || stat.size > maxBytes) {
    throw new Error(
      `File is too large to read. Maximum size is ${maxBytes} bytes.`,
    );
  }
}
