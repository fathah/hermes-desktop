import {
  execFileSync,
  execFile,
  type ExecFileSyncOptions,
  type ExecFileOptions,
} from "child_process";
import { existsSync, mkdirSync, chmodSync, statSync, readFileSync } from "fs";
import { dirname } from "path";
import {
  defaultTmpfsEnvPath,
  defaultVaultPaths,
  legacyVaultPaths,
} from "./runtimePaths";

/**
 * Vault bootstrap — first-launch creation, detection of an existing vault, and
 * OPT-IN TPM sealing. This is the main-process, security-critical companion to
 * the read/write providers in commandProvider*.ts.
 *
 * Design constraints (first-run, zero-dependency, UID-safe):
 *   - Assume NOTHING exists: no vault, no key-file, no tmpfs dump, and possibly
 *     no keepassxc-cli / no TPM. Every path degrades to an honest, actionable
 *     result rather than a thrown error or a silent failure.
 *   - No hardcoded uid or machine paths: all locations come from runtimePaths.
 *   - Secrets discipline: a generated key-file is written 0600; no secret VALUE
 *     is ever logged or returned to the renderer (callers expose only structural
 *     facts — paths, booleans, counts).
 */

const TOOL_TIMEOUT_MS = 15_000; // db-create / TPM ops can be slower than a read

export type VaultBackend = "keepassxc";

export interface DetectResult {
  /** A usable secrets source was found (tmpfs dump or a vault on disk). */
  found: boolean;
  /** Which thing was found, for the UI to phrase its message. */
  kind: "tmpfs-env" | "vault-file" | "none";
  /** Absolute path of what was found (tmpfs file or vault), if any. */
  path?: string;
  /** Companion key-file path when a vault-file was found. */
  keyPath?: string;
  /** Key NAMES resolvable right now (never values). Only populated for tmpfs. */
  keys?: string[];
  /** A ready-to-use `secrets.command` for the detected source, if applicable. */
  suggestedCommand?: string;
}

export interface ToolAvailability {
  keepassxc: boolean;
  tpm: boolean;
  /** Human-actionable install hint when a tool is missing (never a command we run). */
  keepassxcHint?: string;
  tpmHint?: string;
}

export interface CreateVaultResult {
  ok: boolean;
  vaultPath?: string;
  keyPath?: string;
  /** The `secrets.command` the caller should persist to read this vault. */
  suggestedCommand?: string;
  error?: string;
}

export interface SealResult {
  ok: boolean;
  /** True when the key-file is now TPM-sealed; false = left as a 0600 file. */
  sealed: boolean;
  error?: string;
}

/**
 * Quiet exec: returns trimmed stdout or null on any failure. Never throws.
 *
 * SYNCHRONOUS — reserved for the FAST, sub-100ms probe calls (`command -v`,
 * `readlink`) that run during UI render to decide what affordances to OFFER.
 * Measured: the full checkToolAvailability() probe burst is ~7ms, so blocking
 * the main thread for it is imperceptible. The SLOW subprocesses (db-create,
 * systemd-creds TPM seal — up to TOOL_TIMEOUT_MS) MUST NOT use this; they use
 * tryExecAsync below so a 7–15s op never freezes the Electron main thread
 * (AIR-016). Keep this rule when adding a new exec: fast probe → tryExec; any
 * call that can take seconds (vault create, TPM, network) → tryExecAsync.
 */
function tryExec(
  file: string,
  args: string[],
  opts: ExecFileSyncOptions = {},
): string | null {
  try {
    const out = execFileSync(file, args, {
      timeout: TOOL_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      ...opts,
    });
    return out ? out.toString("utf-8").trim() : "";
  } catch {
    return null;
  }
}

/**
 * Async sibling of tryExec for the SLOW subprocesses (db-create, TPM seal).
 * Returns trimmed stdout or null on any failure (non-zero exit, timeout, spawn
 * error). NEVER throws and NEVER rejects — the whole point is that the caller
 * can `await` it from an async IPC handler without the event loop blocking, so
 * the renderer keeps painting (spinner, cancel) during a 7–15s TPM dance.
 * AIR-016: the wedge was `execFileSync` on the main thread; this is the fix.
 */
