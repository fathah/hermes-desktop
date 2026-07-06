/**
 * WSL detection + sibling `~/.hermes/` discovery.
 *
 * Hermes One on Windows reads its config from
 * `%LocalAppData%\hermes\`. Users who also run the `hermes` CLI inside
 * a WSL distro have a second, separate `~/.hermes/` at
 * `/home/<user>/.hermes/` on the WSL filesystem. The two are
 * independent — settings configured in one don't appear in the other.
 *
 * This module enumerates accessible WSL `~/.hermes/` directories so
 * the config-health audit can flag drift between the Windows-side
 * config and any sibling. Fail-soft throughout: any error, missing
 * tool, or unreachable distro returns an empty list — never throws.
 */

import { existsSync, readdirSync, statSync } from "fs";
import { execFileSync } from "child_process";

const IS_WINDOWS = process.platform === "win32";

/** Path to the WSL CLI on Windows. Used both as an existence check
 *  and to enumerate distros via `wsl.exe -l -q` — which per
 *  Microsoft docs does NOT start any distro, so it's safe to call
 *  on a cold WSL. */
const WSL_EXE = "C:\\Windows\\System32\\wsl.exe";

/**
 * Information about one sibling `~/.hermes/` discovered on a WSL
 * distro's filesystem. Paths are Windows UNC-style so they can be
 * passed straight to `fs.readFileSync` and friends.
 */
export interface SiblingHermesHome {
  /** WSL distro name, e.g. "Ubuntu". */
  distro: string;
  /** Linux user the home dir belongs to, e.g. "pmos6". */
  user: string;
  /** UNC-style path to the .hermes directory on the WSL fs, e.g.
   *  `\\wsl$\Ubuntu\home\pmos6\.hermes`. Always uses backslashes
   *  because that's what UNC + Node `fs` expect on Windows. */
  hermesHome: string;
}

/** True iff this is a Windows host with WSL installed. The check is a
 *  pure existsSync — fast, side-effect-free, doesn't wake any
 *  distro. */
export function isWindowsHostWithWsl(): boolean {
  if (!IS_WINDOWS) return false;
  try {
    return existsSync(WSL_EXE);
  } catch {
    return false;
  }
}

/**
 * Enumerate WSL distros via `wsl.exe -l -q`. Per Microsoft docs,
 * `--list` does NOT start any distro, so this is safe to call on a
 * cold WSL — it just enumerates what's installed. Output is one
 * distro name per line, UTF-16LE encoded.
 *
 * Previously this used `readdirSync("\\\\wsl$\\")` to avoid spawning
 * a subprocess, but Node's path normalisation mangles the bare
 * `\\wsl$\` root into `C:\wsl$\` and ENOENTs out — even though the
 * per-distro paths like `\\wsl$\Ubuntu-24.04\...` resolve fine.
 * Caught in live testing; the readdir approach would have made the
 * check silently never fire on real WSL hosts.
 *
 * Returns [] if WSL isn't installed, `wsl.exe` errors, or anything
 * throws. Fail-soft.
 */
export function listWslDistros(): string[] {
  if (!isWindowsHostWithWsl()) return [];
  try {
    const raw = execFileSync(WSL_EXE, ["-l", "-q"], {
      encoding: "utf16le",
      timeout: 5000,
      windowsHide: true,
    });
    return String(raw)
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  } catch {
    return [];
  }
}

/**
 * Find every accessible sibling `~/.hermes/` across all WSL distros.
 * Walks each distro's `/home/<user>/.hermes` and yields one entry per
 * existing dir.
 *
 * Performance: filesystem-only, no subprocess. Each distro contributes
 * one `readdirSync` of `/home/`. Cached for `CACHE_TTL_MS` so the
 * audit doesn't re-walk on every panel render.
 */
const CACHE_TTL_MS = 60 * 1000;
let _cache: { ts: number; result: SiblingHermesHome[] } | null = null;

export function findSiblingHermesHomes(): SiblingHermesHome[] {
  if (_cache && Date.now() - _cache.ts < CACHE_TTL_MS) {
    return _cache.result;
  }
  const result: SiblingHermesHome[] = [];
  try {
    for (const distro of listWslDistros()) {
      const homesRoot = `\\\\wsl$\\${distro}\\home`;
      let users: string[] = [];
      try {
        if (!existsSync(homesRoot)) continue;
        users = readdirSync(homesRoot);
      } catch {
        continue;
      }
      for (const user of users) {
        const hermesHome = `\\\\wsl$\\${distro}\\home\\${user}\\.hermes`;
        try {
          if (existsSync(hermesHome) && statSync(hermesHome).isDirectory()) {
            result.push({ distro, user, hermesHome });
          }
        } catch {
          // distro stopped or permission-denied — skip silently
        }
      }
    }
  } catch {
    // any unexpected error → empty result, never blocks the audit
  }
  _cache = { ts: Date.now(), result };
  return result;
}

/** Test-only — clear the cache so repeat invocations re-walk the fs. */
export function _clearWslCache(): void {
  _cache = null;
}

/**
 * Best-effort `wsl --status` check. Used only for diagnostic display;
 * not on the hot path of `findSiblingHermesHomes`. Returns the raw
 * output (trimmed) or null on any error.
 */
export function wslStatus(): string | null {
  if (!isWindowsHostWithWsl()) return null;
  try {
    const out = execFileSync(WSL_EXE, ["--status"], {
      encoding: "utf-8",
      timeout: 5000,
      windowsHide: true,
    });
    return String(out).trim();
  } catch {
    return null;
  }
}
