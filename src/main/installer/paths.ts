import {
  existsSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  readdirSync,
} from "fs";
import { join, resolve, delimiter } from "path";
import { homedir } from "os";
import { app } from "electron";

export const IS_WINDOWS = process.platform === "win32";

function looksLikeHermesHome(dir: string): boolean {
  if (!existsSync(dir)) return false;
  return (
    existsSync(join(dir, "hermes-agent")) ||
    existsSync(join(dir, "gateway.pid")) ||
    existsSync(join(dir, "config.yaml")) ||
    existsSync(join(dir, "active_profile")) ||
    existsSync(join(dir, ".env"))
  );
}

function defaultHermesHome(): string {
  const homeDot = join(homedir(), ".hermes");
  if (!IS_WINDOWS) return homeDot;

  const localApp = process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, "hermes")
    : null;

  // Prefer whichever location already has hermes data.
  if (localApp && looksLikeHermesHome(localApp)) return localApp;
  if (looksLikeHermesHome(homeDot)) return homeDot;

  // Neither populated yet — fall back to install.ps1's default so a
  // fresh install lines up with where the installer will write.
  return localApp ?? homeDot;
}

export function shQuote(s: string): string {
  return `'${s.replace(/'/g, "'\"'\"'")}'`;
}

export function getBundledScriptPath(scriptName: string): string {
  const appPath = app?.getAppPath
    ? app.getAppPath()
    : resolve(__dirname, "../..");
  const isPackaged = app?.isPackaged ?? false;
  if (isPackaged) {
    return join(appPath, "..", "app.asar.unpacked", "resources", scriptName);
  } else {
    return join(appPath, "resources", scriptName);
  }
}

function hermesHomeOverrideFile(): string {
  const userData = app?.getPath?.("userData");
  return userData ? join(userData, "hermes-home.json") : "";
}

function readHermesHomeOverride(): string {
  try {
    const file = hermesHomeOverrideFile();
    if (!file || !existsSync(file)) return "";
    const parsed = JSON.parse(readFileSync(file, "utf-8")) as {
      hermesHome?: unknown;
    };
    const p =
      typeof parsed.hermesHome === "string" ? parsed.hermesHome.trim() : "";
    // Ignore a stale override whose directory no longer exists.
    return p && existsSync(p) ? p : "";
  } catch {
    return "";
  }
}

export function setHermesHomeOverride(home: string): void {
  try {
    const file = hermesHomeOverrideFile();
    if (!file) return;
    if (!home.trim()) {
      if (existsSync(file)) unlinkSync(file);
      return;
    }
    writeFileSync(
      file,
      JSON.stringify({ hermesHome: home.trim() }, null, 2),
      "utf-8",
    );
  } catch {
    /* best effort */
  }
}

export const HERMES_HOME =
  process.env.HERMES_HOME?.trim() ||
  readHermesHomeOverride() ||
  defaultHermesHome();
export const HERMES_REPO = join(HERMES_HOME, "hermes-agent");
export const HERMES_VENV = join(HERMES_REPO, "venv");
export const HERMES_PYTHON = IS_WINDOWS
  ? join(HERMES_VENV, "Scripts", "pythonw.exe")
  : join(HERMES_VENV, "bin", "python");
export const HERMES_SCRIPT = IS_WINDOWS
  ? join(HERMES_VENV, "Scripts", "hermes.exe")
  : join(HERMES_REPO, "hermes");
export const HERMES_ENV_FILE = join(HERMES_HOME, ".env");
export const HERMES_CONFIG_FILE = join(HERMES_HOME, "config.yaml");
export const HERMES_AUTH_FILE = join(HERMES_HOME, "auth.json");

export function installBinariesFor(home: string): {
  python: string;
  script: string;
} {
  const repo = join(home, "hermes-agent");
  const venv = join(repo, "venv");
  return IS_WINDOWS
    ? {
        python: join(venv, "Scripts", "python.exe"),
        script: join(venv, "Scripts", "hermes.exe"),
      }
    : { python: join(venv, "bin", "python"), script: join(repo, "hermes") };
}

export function hermesCliArgs(args: string[] = []): string[] {
  if (process.platform === "win32") {
    return ["-m", "hermes_cli.main", ...args];
  }
  return [HERMES_SCRIPT, ...args];
}

export function getEnhancedPath(): string {
  const home = homedir();
  const extra = (
    IS_WINDOWS
      ? [
          join(HERMES_HOME, "git", "bin"),
          join(HERMES_HOME, "git", "cmd"),
          join(HERMES_HOME, "git", "usr", "bin"),
          join(HERMES_HOME, "node"),
          join(HERMES_VENV, "Scripts"),
          process.env.NVM_SYMLINK,
          process.env.APPDATA ? join(process.env.APPDATA, "npm") : undefined,
          process.env.ProgramFiles
            ? join(process.env.ProgramFiles, "nodejs")
            : undefined,
          process.env["ProgramFiles(x86)"]
            ? join(process.env["ProgramFiles(x86)"], "nodejs")
            : undefined,
          process.env.ProgramFiles
            ? join(process.env.ProgramFiles, "Git", "cmd")
            : undefined,
          process.env.LOCALAPPDATA
            ? join(process.env.LOCALAPPDATA, "Programs", "Git", "cmd")
            : undefined,
          join(home, ".local", "bin"),
          join(home, ".cargo", "bin"),
        ]
      : [
          join(home, ".local", "bin"),
          join(home, ".cargo", "bin"),
          join(HERMES_VENV, "bin"),
          join(home, ".volta", "bin"),
          join(home, ".asdf", "shims"),
          join(home, ".local", "share", "fnm", "aliases", "default", "bin"),
          join(home, ".fnm", "aliases", "default", "bin"),
          ...resolveNvmBin(home),
          "/usr/local/bin",
          "/opt/homebrew/bin",
          "/opt/homebrew/sbin",
        ]
  ).filter((entry): entry is string => Boolean(entry));
  return [...extra, process.env.PATH || ""].filter(Boolean).join(delimiter);
}

function resolveNvmBin(home: string): string[] {
  const nvmDir = process.env.NVM_DIR || join(home, ".nvm");
  const versionsDir = join(nvmDir, "versions", "node");
  if (!existsSync(versionsDir)) return [];
  try {
    const aliasFile = join(nvmDir, "alias", "default");
    if (existsSync(aliasFile)) {
      const alias = readFileSync(aliasFile, "utf-8").trim();
      if (alias.startsWith("v")) {
        const bin = join(versionsDir, alias, "bin");
        if (existsSync(bin)) return [bin];
      }
    }
    const versions = (readdirSync(versionsDir) as string[])
      .filter((d: string) => d.startsWith("v"))
      .sort()
      .reverse();
    if (versions.length > 0) {
      return [join(versionsDir, versions[0], "bin")];
    }
  } catch {
    /* non-fatal */
  }
  return [];
}
