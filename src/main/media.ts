/**
 * Main-process helpers for rendering and saving agent-generated media
 * (issue #299). The agent delivers files via `MEDIA:` tokens; the renderer
 * resolves local paths to data URLs through `readMediaAsDataUrl`, and lets
 * the user save any media (data URL / http(s) URL / local path) to disk
 * via `saveMedia`.
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  statSync,
} from "fs";
import { extname } from "path";
import { BrowserWindow, dialog } from "electron";

const MAX_MEDIA_BYTES = 25 * 1024 * 1024;

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
    return (
      !!filePath && existsSync(filePath) && statSync(filePath).isFile()
    );
  } catch {
    return false;
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
      const comma = src.indexOf(",");
      if (comma === -1) return false;
      writeFileSync(dest, Buffer.from(src.slice(comma + 1), "base64"));
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
