import { readFile, readdir } from "fs/promises";
import { join } from "path";
import { resolveSpsVaultDir } from "./sps-storage";
import type {
  VaultHealthNoteSnapshot,
  VaultHealthReport,
} from "../shared/sps-types";
import YAML from "yaml";

export interface VaultHealthSnapshot {
  notes: VaultHealthNoteSnapshot[];
  links: Array<{ source: string; target: string; type?: string }>;
  mechanical: {
    orphans: string[];
    brokenLinks: Array<{ source: string; target: string; type?: string }>;
    stale: string[];
  };
}

export interface VaultHealthOptions {
  now?: number;
  staleCaptureDays?: number;
  schemaRequiredFields?: Record<string, string[]>;
}

const DEFAULT_SCHEMA_REQUIRED: Record<string, string[]> = {
  project: ["status"],
  task: ["status"],
  meeting: ["date"],
  person: ["aliases"],
  source: ["source"],
  decision: ["status"],
};

export function buildVaultHealthReportFromSnapshot(
  snapshot: VaultHealthSnapshot,
  options: VaultHealthOptions = {},
): VaultHealthReport {
  const now = options.now ?? Date.now();
  const staleCaptureDays = options.staleCaptureDays ?? 14;
  const schemaRequiredFields =
    options.schemaRequiredFields ?? DEFAULT_SCHEMA_REQUIRED;
  const duplicateTitles = duplicates(
    snapshot.notes,
    (note) => note.title,
    "title",
  ).map(({ key, paths }) => ({ title: key, paths }));
  const aliasRows = snapshot.notes.flatMap((note) =>
    aliases(note.props).map((alias) => ({ alias, path: note.path })),
  );
  const duplicateAliases = duplicates(aliasRows, (row) => row.alias, "alias").map(
    ({ key, paths }) => ({ alias: key, paths }),
  );

  const missingSchemaFields = snapshot.notes.flatMap((note) => {
    const schema = schemaName(note.props);
    if (!schema) return [];
    const required = schemaRequiredFields[schema] ?? [];
    const missing = required.filter((key) => isMissing(note.props[key]));
    return missing.length ? [{ path: note.path, schema, missing }] : [];
  });

  const staleBefore = now - staleCaptureDays * 86_400_000;
  const staleCaptures = snapshot.notes
    .filter((note) => note.path.startsWith("_inbox/"))
    .filter((note) => String(note.props.status ?? "") === "unprocessed")
    .filter((note) => Number(note.props.capturedAt ?? note.mtime) < staleBefore)
    .map((note) => ({
      path: note.path,
      title: note.title,
      ageDays: Math.floor(
        (now - Number(note.props.capturedAt ?? note.mtime)) / 86_400_000,
      ),
    }));

  const unprocessedPdfs = snapshot.notes
    .filter((note) => !note.path.startsWith("_inbox/"))
    .filter(
      (note) =>
        String(note.props.source ?? "").toLowerCase() === "pdf" ||
        String(note.props.mime ?? "").toLowerCase() === "application/pdf",
    )
    .filter((note) => String(note.props.status ?? "unprocessed") !== "processed")
    .map((note) => ({ path: note.path, title: note.title }));

  const degree = new Map<string, number>();
  for (const note of snapshot.notes) {
    if (!note.path.includes("/")) degree.set(note.path, 0);
  }
  for (const link of snapshot.links) {
    if (degree.has(link.source)) degree.set(link.source, (degree.get(link.source) ?? 0) + 1);
    if (degree.has(link.target)) degree.set(link.target, (degree.get(link.target) ?? 0) + 1);
  }
  const weaklyConnected = [...degree.entries()]
    .filter(([path, count]) => count <= 1 && !isMetaPage(path))
    .map(([path, count]) => ({ path, degree: count }))
    .sort((a, b) => a.degree - b.degree || a.path.localeCompare(b.path));

  return {
    orphans: snapshot.mechanical.orphans,
    brokenLinks: snapshot.mechanical.brokenLinks,
    stale: snapshot.mechanical.stale,
    duplicateTitles,
    duplicateAliases,
    missingSchemaFields,
    staleCaptures,
    unprocessedPdfs,
    weaklyConnected,
  };
}

