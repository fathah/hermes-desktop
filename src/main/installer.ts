import { spawn, execFile, execFileSync } from "child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  unlinkSync,
} from "fs";
import { join } from "path";
import { homedir, tmpdir } from "os";
import { randomBytes } from "crypto";
import type { BrowserWindow } from "electron";
import {
  customEndpointKeyResolvable,
  getConnectionConfig,
  getConfigValue,
  getModelConfig,
  hasOAuthCredentials,
} from "./config";
import { providerDoesNotNeedApiKey } from "./providers";
import { getActiveProfileNameSync, stripAnsi } from "./utils";
import { setupAskpass } from "./askpass";
import { precacheSudoCredentials } from "./sudoCreds";
import { HIDDEN_SUBPROCESS_OPTIONS } from "./process-options";
import { isLocalBaseUrl } from "../shared/url-key-map";
import { publicFetch } from "./security/network-policy";

// Re-exports of paths and env
export {
  IS_WINDOWS,
  HERMES_HOME,
  HERMES_REPO,
  HERMES_VENV,
  HERMES_PYTHON,
  HERMES_SCRIPT,
  HERMES_ENV_FILE,
  HERMES_CONFIG_FILE,
  HERMES_AUTH_FILE,
  setHermesHomeOverride,
  hermesCliArgs,
  getEnhancedPath,
} from "./installer/paths";

import {
  IS_WINDOWS,
  HERMES_HOME,
  HERMES_REPO,
  HERMES_PYTHON,
  HERMES_SCRIPT,
  HERMES_ENV_FILE,
  HERMES_AUTH_FILE,
  getBundledScriptPath,
  installBinariesFor,
  hermesCliArgs,
  getEnhancedPath,
} from "./installer/paths";

// Re-exports of MCP
export type { McpServerEntry } from "./installer/mcp";
export {
  listMcpServers,
  listMcpServerEntries,
  renderMcpServerEntry,
  upsertMcpServerInYaml,
  writeMcpServerEntry,
  setMcpServerEnabled,
  hasMcpServer,
  commandExists,
  notebookLmCliCommand,
  openAlexMcpServerPath,
  notebookLmMcpEntry,
  notebookLmMcpCommand,
  readClaudeCodeNotebookLmMcpEntry,
  ensureDesktopMcpRegistered,
} from "./installer/mcp";

// Re-exports of Backup & Import
export {
  runHermesBackup,
  runHermesImport,
  validateImportArchivePath,
} from "./installer/backup-import";

// Re-exports of Computer Use
export {
  getComputerUseStatus,
  installComputerUseDriver,
} from "./installer/computer-use";

import type { InstallStatus, InstallProgress } from "../shared/install";
export type { InstallStatus, InstallProgress };

function activeEnvFile(profile: string): string {
  return profile === "default"
    ? HERMES_ENV_FILE
    : join(HERMES_HOME, "profiles", profile, ".env");
}

function activeAuthFile(profile: string): string {
  return profile === "default"
    ? HERMES_AUTH_FILE
    : join(HERMES_HOME, "profiles", profile, "auth.json");
}

const PROVIDER_ENV_KEYS: Record<string, string> = {
  openrouter: "OPENROUTER_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GOOGLE_API_KEY",
  xai: "XAI_API_KEY",
  groq: "GROQ_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  together: "TOGETHER_API_KEY",
  fireworks: "FIREWORKS_API_KEY",
  cerebras: "CEREBRAS_API_KEY",
  mistral: "MISTRAL_API_KEY",
  perplexity: "PERPLEXITY_API_KEY",
  huggingface: "HF_TOKEN",
  hf: "HF_TOKEN",
  qwen: "QWEN_API_KEY",
  minimax: "MINIMAX_API_KEY",
  glm: "GLM_API_KEY",
  zai: "GLM_API_KEY",
  kimi: "KIMI_API_KEY",
  "kimi-coding": "KIMI_API_KEY",
  nvidia: "NVIDIA_API_KEY",
  nous: "NOUS_API_KEY",
  "nous-api": "NOUS_API_KEY",
  vertex: "GOOGLE_APPLICATION_CREDENTIALS",
};

