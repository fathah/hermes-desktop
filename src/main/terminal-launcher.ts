import { execFile, spawn } from "child_process";
import {
  accessSync,
  constants,
  existsSync,
  readdirSync,
  realpathSync,
} from "fs";
import { posix, win32 } from "path";
import { promisify } from "util";

export interface TerminalCommand {
  command: string;
  args: string[];
  cwd: string;
}

interface ResolveOptions {
  env?: NodeJS.ProcessEnv;
  exists?: (filePath: string) => boolean;
  getWindowsPackageInstallLocations?: (
    packageName: string,
    systemRoot: string,
  ) => string[];
  listDirs?: (dirPath: string) => string[];
  platform?: NodeJS.Platform;
  realpath?: (filePath: string) => string;
}

const LINUX_TERMINALS = [
  "x-terminal-emulator",
  "gnome-terminal",
  "konsole",
  "xfce4-terminal",
  "mate-terminal",
  "xterm",
];

const execFileAsync = promisify(execFile);
const windowsPackageLocationCache = new Map<string, Promise<string[]>>();

function pathForPlatform(
  platform: NodeJS.Platform,
): typeof win32 | typeof posix {
  return platform === "win32" ? win32 : posix;
}

function pathDelimiterForPlatform(platform: NodeJS.Platform): string {
  return platform === "win32" ? ";" : ":";
}

function isPathInsideOrEqual(
  filePath: string,
  rootPath: string,
  platform: NodeJS.Platform,
): boolean {
  const pathApi = pathForPlatform(platform);
  const relative = pathApi.relative(
    pathApi.resolve(rootPath),
    pathApi.resolve(filePath),
  );
  return (
    relative === "" ||
    (!relative.startsWith("..") && !pathApi.isAbsolute(relative))
  );
}

