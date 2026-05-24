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
  // Text files: raw UTF-8 contents (already validated to be text)
  text?: string;
  // Path-ref attachments (PDFs, docx, etc.): absolute filesystem path.
  // Origin is the original file path for picker/drag-drop, or a staged
  // copy under %LOCALAPPDATA%/hermes/desktop-staging/<session>/ for paste.
  path?: string;
}

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024; // 20 MB
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
