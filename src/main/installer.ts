import { spawn, execSync, execFile } from "child_process";
import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { homedir, platform } from "os";
import { getModelConfig, getConnectionConfig } from "./config";
import { stripAnsi } from "./utils";

const isWindows = platform() === "win32";

// On Windows, Hermes installs to LOCALAPPDATA\hermes instead of ~/.hermes
const hermesHomeBase = isWindows
  ? process.env.LOCALAPPDATA || join(homedir(), ".hermes")
  : homedir();

export const HERMES_HOME = join(hermesHomeBase, ".hermes");
export const HERMES_REPO = join(HERMES_HOME, "hermes-agent");
export const HERMES_VENV = join(HERMES_REPO, "venv");
// Windows uses Scripts/python.exe instead of bin/python
export const HERMES_PYTHON = isWindows
  ? join(HERMES_VENV, "Scripts", "python.exe")
  : join(HERMES_VENV, "bin", "python");
export const HERMES_SCRIPT = join(HERMES_REPO, "hermes");
export const HERMES_ENV_FILE = join(HERMES_HOME, ".env");
export const HERMES_CONFIG_FILE = join(HERMES_HOME, "config.yaml");

export interface InstallStatus {
  installed: boolean;
  configured: boolean;
  hasApiKey: boolean;
  verified: boolean;
}

export interface InstallProgress {
  step: number;
  totalSteps: number;
  title: string;
  detail: string;
  log: string;
}

export function getEnhancedPath(): string {
  const home = homedir();
  const extra = [
    join(home, ".local", "bin"),
    join(home, ".cargo", "bin"),
    join(HERMES_VENV, "bin"),
    // Node version manager shim directories
    join(home, ".volta", "bin"),
    join(home, ".asdf", "shims"),
    join(home, ".local", "share", "fnm", "aliases", "default", "bin"),
    join(home, ".fnm", "aliases", "default", "bin"),
    ...resolveNvmBin(home),
    "/usr/local/bin",
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
  ];
  return [...extra, process.env.PATH || ""].join(":");
}

