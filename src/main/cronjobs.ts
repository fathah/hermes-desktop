import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { join } from "path";
import { execFile } from "child_process";
import { HERMES_HOME, HERMES_PYTHON, hermesCliArgs } from "./installer";
import { profileHome } from "./utils";
import {
  isRemoteMode,
  getApiUrl,
  getRemoteAuthHeader,
  normaliseRemoteUrl,
} from "./hermes";
import { getConnectionConfig } from "./config";
import { HIDDEN_SUBPROCESS_OPTIONS } from "./process-options";
import { type CronQualityOpts, augmentPrompt } from "./cron-quality";

export interface CronJob {
  id: string;
  name: string;
  schedule: string;
  prompt: string;
  state: "active" | "paused" | "completed";
  enabled: boolean;
  next_run_at: string | null;
  last_run_at: string | null;
  last_status: string | null;
  last_error: string | null;
  repeat: { times: number | null; completed: number } | null;
  deliver: string[];
  skills: string[];
  script: string | null;
}

function jobsFilePath(profile?: string): string {
  return join(profileHome(profile), "cron", "jobs.json");
}

function normalizeJob(job: Record<string, unknown>): CronJob | null {
  if (!job.id) return null;
  const enabled = job.enabled !== false;
  let state: CronJob["state"] = "active";
  if (job.state === "paused" || !enabled) state = "paused";
  else if (job.state === "completed") state = "completed";
  const schedule = job.schedule as { value?: string } | string | undefined;
  return {
    id: String(job.id),
    name: (job.name as string) || "(unnamed)",
    schedule:
      (job.schedule_display as string) ||
      (typeof schedule === "object" ? schedule?.value : schedule) ||
      "?",
    prompt: (job.prompt as string) || "",
    state,
    enabled,
    next_run_at: (job.next_run_at as string) || null,
    last_run_at: (job.last_run_at as string) || null,
    last_status: (job.last_status as string) || null,
    last_error: (job.last_error as string) || null,
    repeat: (job.repeat as CronJob["repeat"]) || null,
    deliver: Array.isArray(job.deliver)
      ? (job.deliver as string[])
      : job.deliver
        ? [job.deliver as string]
        : ["local"],
    skills:
      (job.skills as string[]) || (job.skill ? [job.skill as string] : []),
    script: (job.script as string) || null,
  };
}

async function remoteFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    ...getRemoteAuthHeader(),
    ...((init.headers as Record<string, string>) || {}),
  };
  const apiUrl = await getCronApiUrl(headers);
  return fetch(`${apiUrl}${path}`, { ...init, headers });
}

async function getCronApiUrl(headers: Record<string, string>): Promise<string> {
  try {
    return getApiUrl();
  } catch (err) {
    const conn = getConnectionConfig();
    if (conn.mode !== "ssh" || !conn.ssh?.localPort) throw err;

    // Schedules/Cron can be opened without first running the Chat path that
    // starts/refreshes the in-process SSH tunnel state. As a narrow fallback for
    // that screen, probe the configured/default local SSH port before using it.
    // This port may be stale if startSshTunnel() had to choose a different free
    // port, so a failed /health check preserves getApiUrl()'s original error
    // instead of sending authenticated API requests to an unrelated service.
    const fallbackUrl = normaliseRemoteUrl(
      `http://127.0.0.1:${conn.ssh.localPort}`,
    );
    if (await isCronFallbackHealthy(fallbackUrl, headers)) return fallbackUrl;
    throw err;
  }
}

