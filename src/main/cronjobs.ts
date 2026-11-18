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
import { getConnectionConfig, type ConnectionConfig } from "./config";
import { HIDDEN_SUBPROCESS_OPTIONS } from "./process-options";
import { sshRunCron } from "./ssh-remote";
import { remoteDashboardRequestJson } from "./remote-api";
import { RemoteOAuthError, probeRemoteAuthMode } from "./remote-oauth";
import { dashboardApiUrl } from "./dashboard-api-url";
import { providerTargetRevision } from "./provider-request-target";
import { resolveProfileEditorTarget } from "./profile-editor-target";
import type { ProfileEditorTarget } from "../shared/profile-editor-target";
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
  if (job.state === "completed") state = "completed";
  else if (job.state === "paused" || !enabled) state = "paused";
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
      enabled: state === "active",
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

function getSshCronConfig(
  profile: string | undefined,
  conn: ConnectionConfig,
): SshConfig | null {
  if (!profile || profile === "default" || !isRemoteMode(conn)) return null;
  return conn.mode === "ssh" && conn.ssh ? conn.ssh : null;
}

async function runNamedProfileSshCron(
  args: string[],
  profile: string | undefined,
  conn: ConnectionConfig,
): Promise<{ success: boolean; output: string; error?: string } | null> {
  const ssh = getSshCronConfig(profile, conn);
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
  init: RequestInit,
  conn: ConnectionConfig,
  profile?: string,
  gatewayProfile = false,
): Promise<Response> {
  const headers: Record<string, string> = {
    ...getRemoteAuthHeader(conn),
    ...((init.headers as Record<string, string>) || {}),
  };
  const apiUrl = await getCronApiUrl(headers, conn);
  const profilePrefix =
    gatewayProfile && profile && profile !== "default"
      ? `/p/${encodeURIComponent(profile)}`
      : "";
  const response = await fetch(`${apiUrl}${profilePrefix}${path}`, {
    ...init,
    headers,
  });
  if (
    response.ok &&
    response.headers?.get("content-type")?.toLowerCase().includes("text/html")
  ) {
    throw new Error("Remote cron returned HTML instead of an API response.");
  }
  return response;
}