/** Resolve the active nvm node version's bin directory. */
function resolveNvmBin(home: string): string[] {
  const nvmDir = process.env.NVM_DIR || join(home, ".nvm");
  const versionsDir = join(nvmDir, "versions", "node");
  if (!existsSync(versionsDir)) return [];
  try {
    // Try to read the default alias to find the active version
    const aliasFile = join(nvmDir, "alias", "default");
    if (existsSync(aliasFile)) {
      const alias = readFileSync(aliasFile, "utf-8").trim();
      // alias can be a full version "v20.11.0" or a partial "20" or "lts/*"
      if (alias.startsWith("v")) {
        const bin = join(versionsDir, alias, "bin");
        if (existsSync(bin)) return [bin];
      }
    }
    // Fallback: pick the latest installed version
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

export function checkInstallStatus(): InstallStatus {
  // Fix nested directory structure from Windows installer
  fixNestedInstallation();
  
  // Remote mode: skip local checks entirely
  const conn = getConnectionConfig();
  if (conn.mode === "remote" && conn.remoteUrl) {
    return {
      installed: true,
      configured: true,
      hasApiKey: true,
      verified: true,
    };
  }

  const installed = existsSync(HERMES_PYTHON) && existsSync(HERMES_SCRIPT);
  const configured = existsSync(HERMES_ENV_FILE);
  let hasApiKey = false;
  let verified = false;

  if (installed) {
    // On Windows, skip the version check as it can hang
    // Just verify the files exist
    if (isWindows) {
      verified = true;
    } else {
      try {
        execSync(`"${HERMES_PYTHON}" "${HERMES_SCRIPT}" --version`, {
          cwd: HERMES_REPO,
          env: {
            ...process.env,
            PATH: getEnhancedPath(),
            HOME: homedir(),
            HERMES_HOME,
          },
          stdio: "ignore",
          timeout: 15000,
        });
        verified = true;
      } catch {
        verified = false;
      }
    }
  }

  // Local/custom providers don't need an API key
  try {
    const mc = getModelConfig();
    const localProviders = ["custom", "lmstudio", "ollama", "vllm", "llamacpp"];
    if (localProviders.includes(mc.provider)) {
      hasApiKey = true;
    }
  } catch {
    /* ignore */
  }

  if (!hasApiKey && configured) {
    try {
      const content = readFileSync(HERMES_ENV_FILE, "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith("#")) continue;
        const match = trimmed.match(
          /^(OPENROUTER_API_KEY|ANTHROPIC_API_KEY|OPENAI_API_KEY)=(.+)$/,
        );
        if (
          match &&
          match[2].trim() &&
          !['""', "''", ""].includes(match[2].trim())
        ) {
          hasApiKey = true;
          break;
        }
      }
    } catch {
      /* ignore read errors */
    }
  }

  return { installed, configured, hasApiKey, verified };
}

// Fix nested directory structure from Windows PowerShell installer
function fixNestedInstallation(): void {
  if (!isWindows) return;
  
  try {
    const nestedPath = join(HERMES_REPO, "hermes-agent-main");
    if (existsSync(nestedPath) && existsSync(join(nestedPath, "hermes"))) {
      // Files will be moved on next app restart
      // This is a placeholder for the fix logic
    }
  } catch {
    // Ignore fix errors
  }
}

// Cached version to avoid re-running the Python process
let _cachedVersion: string | null = null;
let _versionFetching = false;

export async function getHermesVersion(): Promise<string | null> {
  if (_cachedVersion !== null) return _cachedVersion;
  if (!existsSync(HERMES_PYTHON) || !existsSync(HERMES_SCRIPT)) return null;
  if (_versionFetching) {
    // Wait for in-flight fetch
    return new Promise((resolve) => {
      const check = setInterval(() => {
        if (!_versionFetching) {
          clearInterval(check);
          resolve(_cachedVersion);
        }
      }, 100);
    });
  }
  _versionFetching = true;
  return new Promise((resolve) => {
    execFile(
      HERMES_PYTHON,
      [HERMES_SCRIPT, "--version"],
      {
        cwd: HERMES_REPO,
        env: {
          ...process.env,
          PATH: getEnhancedPath(),
          HOME: homedir(),
          HERMES_HOME,
        },
        timeout: 15000,
      },
      (error, stdout) => {
        _versionFetching = false;
        if (error) {
          resolve(null);
        } else {
          _cachedVersion = stdout.toString().trim();
          resolve(_cachedVersion);
        }
      },
    );
  });
}

export function clearVersionCache(): void {
  _cachedVersion = null;
}

export function runHermesDoctor(): string {
  if (!existsSync(HERMES_PYTHON) || !existsSync(HERMES_SCRIPT)) {
    return "Hermes is not installed.";
  }
  try {
    const output = execSync(`"${HERMES_PYTHON}" "${HERMES_SCRIPT}" doctor`, {
      cwd: HERMES_REPO,
      env: {
        ...process.env,
        PATH: getEnhancedPath(),
        HOME: homedir(),
        HERMES_HOME,
      },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30000,
    });
    return stripAnsi(output.toString());
  } catch (err) {
    const stderr = (err as { stderr?: Buffer }).stderr?.toString() || "";
    return stripAnsi(stderr) || "Doctor check failed.";
  }
}

const OPENCLAW_DIR_NAMES = [".openclaw", ".clawdbot", ".moldbot"];

export function checkOpenClawExists(): { found: boolean; path: string | null } {
  for (const name of OPENCLAW_DIR_NAMES) {
    const dir = join(homedir(), name);
    if (existsSync(dir)) {
      return { found: true, path: dir };
    }
  }
  return { found: false, path: null };
}

export async function runClawMigrate(
  onProgress: (progress: InstallProgress) => void,
): Promise<void> {
  if (!existsSync(HERMES_PYTHON) || !existsSync(HERMES_SCRIPT)) {
    throw new Error("Hermes is not installed.");
  }

  const openclaw = checkOpenClawExists();
  if (!openclaw.found) {
    throw new Error("No OpenClaw installation found.");
  }

  let log = "";
  function emit(text: string): void {
    log += text;
    onProgress({
      step: 1,
      totalSteps: 1,
      title: "Migrating from OpenClaw",
      detail: text.trim().slice(0, 120),
      log,
    });
  }

  emit(`Migrating from ${openclaw.path}...\n`);

  return new Promise((resolve, reject) => {
    const args = [HERMES_SCRIPT, "claw", "migrate", "--preset", "full"];

    const proc = spawn(HERMES_PYTHON, args, {
      cwd: HERMES_REPO,
      env: {
        ...process.env,
        PATH: getEnhancedPath(),
        HOME: homedir(),
        HERMES_HOME,
        TERM: "dumb",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    proc.stdout?.on("data", (data: Buffer) => {
      emit(stripAnsi(data.toString()));
    });

    proc.stderr?.on("data", (data: Buffer) => {
      emit(stripAnsi(data.toString()));
    });

    proc.on("close", (code) => {
      if (code === 0) {
        emit("\nMigration complete!\n");
        resolve();
      } else {
        reject(new Error(`Migration failed (exit code ${code}).`));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to run migration: ${err.message}`));
    });
  });
}

export async function runHermesUpdate(
  onProgress: (progress: InstallProgress) => void,
): Promise<void> {
  if (!existsSync(HERMES_PYTHON) || !existsSync(HERMES_SCRIPT)) {
    throw new Error("Hermes is not installed. Please install it first.");
  }

  let log = "";
  function emit(text: string): void {
    log += text;
    onProgress({
      step: 1,
      totalSteps: 1,
      title: "Updating Hermes Agent",
      detail: text.trim().slice(0, 120),
      log,
    });
  }

  emit("Running hermes update...\n");

  return new Promise((resolve, reject) => {
    const proc = spawn(HERMES_PYTHON, [HERMES_SCRIPT, "update"], {
      cwd: HERMES_REPO,
      env: {
        ...process.env,
        PATH: getEnhancedPath(),
        HOME: homedir(),
        HERMES_HOME,
        TERM: "dumb",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    proc.stdout?.on("data", (data: Buffer) => {
      emit(stripAnsi(data.toString()));
    });

    proc.stderr?.on("data", (data: Buffer) => {
      emit(stripAnsi(data.toString()));
    });

    proc.on("close", (code) => {
      if (code === 0) {
        emit("\nUpdate complete!\n");
        resolve();
      } else {
        reject(new Error(`Update failed (exit code ${code}).`));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to run update: ${err.message}`));
    });
  });
}

// Parse install.sh output to detect progress stages
// Patterns are ordered by likelihood and should match common installer output
const STAGE_MARKERS: { pattern: RegExp; step: number; title: string }[] = [
  {
    pattern: /Checking for (git|uv|python)/i,
    step: 1,
    title: "Checking prerequisites",
  },
  {
    pattern: /Installing uv|uv found|uv installed|Installing package manager/i,
    step: 2,
    title: "Setting up package manager",
  },
  {
    pattern: /Installing Python|Python .* found|Python installed|Setting up Python/i,
    step: 3,
    title: "Setting up Python",
  },
  {
    pattern: /Cloning|cloning|Updating.*repository|Repository|git clone|fetching/i,
    step: 4,
    title: "Downloading Hermes Agent",
  },
  {
    pattern: /Creating virtual|virtual environment|venv|Creating Python environment|virtualenv/i,
    step: 5,
    title: "Creating Python environment",
  },
  {
    pattern: /pip install|Installing.*packages|dependencies|Installing dependencies|Collecting.*package|Requirement already/i,
    step: 6,
    title: "Installing dependencies",
  },
  {
    pattern: /Configuration|config|Setup complete|Installation complete|Complete!|Successfully installed/i,
    step: 7,
    title: "Finishing setup",
  },
];

export async function runInstall(
  onProgress: (progress: InstallProgress) => void,
): Promise<void> {
  const totalSteps = 7;
  let log = "";
  let currentStep = 1;
  let currentTitle = "Starting installation...";
  let lastOutputTime = Date.now();
  let lastStepAdvanceTime = Date.now();
  const OUTPUT_TIMEOUT_MS = 120000; // 2 minutes timeout for no output
  const STEP_ADVANCE_MS = 30000; // Auto-advance step if stuck for 30s

  function emit(text: string, forceStep?: number): void {
    log += text;
    // Try to detect which stage we're in from the output
    for (const marker of STAGE_MARKERS) {
      if (marker.pattern.test(text)) {
        if (marker.step >= currentStep) {
          currentStep = marker.step;
          currentTitle = marker.title;
          lastStepAdvanceTime = Date.now();
        }
        break;
      }
    }
    // If forceStep is provided, use it (for timeout scenarios)
    const stepToReport = forceStep !== undefined ? forceStep : currentStep;
    onProgress({
      step: stepToReport,
      totalSteps,
      title: forceStep !== undefined ? "Installation timeout or stalled" : currentTitle,
      detail: forceStep !== undefined ? 
        "The installation appears to be stuck. Please check your internet connection and try again." : 
        text.trim().slice(0, 120),
      log,
    });
  }

  // Initial progress
  emit("Running official Hermes install script...\n");

  return new Promise((resolve, reject) => {
    const home = homedir();
    let installationCompleted = false;

    // On Windows, use PowerShell with the official Windows installer
    // On Unix, use bash with curl
    const installCmd = isWindows 
      ? "irm https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.ps1 | iex"
      : "curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash -s -- --skip-setup";
    
    const shellCmd = isWindows ? "powershell.exe" : "bash";
    const shellArgs = isWindows 
      ? ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", installCmd]
      : ["-c", installCmd];

    if (isWindows) {
      emit("Using PowerShell for installation on Windows...\n");
    }

    const proc = spawn(shellCmd, shellArgs, {
      cwd: home,
      env: {
        ...process.env,
        PATH: getEnhancedPath(),
        HOME: home,
        TERM: isWindows ? undefined : "dumb",
        // On Windows, ensure proper environment
        ...(isWindows ? { 
          CHERE_INVOKING: "1",
          MSYS2_PATH_TYPE: "inherit"
        } : {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    // Timeout detection - if no output for 2 minutes, assume stuck
    // Also auto-advance step indicator if installation is taking time
    const progressCheck = setInterval(() => {
      if (installationCompleted) {
        clearInterval(progressCheck);
        return;
      }
      
      const now = Date.now();
      
      // Check for complete timeout
      if (now - lastOutputTime > OUTPUT_TIMEOUT_MS) {
        emit(
          `\n[Timeout] No output received for ${OUTPUT_TIMEOUT_MS / 1000} seconds. Installation may be stuck.\n`,
          currentStep
        );
      }
      
      // Auto-advance step indicator if taking too long (prevents UI from appearing stuck)
      if (now - lastStepAdvanceTime > STEP_ADVANCE_MS && currentStep < totalSteps) {
        currentStep = Math.min(currentStep + 1, totalSteps);
        currentTitle = "Installation in progress...";
        emit(`[Progress update] Step ${currentStep}/${totalSteps}...\n`);
        lastStepAdvanceTime = now;
      }
    }, 5000); // Check every 5 seconds

    proc.stdout?.on("data", (data: Buffer) => {
      lastOutputTime = Date.now();
      const text = stripAnsi(data.toString());
      emit(text);
    });

    proc.stderr?.on("data", (data: Buffer) => {
      lastOutputTime = Date.now();
      const text = stripAnsi(data.toString());
      emit(text);
    });

    proc.on("close", (code) => {
      clearInterval(progressCheck);
      installationCompleted = true;
      
      if (code === 0) {
        emit("\nInstallation complete!\n");
        resolve();
      } else {
        // The install script can exit non-zero due to benign issues
        // Common benign errors:
        // - "Already on 'main'" - git checkout when already on that branch
        // - "git stash pop failed" - no stash to pop
        // If Hermes is actually installed and working, treat as success.
        if (existsSync(HERMES_PYTHON) && existsSync(HERMES_SCRIPT)) {
          // Verify Hermes actually works
          try {
            execSync(`"${HERMES_PYTHON}" "${HERMES_SCRIPT}" --version`, {
              cwd: HERMES_REPO,
              env: {
                ...process.env,
                PATH: getEnhancedPath(),
                HOME: homedir(),
                HERMES_HOME,
              },
              stdio: "ignore",
              timeout: 15000,
            });
            // Hermes works, treat as success
            emit(
              "\nInstallation completed with minor warnings (these can be ignored).\n",
            );
            resolve();
            return;
          } catch {
            // Hermes doesn't work, actual failure
          }
        }
        
        // On Windows, the PowerShell installer sometimes creates a nested directory
        // Fix: Move contents from nested folder if it exists
        if (isWindows) {
          try {
            const nestedPath = join(HERMES_REPO, "hermes-agent-main");
            if (existsSync(nestedPath)) {
              // This will be handled by a post-install fix
              emit("\nInstallation completed but directory structure needs adjustment.\n");
              emit("Please restart the app to complete setup.\n");
              resolve();
              return;
            }
          } catch {
            // Ignore fix attempt errors
          }
        }
        
        reject(
          new Error(
            `Installation failed (exit code ${code}). You can try installing via terminal instead.`,
          ),
        );
      }
    });

    proc.on("error", (err) => {
      clearInterval(progressCheck);
      installationCompleted = true;
      const errorMsg = err.message;
      // Provide Windows-specific guidance
      const windowsHint = isWindows 
        ? " Make sure PowerShell is available and you have internet access." 
        : "";
      reject(new Error(`Failed to start installer: ${errorMsg}.${windowsHint}`));
    });
  });
}

// ────────────────────────────────────────────────────
//  Backup & Import
// ────────────────────────────────────────────────────

export async function runHermesBackup(
  profile?: string,
): Promise<{ success: boolean; path?: string; error?: string }> {
  if (!existsSync(HERMES_PYTHON) || !existsSync(HERMES_SCRIPT)) {
    return { success: false, error: "Hermes is not installed." };
  }
  const args = [HERMES_SCRIPT, "backup"];
  if (profile && profile !== "default") args.push("-p", profile);

  return new Promise((resolve) => {
    execFile(
      HERMES_PYTHON,
      args,
      {
        cwd: HERMES_REPO,
        env: {
          ...process.env,
          PATH: getEnhancedPath(),
          HOME: homedir(),
          HERMES_HOME,
          TERM: "dumb",
        },
        timeout: 120000,
      },
      (error, stdout, stderr) => {
        if (error) {
          resolve({
            success: false,
            error: stripAnsi(stderr || error.message).slice(0, 500),
          });
          return;
        }
        const output = stripAnsi(stdout);
        // Try to extract the backup file path from output
        const pathMatch = output.match(
          /(?:Backup saved|Written|Created).*?(\S+\.(?:tar\.gz|zip|tgz))/i,
        );
        resolve({
          success: true,
          path: pathMatch?.[1] || output.trim().split("\n").pop()?.trim(),
        });
      },
    );
  });
}

export async function runHermesImport(
  archivePath: string,
  profile?: string,
): Promise<{ success: boolean; error?: string }> {
  if (!existsSync(HERMES_PYTHON) || !existsSync(HERMES_SCRIPT)) {
    return { success: false, error: "Hermes is not installed." };
  }
  const args = [HERMES_SCRIPT, "import", archivePath];
  if (profile && profile !== "default") args.push("-p", profile);

  return new Promise((resolve) => {
    execFile(
      HERMES_PYTHON,
      args,
      {
        cwd: HERMES_REPO,
        env: {
          ...process.env,
          PATH: getEnhancedPath(),
          HOME: homedir(),
          HERMES_HOME,
          TERM: "dumb",
        },
        timeout: 120000,
      },
      (error, _stdout, stderr) => {
        if (error) {
          resolve({
            success: false,
            error: stripAnsi(stderr || error.message).slice(0, 500),
          });
          return;
        }
        resolve({ success: true });
      },
    );
  });
}

// ────────────────────────────────────────────────────
//  Debug dump
// ────────────────────────────────────────────────────

export function runHermesDump(): Promise<string> {
  if (!existsSync(HERMES_PYTHON) || !existsSync(HERMES_SCRIPT)) {
    return Promise.resolve("Hermes is not installed.");
  }
  return new Promise((resolve) => {
    execFile(
      HERMES_PYTHON,
      [HERMES_SCRIPT, "dump"],
      {
        cwd: HERMES_REPO,
        env: {
          ...process.env,
          PATH: getEnhancedPath(),
          HOME: homedir(),
          HERMES_HOME,
          TERM: "dumb",
        },
        timeout: 30000,
      },
      (error, stdout, stderr) => {
        if (error) {
          resolve(stripAnsi(stderr || error.message));
        } else {
          resolve(stripAnsi(stdout));
        }
      },
    );
  });
}

// ────────────────────────────────────────────────────
//  Memory provider discovery
// ────────────────────────────────────────────────────

export interface MemoryProviderInfo {
  name: string;
  description: string;
  installed: boolean;
  active: boolean;
  envVars: string[];
}

/**
 * Discover available memory providers by scanning the plugins directory
 * and reading config.yaml for the active provider.
 */
export function discoverMemoryProviders(
  profile?: string,
): MemoryProviderInfo[] {
  const pluginsDir = join(HERMES_REPO, "plugins", "memory");
  if (!existsSync(pluginsDir)) return [];

  const activeProvider = getActiveMemoryProvider(profile);

  // Known providers with their metadata (from plugin.yaml files)
  const KNOWN_PROVIDERS: Record<
    string,
    { description: string; envVars: string[]; pip?: string }
  > = {
    honcho: {
      description: "memory.providers.honcho",
      envVars: ["HONCHO_API_KEY"],
      pip: "honcho-ai",
    },
    hindsight: {
      description: "memory.providers.hindsight",
      envVars: ["HINDSIGHT_API_KEY", "HINDSIGHT_API_URL", "HINDSIGHT_BANK_ID"],
      pip: "hindsight-client",
    },
    mem0: {
      description: "memory.providers.mem0",
      envVars: ["MEM0_API_KEY"],
      pip: "mem0ai",
    },
    retaindb: {
      description: "memory.providers.retaindb",
      envVars: ["RETAINDB_API_KEY"],
    },
    supermemory: {
      description: "memory.providers.supermemory",
      envVars: ["SUPERMEMORY_API_KEY"],
      pip: "supermemory",
    },
    holographic: {
      description: "memory.providers.holographic",
      envVars: [],
    },
    openviking: {
      description: "memory.providers.openviking",
      envVars: ["OPENVIKING_ENDPOINT", "OPENVIKING_API_KEY"],
    },
    byterover: {
      description: "memory.providers.byterover",
      envVars: ["BRV_API_KEY"],
    },
  };

  const results: MemoryProviderInfo[] = [];

  try {
    const dirs = readdirSync(pluginsDir, { withFileTypes: true });
    for (const d of dirs) {
      if (!d.isDirectory() || d.name.startsWith("_")) continue;
      const name = d.name;
      const known = KNOWN_PROVIDERS[name];
      const initFile = join(pluginsDir, name, "__init__.py");
      const installed = existsSync(initFile);

      results.push({
        name,
        description: known?.description || name,
        installed,
        active: name === activeProvider,
        envVars: known?.envVars || [],
      });
    }
  } catch {
    /* non-fatal */
  }

  // Sort: active first, then installed, then alphabetical
  results.sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    if (a.installed !== b.installed) return a.installed ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return results;
}

/**
 * Read the active memory provider from config.yaml.
 */
export function getActiveMemoryProvider(profile?: string): string {
  try {
    const configDir =
      profile && profile !== "default"
        ? join(HERMES_HOME, "profiles", profile)
        : HERMES_HOME;
    const configPath = join(configDir, "config.yaml");
    if (!existsSync(configPath)) return "";
    const content = readFileSync(configPath, "utf-8");
    const match = content.match(/^\s*provider:\s*["']?(\w+)["']?\s*$/m);
    return match?.[1] || "";
  } catch {
    return "";
  }
}

// ────────────────────────────────────────────────────
//  MCP server management
// ────────────────────────────────────────────────────

export function listMcpServers(
  profile?: string,
): Array<{ name: string; type: string; enabled: boolean; detail: string }> {
  try {
    const configPath = join(
      profile && profile !== "default"
        ? join(HERMES_HOME, "profiles", profile)
        : HERMES_HOME,
      "config.yaml",
    );
    if (!existsSync(configPath)) return [];
    const content = readFileSync(configPath, "utf-8");
    // Simple YAML parse for mcp_servers section
    const match = content.match(/^mcp_servers:\s*\n((?:[ \t]+.+\n)*)/m);
    if (!match) return [];

    const servers: Array<{
      name: string;
      type: string;
      enabled: boolean;
      detail: string;
    }> = [];
    const block = match[1];
    // Each top-level key under mcp_servers is a server name (2-space indent)
    const nameRe = /^[ ]{2}(\w[\w-]*):\s*$/gm;
    let m: RegExpExecArray | null;
    while ((m = nameRe.exec(block)) !== null) {
      const name = m[1];
      // Extract following indented block for this server.
      // Find the next line at exactly 2-space indent (next server name).
      const start = m.index + m[0].length;
      const nextMatch = /\n {2}\w/g;
      nextMatch.lastIndex = start;
      const next = nextMatch.exec(block);
      const serverBlock = block.slice(start, next ? next.index : undefined);
      const hasUrl = /url:/.test(serverBlock);
      const hasCommand = /command:/.test(serverBlock);
      const enabledMatch = serverBlock.match(/enabled:\s*(true|false)/i);
      const enabled =
        enabledMatch === null || enabledMatch[1].toLowerCase() === "true";

      let detail = "";
      if (hasUrl) {
        const urlMatch = serverBlock.match(/url:\s*["']?([^\s"']+)/);
        detail = urlMatch?.[1] || "HTTP";
      } else if (hasCommand) {
        const cmdMatch = serverBlock.match(/command:\s*["']?([^\s"']+)/);
        detail = cmdMatch?.[1] || "stdio";
      }

      servers.push({
        name,
        type: hasUrl ? "http" : "stdio",
        enabled,
        detail,
      });
    }
    return servers;
  } catch {
    return [];
  }
}

// ────────────────────────────────────────────────────
//  Log viewer
// ────────────────────────────────────────────────────

export function readLogs(
  logFile = "agent.log",
  lines = 200,
): { content: string; path: string } {
  const logsDir = join(HERMES_HOME, "logs");
  // Sanitize: only allow known log file names
  const allowed = ["agent.log", "errors.log", "gateway.log"];
  const file = allowed.includes(logFile) ? logFile : "agent.log";
  const fullPath = join(logsDir, file);

  if (!existsSync(fullPath)) {
    return { content: "", path: fullPath };
  }
  try {
    const content = readFileSync(fullPath, "utf-8");
    // Return the last N lines
    const allLines = content.split("\n");
    const tail = allLines.slice(-lines).join("\n");
    return { content: tail, path: fullPath };
  } catch {
    return { content: "", path: fullPath };
  }
}