async function isCronFallbackHealthy(
  apiUrl: string,
  headers: Record<string, string>,
): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  try {
    const res = await fetch(`${apiUrl}/health`, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function remoteJsonError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error || `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

/**
 * Read cron jobs from the jobs.json file (async to avoid blocking the main process).
 * In remote mode, fetches from the Hermes API server's /api/jobs endpoint instead.
 */
export async function listCronJobs(
  includeDisabled = true,
  profile?: string,
): Promise<CronJob[]> {
  if (isRemoteMode()) {
    try {
      const qs = includeDisabled ? "?include_disabled=true" : "";
      const res = await remoteFetch(`/api/jobs${qs}`);
      if (!res.ok) {
        console.error("[CRON] remote list failed:", await remoteJsonError(res));
        return [];
      }
      const body = (await res.json()) as { jobs?: Record<string, unknown>[] };
      const raw = body.jobs || [];
      const jobs: CronJob[] = [];
      for (const job of raw) {
        const normalized = normalizeJob(job);
        if (!normalized) continue;
        if (!includeDisabled && !normalized.enabled) continue;
        jobs.push(normalized);
      }
      return jobs;
    } catch (err) {
      console.error("[CRON] remote list error:", err);
      return [];
    }
  }

  const filePath = jobsFilePath(profile);
  if (!existsSync(filePath)) return [];

  try {
    const content = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(content);
    const raw = Array.isArray(parsed) ? parsed : parsed.jobs || [];
    const jobs: CronJob[] = [];

    for (const job of raw) {
      const normalized = normalizeJob(job);
      if (!normalized) continue;
      if (!includeDisabled && !normalized.enabled) continue;
      jobs.push(normalized);
    }

    return jobs;
  } catch (err) {
    console.error("[CRON] Failed to read jobs file:", err);
    return [];
  }
}

/**
 * Run a hermes cron CLI command and return the result.
 */
function runCronCommand(
  args: string[],
  profile?: string,
): Promise<{ success: boolean; output: string; error?: string }> {
  const cliArgs = hermesCliArgs();
  if (profile && profile !== "default") {
    cliArgs.push("-p", profile);
  }
  cliArgs.push("cron", ...args);

  return new Promise((resolve) => {
    execFile(
      HERMES_PYTHON,
      cliArgs,
      {
        cwd: join(HERMES_HOME, "hermes-agent"),
        timeout: 15000,
        ...HIDDEN_SUBPROCESS_OPTIONS,
      },
      (err, stdout, stderr) => {
        if (err) {
          resolve({
            success: false,
            output: stdout || "",
            error: stderr || err.message,
          });
        } else {
          resolve({ success: true, output: stdout || "" });
        }
      },
    );
  });
}

/**
 * Best-effort: find the id of the job just created by diffing the job set
 * (createCronJob has no id in its return). Single-writer desktop, so a one-job
 * diff is reliable; falls back to the newest job matching `name`.
 */
async function findNewJobId(
  beforeIds: Set<string> | null,
  name?: string,
  profile?: string,
): Promise<string | null> {
  try {
    const after = await listCronJobs(true, profile);
    const fresh = beforeIds ? after.filter((j) => !beforeIds.has(j.id)) : after;
    if (fresh.length === 1) return fresh[0].id;
    if (name) {
      const named = [...fresh].reverse().find((j) => j.name === name);
      if (named) return named.id;
    }
    return fresh.length ? fresh[fresh.length - 1].id : null;
  } catch {
    return null;
  }
}

export async function createCronJob(
  schedule: string,
  prompt?: string,
  name?: string,
  deliver?: string,
  profile?: string,
  opts?: CronQualityOpts,
): Promise<{ success: boolean; error?: string; paused?: boolean }> {
  const finalPrompt = augmentPrompt(prompt ?? "", opts);

  // For the first-run-manual gate we need the new job's id (which create does
  // not return), so snapshot the existing ids first.
  let beforeIds: Set<string> | null = null;
  if (opts?.firstRunManual) {
    try {
      beforeIds = new Set((await listCronJobs(true, profile)).map((j) => j.id));
    } catch {
      beforeIds = null;
    }
  }

  let created: { success: boolean; error?: string };
  if (isRemoteMode()) {
    try {
      const res = await remoteFetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name || "",
          schedule,
          prompt: finalPrompt,
          deliver: deliver || "local",
        }),
      });
      created = res.ok
        ? { success: true }
        : { success: false, error: await remoteJsonError(res) };
    } catch (err) {
      created = { success: false, error: (err as Error).message };
    }
  } else {
    const args = ["create", schedule];
    if (finalPrompt) args.push(finalPrompt);
    if (name) args.push("--name", name);
    if (deliver) args.push("--deliver", deliver);
    const result = await runCronCommand(args, profile);
    created = { success: result.success, error: result.error };
  }

  if (!created.success) return created;

  // First-run-manual: pause the new job so the operator reviews run #1 before
  // trusting it. Best-effort — if the id can't be resolved, leave it active.
  let paused = false;
  if (opts?.firstRunManual) {
    const newId = await findNewJobId(beforeIds, name, profile);
    if (newId) {
      const res = await pauseCronJob(newId, profile);
      paused = res.success;
    }
  }
  return { success: true, paused };
}

export async function removeCronJob(
  jobId: string,
  profile?: string,
): Promise<{ success: boolean; error?: string }> {
  if (!jobId) return { success: false, error: "Missing job ID" };
  if (isRemoteMode()) {
    try {
      const res = await remoteFetch(`/api/jobs/${encodeURIComponent(jobId)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        return { success: false, error: await remoteJsonError(res) };
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }
  const result = await runCronCommand(["remove", jobId], profile);
  return { success: result.success, error: result.error };
}

async function remoteJobAction(
  jobId: string,
  action: "pause" | "resume" | "run",
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await remoteFetch(
      `/api/jobs/${encodeURIComponent(jobId)}/${action}`,
      { method: "POST" },
    );
    if (!res.ok) {
      return { success: false, error: await remoteJsonError(res) };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function pauseCronJob(
  jobId: string,
  profile?: string,
): Promise<{ success: boolean; error?: string }> {
  if (!jobId) return { success: false, error: "Missing job ID" };
  if (isRemoteMode()) return remoteJobAction(jobId, "pause");
  const result = await runCronCommand(["pause", jobId], profile);
  return { success: result.success, error: result.error };
}

export async function resumeCronJob(
  jobId: string,
  profile?: string,
): Promise<{ success: boolean; error?: string }> {
  if (!jobId) return { success: false, error: "Missing job ID" };
  if (isRemoteMode()) return remoteJobAction(jobId, "resume");
  const result = await runCronCommand(["resume", jobId], profile);
  return { success: result.success, error: result.error };
}

export async function triggerCronJob(
  jobId: string,
  profile?: string,
): Promise<{ success: boolean; error?: string }> {
  if (!jobId) return { success: false, error: "Missing job ID" };
  if (isRemoteMode()) return remoteJobAction(jobId, "run");
  const result = await runCronCommand(["run", jobId], profile);
  return { success: result.success, error: result.error };
}
