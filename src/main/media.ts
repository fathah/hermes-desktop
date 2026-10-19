/**
 * Main-process helpers for rendering and saving agent-generated media
 * (issue #299). The agent delivers files via `MEDIA:` tokens; the renderer
 * resolves local paths to data URLs through `readMediaAsDataUrl`, and lets
 * the user save any media (data URL / http(s) URL / local path) to disk
 * via `saveMedia`.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  statSync,
  rmSync,
} from "fs";
import { extname, isAbsolute, join, resolve } from "path";
import { homedir, tmpdir } from "os";
import { createHash } from "crypto";
import { BrowserWindow, dialog } from "electron";

const MAX_MEDIA_BYTES = 25 * 1024 * 1024;
const TEMP_MEDIA_DIR = join(tmpdir(), "hermes-desktop-media");
const TEMP_MEDIA_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const TEMP_MEDIA_MAX_FILES = 100;

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".avif": "image/avif",
};

const EXT_BY_MIME: Record<string, string> = Object.fromEntries(
  Object.entries(MIME_BY_EXT).map(([ext, mime]) => [mime, ext]),
);

function sanitizeFilename(name: string): string {
  const cleaned = (name || "image")
    // eslint-disable-next-line no-control-regex -- intentionally strip control chars from filenames
    .replace(/[\x00-\x1F<>:"/\\|?*]/g, "")
    .replace(/\s+/g, "_")
    .replace(/\.{2,}/g, ".")
    .trim();
  return (cleaned || "image").slice(0, 160);
}

function decodeDataUrl(src: string): { mime: string; buffer: Buffer } | null {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(src || "");
  if (!match) return null;
  const mime = match[1].toLowerCase();
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length <= 0 || buffer.length > MAX_MEDIA_BYTES) return null;
  return { mime, buffer };
}

export function cleanupTempMediaFiles({
  maxAgeMs = 0,
  maxFiles = 0,
}: {
  maxAgeMs?: number;
  maxFiles?: number;
} = {}): void {
  try {
    if (!existsSync(TEMP_MEDIA_DIR)) return;
    const now = Date.now();
    const entries = readdirSync(TEMP_MEDIA_DIR, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const path = join(TEMP_MEDIA_DIR, entry.name);
        return { path, mtimeMs: statSync(path).mtimeMs };
      })
      .sort((a, b) => a.mtimeMs - b.mtimeMs);

    const keepNewestFrom = Math.max(0, entries.length - maxFiles);
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const expired = maxAgeMs <= 0 || now - entry.mtimeMs > maxAgeMs;
      const overLimit = maxFiles <= 0 || i < keepNewestFrom;
      if (expired || overLimit) {
        rmSync(entry.path, { force: true });
      }
    }
  } catch {
    // Best-effort cleanup only. Failure should never block opening media.
  }
}

export function materializeDataUrlToTemp(
  src: string,
  suggestedName: string,
): string | null {
  try {
    const decoded = decodeDataUrl(src);
    if (!decoded) return null;

    mkdirSync(TEMP_MEDIA_DIR, { recursive: true });
    cleanupTempMediaFiles({
      maxAgeMs: TEMP_MEDIA_MAX_AGE_MS,
      maxFiles: TEMP_MEDIA_MAX_FILES,
    });

    let filename = sanitizeFilename(suggestedName);
    if (!extname(filename)) {
      filename += EXT_BY_MIME[decoded.mime] || ".bin";
    }
    const hash = createHash("sha256").update(decoded.buffer).digest("hex");
    const target = join(TEMP_MEDIA_DIR, `${hash.slice(0, 16)}-${filename}`);
    if (!existsSync(target)) {
      writeFileSync(target, decoded.buffer);
    }
    return target;
  } catch {
    return null;
  }
}

/**
 * Read a local image file and return it as a `data:` URL. Returns null when
 * the file is missing, not an image, too large, or unreadable.
 */
export function readMediaAsDataUrl(filePath: string): string | null {
  try {
    if (!filePath || !existsSync(filePath)) return null;
    const ext = extname(filePath).toLowerCase();
    const mime = MIME_BY_EXT[ext];
    if (!mime) return null;
    if (statSync(filePath).size > MAX_MEDIA_BYTES) return null;
    const base64 = readFileSync(filePath).toString("base64");
    return `data:${mime};base64,${base64}`;
  } catch {
    return null;
  }
}

/**
 * True only when `filePath` points at an existing regular file. Used to
 * verify a bare (untagged) path the agent mentioned really is a delivered
 * file before the renderer treats it as media (issue #299).
 */
export function mediaFileExists(filePath: string): boolean {
  try {
    return !!filePath && existsSync(filePath) && statSync(filePath).isFile();
  } catch {
    return false;
  }
}

const MAX_PREVIEW_BYTES = 4 * 1024 * 1024;
const PREVIEW_EXT_RE = /\.(html?|xhtml)$/i;

/**
 * Read a local HTML file as UTF-8 text for the `::preview{file="…"}`
 * transcript directive. Relative paths resolve against `baseDir` (the
 * session's linked workspace), `~` expands to the user's home, and absolute
 * paths are used as-is. Returns null when the path is missing, not an HTML
 * file, too large, or unreadable — the renderer then falls back to showing
 * the directive verbatim rather than a broken frame.
 */
export function readHtmlFileText(
  filePath: string,
  baseDir?: string,
): string | null {
  try {
    if (!filePath || !PREVIEW_EXT_RE.test(filePath)) return null;
    let resolved = filePath;
    if (filePath === "~" || filePath.startsWith("~/")) {
      resolved = join(homedir(), filePath.slice(1));
    } else if (!isAbsolute(filePath) && baseDir) {
      resolved = resolve(baseDir, filePath);
    }
    if (!existsSync(resolved) || statSync(resolved).size > MAX_PREVIEW_BYTES)
      return null;
    return readFileSync(resolved, "utf8");
  } catch {
    return null;
  }
}

/**
 * Prompt the user for a destination and write `src` there. `src` may be a
 * `data:` URL, an http(s) URL, or a local filesystem path. Returns true on
 * success, false when canceled or on any error.
 */
export async function saveMedia(
  src: string,
  suggestedName: string,
  win: BrowserWindow | null,
): Promise<boolean> {
  try {
    const result = win
      ? await dialog.showSaveDialog(win, { defaultPath: suggestedName })
      : await dialog.showSaveDialog({ defaultPath: suggestedName });
    if (result.canceled || !result.filePath) return false;
    const dest = result.filePath;

    if (src.startsWith("data:")) {
      const decoded = decodeDataUrl(src);
      if (!decoded) return false;
      writeFileSync(dest, decoded.buffer);
      return true;
    }

    if (/^https?:\/\//i.test(src)) {
      const response = await fetch(src);
      if (!response.ok) return false;
      const buffer = Buffer.from(await response.arrayBuffer());
      writeFileSync(dest, buffer);
      return true;
    }

    copyFileSync(src, dest);
    return true;
  } catch {
    return false;
  }
}