function tryExecAsync(
  file: string,
  args: string[],
  opts: ExecFileOptions = {},
): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      {
        timeout: TOOL_TIMEOUT_MS,
        windowsHide: true,
        ...opts,
      },
      (err, stdout) => {
        // Any error (timeout SIGTERM, non-zero exit, ENOENT) → null, never throw.
        if (err) {
          resolve(null);
          return;
        }
        resolve(stdout ? stdout.toString().trim() : "");
      },
    );
  });
}

/** Is a binary on PATH? Uses `command -v` via /bin/sh (POSIX). */
function hasBinary(name: string): boolean {
  if (process.platform === "win32") return false; // POSIX-only feature for now
  const r = tryExec("/bin/sh", ["-c", `command -v ${name}`]);
  return r != null && r !== "";
}

/**
 * Resolve the KeePassXC CLI under any of its known names — DON'T assume the
 * `keepassxc-cli` apt name. Candidates, in priority order:
 *   - `keepassxc-cli`            (Debian/Ubuntu/Fedora/Arch native package)
 *   - `keepassxc.cli`           (Snap exposes the CLI under this dotted name)
 *   - `flatpak run org.keepassxc.KeePassXC --pw-stdin` style is NOT a drop-in
 *     CLI, so flatpak is detected but reported as needing the CLI explicitly.
 *
 * Returns the invokable command (a single token usable as argv[0]) or null.
 * This is what makes the feature work out-of-the-box on apt AND snap systems
 * instead of false-negativing on a snap install.
 */
export function resolveKeepassxcCli(): string | null {
  if (process.platform === "win32") return null;
  for (const cand of ["keepassxc-cli", "keepassxc.cli"]) {
    if (hasBinary(cand)) return cand;
  }
  return null;
}

/**
 * Is the resolved keepassxc CLI a SNAP wrapper? A snap binary resolves through
 * /usr/bin/snap (or lives under /snap/), and its confinement blocks access to
 * hidden ($HOME/.*) paths — so the vault must default to a non-hidden dir.
 * Detected by resolving the command to its real path and checking for /snap.
 */
export function keepassxcIsSnap(cli: string): boolean {
  if (process.platform === "win32") return false;
  // `command -v` gives the PATH entry; readlink -f gives the real target.
  const real = tryExec("/bin/sh", ["-c", `readlink -f "$(command -v ${cli})"`]);
  const where = tryExec("/bin/sh", ["-c", `command -v ${cli}`]);
  return (
    (real != null && real.includes("/snap")) ||
    (where != null && where.includes("/snap"))
  );
}

/**
 * What tooling is available for the create/seal paths. The UI uses this to show
 * a "create new vault" affordance only when it can actually succeed, and to
 * surface an install hint (never a silent missing-dependency dead end) otherwise.
 */
export function checkToolAvailability(): ToolAvailability {
  const keepassxc = resolveKeepassxcCli() !== null;
  // TPM needs both the tooling and an accessible TPM resource manager device.
  const tpmTools = hasBinary("tpm2_create") || hasBinary("systemd-creds");
  const tpmDevice = existsSync("/dev/tpmrm0") || existsSync("/dev/tpm0");
  const tpm = tpmTools && tpmDevice;
  return {
    keepassxc,
    tpm,
    keepassxcHint: keepassxc
      ? undefined
      : "Install KeePassXC (provides keepassxc-cli, or keepassxc.cli via Snap): e.g. `apt install keepassxc`, `snap install keepassxc`, or your distro's package manager.",
    tpmHint: tpm
      ? undefined
      : !tpmDevice
        ? "No TPM device found (/dev/tpmrm0). TPM auto-unlock is unavailable; the key-file will be protected with 0600 file permissions instead."
        : "Install tpm2-tools (provides tpm2_create) to enable TPM auto-unlock.",
  };
}

/**
 * Parse env-shaped KEY=VALUE lines from a tmpfs dump, returning NAMES ONLY.
 * Mirrors the command provider's key shape. Never returns values.
 */
function envKeyNames(text: string): string[] {
  const ENV_LINE = /^([A-Za-z_][A-Za-z0-9_]*)=/;
  const names: string[] = [];
  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(ENV_LINE);
    if (m) names.push(m[1]);
  }
  return names;
}

