import { existsSync } from "fs";
import { mkdir, readdir, readFile, rename, stat, writeFile } from "fs/promises";
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
import { getHermesHome } from "./config";

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

export interface WorkspacePageGraph {
  version: 2;
  pages: Record<string, WorkspacePageMeta>;
  rootOrder: string[];
  childOrder: Record<string, string[]>;
  favorites: string[];
  recentVisits: Array<{ path: string; visitedAt: number }>;
  backlinks: Record<string, string[]>;
  sidebar: {
    collapsedSections: string[];
    width: number;
    collapsed: boolean;
  };
}

export interface WorkspaceOptions {
  profile?: string;
  root?: string;
}

const WORKSPACE_EXTENSIONS = new Set([".md", ".markdown", ".yaml", ".yml"]);
const METADATA_FILE = ".workspace-meta.json";
const INTERNAL_NAMES = new Set([
  METADATA_FILE,
  ".agent-proposals.json",
  ".history",
]);
const ROOT_KEY = "__root__";

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

function metadataPath(root: string): string {
  return join(root, METADATA_FILE);
}

function timestamp(): number {
  return Date.now();
}

function isWorkspaceFile(path: string): boolean {
  return WORKSPACE_EXTENSIONS.has(extname(path).toLowerCase());
}

function toWorkspaceRelative(root: string, absolutePath: string): string {
  return relative(root, absolutePath).split(sep).join("/");
}

