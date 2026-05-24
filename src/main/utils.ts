import { execFileSync } from "child_process";
import { join, dirname } from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { HERMES_HOME } from "./installer";

const PROFILE_NAME_RE = /^[a-z0-9_][a-z0-9_-]{0,63}$/;
export const PROFILE_NAME_ERROR =
  "Profile names may contain lowercase letters, numbers, underscores, and hyphens, and cannot start with a hyphen.";

/**
 * Strip ANSI escape codes from terminal output.
 * Used by hermes.ts, claw3d.ts, and installer.ts when processing
 * child process output for display in the renderer.
 */
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1B\[[0-9;]*[a-zA-Z]|\x1B\][^\x07]*\x07|\x1B\(B|\r/g;

export function stripAnsi(str: string): string {
  return str.replace(ANSI_RE, "");
}

export function isValidNamedProfileName(profile: unknown): profile is string {
  return typeof profile === "string" && PROFILE_NAME_RE.test(profile);
}

export function isValidProfileName(profile: unknown): profile is string {
  return profile === "default" || isValidNamedProfileName(profile);
}

export function normalizeProfileName(profile?: unknown): string | undefined {
  if (profile === undefined || profile === "" || profile === "default") {
    return undefined;
  }

  if (!isValidNamedProfileName(profile)) {
    throw new Error(PROFILE_NAME_ERROR);
  }

  return profile;
}

/**
 * Resolve the home directory for a given profile.
 * 'default' or undefined maps to ~/.hermes; named profiles
 * live under ~/.hermes/profiles/<name>.
 */
export function profileHome(profile?: unknown): string {
  const normalized = normalizeProfileName(profile);
  return normalized ? join(HERMES_HOME, "profiles", normalized) : HERMES_HOME;
}

/**
 * Resolve the standard per-profile file locations (.env, config.yaml) under
 * the profile's home directory.
 */
export function profilePaths(profile?: unknown): {
  envFile: string;
  configFile: string;
  home: string;
} {
  const home = profileHome(profile);
  return {
    home,
    envFile: join(home, ".env"),
    configFile: join(home, "config.yaml"),
  };
}

/**
 * Liveness check for a PID, distinguishing "doesn't exist" from "exists but
 * we can't open it". `process.kill(pid, 0)` is the POSIX-idiomatic check,
 * but on Windows libuv requests PROCESS_TERMINATE access to issue the kill
 * call — and a detached subprocess started by a different console (e.g. the
 * Python hermes CLI launching the gateway as `pythonw` with `--replace`)
 * commonly refuses that handle, raising EPERM. EPERM means the process
 * exists; only ESRCH means it doesn't. The previous catch-all `try/catch
 * return false` conflated those, so the desktop reported the gateway as
 * "Stopped" while it was very much alive.
 */
export function pidIsAlive(pid: number): boolean {
  if (!pid || !Number.isFinite(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // ESRCH: no such process. Everything else (notably EPERM on Windows)
    // means the process is there but we lack rights to signal it.
    return code !== "ESRCH";
  }
}

/**
 * Return the image (.exe) name of the process at `pid` on Windows, or null
 * if the PID isn't found or the lookup fails. Used as a second-stage check
 * on top of `pidIsAlive` because EPERM from `process.kill` only confirms
 * "some Windows process exists at this PID" — it doesn't confirm that
 * process is ours.
 *
 * Important for the WSL coexistence case: when HERMES_HOME points into WSL
 * via UNC, the PID file contains a Linux PID. `process.kill(linuxPid, 0)`
 * runs against Windows' PID space; if a random Windows process happens to
 * own that number, EPERM would lie. Verifying the image name (e.g. starts
 * with "python") catches that.
 *
 * Synchronous tasklist call with a tight timeout — acceptable because it's
 * gated behind a positive liveness check that already short-circuits the
 * common "process is gone" path.
 */
export function getProcessImageNameWin(pid: number): string | null {
  if (process.platform !== "win32") return null;
  if (!pid || !Number.isFinite(pid)) return null;
  try {
    const output = execFileSync(
      "tasklist",
      ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"],
      { encoding: "utf-8", timeout: 5000, windowsHide: true },
    );
    // CSV row format: "image.exe","27652","Console","1","45,000 K"
    // Returns "INFO: No tasks are running…" if the PID doesn't exist.
    const m = output.match(/^"([^"]+)"/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/**
 * Like `pidIsAlive`, but on Windows also verifies the running process's
 * image name matches one of `expectedImagePrefixes` (case-insensitive).
 * This guards against false positives from PID reuse and from WSL-side
 * PIDs being checked against the Windows PID space.
 *
 * If we can't read the image name (`tasklist` missing/timeout/etc.),
 * fall back to trusting `pidIsAlive` rather than blocking — a flaky
 * verification step shouldn't make a healthy gateway look dead.
 */
export function pidIsAliveAs(
  pid: number,
  expectedImagePrefixes: string[],
): boolean {
  if (!pidIsAlive(pid)) return false;
  if (process.platform !== "win32") return true;
  const image = getProcessImageNameWin(pid);
  if (!image) return true; // lookup failed; don't penalize the caller
  const lower = image.toLowerCase();
  return expectedImagePrefixes.some((prefix) =>
    lower.startsWith(prefix.toLowerCase()),
  );
}

/**
 * Read the active profile name from ~/.hermes/active_profile. Returns "default"
 * when the file is missing, empty, or unreadable. Shared sync helper used by
 * installer.ts and config.ts; profiles.ts's async wrapper delegates here.
 */
export function getActiveProfileNameSync(): string {
  try {
    const activeFile = join(HERMES_HOME, "active_profile");
    if (!existsSync(activeFile)) return "default";
    const name = readFileSync(activeFile, "utf-8").trim();
    return name || "default";
  } catch {
    return "default";
  }
}

/**
 * Resolve the session database for the currently active profile. The
 * default profile uses ~/.hermes/state.db; named profiles use
 * ~/.hermes/profiles/<name>/state.db. The desktop's Sessions feature
 * used to read the root state.db unconditionally, so named-profile users
 * saw an empty or wrong session list (issue #311).
 */
export function activeStateDbPath(): string {
  return join(profileHome(getActiveProfileNameSync()), "state.db");
}

/**
 * Escape special regex characters in a string so it can be
 * safely interpolated into a RegExp constructor.
 */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Write a file, creating parent directories if they don't exist.
 * Prevents ENOENT crashes when ~/.hermes has been deleted or doesn't exist yet.
 */
export function safeWriteFile(filePath: string, content: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, content, "utf-8");
}