/**
 * Detect an existing secrets source for first-run UX. Priority:
 *   1. The canonical tmpfs env dump (a boot-time unseal already ran) — the
 *      strongest signal; we can even enumerate its key names. This is the
 *      "you already have hermes-secrets, just use it" auto-detect the operator
 *      asked for.
 *   2. A vault file on disk (legacy ~/secrets first, then the app-default
 *      location). Present but not yet unsealed into tmpfs.
 *   3. Nothing — the caller should offer to CREATE one.
 *
 * Never throws; never returns a secret value.
 */
export function detectExistingVault(): DetectResult {
  // 1. tmpfs env dump
  const tmpfs = defaultTmpfsEnvPath();
  if (existsSync(tmpfs)) {
    let keys: string[] = [];
    try {
      keys = envKeyNames(readFileSync(tmpfs, "utf-8"));
    } catch {
      keys = [];
    }
    return {
      found: true,
      kind: "tmpfs-env",
      path: tmpfs,
      keys,
      // UID-safe: the command is derived, not a literal /run/user/1000.
      suggestedCommand: `cat ${shellQuote(tmpfs)}`,
    };
  }

  // 2. a vault file on disk — legacy convention first, then app default.
  for (const cand of [legacyVaultPaths(), defaultVaultPaths()]) {
    if (existsSync(cand.vaultPath)) {
      const keyPath = existsSync(cand.keyPath) ? cand.keyPath : undefined;
      return {
        found: true,
        kind: "vault-file",
        path: cand.vaultPath,
        keyPath,
        // A keepassxc read command parameterized by the resolved paths.
        suggestedCommand: keyPath
          ? `keepassxc-cli show -q -s -a Password --no-password -k ${shellQuote(keyPath)} ${shellQuote(cand.vaultPath)} "$HERMES_SECRET_KEY"`
          : undefined,
      };
    }
  }

  return { found: false, kind: "none" };
}

