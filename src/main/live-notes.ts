// live-notes.ts — Live Notes engine (main process).
//
// Registry under sps-agent/live-notes.json; proposed body rewrites go to
// live-notes/pending/*.json for the renderer to commit via ingestCommitPage
// (blob-mode safe). Never write page bodies with writeFile here.
import { createHash } from "crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import type { BrowserWindow } from "electron";
import { gatewayChat } from "./gateway-chat";
import { resolveSpsVaultDir } from "./sps-storage";
import { readPageMarkdownFrom } from "./sps-vault";
import { profileHome, safeWriteFile } from "./utils";
import { splitSpsFrontmatter } from "../shared/sps-frontmatter";
import {
  backoffRemainingMs,
  buildLiveNoteRunMessages,
  dueTimedTrigger,
  emailEventMatches,
  emptyLiveNotesRegistry,
  normalizeRegistry,
  normalizeTriggers,
  parseLiveNoteModelOutput,
  validateLiveNoteInput,
  type LiveNoteEmailEvent,
  type LiveNoteInput,
  type LiveNoteItem,
  type LiveNotePending,
  type LiveNoteRunResult,
  type LiveNoteTriggerKind,
  type LiveNotesRegistry,
  MAX_LIVE_NOTES,
} from "../shared/liveNotes";

type GetWindow = () => BrowserWindow | null | undefined;

const runningByNote = new Set<string>();
let _idSeq = 0;
let windowGetter: GetWindow | null = null;

/** Called from IPC registration so email/scheduler ticks can notify the UI. */
export function setLiveNotesWindowGetter(getter: GetWindow): void {
  windowGetter = getter;
}

function resolveWindow(getWindow?: GetWindow): GetWindow | undefined {
  return getWindow ?? windowGetter ?? undefined;
}

function newLiveNoteId(): string {
  _idSeq += 1;
  return `ln_${Date.now().toString(36)}_${_idSeq}`;
}

function newPendingId(liveNoteId: string): string {
  return `${liveNoteId}__${Date.now()}`;
}

function lnDir(profile?: string): string {
  return join(profileHome(profile), "sps-agent");
}

function registryFile(profile?: string): string {
  return join(lnDir(profile), "live-notes.json");
}

function pendingDir(profile?: string): string {
  return join(lnDir(profile), "live-notes", "pending");
}

function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function loadRegistry(profile?: string): LiveNotesRegistry {
  try {
    const raw = readFileSync(registryFile(profile), "utf-8");
    return normalizeRegistry(JSON.parse(raw));
  } catch {
    return emptyLiveNotesRegistry();
  }
}

function saveRegistry(reg: LiveNotesRegistry, profile?: string): void {
  ensureDir(lnDir(profile));
  safeWriteFile(registryFile(profile), JSON.stringify(reg, null, 2));
}

function patchItem(
  id: string,
  patch: Partial<LiveNoteItem>,
  profile?: string,
): LiveNoteItem | null {
  const reg = loadRegistry(profile);
  const idx = reg.items.findIndex((i) => i.id === id);
  if (idx < 0) return null;
  const next = { ...reg.items[idx], ...patch, updatedAt: Date.now() };
  reg.items[idx] = next;
  saveRegistry(reg, profile);
  return next;
}

export function listLiveNotes(profile?: string): LiveNoteItem[] {
  return loadRegistry(profile).items;
}

export function getLiveNoteByPageId(
  pageId: string,
  profile?: string,
): LiveNoteItem | null {
  const id = String(pageId || "").trim();
  if (!id) return null;
  return loadRegistry(profile).items.find((i) => i.pageId === id) ?? null;
}

export function getLiveNoteById(
  id: string,
  profile?: string,
): LiveNoteItem | null {
  return loadRegistry(profile).items.find((i) => i.id === id) ?? null;
}

