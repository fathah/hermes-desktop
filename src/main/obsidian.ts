import { existsSync, mkdirSync, readFileSync } from "fs";
import { mkdir, readdir, readFile, stat, writeFile } from "fs/promises";
import {
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "path";
import chokidar, { type FSWatcher } from "chokidar";
import { decryptSecret, encryptSecret } from "./config";
import { profileHome, safeWriteFile } from "./utils";

export type ObsidianFileNode = {
  name: string;
  path: string;
  kind: "file" | "directory";
  children?: ObsidianFileNode[];
};

export type ObsidianSearchResult = {
  kind: "obsidian";
  path: string;
  title: string;
  snippet: string;
};

export type PublicObsidianConfig = {
  enabled: boolean;
  vaultPath: string;
  vaultName: string;
  vaultId: string;
  bridgeUrl: string;
  hasBridgeToken: boolean;
};

export type ObsidianConfigInput = {
  vaultPath: string;
  vaultName?: string;
  vaultId?: string;
  bridgeUrl?: string;
  bridgeToken?: string;
};

export type ObsidianFunctionName =
  | "status"
  | "active-note"
  | "open-note"
  | "insert-at-cursor"
  | "replace-selection"
  | "run-command"
  | "write-note";

export interface ObsidianFileChangedEvent {
  path: string;
  content: string;
}

type StoredObsidianConfig = {
  vaultPath?: string;
  vaultName?: string;
  vaultId?: string;
  bridgeUrl?: string;
  bridgeToken?: string;
};

const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown"]);
const OBSIDIAN_INTERNAL_DIR = ".obsidian";
const CONFIG_DIR = "desktop";
const CONFIG_FILE = "obsidian.json";

function configPath(profile?: string): string {
  return join(profileHome(profile), CONFIG_DIR, CONFIG_FILE);
}

function readStoredConfig(profile?: string): StoredObsidianConfig {
  const file = configPath(profile);
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, "utf-8"));
    return parsed && typeof parsed === "object"
      ? (parsed as StoredObsidianConfig)
      : {};
  } catch {
    return {};
  }
}

function writeStoredConfig(
  config: StoredObsidianConfig,
  profile?: string,
): void {
  mkdirSync(dirname(configPath(profile)), { recursive: true });
  safeWriteFile(configPath(profile), JSON.stringify(config, null, 2));
}

function publicConfig(config: StoredObsidianConfig): PublicObsidianConfig {
  const vaultPath = config.vaultPath ?? "";
  return {
    enabled: vaultPath.length > 0,
    vaultPath,
    vaultName: config.vaultName ?? "",
    vaultId: config.vaultId ?? "",
    bridgeUrl: config.bridgeUrl ?? "",
    hasBridgeToken: !!config.bridgeToken,
  };
}

function decryptBridgeToken(config: StoredObsidianConfig): string {
  return config.bridgeToken ? decryptSecret(config.bridgeToken) : "";
}

function configuredVault(profile?: string): string {
  const config = readStoredConfig(profile);
  if (!config.vaultPath) {
    throw new Error("Obsidian vault is not configured");
  }
  return config.vaultPath;
}

function assertObsidianPath(path: string): string {
  const normalized = path.replace(/\\/g, "/").trim();
  if (
    !normalized ||
    normalized.includes("\0") ||
    isAbsolute(normalized) ||
    normalized
      .split("/")
      .some((part) => part === ".." || part === OBSIDIAN_INTERNAL_DIR)
  ) {
    throw new Error("Invalid Obsidian path");
  }
  return normalized;
}

function assertMarkdownPath(path: string): string {
  const normalized = assertObsidianPath(path);
  if (!MARKDOWN_EXTENSIONS.has(extname(normalized).toLowerCase())) {
    throw new Error("Obsidian writes are limited to Markdown files");
  }
  return normalized;
}

function resolveObsidianPath(path: string, profile?: string): string {
  const root = configuredVault(profile);
  const normalized = assertObsidianPath(path);
  const target = resolve(root, normalized);
  const rel = relative(root, target);
  if (rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel)) {
    throw new Error("Invalid Obsidian path");
  }
  return target;
}

