// scheduled-research.ts — the Scheduled Research engine (main process).
//
// Keeps a LIVING wiki page per topic current on a recurring schedule. The
// scheduler runs in the desktop main process (deterministic + testable) and
// catches up on launch; for each due schedule it: runs a web-grounded research
// turn, smart-merges the findings into the topic's page (op:"update", only on
// meaningful change), and drops the proposed merge into a pending queue that the
// renderer reviews + applies through the normal commitChangeset path. This
// routing (pending queue → renderer commit) keeps it correct in the default
// `blob` storage mode, where direct vault writes are not read back.
//
// Persistence (app metadata, NOT the overridable vault) lives under
// <profileHome>/sps-agent/: scheduled-research.json (registry),
// scheduled-research/pending/*.json (proposed merges), scheduled-research.jsonl
// (run history). Pure scheduling/validation logic lives in
// src/shared/scheduledResearch.ts (unit-tested); this module owns I/O + gateway.
import { promises as fs } from "fs";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";
import type { BrowserWindow } from "electron";
import { getApiUrl, getRemoteAuthHeader } from "./hermes";
import { resolveSpsVaultDir } from "./sps-storage";
import { profileHome } from "./utils";
import {
  readWikiSchema,
  parseChangeset,
  buildScheduledMergeMessages,
  type IngestChangeset,
} from "./sps-ingest";
import { readPageMarkdownFrom } from "./sps-vault";
import {
  buildResearchPrompt,
  capResearchBrief,
  hasUsableSources,
} from "../shared/research";
import {
  isDue,
  slugForTopic,
  validateScheduleInput,
  MAX_SCHEDULES,
  type ScheduledResearchItem,
  type ScheduleInput,
} from "../shared/scheduledResearch";

export type RunOutcome = "changed" | "no-change" | "no-sources" | "error";

export interface PendingUpdate {
  id: string;
  scheduleId: string;
  topic: string;
  pageId: string;
  ts: number;
  summary: string;
  changeset: IngestChangeset;
}

// ── paths (fixed app-metadata dir, not the overridable vault) ────────────────
function srDir(profile?: string): string {
  return join(profileHome(profile), "sps-agent");
}
function registryFile(profile?: string): string {
  return join(srDir(profile), "scheduled-research.json");
}
function pendingDir(profile?: string): string {
  return join(srDir(profile), "scheduled-research", "pending");
}
function historyFile(profile?: string): string {
  return join(srDir(profile), "scheduled-research.jsonl");
}

// ── registry CRUD ────────────────────────────────────────────────────────────
function loadRegistry(profile?: string): {
  schedules: ScheduledResearchItem[];
} {
  try {
    const raw = readFileSync(registryFile(profile), "utf-8");
    const data = JSON.parse(raw);
    const schedules = Array.isArray(data?.schedules) ? data.schedules : [];
    return { schedules };
  } catch {
    return { schedules: [] };
  }
}

function saveRegistry(
  reg: { schedules: ScheduledResearchItem[] },
  profile?: string,
): void {
  const dir = srDir(profile);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(registryFile(profile), JSON.stringify(reg, null, 2));
}

export function listSchedules(profile?: string): ScheduledResearchItem[] {
  return loadRegistry(profile).schedules;
}

let _idSeq = 0;
function newId(): string {
  _idSeq += 1;
  return `sr_${Date.now().toString(36)}_${_idSeq}`;
}

export function createSchedule(
  input: ScheduleInput,
  profile?: string,
): { ok: boolean; item?: ScheduledResearchItem; error?: string } {
  const err = validateScheduleInput(input);
  if (err) return { ok: false, error: err };
  const reg = loadRegistry(profile);
  if (reg.schedules.length >= MAX_SCHEDULES) {
    return { ok: false, error: `At most ${MAX_SCHEDULES} schedules.` };
  }
  const pageId = slugForTopic(input.topic);
  if (reg.schedules.some((s) => s.pageId === pageId)) {
    return { ok: false, error: "A schedule for that topic already exists." };
  }
  const item: ScheduledResearchItem = {
    id: newId(),
    topic: input.topic.trim(),
    pageId,
    cadence: input.cadence,
    hour: input.hour ?? 8,
    autoApply: input.autoApply ?? false,
    telegramPush: input.telegramPush ?? false,
    enabled: true,
    createdAt: Date.now(),
    lastRunAt: 0,
    lastChangeHash: "",
  };
  reg.schedules.push(item);
  saveRegistry(reg, profile);
  return { ok: true, item };
}

