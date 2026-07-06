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
import { sshRunCron } from "./ssh-remote";
import type { SshConfig } from "./ssh-tunnel";

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

function parseCronState(raw: string | undefined): CronJob["state"] {
  const state = (raw || "").trim().toLowerCase();
  if (state === "paused") return "paused";
  if (state === "completed") return "completed";
  return "active";
}

function parseRepeat(value: string | undefined): CronJob["repeat"] {
  const raw = (value || "").trim();
  if (!raw) return null;
  if (raw === "∞" || raw.toLowerCase() === "infinite") {
    return { times: null, completed: 0 };
  }
  const fraction = raw.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (fraction) {
    return {
      completed: Number(fraction[1]),
      times: Number(fraction[2]),
    };
  }
  const times = Number(raw);
  return Number.isFinite(times) ? { times, completed: 0 } : null;
}

function splitCsvish(value: string | undefined): string[] {
  const raw = (value || "").trim();
  if (!raw) return [];
  return raw
    .split(/,\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseLastRun(value: string | undefined): {
  last_run_at: string | null;
  last_status: string | null;
} {
  const raw = (value || "").trim();
  if (!raw) return { last_run_at: null, last_status: null };
  const match = raw.match(/^(.+?)(?:\s{2,}(\S.*))?$/);
  return {
    last_run_at: match?.[1]?.trim() || raw,
    last_status: match?.[2]?.trim() || null,
  };
}

export function parseCronListOutput(output: string): CronJob[] {
  const jobs: CronJob[] = [];
  let current: {
    id: string;
    state: CronJob["state"];
    fields: Record<string, string>;
  } | null = null;

  function flush(): void {
    if (!current) return;
    const lastRun = parseLastRun(current.fields["Last run"]);
    const state = current.state;
    const deliver = splitCsvish(current.fields.Deliver);
    jobs.push({
      id: current.id,
      name: current.fields.Name || "(unnamed)",
      schedule: current.fields.Schedule || "?",
      prompt: current.fields.Prompt || "",
      state,
      enabled: state !== "paused",
      next_run_at: current.fields["Next run"] || null,
      last_run_at: lastRun.last_run_at,
      last_status: lastRun.last_status,
      last_error: current.fields.Error || null,
      repeat: parseRepeat(current.fields.Repeat),
      deliver: deliver.length > 0 ? deliver : ["local"],
      skills: splitCsvish(current.fields.Skills),
      script: current.fields.Script || null,
    });
    current = null;
  }

  for (const line of output.split(/\r?\n/)) {
    const jobMatch = line.match(/^\s*([A-Za-z0-9_-]+)\s+\[([^\]]+)\]\s*$/);
    if (jobMatch) {
      flush();
      current = {
        id: jobMatch[1],
        state: parseCronState(jobMatch[2]),
        fields: {},
      };
      continue;
    }

    if (!current) continue;
    const fieldMatch = line.match(/^\s{2,}([^:]+):\s*(.*)$/);
    if (fieldMatch) {
      current.fields[fieldMatch[1].trim()] = fieldMatch[2].trim();
    }
  }

  flush();
  return jobs;
}

function getSshCronConfig(profile?: string): SshConfig | null {
  if (!profile || profile === "default" || !isRemoteMode()) return null;
  const conn = getConnectionConfig();
  return conn.mode === "ssh" && conn.ssh ? conn.ssh : null;
}

async function runNamedProfileSshCron(
  args: string[],
  profile?: string,
): Promise<{ success: boolean; output: string; error?: string } | null> {
  const ssh = getSshCronConfig(profile);
  if (!ssh) return null;
  const res = await sshRunCron(ssh, args, { profile, timeoutMs: 15000 });
  return {
    success: res.success,
    output: res.stdout || "",
    error: res.error,
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
  const sshResult = await runNamedProfileSshCron(
    includeDisabled ? ["list", "--all"] : ["list"],
    profile,
  );
  if (sshResult) {
    if (!sshResult.success) {
      console.error("[CRON] remote SSH list failed:", sshResult.error);
      return [];
    }
    const jobs = parseCronListOutput(sshResult.output);
    return includeDisabled ? jobs : jobs.filter((job) => job.enabled);
  }

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

export async function createCronJob(
  schedule: string,
  prompt?: string,
  name?: string,
  deliver?: string,
  profile?: string,
): Promise<{ success: boolean; error?: string }> {
  const args = ["create", schedule];
  if (prompt) args.push(prompt);
  if (name) args.push("--name", name);
  if (deliver) args.push("--deliver", deliver);

  const sshResult = await runNamedProfileSshCron(args, profile);
  if (sshResult) {
    return { success: sshResult.success, error: sshResult.error };
  }

  if (isRemoteMode()) {
    try {
      const res = await remoteFetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name || "",
          schedule,
          prompt: prompt || "",
          deliver: deliver || "local",
        }),
      });
      if (!res.ok) {
        return { success: false, error: await remoteJsonError(res) };
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  const result = await runCronCommand(args, profile);
  return { success: result.success, error: result.error };
}

export async function removeCronJob(
  jobId: string,
  profile?: string,
): Promise<{ success: boolean; error?: string }> {
  if (!jobId) return { success: false, error: "Missing job ID" };
  const sshResult = await runNamedProfileSshCron(["remove", jobId], profile);
  if (sshResult) {
    return { success: sshResult.success, error: sshResult.error };
  }
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
  profile?: string,
): Promise<{ success: boolean; error?: string }> {
  const sshResult = await runNamedProfileSshCron([action, jobId], profile);
  if (sshResult) {
    return { success: sshResult.success, error: sshResult.error };
  }
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
  if (isRemoteMode()) return remoteJobAction(jobId, "pause", profile);
  const result = await runCronCommand(["pause", jobId], profile);
  return { success: result.success, error: result.error };
}

export async function resumeCronJob(
  jobId: string,
  profile?: string,
): Promise<{ success: boolean; error?: string }> {
  if (!jobId) return { success: false, error: "Missing job ID" };
  if (isRemoteMode()) return remoteJobAction(jobId, "resume", profile);
  const result = await runCronCommand(["resume", jobId], profile);
  return { success: result.success, error: result.error };
}

export async function triggerCronJob(
  jobId: string,
  profile?: string,
): Promise<{ success: boolean; error?: string }> {
  if (!jobId) return { success: false, error: "Missing job ID" };
  if (isRemoteMode()) return remoteJobAction(jobId, "run", profile);
  const result = await runCronCommand(["run", jobId], profile);
  return { success: result.success, error: result.error };
}