const URL_TO_ENV_KEY: Array<[RegExp, string]> = [
  [/openrouter\.ai/i, "OPENROUTER_API_KEY"],
  [/anthropic\.com/i, "ANTHROPIC_API_KEY"],
  [/openai\.com/i, "OPENAI_API_KEY"],
  [/huggingface\.co/i, "HF_TOKEN"],
  [/api\.groq\.com/i, "GROQ_API_KEY"],
  [/api\.deepseek\.com/i, "DEEPSEEK_API_KEY"],
  [/api\.moonshot\.ai/i, "KIMI_API_KEY"],
  [/api\.z\.ai/i, "GLM_API_KEY"],
  [/api\.together\.xyz/i, "TOGETHER_API_KEY"],
  [/api\.fireworks\.ai/i, "FIREWORKS_API_KEY"],
  [/api\.cerebras\.ai/i, "CEREBRAS_API_KEY"],
  [/api\.mistral\.ai/i, "MISTRAL_API_KEY"],
  [/api\.perplexity\.ai/i, "PERPLEXITY_API_KEY"],
  [/aiplatform\.googleapis\.com/i, "GOOGLE_APPLICATION_CREDENTIALS"],
];

export function expectedEnvKeyForModel(
  provider: string,
  baseUrl: string,
): string | null {
  const direct = PROVIDER_ENV_KEYS[provider.trim().toLowerCase()];
  if (direct) return direct;
  for (const [pattern, envKey] of URL_TO_ENV_KEY) {
    if (pattern.test(baseUrl)) return envKey;
  }
  return null;
}

function envHasUsableValue(
  content: string,
  expectedKey: string | null,
): boolean {
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const m = trimmed.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!m) continue;
    const key = m[1];
    let value = m[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!value) continue;

    if (expectedKey) {
      if (key === expectedKey) return true;
    } else {
      if (/_API_KEY$/.test(key)) return true;
    }
  }
  return false;
}

type InstallGateModelConfig = {
  provider: string;
  model: string;
  baseUrl: string;
};

function hasExplicitModelConfig(mc: InstallGateModelConfig): boolean {
  const provider = mc.provider.trim().toLowerCase();
  const model = mc.model.trim();
  return Boolean(provider && provider !== "auto" && model);
}

function modelConfigIsSetupReady(
  mc: InstallGateModelConfig,
  profile: string,
): boolean {
  const rawProvider = mc.provider.trim();
  const provider = rawProvider.toLowerCase();
  const baseUrl = mc.baseUrl.trim();
  if (!hasExplicitModelConfig(mc)) return false;

  if (hasOAuthCredentials(rawProvider, profile)) return true;
  if (isLocalBaseUrl(baseUrl)) return true;
  if (provider !== "custom" && providerDoesNotNeedApiKey(provider)) {
    return true;
  }
  if (customEndpointKeyResolvable(rawProvider, baseUrl, profile)) return true;

  return expectedEnvKeyForModel(rawProvider, baseUrl) === null;
}

export type InstallTargetState = "fresh" | "update" | "replace";

export interface InstallTargetInfo {
  hermesHome: string;
  repoPath: string;
  state: InstallTargetState;
}

export function classifyInstallTarget(
  repoExists: boolean,
  repoIsGitRepo: boolean,
): InstallTargetState {
  if (!repoExists) return "fresh";
  return repoIsGitRepo ? "update" : "replace";
}

export function inspectInstallTarget(): InstallTargetInfo {
  const repoExists = existsSync(HERMES_REPO);
  const repoIsGitRepo = repoExists && existsSync(join(HERMES_REPO, ".git"));
  return {
    hermesHome: HERMES_HOME,
    repoPath: HERMES_REPO,
    state: classifyInstallTarget(repoExists, repoIsGitRepo),
  };
}

export function validateHermesHome(dir: string): boolean {
  const home = dir?.trim();
  if (!home || !existsSync(home)) return false;
  const { python, script } = installBinariesFor(home);
  return existsSync(python) && existsSync(script);
}