export function updateSchedule(
  id: string,
  patch: Partial<
    Pick<
      ScheduledResearchItem,
      "cadence" | "hour" | "enabled" | "autoApply" | "telegramPush"
    >
  >,
  profile?: string,
): { ok: boolean; error?: string } {
  const reg = loadRegistry(profile);
  const item = reg.schedules.find((s) => s.id === id);
  if (!item) return { ok: false, error: "Schedule not found." };
  if (patch.cadence !== undefined) item.cadence = patch.cadence;
  if (patch.hour !== undefined) item.hour = patch.hour;
  if (patch.enabled !== undefined) item.enabled = patch.enabled;
  if (patch.autoApply !== undefined) item.autoApply = patch.autoApply;
  if (patch.telegramPush !== undefined) item.telegramPush = patch.telegramPush;
  saveRegistry(reg, profile);
  return { ok: true };
}

export function deleteSchedule(id: string, profile?: string): { ok: boolean } {
  const reg = loadRegistry(profile);
  reg.schedules = reg.schedules.filter((s) => s.id !== id);
  saveRegistry(reg, profile);
  return { ok: true };
}

// ── pending queue ────────────────────────────────────────────────────────────
export async function listPending(profile?: string): Promise<PendingUpdate[]> {
  const dir = pendingDir(profile);
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const out: PendingUpdate[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      const raw = await fs.readFile(join(dir, name), "utf-8");
      out.push(JSON.parse(raw) as PendingUpdate);
    } catch {
      /* skip unreadable */
    }
  }
  return out.sort((a, b) => a.ts - b.ts);
}

export async function removePending(
  id: string,
  profile?: string,
): Promise<{ ok: boolean }> {
  // id is validated to a safe filename stem.
  if (!/^[A-Za-z0-9_]+$/.test(id)) return { ok: false };
  try {
    await fs.unlink(join(pendingDir(profile), `${id}.json`));
  } catch {
    /* already gone */
  }
  return { ok: true };
}

async function writePending(p: PendingUpdate, profile?: string): Promise<void> {
  const dir = pendingDir(profile);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(join(dir, `${p.id}.json`), JSON.stringify(p, null, 2));
}

// ── run history ──────────────────────────────────────────────────────────────
function recordHistory(
  scheduleId: string,
  outcome: RunOutcome,
  summary: string,
  profile?: string,
): void {
  try {
    const dir = srDir(profile);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const line = JSON.stringify({
      scheduleId,
      ts: Date.now(),
      outcome,
      summary,
    });
    writeFileSync(historyFile(profile), line + "\n", { flag: "a" });
  } catch {
    /* best-effort */
  }
}

// ── gateway call ─────────────────────────────────────────────────────────────
/** Minimal JSON extractor (mirrors sps-agent.extractJson, kept local to avoid a
 *  heavy import). Strips ```json fences, then slices the outer object. */
function extractJson(text: string): unknown {
  const t = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  try {
    return JSON.parse(t);
  } catch {
    const s = t.indexOf("{");
    const e = t.lastIndexOf("}");
    if (s >= 0 && e > s) {
      try {
        return JSON.parse(t.slice(s, e + 1));
      } catch {
        /* fall through */
      }
    }
    return null;
  }
}

