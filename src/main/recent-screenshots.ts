import { promises as fs } from "fs";
import { homedir } from "os";
import { execFile } from "child_process";
import { createHash } from "crypto";
import { promisify } from "util";
import { basename, extname, join } from "path";
import { writeAsset } from "./sps-assets";
import { writeSpsCapture } from "./sps-capture";
import type {
  SpsClipboardScreenshotImportInput,
  SpsRecentScreenshotCandidate,
  SpsRecentScreenshotImportInput,
  SpsRecentScreenshotImportResult,
} from "../shared/recent-screenshots";

export const RECENT_SCREENSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const RECENT_SCREENSHOT_MAX_BYTES = 25 * 1024 * 1024;
export const RECENT_SCREENSHOT_PREVIEW_MAX_BYTES = 2 * 1024 * 1024;
export const RECENT_SCREENSHOT_CANDIDATE_LIMIT = 5;

const SCREENSHOT_NAME_RE = /(clean\s?shot|screen\s?shot|screenshot|xnapper)/i;
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const IMAGE_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};
const execFileAsync = promisify(execFile);

export interface RecentScreenshot extends SpsRecentScreenshotCandidate {
  path: string;
}

interface RecentScreenshotOptions {
  homeDir?: string;
  nowMs?: number;
  dirs?: string[];
  maxAgeMs?: number;
  maxBytes?: number;
  maxPreviewBytes?: number;
  limit?: number;
  readMacScreenshotLocation?: () => Promise<string | null>;
}