function defaultExists(filePath: string): boolean {
  if (process.platform === "win32") return existsSync(filePath);
  try {
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function defaultRealpath(filePath: string): string {
  return realpathSync.native(filePath);
}

function defaultListDirs(dirPath: string): string[] {
  try {
    return readdirSync(dirPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

async function defaultWindowsPackageInstallLocationsAsync(
  packageName: string,
  systemRoot: string,
): Promise<string[]> {
  const cacheKey = `${systemRoot}\0${packageName}`;
  const cached = windowsPackageLocationCache.get(cacheKey);
  if (cached) return cached;

  const promise = queryWindowsPackageInstallLocations(
    packageName,
    systemRoot,
  ).then((locations) => {
    if (locations.length === 0) windowsPackageLocationCache.delete(cacheKey);
    return locations;
  });
  windowsPackageLocationCache.set(cacheKey, promise);
  return promise;
}

async function queryWindowsPackageInstallLocations(
  packageName: string,
  systemRoot: string,
): Promise<string[]> {
  const powershell = win32.join(
    systemRoot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  if (!existsSync(powershell)) return [];

  try {
    const { stdout } = (await execFileAsync(
      powershell,
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        [
          `$packages = Get-AppxPackage -Name '${packageName}'`,
          "$packages | Sort-Object Version -Descending | Select-Object -ExpandProperty InstallLocation",
        ].join("; "),
      ],
      {
        encoding: "utf8",
        timeout: 3000,
        windowsHide: true,
      },
    )) as { stdout: string };
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function tryRealpath(
  filePath: string,
  realpath: (path: string) => string,
): string | null {
  try {
    return realpath(filePath);
  } catch {
    return null;
  }
}

function windowsSystemDrive(env: NodeJS.ProcessEnv): string {
  const drive = env.SystemDrive || "C:";
  return /^[a-z]:$/i.test(drive) ? drive : "C:";
}

function findWindowsAppsExecutable(
  programFiles: string,
  packagePrefix: string,
  exeName: string,
  exists: (filePath: string) => boolean,
  listDirs: (dirPath: string) => string[],
): string | null {
  const windowsApps = win32.join(programFiles, "WindowsApps");
  const packageDirs = listDirs(windowsApps)
    .filter((name) => name.startsWith(packagePrefix))
    .sort()
    .reverse();

  for (const packageDir of packageDirs) {
    const exePath = win32.join(windowsApps, packageDir, exeName);
    if (exists(exePath)) return exePath;
  }

  return null;
}

function findTrustedWindowsPackageExecutable(
  packageName: string,
  packagePrefix: string,
  exeName: string,
  programFiles: string,
  systemRoot: string,
  exists: (filePath: string) => boolean,
  listDirs: (dirPath: string) => string[],
  getPackageInstallLocations: (
    packageName: string,
    systemRoot: string,
  ) => string[],
): string | null {
  const windowsApps = win32.join(programFiles, "WindowsApps");

  for (const installLocation of getPackageInstallLocations(
    packageName,
    systemRoot,
  )) {
    const normalized = win32.normalize(installLocation);
    const packageDir = win32.basename(normalized);
    if (!packageDir.startsWith(packagePrefix)) continue;
    if (!isPathInsideOrEqual(normalized, windowsApps, "win32")) continue;

    const exePath = win32.join(normalized, exeName);
    if (exists(exePath)) return exePath;
  }

  return findWindowsAppsExecutable(
    programFiles,
    packagePrefix,
    exeName,
    exists,
    listDirs,
  );
}

async function findTrustedWindowsPackageExecutableAsync(
  packageName: string,
  packagePrefix: string,
  exeName: string,
  programFiles: string,
  systemRoot: string,
  exists: (filePath: string) => boolean,
  listDirs: (dirPath: string) => string[],
  getPackageInstallLocations: (
    packageName: string,
    systemRoot: string,
  ) => Promise<string[]>,
): Promise<string | null> {
  const windowsApps = win32.join(programFiles, "WindowsApps");

  for (const installLocation of await getPackageInstallLocations(
    packageName,
    systemRoot,
  )) {
    const normalized = win32.normalize(installLocation);
    const packageDir = win32.basename(normalized);
    if (!packageDir.startsWith(packagePrefix)) continue;
    if (!isPathInsideOrEqual(normalized, windowsApps, "win32")) continue;

    const exePath = win32.join(normalized, exeName);
    if (exists(exePath)) return exePath;
  }

  return findWindowsAppsExecutable(
    programFiles,
    packagePrefix,
    exeName,
    exists,
    listDirs,
  );
}

function resolveExecutableFromPath(
  command: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  exists: (filePath: string) => boolean,
  realpath: (filePath: string) => string,
  blockedRoot: string,
): string | null {
  const pathApi = pathForPlatform(platform);
  const trimmed = command.trim();
  if (!trimmed || /[\s"'`]/.test(trimmed)) return null;
  const blockedRealpath = exists(blockedRoot)
    ? tryRealpath(blockedRoot, realpath) || blockedRoot
    : blockedRoot;

  if (pathApi.isAbsolute(trimmed)) {
    if (!exists(trimmed)) return null;
    const resolved = tryRealpath(trimmed, realpath);
    if (!resolved) return null;
    if (isPathInsideOrEqual(resolved, blockedRealpath, platform)) return null;
    return resolved;
  }

  // Do not support relative paths here: the terminal launcher should never
  // resolve an executable from the selected worktree.
  if (trimmed.includes("/") || trimmed.includes("\\")) return null;

  const rawPath = env.PATH || env.Path || "";
  const entries = rawPath
    .split(pathDelimiterForPlatform(platform))
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter((entry) => pathApi.isAbsolute(entry));

  const extensions =
    platform === "win32"
      ? (env.PATHEXT || ".EXE;.CMD;.BAT;.COM")
          .split(";")
          .map((ext) => ext.toLowerCase())
      : [""];
  const hasExtension =
    platform === "win32" && Boolean(pathApi.extname(trimmed));

  for (const entry of entries) {
    const candidates =
      platform === "win32" && !hasExtension
        ? extensions.map((ext) => pathApi.join(entry, `${trimmed}${ext}`))
        : [pathApi.join(entry, trimmed)];
    for (const candidate of candidates) {
      if (!exists(candidate)) continue;
      const resolved = tryRealpath(candidate, realpath);
      if (!resolved) continue;
      if (!isPathInsideOrEqual(resolved, blockedRealpath, platform)) {
        return resolved;
      }
    }
  }

  return null;
}

function linuxTerminalArgs(resolvedPath: string, dirPath: string): string[] {
  const executable = posix.basename(resolvedPath);
  if (
    executable === "gnome-terminal" ||
    executable === "gnome-terminal.wrapper" ||
    executable === "xfce4-terminal" ||
    executable === "mate-terminal"
  ) {
    return [`--working-directory=${dirPath}`];
  }
  if (executable === "konsole") {
    return ["--workdir", dirPath];
  }
  return [];
}

function hasCmdControlChars(value: string): boolean {
  return /["^&|<>()%!]/.test(value);
}

function resolveWindowsTerminal(
  dirPath: string,
  env: NodeJS.ProcessEnv,
  exists: (filePath: string) => boolean,
  listDirs: (dirPath: string) => string[],
  getPackageInstallLocations: (
    packageName: string,
    systemRoot: string,
  ) => string[],
): TerminalCommand | null {
  const systemDrive = windowsSystemDrive(env);
  const systemRoot = win32.join(systemDrive, "Windows");
  const programFiles = win32.join(systemDrive, "Program Files");
  const programFilesX86 = win32.join(systemDrive, "Program Files (x86)");
  const cmd = win32.join(systemRoot, "System32", "cmd.exe");
  if (!exists(cmd)) return null;
  if (hasCmdControlChars(dirPath)) return null;

  const startCommand = (target: string, args: string[]): TerminalCommand => ({
    command: cmd,
    args: ["/d", "/s", "/c", "start", "", "/D", dirPath, target, ...args],
    cwd: dirPath,
  });

  const pwshCandidates = [
    win32.join(programFiles, "PowerShell", "7", "pwsh.exe"),
    win32.join(programFilesX86, "PowerShell", "7", "pwsh.exe"),
    findTrustedWindowsPackageExecutable(
      "Microsoft.PowerShell",
      "Microsoft.PowerShell_",
      "pwsh.exe",
      programFiles,
      systemRoot,
      exists,
      listDirs,
      getPackageInstallLocations,
    ),
  ];
  const pwsh = pwshCandidates.find((candidate): candidate is string =>
    Boolean(candidate && exists(candidate)),
  );
  if (pwsh) {
    return startCommand(pwsh, ["-NoExit", "-NoLogo"]);
  }

  const windowsTerminal =
    findTrustedWindowsPackageExecutable(
      "Microsoft.WindowsTerminal",
      "Microsoft.WindowsTerminal_",
      "WindowsTerminal.exe",
      programFiles,
      systemRoot,
      exists,
      listDirs,
      getPackageInstallLocations,
    ) ||
    findTrustedWindowsPackageExecutable(
      "Microsoft.WindowsTerminalPreview",
      "Microsoft.WindowsTerminalPreview_",
      "WindowsTerminal.exe",
      programFiles,
      systemRoot,
      exists,
      listDirs,
      getPackageInstallLocations,
    );
  if (windowsTerminal && exists(windowsTerminal)) {
    return startCommand(windowsTerminal, ["-d", dirPath]);
  }

  const powershell = win32.join(
    systemRoot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  if (exists(powershell)) {
    return startCommand(powershell, ["-NoExit", "-NoLogo"]);
  }

  return null;
}

async function resolveWindowsTerminalAsync(
  dirPath: string,
  env: NodeJS.ProcessEnv,
  exists: (filePath: string) => boolean,
  listDirs: (dirPath: string) => string[],
  getPackageInstallLocations: (
    packageName: string,
    systemRoot: string,
  ) => Promise<string[]>,
): Promise<TerminalCommand | null> {
  const systemDrive = windowsSystemDrive(env);
  const systemRoot = win32.join(systemDrive, "Windows");
  const programFiles = win32.join(systemDrive, "Program Files");
  const programFilesX86 = win32.join(systemDrive, "Program Files (x86)");
  const cmd = win32.join(systemRoot, "System32", "cmd.exe");
  if (!exists(cmd)) return null;
  if (hasCmdControlChars(dirPath)) return null;

  const startCommand = (target: string, args: string[]): TerminalCommand => ({
    command: cmd,
    args: ["/d", "/s", "/c", "start", "", "/D", dirPath, target, ...args],
    cwd: dirPath,
  });

  const packagePwsh = await findTrustedWindowsPackageExecutableAsync(
    "Microsoft.PowerShell",
    "Microsoft.PowerShell_",
    "pwsh.exe",
    programFiles,
    systemRoot,
    exists,
    listDirs,
    getPackageInstallLocations,
  );
  const pwshCandidates = [
    win32.join(programFiles, "PowerShell", "7", "pwsh.exe"),
    win32.join(programFilesX86, "PowerShell", "7", "pwsh.exe"),
    packagePwsh,
  ];
  const pwsh = pwshCandidates.find((candidate): candidate is string =>
    Boolean(candidate && exists(candidate)),
  );
  if (pwsh) {
    return startCommand(pwsh, ["-NoExit", "-NoLogo"]);
  }

  const windowsTerminal =
    (await findTrustedWindowsPackageExecutableAsync(
      "Microsoft.WindowsTerminal",
      "Microsoft.WindowsTerminal_",
      "WindowsTerminal.exe",
      programFiles,
      systemRoot,
      exists,
      listDirs,
      getPackageInstallLocations,
    )) ||
    (await findTrustedWindowsPackageExecutableAsync(
      "Microsoft.WindowsTerminalPreview",
      "Microsoft.WindowsTerminalPreview_",
      "WindowsTerminal.exe",
      programFiles,
      systemRoot,
      exists,
      listDirs,
      getPackageInstallLocations,
    ));
  if (windowsTerminal && exists(windowsTerminal)) {
    return startCommand(windowsTerminal, ["-d", dirPath]);
  }

  const powershell = win32.join(
    systemRoot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  if (exists(powershell)) {
    return startCommand(powershell, ["-NoExit", "-NoLogo"]);
  }

  return null;
}

export function resolveTerminalCommand(
  dirPath: string,
  options: ResolveOptions = {},
): TerminalCommand | null {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const exists = options.exists || defaultExists;
  const listDirs = options.listDirs || defaultListDirs;
  const realpath = options.realpath || defaultRealpath;

  if (platform === "win32") {
    return resolveWindowsTerminal(
      dirPath,
      env,
      exists,
      listDirs,
      options.getWindowsPackageInstallLocations || (() => []),
    );
  }

  if (platform === "darwin") {
    const open = "/usr/bin/open";
    return exists(open)
      ? { command: open, args: ["-a", "Terminal", dirPath], cwd: dirPath }
      : null;
  }

  const candidates = [env.TERMINAL, ...LINUX_TERMINALS].filter(
    (candidate): candidate is string => Boolean(candidate),
  );
  for (const candidate of candidates) {
    const resolved = resolveExecutableFromPath(
      candidate,
      env,
      platform,
      exists,
      realpath,
      dirPath,
    );
    if (resolved) {
      return {
        command: resolved,
        args: linuxTerminalArgs(resolved, dirPath),
        cwd: dirPath,
      };
    }
  }

  return null;
}

export async function resolveTerminalCommandAsync(
  dirPath: string,
  options: ResolveOptions = {},
): Promise<TerminalCommand | null> {
  const platform = options.platform || process.platform;
  if (platform !== "win32") return resolveTerminalCommand(dirPath, options);

  const env = options.env || process.env;
  const exists = options.exists || defaultExists;
  const listDirs = options.listDirs || defaultListDirs;
  const getPackageInstallLocations = options.getWindowsPackageInstallLocations
    ? (packageName: string, systemRoot: string): Promise<string[]> =>
        Promise.resolve(
          options.getWindowsPackageInstallLocations?.(
            packageName,
            systemRoot,
          ) || [],
        )
    : defaultWindowsPackageInstallLocationsAsync;

  return resolveWindowsTerminalAsync(
    dirPath,
    env,
    exists,
    listDirs,
    getPackageInstallLocations,
  );
}

export async function openTerminalInDirectory(
  dirPath: string,
): Promise<boolean> {
  const terminal = await resolveTerminalCommandAsync(dirPath);
  if (!terminal) return false;

  return new Promise((resolve) => {
    let settled = false;
    const settle = (value: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(fallbackTimer);
      resolve(value);
    };
    const fallbackTimer = setTimeout(() => settle(true), 1000);
    fallbackTimer.unref?.();

    try {
      const child = spawn(terminal.command, terminal.args, {
        cwd: terminal.cwd,
        detached: true,
        stdio: "ignore",
        windowsHide: false,
      });
      child.once("error", () => settle(false));
      child.once("spawn", () => {
        child.unref();
        settle(true);
      });
    } catch {
      settle(false);
    }
  });
}