function toVaultRelative(root: string, absolutePath: string): string {
  return relative(root, absolutePath).split(sep).join("/");
}

function isMarkdownFile(path: string): boolean {
  return MARKDOWN_EXTENSIONS.has(extname(path).toLowerCase());
}

async function collectMarkdownFiles(
  root: string,
  absolutePath: string,
): Promise<string[]> {
  const info = await stat(absolutePath);
  const name = absolutePath.split(sep).pop() ?? "";
  if (name === OBSIDIAN_INTERNAL_DIR) return [];
  if (info.isFile()) return isMarkdownFile(absolutePath) ? [absolutePath] : [];
  const entries = await readdir(absolutePath);
  const nested = await Promise.all(
    entries.map((entry) =>
      collectMarkdownFiles(root, join(absolutePath, entry)),
    ),
  );
  return nested.flat();
}

async function readNode(
  root: string,
  absolutePath: string,
): Promise<ObsidianFileNode | null> {
  const info = await stat(absolutePath);
  const name = absolutePath.split(sep).pop() ?? "";
  if (name === OBSIDIAN_INTERNAL_DIR) return null;
  const path = toVaultRelative(root, absolutePath);
  if (info.isDirectory()) {
    const entries = await readdir(absolutePath);
    const children = (
      await Promise.all(
        entries.map((entry) => readNode(root, join(absolutePath, entry))),
      )
    ).filter((node): node is ObsidianFileNode => node !== null);
    children.sort(sortNodes);
    return { name, path, kind: "directory", children };
  }
  if (!isMarkdownFile(absolutePath)) return null;
  return { name, path, kind: "file" };
}

function sortNodes(a: ObsidianFileNode, b: ObsidianFileNode): number {
  return a.name.localeCompare(b.name);
}

export async function getObsidianConfig(
  profile?: string,
): Promise<PublicObsidianConfig> {
  return publicConfig(readStoredConfig(profile));
}

export async function setObsidianConfig(
  input: ObsidianConfigInput,
  profile?: string,
): Promise<PublicObsidianConfig> {
  const existing = readStoredConfig(profile);
  const next: StoredObsidianConfig = {
    vaultPath: input.vaultPath.trim(),
    vaultName: input.vaultName?.trim() ?? "",
    vaultId: input.vaultId?.trim() ?? "",
    bridgeUrl: input.bridgeUrl?.trim() ?? "",
    bridgeToken: existing.bridgeToken,
  };
  if (next.vaultPath && !isAbsolute(next.vaultPath)) {
    throw new Error("Obsidian vault path must be absolute");
  }
  if (input.bridgeToken !== undefined) {
    next.bridgeToken = input.bridgeToken
      ? encryptSecret(input.bridgeToken)
      : "";
  }
  writeStoredConfig(next, profile);
  return publicConfig(next);
}

export async function getObsidianTree(
  profile?: string,
): Promise<ObsidianFileNode[]> {
  const root = configuredVault(profile);
  const entries = await readdir(root);
  const nodes = (
    await Promise.all(entries.map((entry) => readNode(root, join(root, entry))))
  ).filter((node): node is ObsidianFileNode => node !== null);
  return nodes.sort(sortNodes);
}

export async function readObsidianFile(
  path: string,
  profile?: string,
): Promise<string> {
  return readFile(resolveObsidianPath(path, profile), "utf-8");
}

export async function writeObsidianFile(
  path: string,
  content: string,
  profile?: string,
): Promise<boolean> {
  const normalized = assertMarkdownPath(path);
  const target = resolveObsidianPath(normalized, profile);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, "utf-8");
  return true;
}