function expandHome(path: string, homeDir: string): string {
  return path === "~" ? homeDir : path.replace(/^~\//, `${homeDir}/`);
}

async function defaultReadMacScreenshotLocation(): Promise<string | null> {
  if (process.platform !== "darwin") return null;
  try {
    const { stdout } = await execFileAsync("defaults", [
      "read",
      "com.apple.screencapture",
      "location",
    ]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function candidateDirs(
  homeDir: string,
  readMacScreenshotLocation = defaultReadMacScreenshotLocation,
): Promise<string[]> {
  const envDir = process.env.HERMES_RECENT_SCREENSHOT_DIR?.trim();
  if (envDir) return [expandHome(envDir, homeDir)];

  const configured = await readMacScreenshotLocation().catch(() => null);
  const dirs = [
    configured ? expandHome(configured, homeDir) : null,
    join(homeDir, "Desktop"),
    join(homeDir, "Pictures", "Screenshots"),
    join(homeDir, "Downloads"),
  ].filter((dir): dir is string => Boolean(dir));
  return [...new Set(dirs)];
}

function candidateId(path: string, modifiedAt: number, size: number): string {
  return createHash("sha256")
    .update(path)
    .update("\0")
    .update(String(modifiedAt))
    .update("\0")
    .update(String(size))
    .digest("hex");
}

async function previewDataUrl(
  path: string,
  ext: string,
  size: number,
  maxPreviewBytes: number,
): Promise<string | undefined> {
  if (size > maxPreviewBytes) return undefined;
  try {
    const bytes = await fs.readFile(path);
    return `data:${IMAGE_MIME[ext] ?? "application/octet-stream"};base64,${bytes.toString("base64")}`;
  } catch {
    return undefined;
  }
}

function buildCaptureBody(
  assetPath: string,
  originalName: string,
  note?: string,
): string {
  const trimmedNote = note?.trim();
  return [
    `![Screenshot](../_assets/${assetPath})`,
    `Imported from ${originalName}.`,
    trimmedNote ? `Note: ${trimmedNote}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function listRecentScreenshots(
  options: RecentScreenshotOptions = {},
): Promise<RecentScreenshot[]> {
  const home = options.homeDir ?? homedir();
  const dirs =
    options.dirs ??
    (await candidateDirs(home, options.readMacScreenshotLocation));
  const nowMs = options.nowMs ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? RECENT_SCREENSHOT_MAX_AGE_MS;
  const maxBytes = options.maxBytes ?? RECENT_SCREENSHOT_MAX_BYTES;
  const maxPreviewBytes =
    options.maxPreviewBytes ?? RECENT_SCREENSHOT_PREVIEW_MAX_BYTES;
  const limit = options.limit ?? RECENT_SCREENSHOT_CANDIDATE_LIMIT;
  const screenshots: RecentScreenshot[] = [];

  for (const dir of dirs) {
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch {
      continue;
    }

    for (const name of names) {
      if (!SCREENSHOT_NAME_RE.test(name)) continue;
      const ext = extname(name).toLowerCase();
      if (!IMAGE_EXTS.has(ext)) continue;
      const path = join(dir, name);
      try {
        const stat = await fs.stat(path);
        if (!stat.isFile()) continue;
        if (stat.size > maxBytes) continue;
        const modifiedAt = stat.mtimeMs;
        if (nowMs - modifiedAt > maxAgeMs) continue;
        const preview = await previewDataUrl(
          path,
          ext,
          stat.size,
          maxPreviewBytes,
        );
        screenshots.push({
          id: candidateId(path, modifiedAt, stat.size),
          path,
          originalName: basename(name),
          modifiedAt,
          size: stat.size,
          ...(preview ? { previewDataUrl: preview } : {}),
        });
      } catch {
        continue;
      }
    }
  }

  return screenshots
    .sort((a, b) => b.modifiedAt - a.modifiedAt)
    .slice(0, limit);
}

async function importScreenshotBytes(
  vaultDir: string,
  bytes: Buffer,
  input: {
    originalName: string;
    modifiedAt: number;
    note?: string;
    source: "recent-file" | "clipboard";
  },
  options: { nowMs?: number } = {},
): Promise<SpsRecentScreenshotImportResult> {
  try {
    const ext = extname(input.originalName).replace(/^\./, "") || "png";
    const assetPath = await writeAsset(vaultDir, bytes, ext);
    const importedAt = options.nowMs ?? Date.now();
    const capture = await writeSpsCapture(vaultDir, {
      source: "screenshot",
      title: `Screenshot - ${new Date(input.modifiedAt).toLocaleString()}`,
      body: buildCaptureBody(assetPath, input.originalName, input.note),
      via: "user",
      capturedAt: importedAt,
      captureKind: "source",
      schema: "source",
      provenance: "SPS Sources recent screenshot import",
    });
    if (!capture.success || !capture.id) {
      return {
        ok: false,
        reason: "write-failed",
        error: capture.error || "Could not write screenshot capture.",
      };
    }
    return {
      ok: true,
      captureId: capture.id,
      assetPath,
      originalName: input.originalName,
      modifiedAt: input.modifiedAt,
      source: input.source,
    };
  } catch {
    return {
      ok: false,
      reason: "write-failed",
      error: "Could not import the screenshot.",
    };
  }
}

export async function importRecentScreenshot(
  vaultDir: string,
  input: SpsRecentScreenshotImportInput = {},
  options: RecentScreenshotOptions = {},
): Promise<SpsRecentScreenshotImportResult> {
  const screenshots = await listRecentScreenshots(options);
  const screenshot = input.candidateId
    ? screenshots.find((candidate) => candidate.id === input.candidateId)
    : screenshots[0];
  if (!screenshot) {
    return input.candidateId
      ? {
          ok: false,
          reason: "stale-candidate",
          error: "That screenshot is no longer available.",
        }
      : {
          ok: false,
          reason: "not-found",
          error: "No recent screenshots found.",
        };
  }

  let bytes: Buffer;
  try {
    bytes = await fs.readFile(screenshot.path);
  } catch {
    return {
      ok: false,
      reason: "read-failed",
      error: "Could not read that screenshot.",
    };
  }

  return importScreenshotBytes(
    vaultDir,
    bytes,
    {
      originalName: screenshot.originalName,
      modifiedAt: screenshot.modifiedAt,
      note: input.note,
      source: "recent-file",
    },
    options,
  );
}

export async function importClipboardScreenshot(
  vaultDir: string,
  bytes: Buffer,
  input: SpsClipboardScreenshotImportInput = {},
  options: Pick<RecentScreenshotOptions, "maxBytes" | "nowMs"> = {},
): Promise<SpsRecentScreenshotImportResult> {
  if (bytes.length === 0) {
    return {
      ok: false,
      reason: "clipboard-empty",
      error: "No screenshot image found on the clipboard.",
    };
  }
  const maxBytes = options.maxBytes ?? RECENT_SCREENSHOT_MAX_BYTES;
  if (bytes.length > maxBytes) {
    return {
      ok: false,
      reason: "read-failed",
      error: "Clipboard screenshot is too large.",
    };
  }
  const nowMs = options.nowMs ?? Date.now();
  return importScreenshotBytes(
    vaultDir,
    bytes,
    {
      originalName: "Clipboard screenshot.png",
      modifiedAt: nowMs,
      note: input.note,
      source: "clipboard",
    },
    options,
  );
}