export function upsertLiveNote(
  input: LiveNoteInput,
  profile?: string,
): { ok: boolean; item?: LiveNoteItem; error?: string } {
  const err = validateLiveNoteInput(input);
  if (err) return { ok: false, error: err };
  const pageId = input.pageId.trim();
  const objective = input.objective.trim();
  const reg = loadRegistry(profile);
  const existing = reg.items.find((i) => i.pageId === pageId);
  const now = Date.now();
  if (existing) {
    const updated: LiveNoteItem = {
      ...existing,
      objective: objective.slice(0, 4000),
      active:
        input.active !== undefined ? input.active !== false : existing.active,
      autoApply:
        input.autoApply !== undefined
          ? input.autoApply !== false
          : existing.autoApply,
      triggers:
        input.triggers !== undefined
          ? normalizeTriggers(input.triggers)
          : existing.triggers,
      model:
        input.model !== undefined
          ? input.model.trim().slice(0, 80) || undefined
          : existing.model,
      updatedAt: now,
    };
    const idx = reg.items.findIndex((i) => i.id === existing.id);
    reg.items[idx] = updated;
    saveRegistry(reg, profile);
    return { ok: true, item: updated };
  }
  if (reg.items.length >= MAX_LIVE_NOTES) {
    return { ok: false, error: `At most ${MAX_LIVE_NOTES} live notes.` };
  }
  const item: LiveNoteItem = {
    id: newLiveNoteId(),
    pageId,
    objective: objective.slice(0, 4000),
    active: input.active !== false,
    autoApply: input.autoApply !== false,
    triggers: normalizeTriggers(input.triggers ?? {}),
    ...(input.model?.trim() ? { model: input.model.trim().slice(0, 80) } : {}),
    createdAt: now,
    updatedAt: now,
  };
  reg.items.push(item);
  saveRegistry(reg, profile);
  return { ok: true, item };
}

export function setLiveNoteActive(
  pageId: string,
  active: boolean,
  profile?: string,
): { ok: boolean; item?: LiveNoteItem; error?: string } {
  const item = getLiveNoteByPageId(pageId, profile);
  if (!item) return { ok: false, error: "Live note not found." };
  const next = patchItem(item.id, { active: !!active }, profile);
  return next
    ? { ok: true, item: next }
    : { ok: false, error: "Update failed." };
}

export function deleteLiveNote(
  pageId: string,
  profile?: string,
): { ok: boolean; error?: string } {
  const reg = loadRegistry(profile);
  const before = reg.items.length;
  reg.items = reg.items.filter((i) => i.pageId !== pageId);
  if (reg.items.length === before) {
    return { ok: false, error: "Live note not found." };
  }
  saveRegistry(reg, profile);
  return { ok: true };
}

function titleFromMarkdown(markdown: string, pageId: string): string {
  const { frontmatter, body } = splitSpsFrontmatter(markdown);
  if (frontmatter) {
    for (const line of frontmatter.split("\n")) {
      const m = /^title:\s*(.*)$/.exec(line.trim());
      if (m) {
        const raw = m[1].trim();
        try {
          const parsed = JSON.parse(raw);
          if (typeof parsed === "string" && parsed.trim()) return parsed.trim();
        } catch {
          /* plain */
        }
        const unquoted = raw.replace(/^["']|["']$/g, "").trim();
        if (unquoted) return unquoted;
      }
    }
  }
  const h1 = /^#\s+(.+)$/m.exec(body);
  if (h1) return h1[1].trim();
  return pageId;
}

function bodyFromMarkdown(markdown: string): string {
  const { body } = splitSpsFrontmatter(markdown);
  return body;
}

async function writePending(
  pending: LiveNotePending,
  profile?: string,
): Promise<void> {
  const dir = pendingDir(profile);
  ensureDir(dir);
  // One pending per live note: drop older files for same liveNoteId
  try {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".json")) continue;
      try {
        const raw = JSON.parse(readFileSync(join(dir, name), "utf-8"));
        if (raw?.liveNoteId === pending.liveNoteId) {
          unlinkSync(join(dir, name));
        }
      } catch {
        /* skip bad */
      }
    }
  } catch {
    /* empty */
  }
  writeFileSync(
    join(dir, `${pending.id}.json`),
    JSON.stringify(pending, null, 2),
  );
}