export async function buildVaultHealthReport(
  profile?: string,
  staleDays = 30,
): Promise<VaultHealthReport> {
  const { getSpsNoteIndex } = await import("./note-index");
  const index = await getSpsNoteIndex(profile);
  const staleBeforeMs = Date.now() - staleDays * 86_400_000;
  const raw = index.lint(staleBeforeMs);
  const snapshot: VaultHealthSnapshot = {
    notes: await readVaultNoteSnapshots(resolveSpsVaultDir(profile)),
    links: index.links(),
    mechanical: {
      orphans: raw.orphans,
      brokenLinks: raw.brokenLinks,
      stale: raw.stale,
    },
  };
  return buildVaultHealthReportFromSnapshot(snapshot);
}

async function readVaultNoteSnapshots(
  vaultDir: string,
): Promise<VaultHealthNoteSnapshot[]> {
  const paths = await walkMarkdown(vaultDir, "");
  const out: VaultHealthNoteSnapshot[] = [];
  for (const rel of paths) {
    try {
      const raw = await readFile(join(vaultDir, rel), "utf-8");
      const { props, body } = parseFrontmatter(raw);
      out.push({
        path: rel,
        title: deriveTitle({ path: rel, title: "", props, mtime: 0 }, body),
        props,
        body,
        mtime: 0,
      });
    } catch {
      // best-effort health should skip unreadable notes
    }
  }
  return out;
}

async function walkMarkdown(root: string, relDir: string): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(join(root, relDir));
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of names) {
    if (name.startsWith(".")) continue;
    const rel = relDir ? `${relDir}/${name}` : name;
    if (name.endsWith(".md") || name.endsWith(".markdown")) out.push(rel);
    else out.push(...(await walkMarkdown(root, rel)));
  }
  return out.sort();
}

function deriveTitle(note: NoteRecord, body: string): string {
  if (typeof note.props.title === "string" && note.props.title.trim()) {
    return note.props.title.trim();
  }
  const heading = /^#\s+(.+)$/m.exec(body);
  return heading?.[1]?.trim() || note.path.replace(/\.md$/, "");
}

interface NoteRecord {
  path: string;
  title: string;
  props: Record<string, unknown>;
  mtime: number;
}

function parseFrontmatter(raw: string): {
  props: Record<string, unknown>;
  body: string;
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!match) return { props: {}, body: raw };
  try {
    const parsed = YAML.parse(match[1]);
    return {
      props:
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : {},
      body: raw.slice(match[0].length),
    };
  } catch {
    return { props: {}, body: raw.slice(match[0].length) };
  }
}

function aliases(props: Record<string, unknown>): string[] {
  const raw = props.aliases;
  return Array.isArray(raw)
    ? raw.filter((alias): alias is string => typeof alias === "string" && !!alias.trim())
    : [];
}

function schemaName(props: Record<string, unknown>): string | null {
  const raw = props.schema ?? props.type ?? props.kind;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

function isMissing(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

function isMetaPage(path: string): boolean {
  return ["home.md", "Home.md", "index.md", "WIKI.md", "log.md"].includes(path);
}

function duplicates<T>(
  rows: T[],
  keyOf: (row: T) => string,
  _label: string,
): Array<{ key: string; paths: string[] }> {
  const grouped = new Map<string, string[]>();
  for (const row of rows) {
    const key = keyOf(row).trim();
    if (!key) continue;
    const path = "path" in (row as object)
      ? String((row as { path: string }).path)
      : "";
    grouped.set(key.toLowerCase(), [...(grouped.get(key.toLowerCase()) ?? []), path]);
  }
  return [...grouped.entries()]
    .filter(([, paths]) => paths.length > 1)
    .map(([keyLower, paths]) => {
      const first = rows.find((row) => keyOf(row).toLowerCase() === keyLower);
      return { key: first ? keyOf(first) : keyLower, paths: paths.sort() };
    })
    .sort((a, b) => a.key.localeCompare(b.key));
}