async function getCronApiUrl(
  headers: Record<string, string>,
  conn: ConnectionConfig,
): Promise<string> {
  try {
    return getApiUrl(undefined, conn);
  } catch (err) {
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
    const body = (await res.json()) as { error?: string; detail?: string };
    return body.error || body.detail || `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

/** Dashboard (`hermes dashboard` / `serve`) cron REST root. */
const DASHBOARD_CRON_BASE = "/api/cron/jobs";
/** Gateway api_server cron REST root (legacy remote/SSH transport). */
const GATEWAY_CRON_BASE = "/api/jobs";

/**
 * Dashboard cron request. Direct Remote mode must go through the authenticated
 * dashboard boundary (OAuth cookie partition or session token) — a bare fetch
 * carries no OAuth credentials and the dashboard answers 401. Result is wrapped
 * in a Response so callers share one 404/405 fallback and error path.
 */
async function dashboardCronFetch(
  path: string,
  init: RequestInit,
  conn: ConnectionConfig,
  profile?: string,
): Promise<Response> {
  // Both direct Remote and SSH dashboards default lists to all profiles.
  const scopedPath = `${path}${path.includes("?") ? "&" : "?"}profile=${encodeURIComponent(profile || "default")}`;
  if (conn.mode !== "remote")
    return remoteFetch(scopedPath, init, conn, profile);
  // A raw gateway without an API key has no session to send. Keep the plain
  // request for it (as before) rather than failing in the token helper, which
  // refuses to run without a token.
  const keylessToken = conn.remoteAuthMode === "token" && !conn.apiKey?.trim();
  if (keylessToken) return remoteFetch(scopedPath, init, conn, profile);

  const method = (init.method || "GET").toUpperCase() as
    | "GET"
    | "POST"
    | "PUT"
    | "PATCH"
    | "DELETE";
  const body =
    typeof init.body === "string" && init.body
      ? JSON.parse(init.body)
      : undefined;
  try {
    // Dashboard lists default to all profiles; explicitly request the selected one.
    const data = await remoteDashboardRequestJson<unknown>(
      conn,
      scopedPath,
      {
        method,
        body,
      },
      profile,
    );
    return new Response(JSON.stringify(data ?? {}), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const status =
      err instanceof RemoteOAuthError
        ? err.statusCode
        : (err as { statusCode?: number }).statusCode;
    // Only real HTTP failures become a Response. An error without a status, or
    // one carrying a SUCCESS status (an OAuth redirect to a sign-in page answers
    // 200 with HTML), must not turn into an "ok" response and report a job
    // action that never happened as done.
    if (!status || status < 400) {
      if (
        !conn.apiKey?.trim() &&
        conn.remoteAuthMode !== "oauth" &&
        err instanceof Error &&
        err.message === "Remote Hermes dashboard token is not configured."
      ) {
        return remoteFetch(scopedPath, init, conn, profile);
      }
      throw err;
    }
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }
}

function isUnsupportedCronRoute(res: Response): boolean {
  return res.status === 404 || res.status === 405;
}

/** Dashboard returns a bare array; gateway wraps `{ jobs: [...] }`. */
export function cronJobsFromResponseBody(
  body: unknown,
): Record<string, unknown>[] {
  if (Array.isArray(body)) return body as Record<string, unknown>[];
  if (
    body &&
    typeof body === "object" &&
    Array.isArray((body as { jobs?: unknown }).jobs)
  ) {
    return (body as { jobs: Record<string, unknown>[] }).jobs;
  }
  return [];
}

/**
 * Prefer the dashboard cron surface; fall back to the gateway `/api/jobs`
 * routes when the URL is a legacy api_server (404/405 on the dashboard path).
 */
async function remoteFetchCron(
  jobPath: string,
  init: RequestInit,
  conn: ConnectionConfig,
  profile?: string,
): Promise<Response> {
  const dashboardRes = await dashboardCronFetch(
    `${DASHBOARD_CRON_BASE}${jobPath}`,
    init,
    conn,
    profile,
  );
  if (!isUnsupportedCronRoute(dashboardRes)) return dashboardRes;

  // Gateway uses `/run` where the dashboard uses `/trigger`.
  const gatewayPath = jobPath.endsWith("/trigger")
    ? `${jobPath.slice(0, -"/trigger".length)}/run`
    : jobPath;
  return remoteFetch(
    `${GATEWAY_CRON_BASE}${gatewayPath}`,
    init,
    conn,
    profile,
    true,
  );
}

function normalizeCronJobRows(
  raw: Record<string, unknown>[],
  includeDisabled: boolean,
): CronJob[] {
  const jobs: CronJob[] = [];
  for (const job of raw) {
    const normalized = normalizeJob(job);
    if (!normalized) continue;
    if (!includeDisabled && !normalized.enabled) continue;
    jobs.push(normalized);
  }
  return jobs;
}

/**
 * Read cron jobs from the jobs.json file (async to avoid blocking the main process).
 * In remote/SSH dashboard mode, fetches `/api/cron/jobs` (with gateway `/api/jobs`
 * fallback for legacy transport).
 */
export async function listCronJobs(
  includeDisabled = true,
  profile?: string,
): Promise<CronJob[]> {
  const conn = getConnectionConfig();
  const sshResult = await runNamedProfileSshCron(
    includeDisabled ? ["list", "--all"] : ["list"],
    profile,
    conn,
  );
  if (sshResult) {
    if (!sshResult.success) {
      console.error("[CRON] remote SSH list failed:", sshResult.error);
      return [];
    }
    const jobs = parseCronListOutput(sshResult.output);
    return includeDisabled ? jobs : jobs.filter((job) => job.enabled);
  }

  if (isRemoteMode(conn)) {
    try {
      // Dashboard list has no include_disabled flag — filter client-side.
      // Gateway accepts ?include_disabled= when we fall back.
      let res = await dashboardCronFetch(
        DASHBOARD_CRON_BASE,
        {},
        conn,
        profile,
      );
      if (isUnsupportedCronRoute(res)) {
        const qs = includeDisabled ? "?include_disabled=true" : "";
        res = await remoteFetch(
          `${GATEWAY_CRON_BASE}${qs}`,
          {},
          conn,
          profile,
          true,
        );
      }
      if (!res.ok) {
        console.error("[CRON] remote list failed:", await remoteJsonError(res));
        return [];
      }
      return normalizeCronJobRows(
        cronJobsFromResponseBody(await res.json()),
        includeDisabled,
      );
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
    return normalizeCronJobRows(raw, includeDisabled);
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
  const conn = getConnectionConfig();
  const args = ["create", schedule];
  if (prompt) args.push(prompt);
  if (name) args.push("--name", name);
  if (deliver) args.push("--deliver", deliver);

  const sshResult = await runNamedProfileSshCron(args, profile, conn);
  if (sshResult) {
    return { success: sshResult.success, error: sshResult.error };
  }

  if (isRemoteMode(conn)) {
    try {
      const res = await remoteFetchCron(
        "",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name || "",
            schedule,
            prompt: prompt || "",
            deliver: deliver || "local",
          }),
        },
        conn,
        profile,
      );
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
  const conn = getConnectionConfig();
  const sshResult = await runNamedProfileSshCron(
    ["remove", jobId],
    profile,
    conn,
  );
  if (sshResult) {
    return { success: sshResult.success, error: sshResult.error };
  }
  if (isRemoteMode(conn)) {
    try {
      const res = await remoteFetchCron(
        `/${encodeURIComponent(jobId)}`,
        {
          method: "DELETE",
        },
        conn,
        profile,
      );
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
  profile: string | undefined,
  conn: ConnectionConfig,
): Promise<{ success: boolean; error?: string }> {
  const sshResult = await runNamedProfileSshCron(
    [action, jobId],
    profile,
    conn,
  );
  if (sshResult) {
    return { success: sshResult.success, error: sshResult.error };
  }
  try {
    // Dashboard exposes `/trigger`; gateway uses `/run`. remoteFetchCron maps.
    const dashboardAction = action === "run" ? "trigger" : action;
    const res = await remoteFetchCron(
      `/${encodeURIComponent(jobId)}/${dashboardAction}`,
      { method: "POST" },
      conn,
      profile,
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
  const conn = getConnectionConfig();
  if (isRemoteMode(conn)) return remoteJobAction(jobId, "pause", profile, conn);
  const result = await runCronCommand(["pause", jobId], profile);
  return { success: result.success, error: result.error };
}

export async function resumeCronJob(
  jobId: string,
  profile?: string,
): Promise<{ success: boolean; error?: string }> {
  if (!jobId) return { success: false, error: "Missing job ID" };
  const conn = getConnectionConfig();
  if (isRemoteMode(conn))
    return remoteJobAction(jobId, "resume", profile, conn);
  const result = await runCronCommand(["resume", jobId], profile);
  return { success: result.success, error: result.error };
}

export async function triggerCronJob(
  jobId: string,
  profile?: string,
): Promise<{ success: boolean; error?: string }> {
  if (!jobId) return { success: false, error: "Missing job ID" };
  const conn = getConnectionConfig();
  if (isRemoteMode(conn)) return remoteJobAction(jobId, "run", profile, conn);
  const result = await runCronCommand(["run", jobId], profile);
  return { success: result.success, error: result.error };
}

// ── Run history / output ────────────────────────────────────────────────────

export interface CronRun {
  /** Opaque run id: a `cron_<job>_<ts>` session id, `cron_output:<job>:<stem>`, or `file:<name>` locally. */
  id: string;
  source: string;
  started_at: number | string | null;
  ended_at: number | string | null;
  title: string;
  preview: string;
  message_count: number;
  input_tokens: number | null;
  output_tokens: number | null;
  is_active: boolean;
}

export interface CronRunsResult {
  success: boolean;
  runs: CronRun[];
  error?: string;
  /** The connection mode or server does not expose run history. */
  unsupported?: boolean;
}

export interface CronRunOutputResult {
  success: boolean;
  output: string;
  /** True when the text is only a preview of the real output. */
  partial?: boolean;
  /** True when the output was cut to fit MAX_RUN_OUTPUT_CHARS. */
  truncated?: boolean;
  error?: string;
  unsupported?: boolean;
}

const MAX_RUN_OUTPUT_CHARS = 200_000;
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

/** Keep bounded text valid when a UTF-16 limit falls inside a surrogate pair. */
function runTextPrefix(text: string, limit: number): string {
  const end =
    text.length > limit &&
    /[\uD800-\uDBFF]/.test(text[limit - 1]) &&
    /[\uDC00-\uDFFF]/.test(text[limit])
      ? limit - 1
      : limit;
  return text.slice(0, end);
}

function clampRunOutput(text: string): { output: string; truncated: boolean } {
  return text.length > MAX_RUN_OUTPUT_CHARS
    ? { output: runTextPrefix(text, MAX_RUN_OUTPUT_CHARS), truncated: true }
    : { output: text, truncated: false };
}

function asRunNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeRun(raw: Record<string, unknown>): CronRun {
  const time = (v: unknown): number | string | null =>
    typeof v === "string" ? v : asRunNumber(v);
  return {
    id: String(raw.id ?? ""),
    source: String(raw.source ?? ""),
    started_at: time(raw.started_at),
    ended_at: time(raw.ended_at),
    title: typeof raw.title === "string" ? raw.title : "",
    preview: typeof raw.preview === "string" ? raw.preview : "",
    message_count: asRunNumber(raw.message_count) ?? 0,
    input_tokens: asRunNumber(raw.input_tokens),
    output_tokens: asRunNumber(raw.output_tokens),
    is_active: raw.is_active === true,
  };
}

function remoteRunsUnsupported(err: unknown): boolean {
  const status = (err as { statusCode?: number }).statusCode;
  return status === 404 || status === 405;
}

/** Read a bounded prefix, refusing symlinks and non-file entries. */
async function readFilePreview(path: string, chars: number): Promise<string> {
  const { open, lstat } = await import("fs/promises");
  if (!(await lstat(path)).isFile())
    throw new Error("Run output is not a file.");
  const { constants } = await import("fs");
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!(await handle.stat()).isFile())
      throw new Error("Run output is not a file.");
    const buf = Buffer.alloc(chars * 4);
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
    return runTextPrefix(buf.toString("utf-8", 0, bytesRead), chars);
  } finally {
    await handle.close();
  }
}

function localRunDir(jobId: string, profile?: string): string {
  return join(profileHome(profile), "cron", "output", jobId);
}

function runLimit(limit: number): number {
  return Number.isFinite(limit)
    ? Math.max(1, Math.min(100, Math.floor(limit)))
    : 20;
}

/** Only the selected dashboard may supply history; no legacy gateway fallback. */
async function historyJson<T>(
  conn: ConnectionConfig,
  path: string,
  profile: string | undefined,
  assertCurrent: () => void,
): Promise<T> {
  const revision = providerTargetRevision(conn);
  const check = (): void => {
    assertCurrent();
    if (providerTargetRevision(conn) !== revision)
      throw new Error("Remote authentication changed; reload history.");
  };
  const mode =
    conn.remoteAuthMode === "auto"
      ? (await probeRemoteAuthMode(conn.remoteUrl)).authMode
      : conn.remoteAuthMode;
  check();
  const scopedPath = `${path}${path.includes("?") ? "&" : "?"}profile=${encodeURIComponent(profile || "default")}`;
  let result: T;
  if (mode === "token" && !conn.apiKey.trim()) {
    const url = new URL(
      dashboardApiUrl({ remoteUrl: conn.remoteUrl, apiKey: "" }, scopedPath),
    );
    const headers: Record<string, string> = {};
    if (url.username || url.password) {
      headers.Authorization = `Basic ${Buffer.from(`${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`).toString("base64")}`;
      url.username = "";
      url.password = "";
    }
    const response = await fetch(url.toString(), {
      headers,
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok)
      throw Object.assign(new Error(`Run history HTTP ${response.status}`), {
        statusCode: response.status,
      });
    result = (await response.json()) as T;
  } else {
    result = await remoteDashboardRequestJson<T>(
      { ...conn, remoteAuthMode: mode },
      scopedPath,
    );
  }
  check();
  return result;
}

async function remoteRunList(
  jobId: string,
  limit: number,
  conn: ConnectionConfig,
  profile: string | undefined,
  assertCurrent: () => void,
): Promise<CronRun[]> {
  const data = await historyJson<{ runs: unknown }>(
    conn,
    `${DASHBOARD_CRON_BASE}/${encodeURIComponent(jobId)}/runs?limit=${runLimit(limit)}`,
    profile,
    assertCurrent,
  );
  if (
    !Array.isArray(data?.runs) ||
    data.runs.some(
      (row) =>
        !row ||
        typeof row !== "object" ||
        typeof row.id !== "string" ||
        !SAFE_SEGMENT.test(row.id),
    )
  )
    throw new Error("Run history response was invalid.");
  return data.runs.map(normalizeRun);
}

/** Newest runs, bound to the captured connection and profile. */
export async function listCronRuns(
  jobId: string,
  limit = 20,
  profile?: string,
  target?: ProfileEditorTarget,
): Promise<CronRunsResult> {
  try {
    if (!SAFE_SEGMENT.test(jobId)) throw new Error("Invalid job ID");
    const resolved = resolveProfileEditorTarget(profile, target);
    const conn = resolved.connection;
    const assertCurrent = (): void => {
      if (target) resolveProfileEditorTarget(profile, target);
    };
    if (conn.mode === "ssh")
      return {
        success: false,
        runs: [],
        unsupported: true,
        error: "Run history is not available over SSH yet.",
      };
    if (conn.mode === "remote")
      return {
        success: true,
        runs: await remoteRunList(
          jobId,
          limit,
          conn,
          resolved.profile,
          assertCurrent,
        ),
      };
    const dir = localRunDir(jobId, resolved.profile);
    if (!existsSync(dir)) return { success: true, runs: [] };
    const { readdir, lstat } = await import("fs/promises");
    const names = (await readdir(dir)).filter(
      (name) => name.endsWith(".md") && SAFE_SEGMENT.test(name),
    );
    const stats = await Promise.all(
      names.map(async (name) => {
        try {
          const stat = await lstat(join(dir, name));
          return stat.isFile() ? { name, mtimeMs: stat.mtimeMs } : null;
        } catch {
          return null;
        }
      }),
    );
    const newest = stats
      .filter(
        (stat): stat is { name: string; mtimeMs: number } => stat !== null,
      )
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, runLimit(limit));
    const runs = await Promise.all(
      newest.map(
        async ({ name, mtimeMs }): Promise<CronRun> => ({
          id: `file:${name}`,
          source: "cron_output",
          started_at: mtimeMs / 1000,
          ended_at: null,
          title: name.replace(/\.md$/, ""),
          preview: await readFilePreview(join(dir, name), 300),
          message_count: 0,
          input_tokens: null,
          output_tokens: null,
          is_active: false,
        }),
      ),
    );
    assertCurrent();
    return { success: true, runs };
  } catch (err) {
    return {
      success: false,
      runs: [],
      unsupported: remoteRunsUnsupported(err),
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Bounded text of a run belonging to this job's current history window. */
export async function getCronRunOutput(
  jobId: string,
  runId: string,
  profile?: string,
  target?: ProfileEditorTarget,
): Promise<CronRunOutputResult> {
  try {
    if (
      !SAFE_SEGMENT.test(jobId) ||
      !SAFE_SEGMENT.test(runId.replace(/^file:/, ""))
    )
      throw new Error("Invalid run ID");
    const resolved = resolveProfileEditorTarget(profile, target);
    const conn = resolved.connection;
    const assertCurrent = (): void => {
      if (target) resolveProfileEditorTarget(profile, target);
    };
    if (conn.mode === "ssh")
      return {
        success: false,
        output: "",
        unsupported: true,
        error: "Run output is not available over SSH yet.",
      };
    if (conn.mode === "remote") {
      const runs = await remoteRunList(
        jobId,
        100,
        conn,
        resolved.profile,
        assertCurrent,
      );
      const run = runs.find((item) => item.id === runId);
      if (!run) throw new Error("Run not found in this job's history.");
      if (run.source === "cron_output")
        return { success: true, output: run.preview, partial: true };
      const data = await historyJson<{ messages: unknown }>(
        conn,
        `/api/sessions/${encodeURIComponent(runId)}/messages?order=oldest&limit=500`,
        resolved.profile,
        assertCurrent,
      );
      if (
        !Array.isArray(data?.messages) ||
        data.messages.some((message) => !message || typeof message !== "object")
      )
        throw new Error("Run output response was invalid.");
      const text = data.messages
        .filter((m) => m.display_kind !== "hidden")
        .map((m) => {
          const role = String(m.role ?? "message");
          const raw = m.display_content ?? m.content;
          const content =
            typeof raw === "string" ? raw : raw ? JSON.stringify(raw) : "";
          return content.trim() ? `[${role}]\n${content}` : "";
        })
        .filter(Boolean)
        .join("\n\n");
      return {
        success: true,
        ...clampRunOutput(text),
        partial: data.messages.length === 500,
      };
    }
    const name = runId.startsWith("file:") ? runId.slice(5) : "";
    if (!name.endsWith(".md")) throw new Error("Invalid run ID");
    const text = await readFilePreview(
      join(localRunDir(jobId, resolved.profile), name),
      // Two extra UTF-16 units preserve overflow after trimming a split pair.
      MAX_RUN_OUTPUT_CHARS + 2,
    );
    assertCurrent();
    return { success: true, ...clampRunOutput(text) };
  } catch (err) {
    return {
      success: false,
      output: "",
      unsupported: remoteRunsUnsupported(err),
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
