// Shared attachment constants + helpers used by renderer, preload, and main.
// Do not import renderer-only or main-only modules from this file.

export type AttachmentKind = "image" | "text-file" | "path-ref";

export interface Attachment {
  id: string;
  kind: AttachmentKind;
  name: string;
  mime: string;
  size: number;
  // Images: data:image/<mime>;base64,<...>
  dataUrl?: string;
  // Images: present iff the renderer transcoded/downsampled the source
  // before pushing the attachment (e.g. a 12 MB photo compressed to fit
  // the gateway's 10 MB request-body cap — see #405). UI uses this to
  // surface the size delta in the attachment chip so the user knows
  // quality changed.
  originalSize?: number;
  // Text files: raw UTF-8 contents (already validated to be text)
  text?: string;
  // Path-ref attachments (PDFs, docx, etc.): absolute filesystem path.
  // Origin is the original file path for picker/drag-drop, or a staged
  // copy under %LOCALAPPDATA%/hermes/desktop-staging/<session>/ for paste.
  path?: string;
}

/**
 * Sanity cap on accepted image input. Set generously — the renderer
 * compresses anything between this and `MAX_IMAGE_TARGET_BYTES` to fit.
 * The only purpose of this cap is to bail before loading a pathologically
 * large file into the renderer's canvas (which has its own pixel ceiling
 * around 16M px and would OOM or stall before the decode completes).
 *
 * Was 20 MB pre-#405 with no compression; users with >20 MB photos got
 * a hard reject. Now: anything up to 50 MB original is accepted, and
 * compression brings the encoded body under the gateway's limit.
 */
export const MAX_IMAGE_INPUT_BYTES = 50 * 1024 * 1024; // 50 MB

/**
 * Target size for the binary payload of an image attachment after
 * (optional) compression. Chosen so the base64-inflated payload (~4/3×)
 * plus history and JSON overhead stays under the gateway's 10 MB
 * request-body cap (`MAX_REQUEST_BYTES` in `gateway/platforms/api_server.py`).
 *
 *   5 MB binary × 4/3 ≈ 6.67 MB base64 → ~3.3 MB headroom for history.
 *
 * `attachmentUtils.compressImageToFit` only runs when `file.size`
 * exceeds this target. Files already under the target pass through
 * untouched (no quality loss, no recompression).
 */
export const MAX_IMAGE_TARGET_BYTES = 5 * 1024 * 1024; // 5 MB

// Kept under the old name for backwards-compat with existing imports
// (notably tests). Equivalent to the new INPUT cap — same semantics.
export const MAX_IMAGE_BYTES = MAX_IMAGE_INPUT_BYTES;

export const MAX_TEXT_BYTES = 256 * 1024; // 256 KB
export const MAX_ATTACHMENTS_PER_MESSAGE = 10;

export const ALLOWED_IMAGE_MIMES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

// Text-file allowlist by extension (case-insensitive, no leading dot).
// Files outside this set with non-text/* MIMEs are rejected so we don't
// silently mangle binary content into a UTF-8 string.
export const ALLOWED_TEXT_EXTENSIONS: ReadonlySet<string> = new Set([
  "md",
  "markdown",
  "txt",
  "text",
  "log",
  "csv",
  "tsv",
  "json",
  "yaml",
  "yml",
  "toml",
  "ini",
  "env",
  "xml",
  "html",
  "htm",
  "css",
  "scss",
  "less",
  "sql",
  "sh",
  "bash",
  "zsh",
  "fish",
  "ps1",
  "py",
  "js",
  "jsx",
  "ts",
  "tsx",
  "mjs",
  "cjs",
  "go",
  "rs",
  "c",
  "cc",
  "cpp",
  "cxx",
  "h",
  "hpp",
  "java",
  "kt",
  "kts",
  "rb",
  "php",
  "swift",
  "scala",
  "lua",
  "r",
  "pl",
  "vue",
  "svelte",
  "dockerfile",
  "makefile",
  "gitignore",
  "editorconfig",
]);

export function getFileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot < 0 || dot === name.length - 1) {
    // Fall back to the bare filename for extension-less special files
    // (Dockerfile, Makefile, etc.) so the allowlist can match them.
    return name.toLowerCase();
  }
  return name.slice(dot + 1).toLowerCase();
}

export function isImageMime(mime: string): boolean {
  return ALLOWED_IMAGE_MIMES.has(mime.toLowerCase());
}

export function isTextFile(mime: string, name: string): boolean {
  if (mime.toLowerCase().startsWith("text/")) return true;
  return ALLOWED_TEXT_EXTENSIONS.has(getFileExtension(name));
}

/**
 * Escape XML-sensitive characters in attribute values so a filename
 * containing quotes or angle brackets can't break the `<file ...>` wrapper
 * we use to inline text attachments in user messages.
 */
export function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
