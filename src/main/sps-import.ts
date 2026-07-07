import { createHash } from "crypto";
import type { Dirent } from "fs";
import { access, readFile, readdir } from "fs/promises";
import { basename, extname, join, relative, sep } from "path";
import type {
  SpsImportPlan,
  SpsImportPlanItem,
  SpsImportResult,
  SpsImportSource,
} from "../shared/sps-types";
import { safeWriteFileAsync } from "./utils";

const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown"]);
const SKIP_DIRS = new Set([".obsidian", ".git", "node_modules"]);
const PAGE_ID_RE = /^[A-Za-z0-9_-]+$/;

export interface MarkdownImportPlanInput {
  source: Extract<SpsImportSource, { kind: "markdown-folder" }>;
  vaultDir: string;
  targetFolder?: string;
}

export async function createMarkdownImportPlan(
  input: MarkdownImportPlanInput,
): Promise<SpsImportPlan> {
  const files = await collectMarkdownFiles(
    input.source.path,
    input.source.path,
  );
  const targetFolder = normalizeTargetFolder(input.targetFolder);
  const items: SpsImportPlanItem[] = [];

  for (const sourcePath of files) {
    const targetPageId = pageIdFromMarkdownPath(sourcePath);
    if (!targetPageId) {
      items.push({
        sourcePath,
        targetPageId: "",
        targetPath: "",
        status: "skipped",
        reason: "File name cannot be converted to a safe SPS page id.",
      });
      continue;
    }
    const targetPath = targetFolder
      ? `${targetFolder}/${targetPageId}.md`
      : `${targetPageId}.md`;
    const exists = await pathExists(join(input.vaultDir, targetPath));
    items.push({
      sourcePath,
      targetPageId,
      targetPath,
      status: exists ? "conflict" : "create",
      reason: exists ? "Target page already exists." : undefined,
    });
  }

  return {
    id: importPlanId(input.source, targetFolder, items),
    source: input.source,
    targetFolder,
    items,
    summary: {
      filesScanned: files.length,
      pagesToCreate: items.filter((item) => item.status === "create").length,
      conflicts: items.filter((item) => item.status === "conflict").length,
      skipped: items.filter((item) => item.status === "skipped").length,
    },
  };
}

export async function applyMarkdownImportPlan(
  plan: SpsImportPlan,
  vaultDir: string,
): Promise<SpsImportResult> {
  let pagesCreated = 0;
  let conflicts = 0;
  let skipped = 0;

  for (const item of plan.items) {
    if (item.status === "conflict") {
      conflicts += 1;
      continue;
    }
    if (
      item.status !== "create" ||
      !isSafeTargetPath(item.targetPath) ||
      !PAGE_ID_RE.test(item.targetPageId)
    ) {
      skipped += 1;
      continue;
    }

    const targetAbsolute = join(vaultDir, item.targetPath);
    if (await pathExists(targetAbsolute)) {
      conflicts += 1;
      continue;
    }

    try {
      const markdown = await readFile(item.sourcePath, "utf-8");
      await safeWriteFileAsync(targetAbsolute, markdown);
      pagesCreated += 1;
    } catch {
      skipped += 1;
    }
  }

  return {
    success: true,
    pagesCreated,
    conflicts,
    skipped,
  };
}

async function collectMarkdownFiles(
  root: string,
  dir: string,
): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = (await readdir(dir, { withFileTypes: true })) as Dirent[];
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".") {
      if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
      if (entry.isFile()) continue;
    }
    const absolute = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      files.push(...(await collectMarkdownFiles(root, absolute)));
    } else if (
      entry.isFile() &&
      MARKDOWN_EXTENSIONS.has(extname(entry.name).toLowerCase())
    ) {
      files.push(absolute);
    }
  }
  return files.sort((a, b) =>
    relative(root, a).localeCompare(relative(root, b)),
  );
}

function pageIdFromMarkdownPath(path: string): string {
  const base = basename(path, extname(path));
  const id = base
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return PAGE_ID_RE.test(id) ? id : "";
}

function normalizeTargetFolder(folder?: string): string | undefined {
  const clean = folder
    ?.trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");
  if (!clean) return undefined;
  if (
    clean
      .split("/")
      .some(
        (segment) =>
          !PAGE_ID_RE.test(segment) || segment === "." || segment === "..",
      )
  ) {
    return undefined;
  }
  return clean;
}

function isSafeTargetPath(path: string): boolean {
  const clean = path.trim().replace(/\\/g, "/");
  if (!clean || clean.startsWith("/") || clean.includes("//")) return false;
  const parts = clean.split("/");
  const file = parts.at(-1);
  if (!file || !file.endsWith(".md")) return false;
  if (!PAGE_ID_RE.test(file.slice(0, -3))) return false;
  return parts
    .slice(0, -1)
    .every(
      (segment) =>
        PAGE_ID_RE.test(segment) && segment !== "." && segment !== "..",
    );
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function importPlanId(
  source: SpsImportSource,
  targetFolder: string | undefined,
  items: SpsImportPlanItem[],
): string {
  const hash = createHash("sha256");
  hash.update(source.kind);
  hash.update("\0");
  hash.update(source.path);
  hash.update("\0");
  hash.update(targetFolder ?? "");
  for (const item of items) {
    hash.update("\0");
    hash.update(item.sourcePath.split(sep).join("/"));
    hash.update("\0");
    hash.update(item.targetPath);
    hash.update("\0");
    hash.update(item.status);
  }
  return `imp-${hash.digest("hex").slice(0, 16)}`;
}
