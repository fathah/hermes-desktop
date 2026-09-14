import { app } from "electron";
import { existsSync, writeFileSync, mkdirSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import type { GpuPreferenceMode, GpuStatus } from "../shared/gpu";

// One-shot command-line sentinel carried across an automatic relaunch. It lets
// the relaunched process start with GPU disabled even when the flag file could
// not be written (read-only FS, permissions) — which is what breaks the
// otherwise-infinite crash → relaunch cycle (PR #605 review).
const GPU_DISABLE_ARG = "--hermes-gpu-disabled";

/** Normalised HERMES_DISABLE_GPU: "on" to force-disable, "off" to force-enable
 *  (overriding a persisted flag), or null when unset/unrecognised. */
function gpuEnvOverride(): "on" | "off" | null {
  const v = (process.env.HERMES_DISABLE_GPU || "").trim().toLowerCase();
  if (v === "1" || v === "true") return "on";
  if (v === "0" || v === "false") return "off";
  return null;
}

function shouldHonorPersistedGpuFlag(): boolean {
  if (process.env.HERMES_GPU_FALLBACK === "1") return true;
  if (process.env.HERMES_GPU_FALLBACK === "0") return false;
  // The persistent fallback targets Windows/Linux GPU crash loops caused by
  // virtual adapters and constrained GPU stacks. On macOS it can permanently
  // push the Office tab onto slow SwiftShader after a transient GPU hiccup.
  return process.platform !== "darwin";
}

// Some machines — notably Windows boxes running remote-control software that
// installs virtual display adapters (Todesk, GameViewer/向日葵, TeamViewer,
// Sunlogin, etc.) — confuse Chromium's GPU initialization. The GPU process
// crashes on launch, Chromium retries ~9 times and then fatally exits with
// "GPU process isn't usable. Goodbye." (issue #592).
//
// Passing --disable-gpu on the external command line doesn't reliably help
// because the GPU process still attempts to initialize. The robust fix is to
// disable hardware acceleration from inside the main process *before* the app
// is ready, and to remember that choice across launches once we've seen the
// GPU process die.

// Resolve the flag path once, at module load — before app.setName() runs in
// whenReady — so the path the crash guard writes to is the same one we read
// from on the next launch (app.getPath("userData") depends on app.name).
let cachedFlagPath: string | null = null;

function flagPath(): string {
  if (!cachedFlagPath) {
    cachedFlagPath = join(app.getPath("userData"), "disable-gpu.flag");
  }
  return cachedFlagPath;
}

// How long a crash-persisted flag stays authoritative. A GPU crash is often
// transient — a driver update mid-session, a remote-desktop virtual adapter
// that's since been removed, or a Chromium blocklist gap for a brand-new GPU
// (a user's RTX 5060 Ti was stuck on SwiftShader for over a week because the
// flag never expired). After this window the flag is treated as stale: it is
// cleared on launch and hardware acceleration is retried. If the GPU process
// still crashes, the crash guard persists a fresh flag and relaunches GPU-off,
// so a chronically broken machine pays at most one crash+relaunch per window
// instead of the user being silently stuck on software rendering forever.
const GPU_FLAG_TTL_MS = 24 * 60 * 60 * 1000;

// Explicit user preference from Settings → Appearance. Stored beside the crash
// flag because it must be readable synchronously before app-ready — the only
// point where hardware acceleration can still be disabled. Renderer-side
// settings storage initializes far too late for that.
let cachedPrefPath: string | null = null;

function prefPath(): string {
  if (!cachedPrefPath) {
    cachedPrefPath = join(app.getPath("userData"), "gpu-preference.json");
  }
  return cachedPrefPath;
}

// Captured on the boot path (applyGpuPreferences) so the Settings pane can
// tell a pending preference change apart from the state actually in effect.
let bootPreference: GpuPreferenceMode | null = null;

/** The persisted Settings preference; malformed/missing files mean "auto". */
export function getGpuPreference(): GpuPreferenceMode {
  try {
    const raw = JSON.parse(readFileSync(prefPath(), "utf-8")) as {
      mode?: unknown;
    };
    if (raw.mode === "on" || raw.mode === "off") return raw.mode;
  } catch {
    // Missing or corrupt preference file — fall through to the default.
  }
  return "auto";
}

/** Persist the Settings preference. Takes effect on the next launch. */
export function setGpuPreference(mode: GpuPreferenceMode): boolean {
  try {
    const dir = app.getPath("userData");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(prefPath(), JSON.stringify({ mode }), "utf-8");
    return true;
  } catch (err) {
    console.error("[GPU] Failed to persist gpu preference:", err);
    return false;
  }
}

/** Timestamp persisted in the flag file, or null when the file is missing or
 *  its content doesn't parse as a date (hand-created/truncated files). */
function flagWrittenAt(): Date | null {
  try {
    const raw = readFileSync(flagPath(), "utf-8").trim();
    const parsed = new Date(raw);
    return isNaN(parsed.getTime()) ? null : parsed;
  } catch {
    return null;
  }
}

/** True when the persisted flag exists but is past its TTL (or unreadable —
 *  self-healing beats staying stuck on software rendering). */
function isFlagStale(): boolean {
  const writtenAt = flagWrittenAt();
  if (!writtenAt) return true;
  return Date.now() - writtenAt.getTime() > GPU_FLAG_TTL_MS;
}

/**
 * True when hardware acceleration should be disabled. Precedence:
 *   1. HERMES_DISABLE_GPU=0/false — force-enable, overrides everything else.
 *   2. HERMES_DISABLE_GPU=1/true  — force-disable.
 *   3. the relaunch sentinel arg  — a prior crash relaunched us GPU-off. This
 *      outranks a "force on" preference so a crash still breaks the loop for
 *      the current session even when the user insists on hardware rendering.
 *   4. the Settings preference — "off" disables, "on" ignores any crash flag.
 *   5. the persisted disable-gpu.flag from a previous crash, while fresh
 *      (within GPU_FLAG_TTL_MS). A stale flag no longer disables the GPU.
 */
export function isGpuDisabled(): boolean {
  const env = gpuEnvOverride();
  if (env === "off") return false;
  if (env === "on") return true;
  if (process.argv.includes(GPU_DISABLE_ARG)) return true;
  const pref = getGpuPreference();
  if (pref === "off") return true;
  if (pref === "on") return false;
  if (!shouldHonorPersistedGpuFlag()) return false;
  try {
    return existsSync(flagPath()) && !isFlagStale();
  } catch {
    return false;
  }
}

/** Remove the persisted disable-gpu flag, if present. Best-effort. Returns
 *  true when the flag is gone (removed or never existed). */
function clearGpuFlag(why: string): boolean {
  try {
    if (existsSync(flagPath())) {
      rmSync(flagPath(), { force: true });
      console.warn(
        `[GPU] ${why} — cleared persisted disable-gpu.flag; ` +
          "hardware acceleration re-enabled.",
      );
    }
    return true;
  } catch (err) {
    console.error("[GPU] Failed to clear disable-gpu flag:", err);
    return false;
  }
}

/**
 * Apply GPU-disabling switches. MUST be called before app is ready (i.e. at
 * module load, before app.whenReady()), otherwise app.disableHardwareAcceleration()
 * throws and the command-line switches are ignored.
 */
export function applyGpuPreferences(): void {
  bootPreference ??= getGpuPreference();
  // An explicit force-enable should also wipe any persisted flag so the
  // choice sticks on future launches, not just this one.
  if (gpuEnvOverride() === "off" || !shouldHonorPersistedGpuFlag()) {
    clearGpuFlag("HERMES_DISABLE_GPU override");
  } else if (
    gpuEnvOverride() !== "on" &&
    existsSync(flagPath()) &&
    isFlagStale()
  ) {
    // The crash that justified software rendering is old news. Delete the
    // flag and retry hardware acceleration; installGpuCrashGuard re-arms on
    // this launch and will re-persist a fresh flag if the GPU still crashes.
    clearGpuFlag("Persisted flag expired, retrying hardware acceleration");
  }
  if (!isGpuDisabled()) return;
  console.warn(
    "[GPU] Hardware acceleration disabled (software rendering). " +
      "Set HERMES_DISABLE_GPU=0 or delete the disable-gpu.flag file to re-enable.",
  );
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("disable-gpu-compositing");
  // Keep the software (SwiftShader) rasterizer available so WebGL surfaces — the
  // Office 3D tab — still render when hardware acceleration is off (VMs, headless
  // GPUs, machines whose GPU process crashes). We deliberately do NOT pass
  // --disable-software-rasterizer. Chromium 136 gates SwiftShader-backed WebGL
  // behind --enable-unsafe-swiftshader, so opt in explicitly; without it WebGL
  // context creation fails ("Could not create a WebGL context ... Disabled").
  app.commandLine.appendSwitch("enable-unsafe-swiftshader");
}

/** Persist the disable-gpu flag. Returns false if the write failed so the
 *  caller can fall back to the relaunch sentinel and avoid a crash loop. */
function persistGpuDisabled(): boolean {
  try {
    const dir = app.getPath("userData");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(flagPath(), new Date().toISOString(), "utf-8");
    return true;
  } catch (err) {
    console.error("[GPU] Failed to persist disable-gpu flag:", err);
    return false;
  }
}

export function getGpuStatus(): GpuStatus {
  const preference = getGpuPreference();
  // Outside the real boot path (tests, or callers before applyGpuPreferences)
  // the current file content is the best available boot approximation.
  const boot = bootPreference ?? preference;
  if (!isGpuDisabled()) {
    return {
      disabled: false,
      reason: null,
      flagWrittenAt: null,
      canReenable: false,
      preference,
      bootPreference: boot,
    };
  }
  if (gpuEnvOverride() === "on") {
    return {
      disabled: true,
      reason: "env",
      flagWrittenAt: null,
      canReenable: false,
      preference,
      bootPreference: boot,
    };
  }
  if (process.argv.includes(GPU_DISABLE_ARG)) {
    return {
      disabled: true,
      reason: "sentinel",
      flagWrittenAt: flagWrittenAt()?.toISOString() ?? null,
      canReenable: true,
      preference,
      bootPreference: boot,
    };
  }
  if (preference === "off") {
    // The user's own Settings choice — informational only; changing it lives
    // in Settings, not in the Office banner's one-click recovery.
    return {
      disabled: true,
      reason: "preference",
      flagWrittenAt: null,
      canReenable: false,
      preference,
      bootPreference: boot,
    };
  }
  return {
    disabled: true,
    reason: "flag",
    flagWrittenAt: flagWrittenAt()?.toISOString() ?? null,
    canReenable: true,
    preference,
    bootPreference: boot,
  };
}

/** Relaunch without the GPU-off sentinel so the next process re-derives GPU
 *  state from env/preference/flag alone (used after a preference change). */
export function relaunchApp(): void {
  const args = process.argv.slice(1).filter((a) => a !== GPU_DISABLE_ARG);
  app.relaunch({ args });
  app.exit(0);
}

/**
 * User-initiated recovery: delete the persisted flag and relaunch without the
 * GPU-off sentinel so the next process tries hardware acceleration again. If
 * the GPU still crashes, the crash guard writes a fresh flag — no crash loop.
 * Returns false (and does nothing) when the env var forces GPU off, since a
 * relaunch would inherit it.
 */
export function reenableGpuAndRelaunch(): boolean {
  if (gpuEnvOverride() === "on") return false;
  clearGpuFlag("User requested hardware acceleration");
  relaunchApp();
  return true;
}

/**
 * Watch for fatal GPU process crashes. When the GPU process dies abnormally
 * (the symptom on machines with virtual display adapters), persist the
 * disable-gpu flag and relaunch the app with software rendering instead of
 * letting Chromium retry-then-fatally-exit. Only acts once per launch.
 *
 * Register this early (before app is ready); the event itself fires later.
 */
export function installGpuCrashGuard(): void {
  if (!shouldHonorPersistedGpuFlag()) return;
  // Already running with GPU disabled — nothing left to guard against.
  if (isGpuDisabled()) return;

  let recovering = false;
  app.on("child-process-gone", (_event, details) => {
    if (details.type !== "GPU") return;
    // A clean exit isn't a crash — ignore it.
    if (details.reason === "clean-exit") return;
    if (recovering) return;
    recovering = true;

    console.error(
      `[GPU] GPU process gone (reason=${details.reason}, exitCode=${details.exitCode}). ` +
        "Disabling hardware acceleration and relaunching with software rendering.",
    );
    // A "force on" preference means the user overrules persistent fallback:
    // the sentinel still rescues this session, but no flag is written, so the
    // next launch honors their choice and tries hardware acceleration again.
    const forcedOn = getGpuPreference() === "on";
    const persisted = forcedOn ? false : persistGpuDisabled();
    if (!forcedOn && !persisted) {
      console.error(
        "[GPU] Could not persist disable-gpu.flag (read-only/locked filesystem?). " +
          "Relaunching with a one-shot switch; hardware acceleration may need to be " +
          "disabled manually via HERMES_DISABLE_GPU=1 if this recurs.",
      );
    }
    // Carry the sentinel arg so the relaunched process starts GPU-off even if
    // the flag write failed — this is what prevents an infinite crash loop.
    const args = process.argv
      .slice(1)
      .filter((a) => a !== GPU_DISABLE_ARG)
      .concat(GPU_DISABLE_ARG);
    app.relaunch({ args });
    app.exit(0);
  });
}
