import { existsSync } from "fs";
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "fs/promises";
import { randomUUID } from "crypto";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "path";
import chokidar, { type FSWatcher } from "chokidar";
import YAML from "yaml";
import { getHermesHome } from "./config";

export type WorkspaceFileNode = {
  name: string;
  path: string;
  kind: "file" | "directory";
  children?: WorkspaceFileNode[];
};

export type WorkspaceSearchResult = {
  kind: "workspace";
  path: string;
  title: string;
  snippet: string;
};

export interface WorkspaceOptions {
  profile?: string;
  root?: string;
}

export interface WorkspaceFileChangedEvent {
  path: string;
  content: string;
}

export interface WorkspacePageMeta {
  id: string;
  path: string;
  displayName: string;
  parentPath: string | null;
  childOrder: string[];
  favorite: boolean;
  trashed: boolean;
  createdAt: number;
  updatedAt: number;
  lastVisitedAt?: number;
}

export interface WorkspaceMetadata {
  version: 1;
  pages: Record<string, WorkspacePageMeta>;
  rootOrder: string[];
  favorites: string[];
  recentVisits: Array<{ path: string; visitedAt: number }>;
}

export interface CreateWorkspacePageInput {
  title: string;
  parentPath?: string | null;
  content?: string;
}

export interface WorkspaceHistoryEntry {
  id: string;
  pageId: string;
  path: string;
  createdAt: number;
  reason: "user-save" | "page-operation" | "agent-proposal" | "restore";
  content: string;
  summary: Array<{ kind: "added" | "removed" | "changed"; text: string }>;
}

export interface AgentWorkspaceProposal {
  id: string;
  path: string;
  baseContent: string;
  proposedContent: string;
  hunks: AgentWorkspaceProposalHunk[];
  createdAt: number;
  status: "pending";
}

export interface AgentWorkspaceProposalHunk {
  id: string;
  blockId?: string;
  before: string;
  after: string;
  status: "pending" | "accepted" | "rejected";
}

const DEFAULT_INDEX = `# Hermes Workspace

This is your local agent workspace. Create pages in the sidebar, edit Markdown here, and ask Hermes to help from the chat pane.
`;

const WORKSPACE_EXTENSIONS = new Set([".md", ".markdown", ".yaml", ".yml"]);
const METADATA_FILE = ".workspace-meta.json";
const PROPOSALS_FILE = ".agent-proposals.json";
const HISTORY_DIR = ".history";
const INTERNAL_NAMES = new Set([METADATA_FILE, PROPOSALS_FILE, HISTORY_DIR]);

function workspaceBase(options: WorkspaceOptions = {}): string {
  return join(options.root ?? getHermesHome(options.profile), "workspace");
}

function assertWorkspacePath(path: string): string {
  const normalized = path.replace(/\\/g, "/").trim();
  if (
    !normalized ||
    normalized.includes("\0") ||
    isAbsolute(normalized) ||
    normalized
      .split("/")
      .some((part) => part === ".." || INTERNAL_NAMES.has(part))
  ) {
    throw new Error("Invalid workspace path");
  }
  return normalized;
}

function resolveWorkspacePath(
  path: string,
  options: WorkspaceOptions = {},
): string {
  const root = workspaceBase(options);
  const normalized = assertWorkspacePath(path);
  const target = resolve(root, normalized);
  const rel = relative(root, target);
  if (rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel)) {
    throw new Error("Invalid workspace path");
  }
  return target;
}

function toWorkspaceRelative(root: string, absolutePath: string): string {
  return relative(root, absolutePath).split(sep).join("/");
}

function isWorkspaceFile(path: string): boolean {
  return WORKSPACE_EXTENSIONS.has(extname(path).toLowerCase());
}

function metadataPath(root: string): string {
  return join(root, METADATA_FILE);
}

function proposalsPath(root: string): string {
  return join(root, PROPOSALS_FILE);
}

function historyRoot(root: string, pageId: string): string {
  return join(root, HISTORY_DIR, pageId);
}

