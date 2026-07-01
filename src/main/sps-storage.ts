// sps-storage.ts — resolves WHERE the SPS vault lives on disk.
//
// By default the vault is <profileHome>/sps-agent/vault. A user who lives in
// Obsidian can repoint it at their Obsidian vault (ideally a dedicated subfolder)
// so the same markdown is a first-class Obsidian vault. This preserves the one
// rule — "markdown on disk is the source of truth" — because both apps simply
// edit the same files; there is no sync engine and no second source of truth.
//
// The override is per-profile, stored next to the vault, and read synchronously
// so every reader/writer resolves the SAME directory. Changing the location
// NEVER moves or deletes files: it only changes where future reads/writes/index
// point; existing files in the old location are left untouched.
import {
  mkdirSync,
  realpathSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "fs";
import { dirname, isAbsolute, join } from "path";
import { profileHome, getActiveProfileNameSync } from "./utils";

interface SpsStorageConfig {
  /** Absolute path to an override vault directory. Absent ⇒ the default. */
  vaultDir?: string;
}

export interface VaultLocation {
  /** The resolved vault directory in use. */
  dir: string;
  /** True when `dir` is the built-in default (no override active). */
  isDefault: boolean;
  /** The built-in default, for "reset" affordances. */
  default: string;
}

export interface SetVaultResult {
  ok: boolean;
  error?: string;
  location?: VaultLocation;
  /** True when the chosen directory already had content (informational). */
  nonEmpty?: boolean;
}

// ── pure helpers (no I/O — unit-testable) ─────────────────────────────────────

/** Validate a user-supplied vault directory string. */
export function isValidVaultDirInput(dir: string): {
  ok: boolean;
  error?: string;
} {
  const trimmed = dir.trim();
  if (!trimmed) return { ok: false, error: "Choose a folder." };
  if (!isAbsolute(trimmed)) {
    return { ok: false, error: "Choose an absolute folder path." };
  }
  return { ok: true };
}

/** Resolve the effective vault dir: a valid absolute override, else the default. */
export function chooseVaultDir(
  override: string | undefined,
  defaultDir: string,
): string {
  if (override && isAbsolute(override)) {
    try {
      return realpathSync(override);
    } catch {
      return override;
    }
  }
  return defaultDir;
}

// ── I/O wrappers ──────────────────────────────────────────────────────────────

function configPath(profile?: string): string {
  const home = profileHome(profile || getActiveProfileNameSync());
  return join(home, "sps-agent", "sps-storage.json");
}

function defaultVaultDir(profile?: string): string {
  const home = profileHome(profile || getActiveProfileNameSync());
  return join(home, "sps-agent", "vault");
}

function readStorageConfig(profile?: string): SpsStorageConfig {
  try {
    const raw = readFileSync(configPath(profile), "utf-8");
    const parsed = JSON.parse(raw) as SpsStorageConfig;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStorageConfig(cfg: SpsStorageConfig, profile?: string): void {
  const path = configPath(profile);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(cfg, null, 2), "utf-8");
}

/** True when `dir` contains any non-hidden entry (a populated Obsidian vault). */
function isNonEmptyDir(dir: string): boolean {
  try {
    return readdirSync(dir).some((name) => !name.startsWith("."));
  } catch {
    return false;
  }
}

/** The directory every SPS vault reader/writer must use for this profile. */
export function resolveSpsVaultDir(profile?: string): string {
  const override = readStorageConfig(profile).vaultDir;
  return chooseVaultDir(override, defaultVaultDir(profile));
}

export function getVaultLocation(profile?: string): VaultLocation {
  const def = defaultVaultDir(profile);
  const dir = resolveSpsVaultDir(profile);
  return { dir, isDefault: dir === def, default: def };
}

/** Point the SPS vault at `dir` (creating it if needed). Non-destructive. */
export function setVaultLocation(
  dir: string,
  profile?: string,
): SetVaultResult {
  const trimmed = dir.trim();
  const valid = isValidVaultDirInput(trimmed);
  if (!valid.ok) return { ok: false, error: valid.error };

  try {
    mkdirSync(trimmed, { recursive: true });
  } catch (e) {
    return {
      ok: false,
      error: `Can't create that folder: ${(e as Error).message}`,
    };
  }
  const canonicalDir = chooseVaultDir(trimmed, trimmed);
  const def = defaultVaultDir(profile);
  const canonicalDefault = chooseVaultDir(def, def);
  // Setting it back to the default is just a reset.
  if (canonicalDir === canonicalDefault) {
    return { ok: true, location: resetVaultLocation(profile) };
  }

  // Non-destructive writability probe.
  try {
    const probe = join(canonicalDir, ".sps-write-probe");
    writeFileSync(probe, "");
    rmSync(probe, { force: true });
  } catch {
    return { ok: false, error: "That folder isn't writable." };
  }

  const nonEmpty = isNonEmptyDir(canonicalDir);
  writeStorageConfig({ vaultDir: canonicalDir }, profile);
  return { ok: true, location: getVaultLocation(profile), nonEmpty };
}

/** Clear the override — back to <profileHome>/sps-agent/vault. */
export function resetVaultLocation(profile?: string): VaultLocation {
  writeStorageConfig({}, profile);
  return getVaultLocation(profile);
}
