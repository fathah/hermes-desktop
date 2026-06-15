// sps-okf.ts — translation engine for Google's Open Knowledge Format (OKF) v0.1
//
// Converts OKF directory structures into the SPS Agent's page format and vice-versa:
//   1. Import: Reads OKF Markdown files recursively, resolves relative/absolute links,
//      maps metadata, and yields a proposed ingest changeset.
//   2. Export: Generates a flat/nested OKF directory structure from SPS page states,
//      translates Obsidian wikilinks to relative Markdown links, and builds progressive
//      disclosure index.md catalogs.
//
// decoupling: Pure fs/path/YAML dependencies to allow unit testing.

import { promises as fs } from "fs";
import { dirname, join, relative, basename, normalize } from "path";
import YAML from "yaml";

export interface IngestPageProposal {
  op: "create" | "update";
  pageId: string;
  title: string;
  markdown: string;
}

/** Coerce a string into a safe SPS page id slug. */
export function slugifyPageId(raw: string): string {
  const collapsed = String(raw)
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return collapsed;
}

/** Helper: Parse frontmatter from a markdown file. */
export function parsePageMarkdown(raw: string): {
  props: Record<string, unknown>;
  body: string;
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!match) return { props: {}, body: raw };
  try {
    const parsed = YAML.parse(match[1]);
    const props =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    return { props, body: raw.slice(match[0].length) };
  } catch {
    return { props: {}, body: raw.slice(match[0].length) };
  }
}

/** Helper: Serialize properties and body back to frontmatter-topped markdown. */
export function stringifyPageMarkdown(
  props: Record<string, unknown>,
  body: string,
): string {
  if (Object.keys(props).length === 0) return body;
  const yamlStr = YAML.stringify(props).trim();
  return `---\n${yamlStr}\n---\n\n${body}`;
}

/** Helper: Resolve link target paths relative to the current file. */
export function resolveRelativePath(
  fromRelPath: string,
  linkPath: string,
): string {
  if (linkPath.startsWith("/")) {
    return normalize(linkPath.slice(1)).replace(/\\/g, "/");
  }
  const dir = dirname(fromRelPath);
  const resolved = join(dir, linkPath);
  return normalize(resolved).replace(/\\/g, "/");
}

/** Helper: Convert standard Markdown links into human-friendly Obsidian wikilinks. */
export function convertMarkdownLinksToWikilinks(
  markdown: string,
  currentFileRelPath: string,
  pathMap: Map<string, string>,
): string {
  return markdown.replace(
    /\[([^\]]+)\]\(([^)]+?\.md)\)/g,
    (_match, label, linkPath) => {
      const resolved = resolveRelativePath(currentFileRelPath, linkPath);
      // Resolve via direct path, or path without extension
      const targetPageId =
        pathMap.get(resolved) ||
        pathMap.get(resolved.replace(/\.md$/, "")) ||
        slugifyPageId(basename(linkPath, ".md"));

      if (
        targetPageId.toLowerCase() === label.toLowerCase() ||
        targetPageId === label
      ) {
        return `[[${targetPageId}]]`;
      } else {
        return `[[${targetPageId}|${label}]]`;
      }
    },
  );
}

/** Helper: Convert Obsidian wikilinks back into relative path Markdown links for export. */
export function convertWikilinksToMarkdownLinks(
  markdown: string,
  currentFileRelPath: string,
  pathMap: Map<string, string>,
): string {
  return markdown.replace(
    /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
    (_match, target, label) => {
      const cleanTarget = target.trim();
      const cleanLabel = label ? label.trim() : cleanTarget;
      const targetRelPath = pathMap.get(cleanTarget);

      if (!targetRelPath) {
        // Fallback: absolute-style bundle link if we don't know the exact folder path
        return `[${cleanLabel}](/${cleanTarget}.md)`;
      }

      // Compute relative link from currentFileRelPath to targetRelPath
      const fromDir = dirname(currentFileRelPath);
      let relativePath = relative(fromDir, targetRelPath).replace(/\\/g, "/");
      if (!relativePath.startsWith(".") && !relativePath.startsWith("/")) {
        relativePath = `./${relativePath}`;
      }

      return `[${cleanLabel}](${relativePath})`;
    },
  );
}

/** Recursively glob all markdown files under a directory. */
export async function globMdFiles(
  dir: string,
  baseDir = dir,
): Promise<string[]> {
  let entries: import("fs").Dirent[] = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const res = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && !entry.name.startsWith(".")) {
        files.push(...(await globMdFiles(res, baseDir)));
      }
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      const relPath = relative(baseDir, res);
      if (relPath !== "index.md" && relPath !== "log.md") {
        files.push(res);
      }
    }
  }
  return files;
}