export function listLiveNotePending(profile?: string): LiveNotePending[] {
  const dir = pendingDir(profile);
  if (!existsSync(dir)) return [];
  const out: LiveNotePending[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    try {
      const raw = JSON.parse(readFileSync(join(dir, name), "utf-8"));
      if (!raw || typeof raw !== "object") continue;
      if (typeof raw.id !== "string" || typeof raw.pageId !== "string")
        continue;
      if (typeof raw.proposedBody !== "string") continue;
      out.push(raw as LiveNotePending);
    } catch {
      /* skip */
    }
  }
  out.sort((a, b) => a.createdAt - b.createdAt);
  return out;
}

export function dismissLiveNotePending(
  id: string,
  profile?: string,
): { ok: boolean } {
  const path = join(pendingDir(profile), `${id}.json`);
  try {
    unlinkSync(path);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export function ackLiveNoteApplied(
  pendingId: string,
  liveNoteId: string,
  summary: string,
  profile?: string,
): { ok: boolean } {
  dismissLiveNotePending(pendingId, profile);
  const item = getLiveNoteById(liveNoteId, profile);
  if (!item) return { ok: true };
  patchItem(
    liveNoteId,
    {
      lastRunAt: Date.now(),
      lastRunSummary: summary.slice(0, 500),
      lastRunError: null,
    },
    profile,
  );
  return { ok: true };
}

export async function runLiveNote(
  pageIdOrId: string,
  trigger: LiveNoteTriggerKind,
  opts?: {
    profile?: string;
    getWindow?: GetWindow;
    email?: LiveNoteEmailEvent;
    bypassBackoff?: boolean;
  },
): Promise<LiveNoteRunResult> {
  const profile = opts?.profile;
  const item =
    getLiveNoteByPageId(pageIdOrId, profile) ??
    getLiveNoteById(pageIdOrId, profile);
  if (!item) return { ok: false, error: "Live note not found." };
  if (!item.active && trigger !== "manual") {
    return { ok: true, action: "skipped", summary: "Inactive." };
  }
  if (runningByNote.has(item.id)) {
    return { ok: false, error: "Already running." };
  }
  const bypass = opts?.bypassBackoff === true || trigger === "manual";
  if (!bypass) {
    const remain = backoffRemainingMs(item.lastAttemptAt);
    if (remain > 0) {
      return {
        ok: true,
        action: "skipped",
        summary: `Backoff ${Math.ceil(remain / 1000)}s remaining.`,
      };
    }
  }

  runningByNote.add(item.id);
  const runId = `run_${Date.now().toString(36)}`;
  const notify = resolveWindow(opts?.getWindow);
  patchItem(item.id, { lastAttemptAt: Date.now(), lastRunId: runId }, profile);

  try {
    const vaultDir = resolveSpsVaultDir(profile);
    let markdown = "";
    try {
      markdown = (await readPageMarkdownFrom(vaultDir, item.pageId)) ?? "";
    } catch {
      markdown = "";
    }
    const currentBody = bodyFromMarkdown(markdown);
    const title = titleFromMarkdown(markdown, item.pageId);
    const beforeHash = sha256(currentBody);
    const dateStr = new Date().toISOString().slice(0, 10);
    const messages = buildLiveNoteRunMessages({
      objective: item.objective,
      pageId: item.pageId,
      title,
      currentBody,
      trigger,
      email: opts?.email,
      dateStr,
    });
    const content = await gatewayChat(messages, 4096, profile);
    const parsed = parseLiveNoteModelOutput(content);
    if (parsed.action === "no_update" || !parsed.body) {
      const summary = "No material update.";
      patchItem(
        item.id,
        {
          lastRunAt: Date.now(),
          lastRunSummary: summary,
          lastRunError: null,
        },
        profile,
      );
      notify?.()?.webContents.send("live-note-run-status", {
        liveNoteId: item.id,
        pageId: item.pageId,
        action: "no_update",
        summary,
      });
      return { ok: true, action: "no_update", summary };
    }

    // Unchanged body
    if (sha256(parsed.body) === beforeHash) {
      const summary = "No material update.";
      patchItem(
        item.id,
        {
          lastRunAt: Date.now(),
          lastRunSummary: summary,
          lastRunError: null,
        },
        profile,
      );
      return { ok: true, action: "no_update", summary };
    }

    const pending: LiveNotePending = {
      id: newPendingId(item.id),
      liveNoteId: item.id,
      pageId: item.pageId,
      title,
      createdAt: Date.now(),
      trigger,
      contentBeforeHash: beforeHash,
      proposedBody: parsed.body,
      summary: `Updated from ${trigger}`.slice(0, 200),
      emailCaptureId: opts?.email?.captureId,
      autoApply: item.autoApply,
    };
    await writePending(pending, profile);
    // lastRunAt set on ack after apply so failed apply can retry windows
    patchItem(
      item.id,
      {
        lastRunSummary: pending.summary,
        lastRunError: null,
      },
      profile,
    );
    notify?.()?.webContents.send("live-note-pending", {
      pendingId: pending.id,
      liveNoteId: item.id,
      pageId: item.pageId,
      autoApply: pending.autoApply,
      summary: pending.summary,
    });
    notify?.()?.webContents.send("live-note-run-status", {
      liveNoteId: item.id,
      pageId: item.pageId,
      action: "replace",
      summary: pending.summary,
      pendingId: pending.id,
    });
    return {
      ok: true,
      action: "replace",
      summary: pending.summary,
      pendingId: pending.id,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Live note run failed";
    patchItem(item.id, { lastRunError: message.slice(0, 500) }, profile);
    notify?.()?.webContents.send("live-note-run-status", {
      liveNoteId: item.id,
      pageId: item.pageId,
      action: "error",
      error: message,
    });
    return { ok: false, error: message };
  } finally {
    runningByNote.delete(item.id);
  }
}

/** Scheduler tick: run due timed live notes (app-open). */
export async function tickLiveNotes(profile?: string): Promise<void> {
  const now = new Date();
  const items = listLiveNotes(profile).filter((i) => i.active);
  for (const item of items) {
    const due = dueTimedTrigger(item.triggers, item.lastRunAt, now);
    if (!due) continue;
    if (backoffRemainingMs(item.lastAttemptAt) > 0) continue;
    if (runningByNote.has(item.id)) continue;
    // Fire and continue; serialize per note via runningByNote
    void runLiveNote(item.pageId, due, { profile });
  }
}

export type EmailEnqueueInput = {
  subject: string;
  bodyPreview: string;
  from: string;
  triageLabel?: string;
  digest?: boolean;
  captureId?: string;
  profile?: string;
};

/**
 * After email capture: match active live notes and kick runs.
 * Never throws — capture path must stay isolated.
 */
export function enqueueLiveNotesForEmailEvent(input: EmailEnqueueInput): void {
  try {
    const event: LiveNoteEmailEvent = {
      subject: input.subject || "",
      bodyPreview: input.bodyPreview || "",
      from: input.from || "",
      triageLabel: input.triageLabel,
      digest: input.digest === true,
      captureId: input.captureId,
    };
    const items = listLiveNotes(input.profile).filter(
      (i) => i.active && i.triggers.eventMatch,
    );
    for (const item of items) {
      if (!emailEventMatches(item.triggers.eventMatch, event)) continue;
      void runLiveNote(item.pageId, "email", {
        profile: input.profile,
        email: event,
      });
    }
  } catch {
    /* never break email capture */
  }
}

/** Test helper: replace registry contents. */
export function __setRegistryForTests(
  reg: LiveNotesRegistry,
  profile?: string,
): void {
  saveRegistry(normalizeRegistry(reg), profile);
}

export function __clearRunningForTests(): void {
  runningByNote.clear();
}
