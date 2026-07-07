import { promises as fs } from "fs";
import { join } from "path";
import {
  profileHome,
  getActiveProfileNameSync,
  safeWriteFileAsync,
} from "./utils";
import type {
  ActiveWorkCreateInput,
  ActiveWorkCriterion,
  ActiveWorkPatch,
  ActiveWorkRun,
} from "../shared/active-work";

function activeWorkPath(profile?: string): string {
  return join(
    profileHome(profile || getActiveProfileNameSync()),
    "sps-agent",
    "active-work-runs.json",
  );
}

function id(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeCriteria(
  criteria: ActiveWorkCreateInput["criteria"] = [],
): ActiveWorkCriterion[] {
  return criteria.map((c) => ({
    id: id("crit"),
    text: c.text,
    done: Boolean(c.done),
  }));
}

async function readRuns(profile?: string): Promise<ActiveWorkRun[]> {
  try {
    const raw = await fs.readFile(activeWorkPath(profile), "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ActiveWorkRun[]) : [];
  } catch {
    return [];
  }
}

async function writeRuns(
  runs: ActiveWorkRun[],
  profile?: string,
): Promise<void> {
  const p = activeWorkPath(profile);
  await safeWriteFileAsync(p, JSON.stringify(runs, null, 2));
}

export async function listActiveWorkRuns(
  profile?: string,
): Promise<ActiveWorkRun[]> {
  const runs = await readRuns(profile);
  return runs.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getActiveWorkRun(
  runId: string,
  profile?: string,
): Promise<ActiveWorkRun | null> {
  const runs = await readRuns(profile);
  return runs.find((r) => r.id === runId) ?? null;
}

export async function createActiveWorkRun(
  input: ActiveWorkCreateInput,
  profile?: string,
): Promise<ActiveWorkRun> {
  const now = Date.now();
  const run: ActiveWorkRun = {
    id: id("work"),
    source: input.source,
    status: "running",
    title: input.title,
    goal: input.goal,
    pageId: input.pageId,
    pageTitle: input.pageTitle,
    sessionId: input.sessionId,
    clientRunId: input.clientRunId,
    taskId: input.taskId,
    criteria: normalizeCriteria(input.criteria),
    artifacts: [],
    createdAt: now,
    updatedAt: now,
  };
  const runs = await readRuns(profile);
  await writeRuns([run, ...runs], profile);
  return run;
}

export async function updateActiveWorkRun(
  runId: string,
  patch: ActiveWorkPatch,
  profile?: string,
): Promise<ActiveWorkRun | null> {
  const runs = await readRuns(profile);
  const idx = runs.findIndex((r) => r.id === runId);
  if (idx < 0) return null;
  const current = runs[idx];
  const next: ActiveWorkRun = {
    ...current,
    ...patch,
    lastTool:
      patch.lastTool === null
        ? undefined
        : (patch.lastTool ?? current.lastTool),
    blockerReason:
      patch.blockerReason === null
        ? undefined
        : (patch.blockerReason ?? current.blockerReason),
    summary:
      patch.summary === null ? undefined : (patch.summary ?? current.summary),
    error: patch.error === null ? undefined : (patch.error ?? current.error),
    updatedAt: Date.now(),
  };
  runs[idx] = next;
  await writeRuns(runs, profile);
  return next;
}
