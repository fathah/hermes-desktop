import { spawn } from "child_process";
import {
  existsSync,
  mkdirSync,
  createWriteStream,
  writeFileSync,
  readFileSync,
  unlinkSync,
} from "fs";
import { join } from "path";
import { homedir } from "os";
import { desktopCapturer, app, powerMonitor } from "electron";
import { HERMES_HOME, HERMES_PYTHON, hermesCliArgs } from "./installer";
import {
  decideLockAcquisition,
  parseLockRecord,
  serializeLockRecord,
  type LockRecord,
} from "./scheduler-lock";
import { log } from "./log";
import { getActiveProfileNameSync, profileHome } from "./utils";
import { listCronJobs } from "./cronjobs";
import { triggerSelfHealing } from "./self-healing";
import { readDesktopConfig, writeDesktopConfig } from "./config";
import { runDreamCycle } from "./dream-cycle";

export async function captureScreenshot(
  jobId: string,
  profile: string,
): Promise<string | null> {
  if (!app.isReady()) {
    return null;
  }

  try {
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: 1280, height: 720 },
    });

    if (sources.length === 0) {
      return null;
    }

    const pngBuffer = sources[0].thumbnail.toPNG();
    const logDir = join(profileHome(profile), "logs", "routines");
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const screenshotPath = join(
      logDir,
      `routine-${jobId}-${timestamp}-error.png`,
    );
    writeFileSync(screenshotPath, pngBuffer);
    console.log(`[SCHEDULER] Saved error screenshot to ${screenshotPath}`);
    return screenshotPath;
  } catch (err) {
    console.error("[SCHEDULER] Failed to capture screenshot:", err);
    return null;
  }
}

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
const activeRuns = new Map<string, boolean>();

// Phase 1.2 — self-healing routine locks.
//
// A run that overshoots this is presumed wedged: its lock becomes stealable and a
// reap timer kills the child and releases the lock so the job can run again.
const JOB_TIMEOUT_MS = 15 * 60 * 1000;

function lockDir(): string {
  return join(HERMES_HOME, "locks");
}

function lockPathFor(jobId: string): string {
  return join(lockDir(), `${jobId}.lock`);
}

// `process.kill(pid, 0)` sends no signal but performs the permission/existence
// check: ESRCH => the process is gone; EPERM => alive but not ours (still alive).
function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function readExistingLock(lockFile: string): LockRecord | null {
  if (!existsSync(lockFile)) return null;
  try {
    return parseLockRecord(readFileSync(lockFile, "utf-8"));
  } catch {
    return null;
  }
}

// Persisted skip telemetry so a job that the scheduler keeps skipping is visible
// rather than silently dead. Exposed via IPC (get-scheduler-skips); the Scheduled
// modal surfaces it in Phase 2.2.
export interface JobSkipInfo {
  skipCount: number;
  lastSkipAt: number;
  lastReason: string;
}

function skipsPath(): string {
  return join(HERMES_HOME, "scheduler-skips.json");
}