/** Minimal POSIX single-quote escaping for paths embedded in a sh command. */
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * Create a NEW KeePassXC vault with a generated key-file, at the app-default
 * (UID-safe) location unless overridden. Returns a ready `secrets.command`.
 *
 * Steps:
 *   1. Pre-flight: keepassxc-cli present? target not already a vault?
 *   2. mkdir -p the data dir (0700).
 *   3. Generate a 512-bit random key-file, write it 0600.
 *   4. `keepassxc-cli db-create --set-key-file <key> <vault>` (no password —
 *      key-file-only, matching the operator's TPM-sealed-key-file model).
 *   5. Return the read command parameterized by the resolved paths.
 *
 * Never logs the key-file contents. Never throws — returns { ok:false, error }.
 */
export async function createVault(opts?: {
  vaultPath?: string;
  keyPath?: string;
}): Promise<CreateVaultResult> {
  const cli = resolveKeepassxcCli();
  if (!cli) {
    return { ok: false, error: "keepassxc-cli-not-installed" };
  }

  // Snap-confined CLI can't write hidden $HOME dirs — default to a visible dir.
  const snap = keepassxcIsSnap(cli);
  const def = defaultVaultPaths(snap);
  const vaultPath = opts?.vaultPath || def.vaultPath;
  const keyPath = opts?.keyPath || def.keyPath;

  if (existsSync(vaultPath)) {
    return { ok: false, error: "vault-already-exists", vaultPath };
  }

  try {
    // 2. data dir, 0700
    const dir = dirname(vaultPath);
    mkdirSync(dir, { recursive: true, mode: 0o700 });

    // 3. create the kdbx, key-file-only (no password -> non-interactive).
    //    IMPORTANT: `--set-key-file <path>` makes keepassxc-cli GENERATE a new
    //    key file at <path> itself — it does NOT consume a pre-existing file.
    //    (Verified against keepassxc-cli 2.7.9: pre-creating the file makes
    //    db-create fail with "Loading the key file failed".) So we must NOT
    //    pre-write the key; we let the CLI own its creation, then lock it down.
    //    `cli` is the resolved name (keepassxc-cli OR snap's keepassxc.cli).
    //    AIR-016: db-create can take seconds (snap-confined CLI, slow disk) — run
    //    it ASYNC so the Electron main thread is not frozen during creation; the
    //    IPC handler awaits. Same class as the TPM-seal wedge.
    const created = await tryExecAsync(cli, [
      "db-create",
      "-q",
      "--set-key-file",
      keyPath,
      vaultPath,
    ]);
    if (created == null || !existsSync(vaultPath) || !existsSync(keyPath)) {
      return { ok: false, error: "db-create-failed" };
    }
    // 4. lock down both artifacts to owner-only.
    chmodSync(keyPath, 0o600);
    chmodSync(vaultPath, 0o600);

    return {
      ok: true,
      vaultPath,
      keyPath,
      // suggestedCommand uses the resolved CLI name so it works on snap too.
      suggestedCommand: `${cli} show -q -s -a Password --no-password -k ${shellQuote(keyPath)} ${shellQuote(vaultPath)} "$HERMES_SECRET_KEY"`,
    };
  } catch {
    return { ok: false, error: "create-exception" };
  }
}

/**
 * OPT-IN: seal an existing key-file to the TPM so it can be unsealed at boot
 * without a passphrase. Uses systemd-creds when available (simplest, handles
 * the TPM2 dance + policy), else falls back to leaving the key-file as a 0600
 * file and reporting sealed:false honestly.
 *
 * This is deliberately conservative: on ANY uncertainty it does NOT claim a
 * seal happened. A false "sealed" would be a security lie (user thinks the key
 * is hardware-protected when it's plaintext on disk).
 *
 * Never throws.
 */
export async function sealKeyFileToTpm(keyPath: string): Promise<SealResult> {
  if (!existsSync(keyPath)) {
    return { ok: false, sealed: false, error: "keyfile-not-found" };
  }
  const tools = checkToolAvailability();
  if (!tools.tpm) {
    // No TPM: ensure the fallback (0600) is actually in place and say so.
    try {
      chmodSync(keyPath, 0o600);
    } catch {
      /* best effort */
    }
    return { ok: true, sealed: false, error: "no-tpm-keyfile-0600-fallback" };
  }

  // Prefer systemd-creds encrypt --with-key=tpm2: writes a TPM-bound blob.
  if (hasBinary("systemd-creds")) {
    const sealedPath = keyPath + ".tpm";
    // AIR-016: this call is the slow one (measured 7–15s, bounded by
    // TOOL_TIMEOUT_MS — the TPM2 + polkit dance). It MUST run async so the
    // Electron main thread is not frozen while it runs; the IPC handler awaits.
    const out = await tryExecAsync("systemd-creds", [
      "encrypt",
      "--with-key=tpm2",
      keyPath,
      sealedPath,
    ]);
    if (out != null && existsSync(sealedPath)) {
      try {
        chmodSync(sealedPath, 0o600);
      } catch {
        /* best effort */
      }
      return { ok: true, sealed: true };
    }
    // VERIFIED (2026-06): `systemd-creds encrypt --with-key=tpm2` requires polkit
    // authentication (io.systemd.InteractiveAuthenticationRequired) — it CANNOT
    // run from an unprivileged GUI process. The key stays 0600 and we report the
    // honest reason so the UI can offer the one-time privileged command instead
    // of silently failing or pretending the key is TPM-sealed.
    try {
      chmodSync(keyPath, 0o600);
    } catch {
      /* best effort */
    }
    return {
      ok: true,
      sealed: false,
      error: "tpm-seal-needs-privilege-keyfile-0600-fallback",
    };
  }

  // tpm2-tools path is more involved (create primary, seal, persist); rather
  // than half-implement it and risk a false "sealed", report that the richer
  // path needs systemd-creds for now and the 0600 fallback stands.
  try {
    chmodSync(keyPath, 0o600);
  } catch {
    /* best effort */
  }
  return {
    ok: true,
    sealed: false,
    error: "tpm-present-but-systemd-creds-absent-keyfile-0600-fallback",
  };
}

/** Permission sanity: is the key-file 0600 (owner-only)? For the audit/UI. */
export function keyFileIsLocked(keyPath: string): boolean {
  try {
    const mode = statSync(keyPath).mode & 0o777;
    return mode === 0o600;
  } catch {
    return false;
  }
}