export function checkInstallStatus(): InstallStatus {
  const activeProfile = getActiveProfileNameSync();

  const conn = getConnectionConfig();
  if (conn.mode === "remote" && conn.remoteUrl) {
    return {
      installed: true,
      configured: true,
      hasApiKey: true,
      verified: true,
      activeProfile,
    };
  }

  const installed = existsSync(HERMES_PYTHON) && existsSync(HERMES_SCRIPT);
  const envFile = activeEnvFile(activeProfile);
  const authFile = activeAuthFile(activeProfile);
  let configured = existsSync(envFile) || existsSync(authFile);
  let hasApiKey = false;
  const verified = installed;

  let mc: { provider: string; model: string; baseUrl: string } | null = null;
  try {
    mc = getModelConfig(activeProfile);
    if (hasExplicitModelConfig(mc)) configured = true;
    if (modelConfigIsSetupReady(mc, activeProfile)) {
      hasApiKey = true;
    }
  } catch {
    /* ignore */
  }

  if (!hasApiKey && configured && existsSync(envFile)) {
    try {
      const content = readFileSync(envFile, "utf-8");
      const expectedKey = mc
        ? expectedEnvKeyForModel(mc.provider, mc.baseUrl)
        : null;
      hasApiKey = envHasUsableValue(content, expectedKey);
    } catch {
      /* ignore read errors */
    }
  }

  return { installed, configured, hasApiKey, verified, activeProfile };
}

let _verifyCache: { ok: boolean; ts: number } | null = null;
const VERIFY_TTL_MS = 5 * 60 * 1000;

export async function verifyInstall(): Promise<boolean> {
  if (!existsSync(HERMES_PYTHON) || !existsSync(HERMES_SCRIPT)) return false;
  if (_verifyCache && Date.now() - _verifyCache.ts < VERIFY_TTL_MS) {
    return _verifyCache.ok;
  }
  return new Promise((resolve) => {
    execFile(
      HERMES_PYTHON,
      hermesCliArgs(["--version"]),
      {
        cwd: HERMES_REPO,
        env: {
          ...process.env,
          PATH: getEnhancedPath(),
          HOME: homedir(),
          HERMES_HOME,
        },
        timeout: 15000,
        ...HIDDEN_SUBPROCESS_OPTIONS,
      },
      (error) => {
        const ok = !error;
        _verifyCache = { ok, ts: Date.now() };
        resolve(ok);
      },
    );
  });
}

let _cachedVersion: string | null = null;
let _versionFetching = false;