async function gatewayChat(
  messages: Array<{ role: string; content: string }>,
  maxTokens: number,
  profile?: string,
): Promise<string> {
  const url = `${getApiUrl(profile)}/v1/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getRemoteAuthHeader() },
    signal: AbortSignal.timeout(240000),
    body: JSON.stringify({
      model: "hermes-agent",
      stream: false,
      max_tokens: maxTokens,
      messages,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`gateway ${res.status}: ${body.slice(0, 160)}`);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return data?.choices?.[0]?.message?.content ?? "";
}

// ── the run ──────────────────────────────────────────────────────────────────
function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/** Execute one schedule: research → guard → smart-merge → pending queue. Always
 *  stamps lastRunAt (success or failure) so a transient outage doesn't hammer
 *  the gateway every tick; the user can "Run now" to retry sooner. */
export async function runScheduledResearch(
  item: ScheduledResearchItem,
  getWindow?: () => BrowserWindow | null,
  profile?: string,
): Promise<{ outcome: RunOutcome; summary?: string }> {
  let outcome: RunOutcome = "error";
  let summary = "";
  try {
    const vaultDir = resolveSpsVaultDir(profile);
    const schema = await readWikiSchema(vaultDir);

    // 1) research turn (web-grounded, cited brief)
    const brief = await gatewayChat(
      [{ role: "user", content: buildResearchPrompt(item.topic) }],
      3000,
      profile,
    );
    if (!hasUsableSources(brief)) {
      outcome = "no-sources";
      summary = "No web sources returned.";
      return { outcome, summary };
    }
    const cappedBrief = capResearchBrief(brief);

    // 2) cheap dedupe: identical brief to the last committed one ⇒ no change
    const briefHash = sha256(cappedBrief);
    if (item.lastChangeHash && item.lastChangeHash === briefHash) {
      outcome = "no-change";
      summary = "No new findings.";
      stampHash(item, briefHash, profile);
      return { outcome, summary };
    }

    // 3) read the living page (null on first run)
    let current: string | null = null;
    try {
      current = await readPageMarkdownFrom(vaultDir, item.pageId);
    } catch {
      current = null;
    }

    // 4) smart-merge — 0 pages ⇒ no meaningful change
    const dateStr = new Date().toISOString().slice(0, 10);
    const messages = buildScheduledMergeMessages(
      schema,
      item.topic,
      item.pageId,
      current,
      cappedBrief,
      dateStr,
      [],
    );
    const content = await gatewayChat(messages, 4096, profile);
    const changeset = parseChangeset(extractJson(content));
    if (!changeset || changeset.pages.length === 0) {
      outcome = "no-change";
      summary = "No meaningful change.";
      stampHash(item, briefHash, profile);
      return { outcome, summary };
    }

    // 5) force the stable pageId + correct op; keep one page
    const op: "create" | "update" = current ? "update" : "create";
    const page = { ...changeset.pages[0], pageId: item.pageId, op };
    const merged: IngestChangeset = {
      summary: changeset.summary || `Updated ${item.topic}`,
      pages: [page],
      captures: [],
      memory: [],
    };

    // 6) enqueue the proposed merge for renderer review/apply
    const ts = Date.now();
    const pending: PendingUpdate = {
      id: `${item.id}__${ts}`,
      scheduleId: item.id,
      topic: item.topic,
      pageId: item.pageId,
      ts,
      summary: merged.summary,
      changeset: merged,
    };
    await writePending(pending, profile);
    stampHash(item, briefHash, profile);

    outcome = "changed";
    summary = merged.summary;
    getWindow?.()?.webContents.send("scheduled-research-update", {
      scheduleId: item.id,
      topic: item.topic,
      summary,
    });
    return { outcome, summary };
  } catch (err) {
    outcome = "error";
    summary = err instanceof Error ? err.message : "run failed";
    stampRun(item.id, profile); // still stamp lastRunAt to avoid retry storms
    return { outcome, summary };
  } finally {
    recordHistory(item.id, outcome, summary, profile);
  }
}

/** Stamp lastRunAt + lastChangeHash for an item by id. */
function stampHash(
  item: ScheduledResearchItem,
  hash: string,
  profile?: string,
): void {
  const reg = loadRegistry(profile);
  const found = reg.schedules.find((s) => s.id === item.id);
  if (!found) return;
  found.lastRunAt = Date.now();
  found.lastChangeHash = hash;
  saveRegistry(reg, profile);
}

function stampRun(id: string, profile?: string): void {
  const reg = loadRegistry(profile);
  const found = reg.schedules.find((s) => s.id === id);
  if (!found) return;
  found.lastRunAt = Date.now();
  saveRegistry(reg, profile);
}

/** Run a schedule immediately regardless of its cadence (the UI "Run now"). */
export async function triggerScheduleNow(
  id: string,
  getWindow?: () => BrowserWindow | null,
  profile?: string,
): Promise<{ outcome: RunOutcome; summary?: string; error?: string }> {
  const item = loadRegistry(profile).schedules.find((s) => s.id === id);
  if (!item) return { outcome: "error", error: "Schedule not found." };
  return runScheduledResearch(item, getWindow, profile);
}

// ── scheduler loop ───────────────────────────────────────────────────────────
let _timer: ReturnType<typeof setInterval> | null = null;
let _running = false;
let _getWindow: (() => BrowserWindow | null) | null = null;

async function tick(): Promise<void> {
  if (_running) return;
  _running = true;
  try {
    const now = new Date();
    const due = loadRegistry().schedules.filter((s) => isDue(s, now));
    for (const s of due) {
      await runScheduledResearch(s, _getWindow ?? undefined);
    }
  } catch {
    /* never let a tick throw kill the loop */
  } finally {
    _running = false;
  }
}

/** Start the scheduler: a catch-up pass shortly after launch, then hourly-ish
 *  ticks (every 60s the due-check is cheap; runs only fire per cadence). */
export function startScheduledResearch(
  getWindow: () => BrowserWindow | null,
): void {
  _getWindow = getWindow;
  // Delay the first pass so the gateway has a moment to be reachable on launch.
  setTimeout(() => void tick(), 20000);
  _timer = setInterval(() => void tick(), 60000);
  _timer.unref?.();
}

export function stopScheduledResearch(): void {
  if (_timer) clearInterval(_timer);
  _timer = null;
}
