import { spawn } from "child_process";
import {
  existsSync,
  mkdirSync,
  createWriteStream,
  writeFileSync,
  unlinkSync,
} from "fs";
import { join } from "path";
import { homedir } from "os";
import { desktopCapturer, app } from "electron";
import { HERMES_HOME, HERMES_PYTHON, hermesCliArgs } from "./installer";
import { getActiveProfileNameSync, profileHome } from "./utils";
import { listCronJobs } from "./cronjobs";
import { triggerSelfHealing } from "./self-healing";
import { readDesktopConfig, writeDesktopConfig } from "./config";

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

/**
 * Check and execute due cron jobs for the active profile.
 */
export async function tickScheduler(profile?: string): Promise<void> {
  const activeProfile = profile ?? getActiveProfileNameSync();
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

  const lockFile = join("/tmp", `hermes-routine-${jobId}.lock`);
  if (existsSync(lockFile)) {
    console.warn(
      `[SCHEDULER] Job "${jobName}" (${jobId}) is locked by another runner. Skipping.`,
    );
    return false;
  }

  try {
    writeFileSync(lockFile, String(process.pid), "utf-8");
  } catch (err) {
    console.error(`[SCHEDULER] Failed to create lockfile ${lockFile}:`, err);
  }

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

      proc.on("close", async (code) => {
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