function timestamp(): number {
  return Date.now();
}

function displayNameFromPath(path: string): string {
  return basename(path, extname(path))
    .split(/[-_ ]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function slugifyTitle(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "untitled";
}

function parentForPath(path: string): string | null {
  const parent = dirname(path);
  return parent === "." ? null : parent;
}

function displayTitle(title: string): string {
  return title.trim() || "Untitled";
}

export async function ensureWorkspace(
  options: WorkspaceOptions = {},
): Promise<string> {
  const root = workspaceBase(options);
  await mkdir(root, { recursive: true });
  const indexPath = join(root, "index.md");
  if (!existsSync(indexPath)) {
    await writeFile(indexPath, DEFAULT_INDEX, "utf-8");
  }
  return root;
}

async function readMetadata(root: string): Promise<WorkspaceMetadata> {
  if (!existsSync(metadataPath(root))) {
    return {
      version: 1,
      pages: {},
      rootOrder: [],
      favorites: [],
      recentVisits: [],
    };
  }
  try {
    const parsed = JSON.parse(await readFile(metadataPath(root), "utf-8")) as
      | Partial<WorkspaceMetadata>
      | undefined;
    return {
      version: 1,
      pages: parsed?.pages ?? {},
      rootOrder: parsed?.rootOrder ?? [],
      favorites: parsed?.favorites ?? [],
      recentVisits: parsed?.recentVisits ?? [],
    };
  } catch {
    return {
      version: 1,
      pages: {},
      rootOrder: [],
      favorites: [],
      recentVisits: [],
    };
  }
}

async function writeMetadata(
  root: string,
  metadata: WorkspaceMetadata,
): Promise<void> {
  await writeFile(
    metadataPath(root),
    JSON.stringify(metadata, null, 2),
    "utf-8",
  );
}

function syncMetadataCollections(metadata: WorkspaceMetadata): void {
  metadata.favorites = Object.values(metadata.pages)
    .filter((page) => page.favorite && !page.trashed)
    .map((page) => page.path);
  metadata.recentVisits = metadata.recentVisits.filter(
    (visit) =>
      metadata.pages[visit.path] && !metadata.pages[visit.path].trashed,
  );
  metadata.rootOrder = metadata.rootOrder.filter(
    (path) => metadata.pages[path] && !metadata.pages[path].trashed,
  );
}

async function collectFiles(
  root: string,
  absolutePath: string,
  metadata: WorkspaceMetadata = {
    version: 1,
    pages: {},
    rootOrder: [],
    favorites: [],
    recentVisits: [],
  },
  config: { includeTrashed?: boolean } = {},
): Promise<string[]> {
  const info = await stat(absolutePath);
  const name = basename(absolutePath);
  if (INTERNAL_NAMES.has(name)) return [];
  if (info.isFile()) {
    const path = toWorkspaceRelative(root, absolutePath);
    if (!config.includeTrashed && metadata.pages[path]?.trashed) return [];
    return isWorkspaceFile(absolutePath) ? [absolutePath] : [];
  }
  const entries = await readdir(absolutePath);
  const nested = await Promise.all(
    entries.map((entry) =>
      collectFiles(root, join(absolutePath, entry), metadata, config),
    ),
  );
  return nested.flat();
}

async function ensureMetadata(
  root: string,
  options: WorkspaceOptions = {},
): Promise<WorkspaceMetadata> {
  await ensureWorkspace(options);
  const metadata = await readMetadata(root);
  let changed = false;
  const files = await collectFiles(root, root, metadata, {
    includeTrashed: true,
  });
  for (const file of files) {
    const path = toWorkspaceRelative(root, file);
    if (metadata.pages[path]) continue;
    const createdAt = timestamp();
    metadata.pages[path] = {
      id: randomUUID(),
      path,
      displayName: displayNameFromPath(path),
      parentPath: parentForPath(path),
      childOrder: [],
      favorite: false,
      trashed: false,
      createdAt,
      updatedAt: createdAt,
    };
    changed = true;
  }
  syncMetadataCollections(metadata);
  if (changed || !existsSync(metadataPath(root))) {
    await writeMetadata(root, metadata);
  }
  return metadata;
}

function pageForPath(
  metadata: WorkspaceMetadata,
  path: string,
): WorkspacePageMeta {
  const page = metadata.pages[path];
  if (!page) throw new Error("Workspace page not found");
  return page;
}

async function uniquePagePath(
  root: string,
  parentPath: string | null,
  title: string,
): Promise<string> {
  const base = slugifyTitle(title);
  const prefix = parentPath ? `${parentPath.replace(/\/+$/, "")}/` : "";
  let index = 1;
  while (true) {
    const suffix = index === 1 ? "" : `-${index}`;
    const candidate = `${prefix}${base}${suffix}.md`;
    if (!existsSync(join(root, candidate))) return candidate;
    index += 1;
  }
}

async function snapshotWorkspaceFile(
  path: string,
  reason: WorkspaceHistoryEntry["reason"],
  options: WorkspaceOptions = {},
): Promise<void> {
  const root = await ensureWorkspace(options);
  const normalized = assertWorkspacePath(path);
  const target = resolveWorkspacePath(normalized, options);
  if (!existsSync(target)) return;
  const metadata = await ensureMetadata(root, options);
  if (!metadata.pages[normalized]) {
    const createdAt = timestamp();
    metadata.pages[normalized] = {
      id: randomUUID(),
      path: normalized,
      displayName: displayNameFromPath(normalized),
      parentPath: parentForPath(normalized),
      childOrder: [],
      favorite: false,
      trashed: false,
      createdAt,
      updatedAt: createdAt,
    };
    await writeMetadata(root, metadata);
  }
  const page = metadata.pages[normalized];
  const id = `${Date.now()}-${randomUUID()}`;
  const entry: WorkspaceHistoryEntry = {
    id,
    pageId: page.id,
    path: normalized,
    createdAt: timestamp(),
    reason,
    content: await readFile(target, "utf-8"),
    summary: historySummary(await readFile(target, "utf-8")),
  };
  const dir = historyRoot(root, page.id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${id}.json`), JSON.stringify(entry, null, 2));
}

function historySummary(
  content: string,
): Array<{ kind: "added" | "removed" | "changed"; text: string }> {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  return lines.slice(0, 5).map((line) => ({ kind: "changed", text: line }));
}

async function readNode(
  root: string,
  absolutePath: string,
  metadata: WorkspaceMetadata,
): Promise<WorkspaceFileNode | null> {
  const info = await stat(absolutePath);
  const name = basename(absolutePath);
  if (INTERNAL_NAMES.has(name)) return null;
  const path = toWorkspaceRelative(root, absolutePath);
  if (info.isDirectory()) {
    const entries = await readdir(absolutePath);
    const children = (
      await Promise.all(
        entries.map((entry) =>
          readNode(root, join(absolutePath, entry), metadata),
        ),
      )
    ).filter((node): node is WorkspaceFileNode => node !== null);
    children.sort(sortNodes);
    return { name, path, kind: "directory", children };
  }
  if (!isWorkspaceFile(absolutePath)) return null;
  if (metadata.pages[path]?.trashed) return null;
  return { name, path, kind: "file" };
}

function sortNodes(a: WorkspaceFileNode, b: WorkspaceFileNode): number {
  if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
  return a.name.localeCompare(b.name);
}

function sortNodesWithOrder(
  order: string[],
): (a: WorkspaceFileNode, b: WorkspaceFileNode) => number {
  return (a, b) => {
    const aIndex = order.indexOf(a.path);
    const bIndex = order.indexOf(b.path);
    if (aIndex !== -1 || bIndex !== -1) {
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      return aIndex - bIndex;
    }
    return sortNodes(a, b);
  };
}

export async function getWorkspaceTree(
  options: WorkspaceOptions = {},
): Promise<WorkspaceFileNode[]> {
  const root = await ensureWorkspace(options);
  const metadata = await ensureMetadata(root, options);
  const entries = await readdir(root);
  const nodes = (
    await Promise.all(
      entries.map((entry) => readNode(root, join(root, entry), metadata)),
    )
  ).filter((node): node is WorkspaceFileNode => node !== null);
  return nodes.sort(sortNodesWithOrder(metadata.rootOrder));
}

export async function readWorkspaceFile(
  path: string,
  options: WorkspaceOptions = {},
): Promise<string> {
  await ensureWorkspace(options);
  return readFile(resolveWorkspacePath(path, options), "utf-8");
}

export async function writeWorkspaceFile(
  path: string,
  content: string,
  options: WorkspaceOptions = {},
): Promise<boolean> {
  const root = await ensureWorkspace(options);
  const normalized = assertWorkspacePath(path);
  const target = resolveWorkspacePath(normalized, options);
  if (existsSync(target)) {
    await snapshotWorkspaceFile(normalized, "user-save", options);
  }
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, "utf-8");
  const metadata = await ensureMetadata(root, options);
  if (metadata.pages[normalized]) {
    metadata.pages[normalized].updatedAt = timestamp();
    await writeMetadata(root, metadata);
  }
  return true;
}

export async function deleteWorkspaceFile(
  path: string,
  options: WorkspaceOptions = {},
): Promise<boolean> {
  await ensureWorkspace(options);
  await rm(resolveWorkspacePath(path, options), {
    recursive: true,
    force: true,
  });
  return true;
}

export async function getWorkspaceMetadata(
  options: WorkspaceOptions = {},
): Promise<WorkspaceMetadata> {
  const root = await ensureWorkspace(options);
  return ensureMetadata(root, options);
}

export async function createWorkspacePage(
  input: CreateWorkspacePageInput,
  options: WorkspaceOptions = {},
): Promise<WorkspacePageMeta> {
  const root = await ensureWorkspace(options);
  const metadata = await ensureMetadata(root, options);
  const parentPath = input.parentPath
    ? assertWorkspacePath(input.parentPath)
    : null;
  const pagePath = await uniquePagePath(root, parentPath, input.title);
  const createdAt = timestamp();
  const page: WorkspacePageMeta = {
    id: randomUUID(),
    path: pagePath,
    displayName: displayTitle(input.title),
    parentPath,
    childOrder: [],
    favorite: false,
    trashed: false,
    createdAt,
    updatedAt: createdAt,
  };
  await mkdir(dirname(join(root, pagePath)), { recursive: true });
  await writeFile(
    join(root, pagePath),
    input.content ?? `# ${page.displayName}\n`,
  );
  metadata.pages[pagePath] = page;
  if (parentPath && metadata.pages[parentPath]) {
    metadata.pages[parentPath].childOrder.push(pagePath);
  } else if (!parentPath) {
    metadata.rootOrder.push(pagePath);
  }
  syncMetadataCollections(metadata);
  await writeMetadata(root, metadata);
  return page;
}

export async function renameWorkspacePage(
  path: string,
  title: string,
  options: WorkspaceOptions = {},
): Promise<WorkspacePageMeta> {
  const root = await ensureWorkspace(options);
  const normalized = assertWorkspacePath(path);
  const metadata = await ensureMetadata(root, options);
  const page = pageForPath(metadata, normalized);
  await snapshotWorkspaceFile(normalized, "page-operation", options);
  const nextPath = await uniquePagePath(root, page.parentPath, title);
  const content = await readFile(join(root, normalized), "utf-8");
  const nextTitle = displayTitle(title);
  const nextContent = content.match(/^#\s+.+$/m)
    ? content.replace(/^#\s+.+$/m, `# ${nextTitle}`)
    : `# ${nextTitle}\n\n${content}`;
  await rename(join(root, normalized), join(root, nextPath));
  await writeFile(join(root, nextPath), nextContent, "utf-8");
  delete metadata.pages[normalized];
  page.path = nextPath;
  page.displayName = nextTitle;
  page.updatedAt = timestamp();
  metadata.pages[nextPath] = page;
  metadata.recentVisits = metadata.recentVisits.map((visit) =>
    visit.path === normalized ? { ...visit, path: nextPath } : visit,
  );
  metadata.rootOrder = metadata.rootOrder.map((child) =>
    child === normalized ? nextPath : child,
  );
  for (const candidate of Object.values(metadata.pages)) {
    candidate.childOrder = candidate.childOrder.map((child) =>
      child === normalized ? nextPath : child,
    );
  }
  syncMetadataCollections(metadata);
  await writeMetadata(root, metadata);
  return page;
}

export async function moveWorkspacePage(
  path: string,
  parentPath: string | null,
  options: WorkspaceOptions = {},
): Promise<WorkspacePageMeta> {
  const root = await ensureWorkspace(options);
  const normalized = assertWorkspacePath(path);
  const nextParent = parentPath ? assertWorkspacePath(parentPath) : null;
  const metadata = await ensureMetadata(root, options);
  const page = pageForPath(metadata, normalized);
  await snapshotWorkspaceFile(normalized, "page-operation", options);
  const nextPath = nextParent
    ? `${nextParent}/${basename(normalized)}`
    : basename(normalized);
  if (nextPath !== normalized) {
    await mkdir(dirname(join(root, nextPath)), { recursive: true });
    await rename(join(root, normalized), join(root, nextPath));
    delete metadata.pages[normalized];
    metadata.pages[nextPath] = page;
  }
  for (const candidate of Object.values(metadata.pages)) {
    candidate.childOrder = candidate.childOrder.filter(
      (child) => child !== normalized,
    );
  }
  metadata.rootOrder = metadata.rootOrder.filter(
    (child) => child !== normalized,
  );
  page.path = nextPath;
  page.parentPath = nextParent;
  page.updatedAt = timestamp();
  if (nextParent && metadata.pages[nextParent]) {
    metadata.pages[nextParent].childOrder.push(nextPath);
  } else if (!nextParent) {
    metadata.rootOrder.push(nextPath);
  }
  metadata.recentVisits = metadata.recentVisits.map((visit) =>
    visit.path === normalized ? { ...visit, path: nextPath } : visit,
  );
  syncMetadataCollections(metadata);
  await writeMetadata(root, metadata);
  return page;
}

export async function duplicateWorkspacePage(
  path: string,
  options: WorkspaceOptions = {},
): Promise<WorkspacePageMeta> {
  const root = await ensureWorkspace(options);
  const normalized = assertWorkspacePath(path);
  const metadata = await ensureMetadata(root, options);
  const source = pageForPath(metadata, normalized);
  const title = `${source.displayName} Copy`;
  const duplicatePath = await uniquePagePath(root, source.parentPath, title);
  await mkdir(dirname(join(root, duplicatePath)), { recursive: true });
  await copyFile(join(root, normalized), join(root, duplicatePath));
  const createdAt = timestamp();
  const page: WorkspacePageMeta = {
    ...source,
    id: randomUUID(),
    path: duplicatePath,
    displayName: title,
    favorite: false,
    trashed: false,
    childOrder: [],
    createdAt,
    updatedAt: createdAt,
    lastVisitedAt: undefined,
  };
  metadata.pages[duplicatePath] = page;
  if (page.parentPath && metadata.pages[page.parentPath]) {
    metadata.pages[page.parentPath].childOrder.push(duplicatePath);
  } else {
    metadata.rootOrder.push(duplicatePath);
  }
  syncMetadataCollections(metadata);
  await writeMetadata(root, metadata);
  return page;
}

export async function trashWorkspacePage(
  path: string,
  options: WorkspaceOptions = {},
): Promise<boolean> {
  const root = await ensureWorkspace(options);
  const normalized = assertWorkspacePath(path);
  const metadata = await ensureMetadata(root, options);
  const page = pageForPath(metadata, normalized);
  await snapshotWorkspaceFile(normalized, "page-operation", options);
  page.trashed = true;
  page.favorite = false;
  page.updatedAt = timestamp();
  syncMetadataCollections(metadata);
  await writeMetadata(root, metadata);
  return true;
}

export async function restoreWorkspacePage(
  path: string,
  options: WorkspaceOptions = {},
): Promise<boolean> {
  const root = await ensureWorkspace(options);
  const normalized = assertWorkspacePath(path);
  const metadata = await ensureMetadata(root, options);
  const page = pageForPath(metadata, normalized);
  page.trashed = false;
  page.updatedAt = timestamp();
  syncMetadataCollections(metadata);
  await writeMetadata(root, metadata);
  return true;
}

export async function favoriteWorkspacePage(
  path: string,
  favorite: boolean,
  options: WorkspaceOptions = {},
): Promise<WorkspacePageMeta> {
  const root = await ensureWorkspace(options);
  const normalized = assertWorkspacePath(path);
  const metadata = await ensureMetadata(root, options);
  const page = pageForPath(metadata, normalized);
  page.favorite = favorite;
  page.updatedAt = timestamp();
  syncMetadataCollections(metadata);
  await writeMetadata(root, metadata);
  return page;
}

export async function updateWorkspacePageOrder(
  parentPath: string | null,
  orderedPaths: string[],
  options: WorkspaceOptions = {},
): Promise<WorkspaceMetadata> {
  const root = await ensureWorkspace(options);
  const metadata = await ensureMetadata(root, options);
  const sanitized = orderedPaths.map(assertWorkspacePath);
  if (parentPath) {
    const parent = pageForPath(metadata, assertWorkspacePath(parentPath));
    parent.childOrder = sanitized.filter((path) => metadata.pages[path]);
    parent.updatedAt = timestamp();
  } else {
    metadata.rootOrder = sanitized.filter((path) => metadata.pages[path]);
  }
  await writeMetadata(root, metadata);
  return metadata;
}

export async function recordWorkspaceVisit(
  path: string,
  options: WorkspaceOptions = {},
): Promise<boolean> {
  const root = await ensureWorkspace(options);
  const normalized = assertWorkspacePath(path);
  const metadata = await ensureMetadata(root, options);
  const page = pageForPath(metadata, normalized);
  const visitedAt = timestamp();
  page.lastVisitedAt = visitedAt;
  metadata.recentVisits = [
    { path: normalized, visitedAt },
    ...metadata.recentVisits.filter((visit) => visit.path !== normalized),
  ].slice(0, 20);
  await writeMetadata(root, metadata);
  return true;
}

export async function listWorkspaceHistory(
  path: string,
  options: WorkspaceOptions = {},
): Promise<WorkspaceHistoryEntry[]> {
  const root = await ensureWorkspace(options);
  const normalized = assertWorkspacePath(path);
  const metadata = await ensureMetadata(root, options);
  const page = pageForPath(metadata, normalized);
  const dir = historyRoot(root, page.id);
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir);
  const history = await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".json"))
      .map(async (entry) => {
        return JSON.parse(
          await readFile(join(dir, entry), "utf-8"),
        ) as WorkspaceHistoryEntry;
      }),
  );
  return history.sort((a, b) => b.createdAt - a.createdAt);
}