function displayNameFromPath(path: string): string {
  return basename(path, extname(path))
    .split(/[-_ ]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function parentForPath(path: string): string | null {
  const parent = dirname(path);
  return parent === "." ? null : parent;
}

async function ensureWorkspace(options: WorkspaceOptions = {}): Promise<string> {
  const root = workspaceBase(options);
  await mkdir(root, { recursive: true });
  const indexPath = join(root, "index.md");
  if (!existsSync(indexPath)) {
    await writeFile(
      indexPath,
      "# Hermes Workspace\n\nThis is your local agent workspace.\n",
      "utf-8",
    );
  }
  return root;
}

async function collectFiles(root: string, absolutePath: string): Promise<string[]> {
  const info = await stat(absolutePath);
  const name = basename(absolutePath);
  if (INTERNAL_NAMES.has(name)) return [];
  if (info.isFile()) {
    return isWorkspaceFile(absolutePath) ? [absolutePath] : [];
  }
  const entries = await readdir(absolutePath);
  const nested = await Promise.all(
    entries.map((entry) => collectFiles(root, join(absolutePath, entry))),
  );
  return nested.flat();
}

async function readRawGraph(root: string): Promise<Partial<WorkspacePageGraph>> {
  if (!existsSync(metadataPath(root))) return {};
  try {
    return JSON.parse(await readFile(metadataPath(root), "utf-8")) as Partial<
      WorkspacePageGraph
    >;
  } catch {
    return {};
  }
}

async function writeGraph(
  root: string,
  graph: WorkspacePageGraph,
): Promise<void> {
  await writeFile(metadataPath(root), JSON.stringify(graph, null, 2), "utf-8");
}

function orderWithKnownFirst(
  preferred: string[],
  allPaths: string[],
): string[] {
  const known = [...new Set(preferred)].filter((path) =>
    allPaths.includes(path),
  );
  const missing = allPaths
    .filter((path) => !known.includes(path))
    .sort((a, b) => {
      if (a === "index.md") return -1;
      if (b === "index.md") return 1;
      return a.localeCompare(b);
    });
  return [...missing, ...known];
}

function buildChildOrder(
  pages: Record<string, WorkspacePageMeta>,
  rootOrder: string[],
  previous: Partial<WorkspacePageGraph>,
): Record<string, string[]> {
  const byParent = new Map<string, string[]>();
  for (const page of Object.values(pages)) {
    if (page.trashed) continue;
    const key = page.parentPath ?? ROOT_KEY;
    byParent.set(key, [...(byParent.get(key) ?? []), page.path]);
  }

  const childOrder: Record<string, string[]> = {};
  for (const [parent, paths] of byParent) {
    const preferred =
      parent === ROOT_KEY
        ? [...rootOrder, ...(previous.childOrder?.[ROOT_KEY] ?? [])]
        : [
            ...(pages[parent]?.childOrder ?? []),
            ...(previous.childOrder?.[parent] ?? []),
          ];
    childOrder[parent] = orderWithKnownFirst(preferred, paths);
  }
  if (!childOrder[ROOT_KEY]) childOrder[ROOT_KEY] = [];
  return childOrder;
}

export function extractBacklinks(content: string): string[] {
  const links = new Set<string>();
  const re = /\[\[([^\]]+)\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    const target = match[1]?.trim();
    if (target) links.add(target);
  }
  return [...links];
}

async function buildBacklinks(
  root: string,
  pages: Record<string, WorkspacePageMeta>,
): Promise<Record<string, string[]>> {
  const titleToPath = new Map<string, string>();
  for (const page of Object.values(pages)) {
    titleToPath.set(page.displayName.toLowerCase(), page.path);
    titleToPath.set(page.path.toLowerCase(), page.path);
    titleToPath.set(basename(page.path, extname(page.path)).toLowerCase(), page.path);
  }

  const backlinks: Record<string, string[]> = {};
  for (const page of Object.values(pages)) {
    if (page.trashed) continue;
    const target = join(root, page.path);
    if (!existsSync(target)) continue;
    const links = extractBacklinks(await readFile(target, "utf-8"));
    for (const link of links) {
      const targetPath = titleToPath.get(link.toLowerCase());
      if (!targetPath) continue;
      backlinks[targetPath] = [...(backlinks[targetPath] ?? []), page.path];
    }
  }
  return backlinks;
}

export async function getWorkspacePageGraph(
  options: WorkspaceOptions = {},
): Promise<WorkspacePageGraph> {
  const root = await ensureWorkspace(options);
  const previous = await readRawGraph(root);
  const pages: Record<string, WorkspacePageMeta> = {
    ...(previous.pages ?? {}),
  };
  const files = await collectFiles(root, root);

  for (const file of files) {
    const path = toWorkspaceRelative(root, file);
    if (pages[path]) {
      pages[path] = {
        ...pages[path],
        path,
        parentPath: parentForPath(path),
      };
      continue;
    }
    const createdAt = timestamp();
    pages[path] = {
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
  }

  const existingPaths = new Set(
    files.map((file) => toWorkspaceRelative(root, file)),
  );
  for (const [path, page] of Object.entries(pages)) {
    if (!existingPaths.has(path)) page.trashed = true;
  }

  const rootPaths = Object.values(pages)
    .filter((page) => page.parentPath === null && !page.trashed)
    .map((page) => page.path);
  const rootOrder = orderWithKnownFirst(previous.rootOrder ?? [], rootPaths);
  const graph: WorkspacePageGraph = {
    version: 2,
    pages,
    rootOrder,
    childOrder: buildChildOrder(pages, rootOrder, previous),
    favorites: Object.values(pages)
      .filter((page) => page.favorite && !page.trashed)
      .map((page) => page.path),
    recentVisits: (previous.recentVisits ?? []).filter(
      (visit) => pages[visit.path] && !pages[visit.path].trashed,
    ),
    backlinks: {},
    sidebar: {
      collapsedSections: previous.sidebar?.collapsedSections ?? [],
      width: previous.sidebar?.width ?? 280,
      collapsed: previous.sidebar?.collapsed ?? false,
    },
  };
  graph.backlinks = await buildBacklinks(root, pages);
  await writeGraph(root, graph);
  return graph;
}

export async function updateWorkspaceSidebarState(
  state: Partial<WorkspacePageGraph["sidebar"]>,
  options: WorkspaceOptions = {},
): Promise<WorkspacePageGraph> {
  const root = await ensureWorkspace(options);
  const graph = await getWorkspacePageGraph(options);
  graph.sidebar = {
    ...graph.sidebar,
    ...state,
    collapsedSections:
      state.collapsedSections?.filter(
        (section): section is string => typeof section === "string",
      ) ?? graph.sidebar.collapsedSections,
    width:
      typeof state.width === "number" && Number.isFinite(state.width)
        ? Math.max(220, Math.min(520, state.width))
        : graph.sidebar.width,
    collapsed:
      typeof state.collapsed === "boolean"
        ? state.collapsed
        : graph.sidebar.collapsed,
  };
  await writeGraph(root, graph);
  return graph;
}

export async function getWorkspaceBacklinks(
  path: string,
  options: WorkspaceOptions = {},
): Promise<string[]> {
  const normalized = assertWorkspacePath(path);
  const graph = await getWorkspacePageGraph(options);
  return graph.backlinks[normalized] ?? [];
}

export async function moveWorkspacePageInGraph(
  path: string,
  parentPath: string | null,
  beforePath?: string | null,
  options: WorkspaceOptions = {},
): Promise<WorkspacePageMeta> {
  const root = await ensureWorkspace(options);
  const normalized = assertWorkspacePath(path);
  const nextParent = parentPath ? assertWorkspacePath(parentPath) : null;
  const before = beforePath ? assertWorkspacePath(beforePath) : null;
  const graph = await getWorkspacePageGraph(options);
  const page = graph.pages[normalized];
  if (!page) throw new Error("Workspace page not found");

  const currentTarget = resolveWorkspacePath(normalized, options);
  const nextPath = nextParent
    ? `${nextParent}/${basename(normalized)}`
    : basename(normalized);
  if (nextPath !== normalized) {
    const nextTarget = resolveWorkspacePath(nextPath, options);
    await mkdir(dirname(nextTarget), { recursive: true });
    await rename(currentTarget, nextTarget);
    delete graph.pages[normalized];
    page.path = nextPath;
    graph.pages[nextPath] = page;
  }

  page.parentPath = nextParent;
  page.updatedAt = timestamp();
  const key = nextParent ?? ROOT_KEY;
  for (const parent of Object.keys(graph.childOrder)) {
    graph.childOrder[parent] = graph.childOrder[parent].filter(
      (candidate) => candidate !== normalized && candidate !== nextPath,
    );
  }
  const ordered = graph.childOrder[key] ?? [];
  const insertion = before ? ordered.indexOf(before) : -1;
  if (insertion === -1) ordered.push(page.path);
  else ordered.splice(insertion, 0, page.path);
  graph.childOrder[key] = ordered;
  graph.rootOrder = graph.childOrder[ROOT_KEY] ?? [];

  for (const candidate of Object.values(graph.pages)) {
    candidate.childOrder = graph.childOrder[candidate.path] ?? [];
  }
  await writeGraph(root, graph);
  return page;
}