/** Recursively scan all subdirectories of a vault to map page IDs to relative paths. */
async function buildVaultPathMap(
  vaultDir: string,
  currentDir = vaultDir,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let entries: import("fs").Dirent[] = [];
  try {
    entries = await fs.readdir(currentDir, { withFileTypes: true });
  } catch {
    return map;
  }
  for (const entry of entries) {
    const fullPath = join(currentDir, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name !== "assets" &&
        entry.name !== "_inbox" &&
        !entry.name.startsWith(".")
      ) {
        const subMap = await buildVaultPathMap(vaultDir, fullPath);
        for (const [k, v] of subMap.entries()) {
          map.set(k, v);
        }
      }
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      const relPath = relative(vaultDir, fullPath).replace(/\\/g, "/");
      if (
        relPath !== "index.md" &&
        relPath !== "log.md" &&
        relPath !== "WIKI.md"
      ) {
        const stem = entry.name.replace(/\.md$/, "");
        map.set(stem, relPath);
      }
    }
  }
  return map;
}

/**
 * OKF Import: Scans the target OKF bundle, converts metadata & links,
 * and proposes an IngestChangeset of pages.
 */
export async function spsImportOkfBundle(
  bundleDir: string,
  _profile?: string,
): Promise<{ success: boolean; pages: IngestPageProposal[]; error?: string }> {
  try {
    const files = await globMdFiles(bundleDir);
    if (files.length === 0) {
      return {
        success: true,
        pages: [],
        error: "No markdown files found in the selected folder.",
      };
    }

    // Phase 1: Build the relative path mapping for link resolution
    const pathMap = new Map<string, string>();
    const fileData: Array<{
      absPath: string;
      relPath: string;
      pageId: string;
    }> = [];

    for (const file of files) {
      const relPath = relative(bundleDir, file).replace(/\\/g, "/");
      const stem = basename(file, ".md");
      const pageId = slugifyPageId(stem);

      fileData.push({ absPath: file, relPath, pageId });
      // Map multiple configurations of paths to handle diverse markdown link formats
      pathMap.set(relPath, pageId);
      pathMap.set(relPath.replace(/\.md$/, ""), pageId);
      pathMap.set(stem, pageId);
      pathMap.set(stem + ".md", pageId);
    }

    // Phase 2: Read, translate and structure pages
    const proposals: IngestPageProposal[] = [];

    for (const item of fileData) {
      const rawContent = await fs.readFile(item.absPath, "utf-8");
      const { props, body } = parsePageMarkdown(rawContent);

      // Translate frontmatter keys to SPS properties
      const type = typeof props.type === "string" ? props.type : "Concept";
      const title =
        typeof props.title === "string"
          ? props.title
          : basename(item.absPath, ".md");
      const source =
        typeof props.resource === "string" ? props.resource : undefined;
      const tags = Array.isArray(props.tags)
        ? props.tags.filter((t): t is string => typeof t === "string")
        : undefined;

      let ingestedAt: number | undefined;
      if (typeof props.timestamp === "string") {
        const parsedTime = Date.parse(props.timestamp);
        if (!isNaN(parsedTime)) {
          ingestedAt = parsedTime;
        }
      }

      // Convert path-based links to Obsidian wikilinks
      const wikilinkBody = convertMarkdownLinksToWikilinks(
        body,
        item.relPath,
        pathMap,
      );

      // Rebuild frontmatter matching the pageToMarkdown parser
      const cleanProps: Record<string, unknown> = {
        title,
        type,
      };
      if (source !== undefined) cleanProps.source = source;
      if (ingestedAt !== undefined) cleanProps.ingestedAt = ingestedAt;
      if (tags !== undefined && tags.length > 0) cleanProps.tags = tags;

      // Retain additional custom frontmatter keys
      for (const [k, v] of Object.entries(props)) {
        if (!["title", "type", "resource", "tags", "timestamp"].includes(k)) {
          cleanProps[k] = v;
        }
      }

      const cleanMarkdown = stringifyPageMarkdown(cleanProps, wikilinkBody);

      proposals.push({
        op: "create", // The client-side workspace slice automatically handles op switches
        pageId: item.pageId,
        title,
        markdown: cleanMarkdown,
      });
    }

    return { success: true, pages: proposals };
  } catch (err) {
    return {
      success: false,
      pages: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * OKF Export: Generates a complete OKF-compliant directory structure under targetDir
 * representing standard pages and query database subdirectories from the active vault.
 */
export async function spsExportOkfBundle(
  vaultDir: string,
  targetDir: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    // Phase 1: Build mapping from pageId to relative path inside the active vault
    const pathMap = await buildVaultPathMap(vaultDir);

    // Recursively collect all markdown files in the vault (standard & rows)
    const vaultFiles: string[] = [];
    async function collectVaultFiles(dir: string): Promise<void> {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (
            entry.name !== "assets" &&
            entry.name !== "_inbox" &&
            !entry.name.startsWith(".")
          ) {
            await collectVaultFiles(fullPath);
          }
        } else if (entry.isFile() && entry.name.endsWith(".md")) {
          const relPath = relative(vaultDir, fullPath);
          if (
            relPath !== "index.md" &&
            relPath !== "log.md" &&
            relPath !== "WIKI.md"
          ) {
            vaultFiles.push(fullPath);
          }
        }
      }
    }
    await collectVaultFiles(vaultDir);

    if (vaultFiles.length === 0) {
      return {
        success: false,
        error: "The vault contains no exportable pages.",
      };
    }

    // Keep track of directory groupings to generate progressive-disclosure index.md catalogs
    const dirGroupings = new Map<
      string,
      Array<{ relPath: string; title: string; desc: string; isDir?: boolean }>
    >();

    // Phase 2: Convert and write each file
    for (const file of vaultFiles) {
      const relPath = relative(vaultDir, file).replace(/\\/g, "/");
      const rawContent = await fs.readFile(file, "utf-8");
      const { props, body } = parsePageMarkdown(rawContent);

      // Translate SPS metadata properties to OKF standard keys
      const type =
        typeof props.type === "string"
          ? props.type
          : relPath.includes("/")
            ? "Task"
            : "Concept";
      const title =
        typeof props.title === "string" ? props.title : basename(file, ".md");
      const description =
        typeof props.description === "string" ? props.description : "";
      const resource =
        typeof props.source === "string" ? props.source : undefined;
      const tags = Array.isArray(props.tags) ? props.tags : undefined;

      let timestamp: string | undefined;
      if (typeof props.ingestedAt === "number") {
        timestamp = new Date(props.ingestedAt).toISOString();
      }

      // Translate wikilinks to relative links
      const markdownBody = convertWikilinksToMarkdownLinks(
        body,
        relPath,
        pathMap,
      );

      const okfProps: Record<string, unknown> = {
        type,
        title,
      };
      if (description) okfProps.description = description;
      if (resource !== undefined) okfProps.resource = resource;
      if (tags !== undefined && tags.length > 0) okfProps.tags = tags;
      if (timestamp !== undefined) okfProps.timestamp = timestamp;

      // Carry other properties forward
      for (const [k, v] of Object.entries(props)) {
        if (
          ![
            "title",
            "type",
            "source",
            "ingestedAt",
            "tags",
            "description",
            "timestamp",
          ].includes(k)
        ) {
          okfProps[k] = v;
        }
      }

      const okfMarkdown = stringifyPageMarkdown(okfProps, markdownBody);

      // Ensure target directory subdirectory exists
      const targetFilePath = join(targetDir, relPath);
      const targetSubdir = dirname(targetFilePath);
      await fs.mkdir(targetSubdir, { recursive: true });

      // Write converted file
      await fs.writeFile(targetFilePath, okfMarkdown, "utf-8");

      // Register file under its target subdirectory for index.md indexing
      const relDir = dirname(relPath).replace(/\\/g, "/");
      if (!dirGroupings.has(relDir)) {
        dirGroupings.set(relDir, []);
      }
      dirGroupings.get(relDir)!.push({
        relPath,
        title,
        desc: description,
      });

      // Register subdirectories recursively under their parent directories
      let currentParent = relDir;
      while (currentParent !== ".") {
        const parentDir = dirname(currentParent).replace(/\\/g, "/");
        const dirName = basename(currentParent);
        if (!dirGroupings.has(parentDir)) {
          dirGroupings.set(parentDir, []);
        }
        const siblingList = dirGroupings.get(parentDir)!;
        const alreadyRegistered = siblingList.some(
          (item) => item.isDir && item.relPath === currentParent,
        );
        if (!alreadyRegistered) {
          siblingList.push({
            relPath: currentParent,
            title: dirName,
            desc: `${dirName} Database`,
            isDir: true,
          });
        }
        currentParent = parentDir;
      }
    }

    // Phase 3: Auto-generate progressive disclosure index.md listings for directories
    for (const [relDir, items] of dirGroupings.entries()) {
      const idxLines: string[] = [];
      const heading =
        relDir === "."
          ? "# Workspace Catalog"
          : `# ${basename(relDir)} Database`;

      idxLines.push(heading);
      idxLines.push("");

      const sorted = [...items].sort((a, b) => a.title.localeCompare(b.title));
      for (const item of sorted) {
        const linkPath = item.isDir ? `/${item.relPath}/` : `/${item.relPath}`;
        const descSuffix = item.desc ? ` - ${item.desc}` : "";
        idxLines.push(`* [${item.title}](${linkPath})${descSuffix}`);
      }

      idxLines.push("");

      // Write index.md
      const targetIdxDir = relDir === "." ? targetDir : join(targetDir, relDir);
      let indexContent = idxLines.join("\n");
      if (relDir === ".") {
        // Embed targeted version frontmatter in root index.md as allowed by Spec (§11)
        indexContent = `---\nokf_version: "0.1"\n---\n\n` + indexContent;
      }
      await fs.writeFile(join(targetIdxDir, "index.md"), indexContent, "utf-8");
    }

    // Phase 4: Copy log.md if it exists in the active vault
    const sourceLogPath = join(vaultDir, "log.md");
    try {
      const logContent = await fs.readFile(sourceLogPath, "utf-8");
      // log.md has a title: "Log" frontmatter, but OKF SPEC has no frontmatter for reserved files.
      // We will parse out any frontmatter in log.md before writing to make it strictly conformant.
      const { body } = parsePageMarkdown(logContent);
      await fs.writeFile(
        join(targetDir, "log.md"),
        `# Directory Update Log\n\n` + body.trim() + `\n`,
        "utf-8",
      );
    } catch {
      // log.md is optional; skip if missing
    }

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