export async function appendObsidianFile(
  path: string,
  content: string,
  profile?: string,
): Promise<boolean> {
  const target = resolveObsidianPath(assertMarkdownPath(path), profile);
  const existing = existsSync(target) ? await readFile(target, "utf-8") : "";
  const separator = existing && !existing.endsWith("\n") ? "\n" : "";
  const addition = existing ? content.replace(/^\n+/, "") : content;
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${existing}${separator}${addition}`, "utf-8");
  return true;
}

export async function searchObsidian(
  query: string,
  limit = 20,
  profile?: string,
): Promise<ObsidianSearchResult[]> {
  const root = configuredVault(profile);
  const needle = query.trim();
  if (!needle) return [];
  try {
    const { getNoteIndexForRoot } = await import("./note-index");
    const index = await getNoteIndexForRoot(root);
    const hits = index.search(needle, limit, "any");
    return hits.map((hit) => ({
      kind: "obsidian",
      path: hit.path,
      title: hit.title,
      snippet: hit.snippet,
    }));
  } catch (err) {
    console.error(
      "[obsidian] search failed, falling back to naive search:",
      err,
    );
    const cleanNeedle = needle.toLowerCase();
    const files = await collectMarkdownFiles(root, root);
    const results: ObsidianSearchResult[] = [];
    for (const file of files) {
      try {
        const content = await readFile(file, "utf-8");
        const index = content.toLowerCase().indexOf(cleanNeedle);
        if (index === -1) continue;
        const snippet = content
          .slice(Math.max(0, index - 80), index + 160)
          .trim();
        results.push({
          kind: "obsidian",
          path: toVaultRelative(root, file),
          title: toVaultRelative(root, file).split("/").pop() ?? "",
          snippet,
        });
        if (results.length >= limit) break;
      } catch {
        // ignore read errors on individual files
      }
    }
    return results;
  }
}

export function buildObsidianOpenUri(input: {
  vaultName?: string;
  vaultPath?: string;
  path: string;
}): string {
  const params = new URLSearchParams();
  if (input.vaultName) {
    params.set("vault", input.vaultName);
    params.set("file", assertObsidianPath(input.path));
  } else {
    if (!input.vaultPath) {
      throw new Error("Obsidian vault path is required");
    }
    params.set("path", join(input.vaultPath, assertObsidianPath(input.path)));
  }
  return `obsidian://open?${params.toString()}`;
}

export function isAllowedObsidianExternalUrl(
  rawUrl: unknown,
): rawUrl is string {
  if (typeof rawUrl !== "string") return false;
  try {
    const url = new URL(rawUrl);
    return url.protocol === "obsidian:" && url.hostname === "open";
  } catch {
    return false;
  }
}

export async function callObsidianFunction(
  name: ObsidianFunctionName,
  payload: Record<string, unknown> = {},
  profile?: string,
): Promise<unknown> {
  const config = readStoredConfig(profile);
  const bridgeUrl = config.bridgeUrl?.trim();
  const bridgeToken = decryptBridgeToken(config);
  if (!bridgeUrl || !bridgeToken) {
    throw new Error("Obsidian bridge is not configured");
  }
  const response = await fetch(
    `${bridgeUrl.replace(/\/+$/, "")}/function/${name}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hermes-Obsidian-Token": bridgeToken,
      },
      body: JSON.stringify(payload),
    },
  );
  if (!response.ok) {
    throw new Error(`Obsidian bridge call failed: ${response.status}`);
  }
  return response.json();
}

export async function watchObsidian(
  profile: string | undefined,
  onChange: (event: ObsidianFileChangedEvent) => void,
): Promise<FSWatcher> {
  const root = configuredVault(profile);
  const watcher = chokidar.watch(root, {
    ignoreInitial: true,
    ignored: (path) => path.split(sep).includes(OBSIDIAN_INTERNAL_DIR),
  });
  watcher.on("change", async (absolutePath) => {
    if (!isMarkdownFile(absolutePath)) return;
    try {
      onChange({
        path: toVaultRelative(root, absolutePath),
        content: await readFile(absolutePath, "utf-8"),
      });
    } catch {
      // Best-effort change notifications should not crash the main process.
    }
  });
  return watcher;
}
