/**
 * Pure, dependency-light helpers for the Personalization feature.
 *
 * Kept free of Electron / native (`better-sqlite3`) / `fs` imports so it can be
 * unit-tested under vitest (the rest of personalization.ts opens fs/HERMES_HOME
 * and is exercised by the build + manual smoke instead — see docs/STORAGE.md on
 * the vitest ABI split).
 *
 * The `hooks:` block in config.yaml is a nested list-of-maps
 * (`hooks.pre_llm_call[].command`) which the hand-rolled parser in config.ts
 * explicitly cannot edit — so we use the real `yaml` library here.
 */
import { parseDocument } from "yaml";
import { relative, resolve, isAbsolute } from "path";

export const HOOK_EVENT = "pre_llm_call";

export interface AllowlistEntry {
  event: string;
  command: string;
  approved_at: string;
  script_mtime_at_approval: string | null;
}

export interface AllowlistFile {
  approvals: AllowlistEntry[];
}

/**
 * Resolve `name` to a path directly inside `dir`, rejecting traversal
 * (`..`), absolute paths, and any nested sub-path. Returns null if unsafe.
 * Used to confine writes to ~/.hermes/agent-hooks/.
 */
export function resolveInsideDir(dir: string, name: string): string | null {
  const resolved = resolve(dir, name);
  const rel = relative(dir, resolved);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return null;
  if (rel.includes("/") || rel.includes("\\")) return null;
  return resolved;
}

/** True if config.yaml already registers our hook command under pre_llm_call. */
export function configHasHook(yamlText: string, scriptPath: string): boolean {
  try {
    const doc = parseDocument(yamlText);
    const js = doc.toJS() as { hooks?: Record<string, unknown> } | null;
    const list = js?.hooks?.[HOOK_EVENT];
    return (
      Array.isArray(list) &&
      list.some(
        (e) =>
          e != null &&
          typeof e === "object" &&
          (e as { command?: unknown }).command === scriptPath,
      )
    );
  } catch {
    return false;
  }
}

/**
 * Add our hook to config.yaml under `hooks.pre_llm_call` if absent, preserving
 * existing comments/formatting. Idempotent. Handles hooks being missing,
 * an empty map (`hooks: {}`), or an existing list.
 */
export function upsertHookInConfig(
  yamlText: string,
  scriptPath: string,
  timeout = 10,
): string {
  const doc = parseDocument(yamlText);
  if (configHasHook(yamlText, scriptPath)) return doc.toString();

  const seqNode = doc.getIn(["hooks", HOOK_EVENT], true) as
    | { items?: unknown[] }
    | undefined;

  const entry = doc.createNode({ command: scriptPath, timeout });
  if (seqNode && Array.isArray(seqNode.items)) {
    doc.addIn(["hooks", HOOK_EVENT], entry);
  } else {
    doc.setIn(
      ["hooks", HOOK_EVENT],
      doc.createNode([{ command: scriptPath, timeout }]),
    );
  }
  return doc.toString();
}

/** Remove our hook command from config.yaml, preserving everything else. */
export function removeHookFromConfig(
  yamlText: string,
  scriptPath: string,
): string {
  const doc = parseDocument(yamlText);
  const seq = doc.getIn(["hooks", HOOK_EVENT], true) as
    | { items: Array<{ get?: (k: string) => unknown }> }
    | undefined;
  if (seq && Array.isArray(seq.items)) {
    seq.items = seq.items.filter(
      (item) => item?.get?.("command") !== scriptPath,
    );
  }
  return doc.toString();
}

export function buildAllowlistEntry(
  command: string,
  approvedAtISO: string,
  scriptMtimeISO: string | null,
): AllowlistEntry {
  return {
    event: HOOK_EVENT,
    command,
    approved_at: approvedAtISO,
    script_mtime_at_approval: scriptMtimeISO,
  };
}

/** Upsert an approval into the allowlist, de-duping by (event, command). */
export function upsertAllowlist(
  current: Partial<AllowlistFile> | null,
  entry: AllowlistEntry,
): AllowlistFile {
  const approvals = Array.isArray(current?.approvals) ? current!.approvals : [];
  const kept = approvals.filter(
    (e) => !(e.event === entry.event && e.command === entry.command),
  );
  return { approvals: [...kept, entry] };
}

export function allowlistHasEntry(
  current: Partial<AllowlistFile> | null,
  event: string,
  command: string,
): boolean {
  const approvals = current?.approvals;
  return (
    Array.isArray(approvals) &&
    approvals.some((e) => e?.event === event && e?.command === command)
  );
}