export async function restoreWorkspaceVersion(
  path: string,
  historyId: string,
  options: WorkspaceOptions = {},
): Promise<string> {
  const history = await listWorkspaceHistory(path, options);
  const entry = history.find((candidate) => candidate.id === historyId);
  if (!entry) throw new Error("Workspace history entry not found");
  await snapshotWorkspaceFile(path, "restore", options);
  await writeWorkspaceFile(path, entry.content, options);
  return entry.content;
}

async function readProposals(root: string): Promise<AgentWorkspaceProposal[]> {
  if (!existsSync(proposalsPath(root))) return [];
  try {
    return JSON.parse(
      await readFile(proposalsPath(root), "utf-8"),
    ) as AgentWorkspaceProposal[];
  } catch {
    return [];
  }
}

async function writeProposals(
  root: string,
  proposals: AgentWorkspaceProposal[],
): Promise<void> {
  await writeFile(proposalsPath(root), JSON.stringify(proposals, null, 2));
}

function contentBody(content: string): string[] {
  return content
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

function proposalHunks(
  baseContent: string,
  proposedContent: string,
): AgentWorkspaceProposalHunk[] {
  const baseLines = contentBody(baseContent);
  const proposedLines = contentBody(proposedContent);
  const hunks: AgentWorkspaceProposalHunk[] = [];
  const max = Math.max(baseLines.length, proposedLines.length);
  for (let index = 0; index < max; index += 1) {
    const before = baseLines[index] ?? "";
    const after = proposedLines[index] ?? "";
    if (before === after) continue;
    hunks.push({
      id: `hunk-${index + 1}`,
      before,
      after,
      status: "pending",
    });
  }
  if (hunks.length === 0 && baseContent !== proposedContent) {
    hunks.push({
      id: "hunk-1",
      before: baseContent,
      after: proposedContent,
      status: "pending",
    });
  }
  return hunks;
}

export async function listAgentWorkspaceProposals(
  options: WorkspaceOptions = {},
): Promise<AgentWorkspaceProposal[]> {
  const root = await ensureWorkspace(options);
  return readProposals(root);
}

export async function createAgentWorkspaceProposal(
  path: string,
  proposedContent: string,
  baseContent: string,
  options: WorkspaceOptions = {},
): Promise<AgentWorkspaceProposal> {
  const root = await ensureWorkspace(options);
  const proposal: AgentWorkspaceProposal = {
    id: randomUUID(),
    path: assertWorkspacePath(path),
    baseContent,
    proposedContent,
    hunks: proposalHunks(baseContent, proposedContent),
    createdAt: timestamp(),
    status: "pending",
  };
  const proposals = await readProposals(root);
  proposals.push(proposal);
  await writeProposals(root, proposals);
  return proposal;
}

export async function acceptAgentWorkspaceProposal(
  id: string,
  options: WorkspaceOptions = {},
): Promise<boolean> {
  const root = await ensureWorkspace(options);
  const proposals = await readProposals(root);
  const proposal = proposals.find((candidate) => candidate.id === id);
  if (!proposal) throw new Error("Agent proposal not found");
  await snapshotWorkspaceFile(proposal.path, "agent-proposal", options);
  await writeFile(
    resolveWorkspacePath(proposal.path, options),
    proposal.proposedContent,
    "utf-8",
  );
  await writeProposals(
    root,
    proposals.filter((candidate) => candidate.id !== id),
  );
  return true;
}

export async function rejectAgentWorkspaceProposal(
  id: string,
  options: WorkspaceOptions = {},
): Promise<boolean> {
  const root = await ensureWorkspace(options);
  const proposals = await readProposals(root);
  const proposal = proposals.find((candidate) => candidate.id === id);
  if (proposal) {
    const target = resolveWorkspacePath(proposal.path, options);
    if (existsSync(target)) {
      const current = await readFile(target, "utf-8");
      if (current === proposal.proposedContent) {
        await writeFile(target, proposal.baseContent, "utf-8");
      }
    }
  }
  await writeProposals(
    root,
    proposals.filter((candidate) => candidate.id !== id),
  );
  return true;
}

function titleForFile(path: string, content: string): string {
  if (
    extname(path)
      .toLowerCase()
      .match(/^\.ya?ml$/)
  ) {
    try {
      const parsed = YAML.parse(content);
      if (parsed && typeof parsed.title === "string") return parsed.title;
    } catch {
      return basename(path);
    }
  }
  return basename(path);
}

function snippetFor(content: string, query: string): string {
  const compact = content.trim().replace(/^#{1,6}\s+/gm, "");
  const lower = compact.toLowerCase();
  const index = lower.indexOf(query.toLowerCase());
  if (index === -1 || compact.length <= 220) return compact.slice(0, 220);
  const start = Math.max(0, index - 80);
  const end = Math.min(compact.length, index + query.length + 120);
  return compact.slice(start, end).trim();
}

function searchNeedle(query: string): { needle: string; exact: boolean } {
  const trimmed = query.trim();
  const quoted = trimmed.match(/^"(.+)"$/);
  return {
    needle: (quoted?.[1] ?? trimmed).toLowerCase(),
    exact: Boolean(quoted),
  };
}

function scoreWorkspaceSearchResult(
  title: string,
  content: string,
  query: string,
  favorite: boolean,
): number {
  const { needle, exact } = searchNeedle(query);
  const lowerTitle = title.toLowerCase();
  const lowerContent = content.toLowerCase();
  if (!needle) return 0;
  if (exact && !lowerTitle.includes(needle) && !lowerContent.includes(needle)) {
    return -1;
  }
  let score = 0;
  if (lowerTitle === needle) score += 100;
  if (lowerTitle.startsWith(needle)) score += 80;
  if (lowerTitle.includes(needle)) score += 60;
  if (lowerContent.includes(needle)) score += 20;
  if (favorite) score += 25;
  return score;
}

export async function searchWorkspace(
  query: string,
  limit = 20,
  options: WorkspaceOptions = {},
): Promise<WorkspaceSearchResult[]> {
  const root = await ensureWorkspace(options);
  const metadata = await ensureMetadata(root, options);
  const { needle } = searchNeedle(query);
  if (!needle) {
    return metadata.recentVisits.slice(0, limit).map((visit) => ({
      kind: "workspace",
      path: visit.path,
      title: metadata.pages[visit.path]?.displayName ?? basename(visit.path),
      snippet: "Recent page",
    }));
  }
  const files = await collectFiles(root, root, metadata);
  const results: Array<WorkspaceSearchResult & { score: number }> = [];
  for (const file of files) {
    const content = await readFile(file, "utf-8");
    const path = toWorkspaceRelative(root, file);
    const page = metadata.pages[path];
    const fileTitle = titleForFile(path, content);
    const scoreTitle = extname(path).match(/^\.ya?ml$/i)
      ? fileTitle
      : (page?.displayName ?? fileTitle);
    const score = scoreWorkspaceSearchResult(
      scoreTitle,
      content,
      query,
      page?.favorite ?? false,
    );
    if (score < 0) continue;
    if (score === 0 && !content.toLowerCase().includes(needle)) continue;
    results.push({
      kind: "workspace",
      path,
      title: fileTitle,
      snippet: snippetFor(content, query),
      score,
    });
  }
  return results
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, limit)
    .map(({ score: _score, ...result }) => result);
}

export async function exportWorkspaceMarkdownBundle(
  options: WorkspaceOptions = {},
): Promise<Array<{ path: string; content: string }>> {
  const root = await ensureWorkspace(options);
  const metadata = await ensureMetadata(root, options);
  const files = await collectFiles(root, root, metadata);
  const bundle = await Promise.all(
    files.map(async (file) => ({
      path: toWorkspaceRelative(root, file),
      content: await readFile(file, "utf-8"),
    })),
  );
  return bundle.sort((a, b) => a.path.localeCompare(b.path));
}

export async function watchWorkspace(
  options: WorkspaceOptions,
  onChange: (event: WorkspaceFileChangedEvent) => void,
): Promise<FSWatcher> {
  const root = await ensureWorkspace(options);
  const watcher = chokidar.watch(root, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 25 },
    ignored: (path) => path.split(sep).some((part) => INTERNAL_NAMES.has(part)),
  });

  const emit = async (absolutePath: string): Promise<void> => {
    if (!isWorkspaceFile(absolutePath)) return;
    try {
      const content = await readFile(absolutePath, "utf-8");
      onChange({ path: toWorkspaceRelative(root, absolutePath), content });
    } catch {
      /* deleted or temporarily unavailable */
    }
  };

  watcher.on("add", emit);
  watcher.on("change", emit);
  return watcher;
}
