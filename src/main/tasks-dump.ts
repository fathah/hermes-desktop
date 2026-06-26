// tasks-dump.ts (main) — the volatile nag-state sidecar for the Tasks-Dump
// inbox. Mirrors active-work-runs.ts: a per-profile JSON file holding one
// TaskNagRecord per chased task. The task ROW (vault/tasks/<id>.md) stays the
// source of truth for identity/routing; this store only tracks how often and
// when to nag, so the 60s nag tick never rewrites markdown (which would thrash
// the note-index and git). Anything that opens the note-index lives elsewhere
// (the scheduler) so this module stays pure-fs and vitest-testable.
import { promises as fs } from "fs";
import { dirname, join } from "path";
import { profileHome, getActiveProfileNameSync } from "./utils";
import type { TaskNagRecord } from "../shared/tasks-dump";

function nagStatePath(profile?: string): string {
  const home = profileHome(profile || getActiveProfileNameSync());
  return join(home, "sps-agent", "task-nag-state.json");
}

async function readRecords(profile?: string): Promise<TaskNagRecord[]> {
  try {
    const raw = await fs.readFile(nagStatePath(profile), "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as TaskNagRecord[]) : [];
  } catch {
    return [];
  }
}

async function writeRecords(
  records: TaskNagRecord[],
  profile?: string,
): Promise<void> {
  const path = nagStatePath(profile);
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(path, JSON.stringify(records, null, 2), "utf-8");
}

export async function listNagRecords(
  profile?: string,
): Promise<TaskNagRecord[]> {
  return readRecords(profile);
}

export async function getNagRecord(
  rowId: string,
  profile?: string,
): Promise<TaskNagRecord | null> {
  const records = await readRecords(profile);
  return records.find((r) => r.rowId === rowId) ?? null;
}

/** Insert a new record or replace the existing one with the same rowId. */
export async function setNagRecord(
  record: TaskNagRecord,
  profile?: string,
): Promise<TaskNagRecord> {
  const records = await readRecords(profile);
  const idx = records.findIndex((r) => r.rowId === record.rowId);
  if (idx < 0) {
    records.push(record);
  } else {
    records[idx] = record;
  }
  await writeRecords(records, profile);
  return record;
}

/** Shallow-merge a patch into an existing record (no-op if absent). */
export async function upsertNagRecord(
  rowId: string,
  patch: Partial<Omit<TaskNagRecord, "rowId">>,
  profile?: string,
): Promise<TaskNagRecord | null> {
  const records = await readRecords(profile);
  const idx = records.findIndex((r) => r.rowId === rowId);
  if (idx < 0) return null;
  const next: TaskNagRecord = { ...records[idx], ...patch, rowId };
  records[idx] = next;
  await writeRecords(records, profile);
  return next;
}

export async function removeNagRecord(
  rowId: string,
  profile?: string,
): Promise<void> {
  const records = await readRecords(profile);
  const remaining = records.filter((r) => r.rowId !== rowId);
  if (remaining.length === records.length) return;
  await writeRecords(remaining, profile);
}
