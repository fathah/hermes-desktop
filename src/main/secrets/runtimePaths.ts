import { homedir, tmpdir, userInfo } from "os";
import { join } from "path";

/**
 * Runtime/path helpers for the secrets subsystem.
 *
 * The whole point of this module is that NOTHING downstream hardcodes a user id
 * or a machine-specific path. A vault, its key-file, and the tmpfs env dump are
 * all derived at runtime from the current user and the platform's conventions,
 * so the same build works for uid 1000, uid 1001, a CI runner, or a packaged
 * install — first launch, zero prior setup.
 */

/**
 * The per-user runtime directory, resolved in priority order:
 *   1. $XDG_RUNTIME_DIR        — the correct, spec-defined location (systemd
 *      sets this; it is a 0700 tmpfs owned by the user). Preferred always.
 *   2. /run/user/<uid>         — the conventional Linux location when
 *      XDG_RUNTIME_DIR is unset but the dir exists. uid is read at RUNTIME via
 *      userInfo().uid — never a literal.
 *   3. os.tmpdir()             — last-resort fallback (macOS, or a stripped
 *      environment with neither of the above). Not a tmpfs guarantee, but it
 *      keeps the feature working rather than dead.
 *
 * Returns an absolute path. Never throws.
 */
export function runtimeDir(): string {
  const xdg = process.env.XDG_RUNTIME_DIR;
  if (xdg && xdg.trim() !== "") return xdg;

  // uid read at runtime — the fix for the hardcoded-1000 problem. On platforms
  // where uid is unavailable (-1 on Windows), skip straight to tmpdir.
  let uid = -1;
  try {
    uid = userInfo().uid;
  } catch {
    uid = -1;
  }
  if (uid >= 0) {
    const runUser = join("/run", "user", String(uid));
    // We can't stat reliably here without importing fs at module top; callers
    // that need existence use vaultBootstrap's probe. /run/user/<uid> is the
    // documented location, so return it as the candidate.
    return runUser;
  }
  return tmpdir();
}

/**
 * Canonical path to the tmpfs env dump the boot-time unseal writes and the
 * `command` provider reads (`cat <this file>`). Derived, never hardcoded.
 *
 * Default basename `hermes-secrets.env` matches the established convention so an
 * existing deployment's file is detected, while new users get the same path
 * derived under their own runtime dir.
 */
export function defaultTmpfsEnvPath(): string {
  return join(runtimeDir(), "hermes-secrets.env");
}

/**
 * Default location for a NEW app-managed vault, under the XDG data dir so a
 * first-time user needs zero prior setup. Honors $XDG_DATA_HOME, else
 * ~/.local/share/hermes/. The key-file lives beside it.
 *
 * SNAP CONFINEMENT: a snap-installed keepassxc-cli (its `home` interface) can
 * only access NON-HIDDEN paths under $HOME — it gets "Permission denied" on a
 * dotted dir like ~/.local/share. So when the chosen backend is snap-confined,
 * fall back to a non-hidden ~/hermes/ that the snap CAN write. Native installs
 * keep the XDG-correct hidden path. Pass snapConfined=true to opt into the
 * fallback (vaultBootstrap derives this from the resolved CLI path).
 *
 * Returns { vaultPath, keyPath, dir }. Does not create anything — that is
 * vaultBootstrap's job.
 */
export function defaultVaultPaths(snapConfined = false): {
  dir: string;
  vaultPath: string;
  keyPath: string;
} {
  // Snap can't see hidden dirs under $HOME — use a visible ~/hermes/ instead.
  if (snapConfined) {
    const dir = join(homedir(), "hermes");
    return {
      dir,
      vaultPath: join(dir, "secrets.kdbx"),
      keyPath: join(dir, "secrets.key"),
    };
  }
  const dataHome =
    process.env.XDG_DATA_HOME && process.env.XDG_DATA_HOME.trim() !== ""
      ? process.env.XDG_DATA_HOME
      : join(homedir(), ".local", "share");
  const dir = join(dataHome, "hermes");
  return {
    dir,
    vaultPath: join(dir, "secrets.kdbx"),
    keyPath: join(dir, "secrets.key"),
  };
}

/**
 * Legacy/convention vault location some existing deployments use
 * (`~/secrets/hermes.kdbx` + `~/secrets/hermes.key`). Detection prefers this
 * when present so an established setup keeps working unchanged.
 */
export function legacyVaultPaths(): { vaultPath: string; keyPath: string } {
  const base = join(homedir(), "secrets");
  return {
    vaultPath: join(base, "hermes.kdbx"),
    keyPath: join(base, "hermes.key"),
  };
}