export function getSchedulerSkips(): Record<string, JobSkipInfo> {
  try {
    const raw = readFileSync(skipsPath(), "utf-8");
    const parsed = JSON.parse(raw) as Record<string, JobSkipInfo>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function recordSkip(jobId: string, reason: string): void {
  try {
    const all = getSchedulerSkips();
    const prev = all[jobId];
    all[jobId] = {
      skipCount: (prev?.skipCount ?? 0) + 1,
      lastSkipAt: Date.now(),
      lastReason: reason,
    };
    writeFileSync(skipsPath(), JSON.stringify(all, null, 2), "utf-8");
  } catch (err) {
    console.error("[SCHEDULER] Failed to persist skip telemetry:", err);
  }
}

function clearSkip(jobId: string): void {
  try {
    const all = getSchedulerSkips();
    if (all[jobId]) {
      delete all[jobId];
      writeFileSync(skipsPath(), JSON.stringify(all, null, 2), "utf-8");
    }
  } catch {
    // best-effort
  }
}

export interface SchedulerConfig {
  enabled: boolean;
  tickIntervalMs: number;
}

const DEFAULT_CONFIG: SchedulerConfig = {
  enabled: true,
  tickIntervalMs: 10000, // 10 seconds tick
};

export function getSchedulerConfig(): SchedulerConfig {
  const config = readDesktopConfig();
  return {
    enabled:
      typeof config.schedulerEnabled === "boolean"
        ? config.schedulerEnabled
        : DEFAULT_CONFIG.enabled,
    tickIntervalMs:
      typeof config.schedulerIntervalMs === "number"
        ? config.schedulerIntervalMs
        : DEFAULT_CONFIG.tickIntervalMs,
  };
}

export function setSchedulerConfig(settings: Partial<SchedulerConfig>): void {
  const config = readDesktopConfig();
  if (settings.enabled !== undefined) {
    config.schedulerEnabled = settings.enabled;
  }
  if (settings.tickIntervalMs !== undefined) {
    config.schedulerIntervalMs = settings.tickIntervalMs;
  }
  writeDesktopConfig(config);

  // Restart scheduler with new config if running
  stopScheduler();
  if (config.schedulerEnabled !== false) {
    startScheduler();
  }
}

let last3AmRunDate = "";
let wasIdle = false;

/**
 * Check and execute due cron jobs for the active profile.
 */
export async function tickScheduler(profile?: string): Promise<void> {
  const activeProfile = profile ?? getActiveProfileNameSync();

  // Check 3:00 AM local time Dream Cycle trigger
  try {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const currentHour = now.getHours();
    if (currentHour >= 3 && last3AmRunDate !== todayStr) {
      last3AmRunDate = todayStr;
      console.log(
        `[SCHEDULER] Triggering 3:00 AM local time Dream Cycle (Date: ${todayStr})`,
      );
      void runDreamCycle(activeProfile);
    }
  } catch (err) {
    console.error("[SCHEDULER] Error checking 3:00 AM Dream Cycle:", err);
  }

  // Check 15 minutes of idle time Dream Cycle trigger
  try {
    if (
      typeof app !== "undefined" &&
      app.isReady() &&
      typeof powerMonitor !== "undefined" &&
      powerMonitor &&
      typeof powerMonitor.getSystemIdleTime === "function"
    ) {
      const idleTime = powerMonitor.getSystemIdleTime();
      const isIdleNow = idleTime >= 900; // 15 minutes
      if (isIdleNow && !wasIdle) {
        wasIdle = true;
        console.log(
          `[SCHEDULER] System idle for 15 minutes (idle time: ${idleTime}s). Triggering Dream Cycle.`,
        );
        void runDreamCycle(activeProfile);
      } else if (!isIdleNow) {
        wasIdle = false;
      }
    }
  } catch (err) {
    console.error("[SCHEDULER] Error checking idle Dream Cycle:", err);
  }

  try {
    const jobs = await listCronJobs(true, activeProfile);
    const now = Date.now();

    for (const job of jobs) {
      if (!job.enabled || job.state === "paused" || job.state === "completed") {
        continue;
      }

      if (!job.next_run_at) {
        continue;
      }

      const nextRunTime = new Date(job.next_run_at).getTime();
      if (isNaN(nextRunTime)) {
        continue;
      }

      // Check if job is due and not currently running
      if (nextRunTime <= now && !activeRuns.has(job.id)) {
        console.log(
          `[SCHEDULER] Triggering due job: "${job.name}" (ID: ${job.id})`,
        );
        void runJobHeadless(job.id, job.name, activeProfile);
      }
    }
  } catch (err) {
    console.error("[SCHEDULER] Error during tick:", err);
  }
}

/**
 * Headlessly run a specific cron job by ID.
 * Streams output to ~/.hermes/logs/routines/routine-<id>-<timestamp>.log
 */
export async function runJobHeadless(
  jobId: string,
  jobName: string,
  profile: string,
): Promise<boolean> {
  if (activeRuns.has(jobId)) {
    console.warn(`[SCHEDULER] Job "${jobName}" (${jobId}) is already running.`);
    return false;
  }

  const lockFile = lockPathFor(jobId);
  const existingLock = readExistingLock(lockFile);
  const decision = decideLockAcquisition(
    existingLock,
    Date.now(),
    JOB_TIMEOUT_MS,
    isPidAlive,
  );
  if (decision.type === "blocked") {
    recordSkip(jobId, "locked");
    console.warn(
      `[SCHEDULER] Job "${jobName}" (${jobId}) is locked by a live runner ` +
        `(pid ${existingLock?.pid}). Skipping.`,
    );
    return false;
  }
  if (decision.type === "steal") {
    log.warn("scheduler", {
      msg: "stealing lock",
      reason: decision.reason,
      jobId,
      jobName,
      prevPid: existingLock?.pid,
    });
  }

  try {
    mkdirSync(lockDir(), { recursive: true });
    const record: LockRecord = { pid: process.pid, startedAt: Date.now() };
    writeFileSync(lockFile, serializeLockRecord(record), "utf-8");
  } catch (err) {
    console.error(`[SCHEDULER] Failed to create lockfile ${lockFile}:`, err);
  }

  // A clean acquisition means this job is healthy again — clear any stale skip
  // telemetry so the "keeps getting skipped" warning resolves on its own.
  clearSkip(jobId);

  activeRuns.set(jobId, true);
  const startTime = Date.now();

  return new Promise((resolve) => {
    try {
      const logDir = join(profileHome(profile), "logs", "routines");
      if (!existsSync(logDir)) {
        mkdirSync(logDir, { recursive: true });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const logFilePath = join(logDir, `routine-${jobId}-${timestamp}.log`);
      const logStream = createWriteStream(logFilePath, { flags: "a" });

      logStream.write(
        `=== START ROUTINE RUN: "${jobName}" (${jobId}) at ${new Date().toISOString()} ===\n`,
      );
      logStream.write(`Profile: ${profile}\n\n`);

      const cliArgs = hermesCliArgs();
      if (profile && profile !== "default") {
        cliArgs.push("-p", profile);
      }
      cliArgs.push("cron", "run", jobId);

      const proc = spawn(HERMES_PYTHON, cliArgs, {
        cwd: join(HERMES_HOME, "hermes-agent"),
        env: {
          ...process.env,
          HERMES_HOME,
          HOME: homedir(),
          FAZM_HEADLESS: "1", // Indicate headless environment
        },
      });

      proc.stdout.on("data", (chunk) => {
        logStream.write(chunk);
      });

      proc.stderr.on("data", (chunk) => {
        logStream.write(chunk);
      });

      // Reap a wedged run: if the child never exits within the timeout, kill it,
      // release the lock and resolve false. Without this a hung run would hold its
      // lock until the next acquisition's stale-steal — this bounds the damage and
      // frees the OS process. Cleared the moment the child exits normally.
      const reapTimer = setTimeout(() => {
        log.warn("scheduler", {
          msg: "reaping wedged job",
          jobId,
          jobName,
          timeoutMs: JOB_TIMEOUT_MS,
        });
        try {
          proc.kill("SIGKILL");
        } catch {
          // already gone
        }
        try {
          logStream.write(
            `\n=== REAPED: exceeded ${JOB_TIMEOUT_MS}ms timeout ===\n`,
          );
          logStream.end();
        } catch {
          // ignore
        }
        activeRuns.delete(jobId);
        try {
          if (existsSync(lockFile)) unlinkSync(lockFile);
        } catch {
          // ignore
        }
        recordSkip(jobId, "timeout-reaped");
        resolve(false);
      }, JOB_TIMEOUT_MS);
      reapTimer.unref?.();

      proc.on("close", async (code) => {
        clearTimeout(reapTimer);
        const duration = Date.now() - startTime;
        logStream.write(
          `\n=== END ROUTINE RUN: Exit Code ${code} (Duration: ${duration}ms) ===\n`,
        );
        logStream.end();
        activeRuns.delete(jobId);

        // Release lock
        try {
          if (existsSync(lockFile)) {
            unlinkSync(lockFile);
          }
        } catch {
          // ignore
        }

        console.log(
          `[SCHEDULER] Job "${jobName}" finished with code ${code} in ${duration}ms`,
        );

        if (code !== 0) {
          console.error(
            `[SCHEDULER] Job "${jobName}" (${jobId}) failed. Triggering Self-Healing Loop.`,
          );
          try {
            await captureScreenshot(jobId, profile);
          } catch (captureErr) {
            console.error(
              "[SCHEDULER] Error capturing screenshot:",
              captureErr,
            );
          }
          void triggerSelfHealing(jobId, jobName, logFilePath, profile);
          resolve(false);
        } else {
          resolve(true);
        }
      });

      proc.on("error", async (err) => {
        clearTimeout(reapTimer);
        logStream.write(`\nProcess spawn error: ${err.message}\n`);
        logStream.end();
        activeRuns.delete(jobId);

        // Release lock
        try {
          if (existsSync(lockFile)) {
            unlinkSync(lockFile);
          }
        } catch {
          // ignore
        }

        console.error(`[SCHEDULER] Spawn error running job "${jobName}":`, err);
        try {
          await captureScreenshot(jobId, profile);
        } catch (captureErr) {
          console.error("[SCHEDULER] Error capturing screenshot:", captureErr);
        }
        void triggerSelfHealing(jobId, jobName, logFilePath, profile);
        resolve(false);
      });
    } catch (err) {
      activeRuns.delete(jobId);

      // Release lock
      try {
        if (existsSync(lockFile)) {
          unlinkSync(lockFile);
        }
      } catch {
        // ignore
      }

      console.error(
        `[SCHEDULER] Failed to run job "${jobName}" headlessly:`,
        err,
      );
      resolve(false);
    }
  });
}

/**
 * Start the background scheduler timer.
 */
export function startScheduler(config: Partial<SchedulerConfig> = {}): void {
  const currentConfig = getSchedulerConfig();
  const merged = { ...currentConfig, ...config };
  if (!merged.enabled) {
    console.log("[SCHEDULER] Scheduler is disabled by configuration.");
    return;
  }

  if (schedulerInterval) {
    console.warn("[SCHEDULER] Scheduler is already running.");
    return;
  }

  console.log(
    `[SCHEDULER] Starting background scheduler (tick every ${merged.tickIntervalMs}ms).`,
  );
  schedulerInterval = setInterval(() => {
    void tickScheduler();
  }, merged.tickIntervalMs);
}

/**
 * Stop the background scheduler timer.
 */
export function stopScheduler(): void {
  if (schedulerInterval) {
    console.log("[SCHEDULER] Stopping background scheduler.");
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}