export async function getHermesVersion(): Promise<string | null> {
  if (_cachedVersion !== null) return _cachedVersion;
  if (!existsSync(HERMES_PYTHON) || !existsSync(HERMES_SCRIPT)) return null;
  if (_versionFetching) {
    return new Promise((resolve) => {
      const startedAt = Date.now();
      const check = setInterval(() => {
        if (!_versionFetching || Date.now() - startedAt > 20_000) {
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
      hermesCliArgs(["--version"]),
      {
        cwd: HERMES_REPO,
        env: {
          ...process.env,
          PATH: getEnhancedPath(),
          HOME: homedir(),
          HERMES_HOME,
        },
        timeout: 15000,
        ...HIDDEN_SUBPROCESS_OPTIONS,
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
    const output = execFileSync(HERMES_PYTHON, hermesCliArgs(["doctor"]), {
      cwd: HERMES_REPO,
      env: {
        ...process.env,
        PATH: getEnhancedPath(),
        HOME: homedir(),
        HERMES_HOME,
      },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30000,
      ...HIDDEN_SUBPROCESS_OPTIONS,
    });
    return stripAnsi(output.toString());
  } catch (err) {
    const stderr = (err as { stderr?: Buffer }).stderr?.toString() || "";
    return stripAnsi(stderr) || "Doctor check failed.";
  }
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
    const proc = spawn(HERMES_PYTHON, hermesCliArgs(["update"]), {
      cwd: HERMES_REPO,
      env: {
        ...process.env,
        PATH: getEnhancedPath(),
        HOME: homedir(),
        HERMES_HOME,
        TERM: "dumb",
      },
      stdio: ["ignore", "pipe", "pipe"],
      ...HIDDEN_SUBPROCESS_OPTIONS,
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

export interface HermesUpdateStatus {
  available: boolean;
  behindBy?: number;
  localHead?: string;
  upstreamHead?: string;
  reason?: string;
}

export function interpretHeadComparison(
  localHead: string | null,
  upstreamHead: string | null,
  behindRaw: string | null,
): HermesUpdateStatus {
  if (!localHead) return { available: false, reason: "no-head" };
  if (!upstreamHead)
    return { available: false, reason: "no-upstream", localHead };
  if (localHead === upstreamHead) {
    return { available: false, localHead, upstreamHead };
  }
  const parsed = behindRaw ? parseInt(behindRaw, 10) : NaN;
  const behindBy = Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  return { available: true, behindBy, localHead, upstreamHead };
}

export async function checkHermesUpdate(): Promise<HermesUpdateStatus> {
  if (!existsSync(join(HERMES_REPO, ".git"))) {
    return { available: false, reason: "not-a-git-repo" };
  }

  const gitEnv = {
    ...process.env,
    PATH: getEnhancedPath(),
    HOME: homedir(),
    HERMES_HOME,
  };
  const runGit = (
    args: string[],
    timeout: number,
  ): Promise<{ ok: boolean; out: string }> =>
    new Promise((resolve) => {
      execFile(
        "git",
        args,
        {
          cwd: HERMES_REPO,
          env: gitEnv,
          timeout,
          ...HIDDEN_SUBPROCESS_OPTIONS,
        },
        (error, stdout, stderr) => {
          resolve({
            ok: !error,
            out:
              stripAnsi((stdout || stderr || "").toString()).trim() ||
              (error instanceof Error ? error.message : ""),
          });
        },
      );
    });

  const fetched = await runGit(["fetch", "--quiet"], 30000);
  if (!fetched.ok) {
    return { available: false, reason: fetched.out || "fetch-failed" };
  }

  const local = await runGit(["rev-parse", "HEAD"], 5000);
  const upstream = await runGit(["rev-parse", "@{u}"], 5000);
  const behind =
    local.ok && upstream.ok
      ? await runGit(["rev-list", "--count", "HEAD..@{u}"], 5000)
      : { ok: false, out: "" };

  return interpretHeadComparison(
    local.ok ? local.out : null,
    upstream.ok ? upstream.out : null,
    behind.ok ? behind.out : null,
  );
}

export async function getInstalledEngineSha(): Promise<string | null> {
  if (!existsSync(join(HERMES_REPO, ".git"))) {
    return null;
  }

  const gitEnv = {
    ...process.env,
    PATH: getEnhancedPath(),
    HOME: homedir(),
    HERMES_HOME,
  };

  return new Promise((resolve) => {
    execFile(
      "git",
      ["rev-parse", "HEAD"],
      {
        cwd: HERMES_REPO,
        env: gitEnv,
        timeout: 5000,
        ...HIDDEN_SUBPROCESS_OPTIONS,
      },
      (error, stdout) => {
        const out = stripAnsi((stdout || "").toString()).trim();
        resolve(!error && out ? out : null);
      },
    );
  });
}

export interface InstallScriptOptions {
  commit?: string;
}

export type InstallScriptName = "install.sh" | "install.ps1";

export interface ResolvedInstallScript {
  path: string;
  source: "live" | "bundled";
  reason?: string;
  cleanup?: () => void;
}

interface ResolveInstallScriptOptions {
  bundledPath?: string;
  fetchImpl?: typeof publicFetch;
  tempDir?: string;
  timeoutMs?: number;
  emit?: (message: string) => void;
}

const INSTALL_SCRIPT_MAX_BYTES = 512 * 1024;
const INSTALL_SCRIPT_MIN_BYTES = 128;
const INSTALL_SCRIPT_URLS: Record<InstallScriptName, string> = {
  "install.sh": "https://hermes-agent.nousresearch.com/install.sh",
  "install.ps1": "https://hermes-agent.nousresearch.com/install.ps1",
};

export function validateInstallScriptContent(
  scriptName: InstallScriptName,
  content: string,
): string | null {
  const byteLength = Buffer.byteLength(content, "utf8");
  if (byteLength === 0) return "empty-response";
  if (byteLength < INSTALL_SCRIPT_MIN_BYTES) return "script-too-small";
  if (byteLength > INSTALL_SCRIPT_MAX_BYTES) return "script-too-large";

  if (scriptName === "install.sh") {
    const firstLine = content.split(/\r?\n/, 1)[0]?.trim() || "";
    if (!firstLine.startsWith("#!") || !/sh\b|bash\b/.test(firstLine)) {
      return "missing-shell-shebang";
    }
    return null;
  }

  if (!/^\s*#/m.test(content) || !/\bparam\s*\(/i.test(content)) {
    return "missing-powershell-header";
  }
  if (!/\$ErrorActionPreference\s*=/.test(content)) {
    return "missing-powershell-error-action";
  }
  return null;
}

function stagedInstallScriptPath(
  scriptName: InstallScriptName,
  dir: string,
): string {
  const suffix = scriptName === "install.ps1" ? "ps1" : "sh";
  return join(
    dir,
    `hermes-live-${scriptName.replace(".", "-")}-${randomBytes(6).toString("hex")}.${suffix}`,
  );
}

export async function resolveInstallScriptPath(
  scriptName: InstallScriptName,
  options: ResolveInstallScriptOptions = {},
): Promise<ResolvedInstallScript> {
  const bundledPath = options.bundledPath || getBundledScriptPath(scriptName);
  const fetchImpl = options.fetchImpl || publicFetch;
  const tempDir = options.tempDir || tmpdir();
  const url = INSTALL_SCRIPT_URLS[scriptName];

  const fallback = (reason: string): ResolvedInstallScript => {
    options.emit?.(
      `Using bundled ${scriptName}; live install script refresh unavailable (${reason}).\n`,
    );
    return { path: bundledPath, source: "bundled", reason };
  };

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 10000,
  );
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: {
        Accept: "text/plain",
        "User-Agent": "hermes-desktop-installer",
      },
    });
    if (!response.ok) {
      return fallback(`http-${response.status}`);
    }

    const content = await response.text();
    const invalidReason = validateInstallScriptContent(scriptName, content);
    if (invalidReason) return fallback(invalidReason);

    const path = stagedInstallScriptPath(scriptName, tempDir);
    writeFileSync(path, content, { encoding: "utf8", mode: 0o700 });
    options.emit?.(`Using latest upstream ${scriptName}.\n`);
    return {
      path,
      source: "live",
      cleanup: () => {
        try {
          unlinkSync(path);
        } catch {
          /* best-effort */
        }
      },
    };
  } catch (err) {
    return fallback(err instanceof Error ? err.message : String(err));
  } finally {
    clearTimeout(timer);
  }
}

export function buildUnixInstallArgs(
  scriptPath: string,
  options: InstallScriptOptions = {},
): string[] {
  const args = [scriptPath, "--skip-setup"];
  if (options.commit) {
    args.push("--commit", options.commit);
  }
  return args;
}

export function buildWindowsInstallCommand(
  installerExpression: string,
  hermesHome: string,
  installDir: string,
  options: InstallScriptOptions = {},
): string {
  const parts = [
    `& ${installerExpression}`,
    "-SkipSetup",
    "-HermesHome",
    psQuote(hermesHome),
    "-InstallDir",
    psQuote(installDir),
  ];
  if (options.commit) {
    parts.push("-Commit", psQuote(options.commit));
  }
  return parts.join(" ");
}

const STAGE_MARKERS: { pattern: RegExp; step: number; title: string }[] = [
  {
    pattern: /Checking (for )?(git|uv|python|node|ripgrep|ffmpeg)/i,
    step: 1,
    title: "Checking prerequisites",
  },
  {
    pattern: /Installing uv|uv found|uv installed/i,
    step: 2,
    title: "Setting up package manager",
  },
  {
    pattern: /Installing Python|Python .* found|Python installed/i,
    step: 3,
    title: "Setting up Python",
  },
  {
    pattern:
      /Cloning|cloning|Updating.*repository|Repository|Installing to .*hermes-agent|Downloading PortableGit/i,
    step: 4,
    title: "Downloading Hermes Agent",
  },
  {
    pattern: /Creating virtual|virtual environment|uv venv|\bvenv\b/i,
    step: 5,
    title: "Creating Python environment",
  },
  {
    pattern:
      /pip install|Installing.*packages|dependencies|Trying tier|Resolving|Main package installed/i,
    step: 6,
    title: "Installing dependencies",
  },
  {
    pattern:
      /Installation complete|hermes command ready|Configuration directory ready|Hermes (installation )?(finished|is ready)/i,
    step: 7,
    title: "Finishing setup",
  },
];

export async function runInstall(
  onProgress: (progress: InstallProgress) => void,
  parentWindow?: BrowserWindow | null,
  options: InstallScriptOptions = {},
): Promise<void> {
  const totalSteps = 7;
  let log = "";
  let currentStep = 1;
  let currentTitle = "Starting installation...";

  function emit(text: string): void {
    log += text;
    for (const marker of STAGE_MARKERS) {
      if (marker.pattern.test(text)) {
        if (marker.step >= currentStep) {
          currentStep = marker.step;
          currentTitle = marker.title;
        }
        break;
      }
    }
    onProgress({
      step: currentStep,
      totalSteps,
      title: currentTitle,
      detail: text.trim().slice(0, 120),
      log,
    });
  }

  emit("Running official Hermes install script...\n");

  if (IS_WINDOWS) {
    return runInstallWindows(emit, options);
  }

  emit("→ Checking administrator access...\n");
  const sudoPrecache = await precacheSudoCredentials(parentWindow ?? null);
  if (sudoPrecache.cancelled) {
    throw new Error(
      "Installation cancelled: administrator password is required to install browser libraries.",
    );
  }
  if (!sudoPrecache.ok) {
    emit(
      "⚠ Administrator password was not accepted. Continuing without — install may stall at the browser dependency step.\n",
    );
  } else {
    emit("✓ Administrator access granted\n");
  }

  let askpass: Awaited<ReturnType<typeof setupAskpass>> | null = null;
  try {
    askpass = await setupAskpass(parentWindow ?? null);
  } catch (err) {
    emit(
      `\n[askpass] Could not set up GUI password bridge: ${(err as Error).message}\n`,
    );
  }

  try {
    const installScript = await resolveInstallScriptPath("install.sh", {
      emit,
    });
    return await new Promise<void>((resolve, reject) => {
      const home = homedir();

      const basePath = getEnhancedPath();
      const proc = spawn(
        "bash",
        buildUnixInstallArgs(installScript.path, options),
        {
          cwd: home,
          env: {
            ...process.env,
            PATH: askpass ? `${askpass.pathPrepend}:${basePath}` : basePath,
            HOME: home,
            TERM: "dumb",
            ...(askpass?.env ?? {}),
          },
          stdio: ["ignore", "pipe", "pipe"],
          ...HIDDEN_SUBPROCESS_OPTIONS,
        },
      );

      proc.stdout?.on("data", (data: Buffer) => {
        emit(stripAnsi(data.toString()));
      });

      proc.stderr?.on("data", (data: Buffer) => {
        emit(stripAnsi(data.toString()));
      });

      proc.on("close", (code) => {
        if (code === 0) {
          emit("\nInstallation complete!\n");
          resolve();
        } else {
          if (existsSync(HERMES_PYTHON) && existsSync(HERMES_SCRIPT)) {
            emit(
              "\nInstall script exited with warnings, but Hermes is installed successfully.\n",
            );
            resolve();
          } else {
            reject(
              new Error(
                `Installation failed (exit code ${code}). You can try installing via terminal instead.`,
              ),
            );
          }
        }
      });

      proc.on("error", (err) => {
        reject(new Error(`Failed to start installer: ${err.message}`));
      });
    }).finally(() => {
      installScript.cleanup?.();
    });
  } finally {
    askpass?.cleanup();
    sudoPrecache.stop();
  }
}

function validateEngineSha(sha: string): void {
  if (!/^[0-9a-f]{40}$/i.test(sha)) {
    throw new Error("Rollback requires a full 40-character engine commit SHA.");
  }
}

export async function rollbackEngineTo(
  sha: string,
  onProgress: (progress: InstallProgress) => void,
  parentWindow?: BrowserWindow | null,
): Promise<void> {
  validateEngineSha(sha);
  await runInstall(onProgress, parentWindow, { commit: sha });
}

function psQuote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

function resolvePowerShellExe(): string {
  const programFiles = process.env["ProgramFiles"];
  const candidates = [
    programFiles ? join(programFiles, "PowerShell", "7", "pwsh.exe") : null,
    "pwsh.exe",
    "powershell.exe",
  ].filter((p): p is string => Boolean(p));
  for (const c of candidates) {
    if (c.includes("\\") && existsSync(c)) return c;
  }
  return "powershell.exe";
}

async function runInstallWindows(
  emit: (t: string) => void,
  options: InstallScriptOptions = {},
): Promise<void> {
  const home = homedir();
  const hermesHome = HERMES_HOME;
  const installDir = HERMES_REPO;
  const installScript = await resolveInstallScriptPath("install.ps1", { emit });

  const wrapperPath = join(
    tmpdir(),
    `hermes-install-${randomBytes(6).toString("hex")}.ps1`,
  );

  const wrapperScript = [
    "$ErrorActionPreference = 'Stop'",
    `$localScript = ${psQuote(installScript.path)}`,
    `$installer = Join-Path $env:TEMP ("hermes-install-script-" + [guid]::NewGuid().ToString() + ".ps1")`,
    "$text = [System.IO.File]::ReadAllText($localScript)",
    "[System.IO.File]::WriteAllText($installer, $text, (New-Object System.Text.UTF8Encoding $true))",
    buildWindowsInstallCommand("$installer", hermesHome, installDir, options),
    "$exit = $LASTEXITCODE",
    "Remove-Item -Force -ErrorAction SilentlyContinue $installer",
    "exit $exit",
    "",
  ].join("\r\n");

  try {
    writeFileSync(wrapperPath, wrapperScript, { encoding: "utf8" });
  } catch (err) {
    installScript.cleanup?.();
    throw new Error(
      `Failed to stage Windows installer: ${(err as Error).message}`,
    );
  }

  const psExe = resolvePowerShellExe();
  const basePath = getEnhancedPath();

  return new Promise<void>((resolve, reject) => {
    const proc = spawn(
      psExe,
      [
        "-ExecutionPolicy",
        "Bypass",
        "-NoProfile",
        "-NonInteractive",
        "-File",
        wrapperPath,
      ],
      {
        cwd: home,
        env: {
          ...process.env,
          PATH: basePath,
          HERMES_HOME: hermesHome,
          NO_COLOR: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
        ...HIDDEN_SUBPROCESS_OPTIONS,
      },
    );

    const cleanup = (): void => {
      try {
        unlinkSync(wrapperPath);
      } catch {
        /* best-effort */
      }
      installScript.cleanup?.();
    };

    proc.stdout?.on("data", (data: Buffer) => {
      emit(stripAnsi(data.toString()));
    });

    proc.stderr?.on("data", (data: Buffer) => {
      emit(stripAnsi(data.toString()));
    });

    proc.on("close", (code) => {
      cleanup();
      if (code === 0) {
        emit("\nInstallation complete!\n");
        resolve();
        return;
      }
      if (existsSync(HERMES_PYTHON) && existsSync(HERMES_SCRIPT)) {
        emit(
          "\nInstall script exited with warnings, but Hermes is installed successfully.\n",
        );
        resolve();
      } else {
        reject(
          new Error(
            `Installation failed (exit code ${code}). Open PowerShell and try: irm https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.ps1 | iex`,
          ),
        );
      }
    });

    proc.on("error", (err) => {
      cleanup();
      const hint =
        (err as NodeJS.ErrnoException).code === "ENOENT"
          ? " PowerShell was not found. Reinstall Windows PowerShell or run the installer manually from a terminal."
          : "";
      reject(new Error(`Failed to start installer: ${err.message}.${hint}`));
    });
  });
}

export function runHermesDump(): Promise<string> {
  if (!existsSync(HERMES_PYTHON) || !existsSync(HERMES_SCRIPT)) {
    return Promise.resolve("Hermes is not installed.");
  }
  return new Promise((resolve) => {
    execFile(
      HERMES_PYTHON,
      hermesCliArgs(["dump"]),
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
        ...HIDDEN_SUBPROCESS_OPTIONS,
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

export interface MemoryProviderInfo {
  name: string;
  description: string;
  installed: boolean;
  active: boolean;
  envVars: string[];
}

export function discoverMemoryProviders(
  profile?: string,
): MemoryProviderInfo[] {
  const pluginsDir = join(HERMES_REPO, "plugins", "memory");
  if (!existsSync(pluginsDir)) return [];

  const activeProvider = getActiveMemoryProvider(profile);

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
    "recall-sqlite": {
      description: "memory.providers.recall-sqlite",
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

  results.sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    if (a.installed !== b.installed) return a.installed ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return results;
}

export function getActiveMemoryProvider(profile?: string): string {
  try {
    return getConfigValue("memory.provider", profile) || "";
  } catch {
    return "";
  }
}

export function readLogs(
  logFile = "agent.log",
  lines = 200,
): { content: string; path: string } {
  const logsDir = join(HERMES_HOME, "logs");
  const allowed = [
    "agent.log",
    "errors.log",
    "gateway.log",
    "gateway-stderr.log",
  ];
  const file = allowed.includes(logFile) ? logFile : "agent.log";
  const fullPath = join(logsDir, file);

  if (!existsSync(fullPath)) {
    return { content: "", path: fullPath };
  }
  try {
    const content = readFileSync(fullPath, "utf-8");
    const allLines = content.split("\n");
    const tail = allLines.slice(-lines).join("\n");
    return { content: tail, path: fullPath };
  } catch {
    return { content: "", path: fullPath };
  }
}

export async function runSecurityAudit(profile?: string): Promise<string> {
  if (!existsSync(HERMES_PYTHON) || !existsSync(HERMES_SCRIPT)) {
    return "Hermes is not installed.";
  }
  return new Promise((resolve) => {
    const args = hermesCliArgs(["security", "audit"]);
    if (profile && profile !== "default") {
      args.splice(process.platform === "win32" ? 2 : 1, 0, "-p", profile);
    }
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
        },
        timeout: 60000,
        ...HIDDEN_SUBPROCESS_OPTIONS,
      },
      (_error, stdout, stderr) => {
        const output = stdout.toString() + stderr.toString();
        resolve(stripAnsi(output));
      },
    );
  });
}

export async function getPromptSizeBreakdown(
  profile?: string,
): Promise<string> {
  if (!existsSync(HERMES_PYTHON) || !existsSync(HERMES_SCRIPT)) {
    return JSON.stringify({ error: "Hermes is not installed." });
  }
  return new Promise((resolve) => {
    const args = hermesCliArgs(["prompt-size", "--json"]);
    if (profile && profile !== "default") {
      args.splice(process.platform === "win32" ? 2 : 1, 0, "-p", profile);
    }
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
        },
        timeout: 15000,
        ...HIDDEN_SUBPROCESS_OPTIONS,
      },
      (_error, stdout) => {
        resolve(stdout.toString().trim() || "{}");
      },
    );
  });
}

export async function getChangelog(): Promise<string> {
  if (!existsSync(join(HERMES_REPO, ".git"))) {
    return "";
  }
  return new Promise((resolve) => {
    execFile(
      "git",
      ["log", "HEAD..@{u}", "--oneline", "-n", "30"],
      {
        cwd: HERMES_REPO,
        env: {
          ...process.env,
          PATH: getEnhancedPath(),
          HOME: homedir(),
          HERMES_HOME,
        },
        timeout: 10000,
        ...HIDDEN_SUBPROCESS_OPTIONS,
      },
      (_error, stdout) => {
        resolve(stripAnsi(stdout.toString()));
      },
    );
  });
}
