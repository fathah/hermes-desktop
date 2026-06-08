import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { randomBytes } from "crypto";
import { join } from "path";
import { HERMES_HOME, expectedEnvKeyForModel } from "./installer";
import type {
  SshConnectionConfig,
  PublicConnectionConfig,
} from "../shared/connection";
export type { SshConnectionConfig, PublicConnectionConfig };
import {
  escapeRegex,
  getActiveProfileNameSync,
  profileHome,
  profilePaths,
  safeWriteFile,
} from "./utils";
import { getYamlValue, setYamlValue, deleteYamlValue } from "./yaml-utils";
import { canonicalProviderBaseUrl } from "./provider-registry";
import {
  expectedEnvKeyForUrl,
  OPENAI_COMPAT_PROVIDERS,
} from "../shared/url-key-map";

let safeStorage: typeof import("electron").safeStorage | undefined;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  safeStorage = require("electron").safeStorage;
} catch {
  // Not running inside an Electron environment (e.g. unit tests)
}

type MockSafeStorageGlobal = typeof globalThis & {
  mockSafeStorage?: typeof safeStorage;
};

function getSafeStorage(): typeof safeStorage {
  return (globalThis as MockSafeStorageGlobal).mockSafeStorage ?? safeStorage;
}

// ── Connection Config (local / remote / ssh) ─────────────

export interface ConnectionConfig {
  mode: "local" | "remote" | "ssh";
  remoteUrl: string;
  apiKey: string;
  ssh: SshConnectionConfig;
}

// Lazy getter — avoids circular dependency with installer.ts
// (HERMES_HOME may not be assigned yet when this module first loads)
function desktopConfigFile(): string {
  return join(HERMES_HOME, "desktop.json");
}

export function encryptSecret(secret: string): string {
  if (!secret) return "";
  const storage = getSafeStorage();
  if (storage && storage.isEncryptionAvailable()) {
    try {
      return storage.encryptString(secret).toString("base64");
    } catch (err) {
      console.error("[Security] Failed to encrypt secret:", err);
    }
  }
  return secret;
}

export function decryptSecret(payload: string): string {
  if (!payload) return "";
  const storage = getSafeStorage();
  if (storage && storage.isEncryptionAvailable()) {
    try {
      const buffer = Buffer.from(payload, "base64");
      return storage.decryptString(buffer);
    } catch {
      // Fallback for legacy plaintext values
      return payload;
    }
  }
  return payload;
}

export function readDesktopConfig(): Record<string, unknown> {
  try {
    const f = desktopConfigFile();
    if (!existsSync(f)) return {};
    const data = JSON.parse(readFileSync(f, "utf-8"));
    if (data && typeof data === "object") {
      if (typeof data.remoteApiKey === "string") {
        data.remoteApiKey = decryptSecret(data.remoteApiKey);
      }
      if (typeof data.apiServerKey === "string") {
        data.apiServerKey = decryptSecret(data.apiServerKey);
      }
    }
    return data;
  } catch {
    return {};
  }
}

export function writeDesktopConfig(data: Record<string, unknown>): void {
  if (!existsSync(HERMES_HOME)) {
    mkdirSync(HERMES_HOME, { recursive: true });
  }
  const clone = JSON.parse(JSON.stringify(data));
  if (clone && typeof clone === "object") {
    if (typeof clone.remoteApiKey === "string") {
      clone.remoteApiKey = encryptSecret(clone.remoteApiKey);
    }
    if (typeof clone.apiServerKey === "string") {
      clone.apiServerKey = encryptSecret(clone.apiServerKey);
    }
  }
  writeFileSync(desktopConfigFile(), JSON.stringify(clone, null, 2), "utf-8");
}

// ── Desktop automation prefs (M2) ────────────────────────────────────────────
// App-level, desktop-owned policy/UX toggles stored in desktop.json. They live
// here (not config.yaml) because they are enforced by the desktop main process,
// not the gateway, and because setConfigValue silently drops new nested YAML keys.

/** Scoped auto-approve: let the desktop auto-resolve provably-safe, read-only
 *  command approvals (see autonomy.ts). PER-PROFILE (different profiles carry
 *  different risk), keyed by the resolved profile name in desktop.json. Default
 *  OFF — opt-in only. Resolving undefined → active profile keeps the key stable
 *  between the Settings UI (passes a name) and the chat path (often passes none). */
function autoApproveKey(profile?: string): string {
  return profile || getActiveProfileNameSync();
}
export function getAutoApprove(profile?: string): boolean {
  const map = readDesktopConfig().autoApproveByProfile;
  if (!map || typeof map !== "object") return false;
  return (map as Record<string, unknown>)[autoApproveKey(profile)] === true;
}
export function setAutoApprove(enabled: boolean, profile?: string): void {
  const data = readDesktopConfig();
  const existing = data.autoApproveByProfile;
  const map: Record<string, boolean> =
    existing && typeof existing === "object"
      ? (existing as Record<string, boolean>)
      : {};
  map[autoApproveKey(profile)] = enabled;
  data.autoApproveByProfile = map;
  writeDesktopConfig(data);
}

/** Play a system chime when an agent run completes (handy with parallel runs). */
export function getCompletionSound(): boolean {
  return readDesktopConfig().completionSound === true;
}
export function setCompletionSound(enabled: boolean): void {
  const data = readDesktopConfig();
  data.completionSound = enabled;
  writeDesktopConfig(data);
}

export function getConnectionConfig(): ConnectionConfig {
  const data = readDesktopConfig();
  const ssh = (data.sshConfig as Partial<SshConnectionConfig>) ?? {};
  return {
    mode: (data.connectionMode as "local" | "remote" | "ssh") || "local",
    remoteUrl: (data.remoteUrl as string) || "",
    apiKey: (data.remoteApiKey as string) || "",
    ssh: {
      host: (ssh.host as string) || "",
      port: (ssh.port as number) || 22,
      username: (ssh.username as string) || "",
      keyPath: (ssh.keyPath as string) || "",
      remotePort: (ssh.remotePort as number) || 8642,
      localPort: (ssh.localPort as number) || 18642,
    },
  };
}

export function getPublicConnectionConfig(): PublicConnectionConfig {
  const config = getConnectionConfig();
  return {
    mode: config.mode,
    remoteUrl: config.remoteUrl,
    hasApiKey: config.apiKey.length > 0,
    apiKeyLength: config.apiKey.length,
    ssh: config.ssh,
  };
}

export function setConnectionConfig(config: ConnectionConfig): void {
  const data = readDesktopConfig();
  data.connectionMode = config.mode;
  data.remoteUrl = config.remoteUrl;
  data.remoteApiKey = config.apiKey;
  if (config.mode === "ssh") {
    data.sshConfig = config.ssh;
  }
  writeDesktopConfig(data);
}

export function resolveConnectionApiKeyUpdate(
  existing: ConnectionConfig,
  mode: "local" | "remote" | "ssh",
  remoteUrl: string,
  apiKey?: string,
): string {
  if (apiKey !== undefined) return apiKey;
  if (existing.mode === mode && existing.remoteUrl === remoteUrl) {
    return existing.apiKey;
  }
  return "";
}

// ── In-memory cache with TTL ─────────────────────────────
const CACHE_TTL = 5000; // 5 seconds
const _cache = new Map<string, { data: unknown; ts: number }>();
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function getCached<T>(key: string): T | undefined {
  const entry = _cache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.ts > CACHE_TTL) {
    _cache.delete(key);
    return undefined;
  }
  return entry.data as T;
}

function setCache(key: string, data: unknown): void {
  _cache.set(key, { data, ts: Date.now() });
}

function invalidateCache(prefix: string): void {
  for (const key of _cache.keys()) {
    if (key.startsWith(prefix)) _cache.delete(key);
  }
}

export function readEnv(profile?: string): Record<string, string> {
  const cacheKey = `env:${profile || "default"}`;
  const cached = getCached<Record<string, string>>(cacheKey);
  if (cached) return cached;

  const { envFile } = profilePaths(profile);
  if (!existsSync(envFile)) return {};

  const content = readFileSync(envFile, "utf-8");
  const result: Record<string, string> = {};

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#") || !trimmed.includes("=")) continue;

    const eqIndex = trimmed.indexOf("=");
    const key = trimmed.substring(0, eqIndex).trim();
    let value = trimmed.substring(eqIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  setCache(cacheKey, result);
  return result;
}

export function setEnvValue(
  key: string,
  value: string,
  profile?: string,
): void {
  validateEnvEntry(key, value);

  const { envFile } = profilePaths(profile);
  invalidateCache(`env:${profile || "default"}`);
  if (key === "API_SERVER_KEY") invalidateCache("apiServerKey:");

  if (!existsSync(envFile)) {
    safeWriteFile(envFile, `${key}=${value}\n`);
    return;
  }

  const content = readFileSync(envFile, "utf-8");
  const lines = content.split("\n");
  let found = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.match(new RegExp(`^#?\\s*${escapeRegex(key)}\\s*=`))) {
      lines[i] = `${key}=${value}`;
      found = true;
      break;
    }
  }

  if (!found) {
    lines.push(`${key}=${value}`);
  }

  safeWriteFile(envFile, lines.join("\n"));
}

export function validateEnvEntry(key: string, value: string): void {
  if (!ENV_KEY_RE.test(key)) {
    throw new Error(
      "Invalid environment variable name. Use letters, numbers, and underscores, and do not start with a number.",
    );
  }

  if (/[\0\r\n]/.test(value)) {
    throw new Error("Environment variable values must be single-line strings.");
  }
}



/**
 * Locate a dotted YAML path in `content` (e.g. "agent.service_tier" finds
 * the `service_tier` field nested under top-level `agent:`). Returns the
 * value plus the substring offsets a writer can splice over, or null
 * when any segment of the path is missing.
 *
 * Why this exists: the renderer passes dotted paths like
 * `agent.service_tier`, `memory.provider`, `network.force_ipv4` through
 * `getConfig`/`setConfig`. The old implementation used the key string as
 * a literal regex fragment, so it looked for a flat line spelled exactly
 * `agent.service_tier:` — which never exists in real YAML and silently
 * returned null. Flat keys also leaked across blocks (a `service_tier`
 * under `telegram:` could shadow `agent.service_tier`). See issue #247.
 *
 * Each segment must appear at strictly-greater indent than its parent's
 * line. Segments without dots are treated as 1-segment paths and pinned
 * to the top level (column-0 keys only) — so a flat `provider` no longer
 * matches `model.provider` or `auxiliary.vision.provider` by accident.
 *
 * Returns the first match in document order at each level; later
 * duplicates at the same level are ignored, matching YAML semantics for
 * mappings.
 */


export function getConfigValue(key: string, profile?: string): string | null {
  const { configFile } = profilePaths(profile);
  if (!existsSync(configFile)) return null;

  const content = readFileSync(configFile, "utf-8");
  return getYamlValue(content, key);
}

export function setConfigValue(
  key: string,
  value: string,
  profile?: string,
): void {
  if (
    key === "API_SERVER_KEY" ||
    key === "api_server.token" ||
    key.startsWith("api_server.")
  ) {
    invalidateCache("apiServerKey:");
  }
  const { configFile } = profilePaths(profile);
  if (!existsSync(configFile)) return;

  const content = readFileSync(configFile, "utf-8");
  const updated = setYamlValue(content, key, value, { upsert: false });
  safeWriteFile(configFile, updated);
}



export function getModelConfig(profile?: string): {
  provider: string;
  model: string;
  baseUrl: string;
} {
  const cacheKey = `mc:${profile || "default"}`;
  const cached = getCached<{
    provider: string;
    model: string;
    baseUrl: string;
  }>(cacheKey);
  if (cached) return cached;

  const { configFile } = profilePaths(profile);
  const defaults = { provider: "auto", model: "", baseUrl: "" };
  if (!existsSync(configFile)) return defaults;

  const content = readFileSync(configFile, "utf-8");
  const result = {
    provider: getYamlValue(content, "model.provider") || defaults.provider,
    model: getYamlValue(content, "model.default") || defaults.model,
    baseUrl: getYamlValue(content, "model.base_url") || defaults.baseUrl,
  };

  setCache(cacheKey, result);
  return result;
}

/**
 * Mirror of the runtime key-resolution fallback for OpenAI-compatible /
 * custom endpoints (see `sendMessageViaCli` in hermes.ts): the gateway tries
 * the URL-specific key, then `CUSTOM_API_KEY`, then `OPENAI_API_KEY`. Returns
 * true when any link in that chain is populated for `profile`.
 *
 * Why it exists: the pre-send readiness check and the config-health audit
 * derive a single expected key from the base URL (e.g. a Groq URL →
 * `GROQ_API_KEY`). But a user on the "OpenAI Compatible" provider pointed at
 * Groq legitimately authenticates with `OPENAI_API_KEY` — the runtime falls
 * back to it — so demanding `GROQ_API_KEY` is a false positive (the chat
 * actually works). This lets those checks accept the same keys the gateway
 * does. Returns false for providers the runtime does NOT route through the
 * custom path, so their specific-key checks still apply.
 *
 * (The runtime also consults a per-model `CUSTOM_PROVIDER_<name>_KEY` ahead of
 * the generic keys; that lookup needs models.json and is intentionally omitted
 * here to keep config.ts free of a models.ts import — the generic chain covers
 * the reported cases.)
 */
export function customEndpointKeyResolvable(
  provider: string,
  baseUrl: string,
  profile?: string,
): boolean {
  const p = (provider || "").trim().toLowerCase();
  if (!baseUrl || !OPENAI_COMPAT_PROVIDERS.has(p)) return false;

  const env = readEnv(profile);
  const candidates = new Set<string>([
    expectedEnvKeyForUrl(baseUrl), // URL-specific key, or CUSTOM_API_KEY
    "CUSTOM_API_KEY",
    "OPENAI_API_KEY",
  ]);
  for (const k of candidates) {
    if ((env[k] ?? "").trim()) return true;
  }
  return false;
}



/**
 * Pick a value to write under model.api_key when the user configures a
 * provider="custom" entry pointing at a known commercial host (DeepSeek,
 * Groq, Mistral, etc.).
 *
 * Workaround for an upstream hermes-agent bug
 * (NousResearch/hermes-agent #?? — see fathah/hermes-desktop#260): the
 * gateway's ``_resolve_openrouter_runtime`` fallback chain reaches
 * ``OPENAI_API_KEY``/``OPENROUTER_API_KEY`` when a bare ``custom``
 * provider's credential pool is empty, which leaks unrelated keys to
 * non-OpenAI endpoints (manifesting as ``****ired`` / 401 from
 * api.deepseek.com).  Writing the matching env-var value to
 * ``model.api_key`` makes ``cfg_api_key`` win that chain before the
 * leak ever runs.
 *
 * Returns null when the provider/base_url combination doesn't match a
 * known commercial host or no env var is set — leaves the user's
 * config untouched for local LLMs (Ollama, vLLM, etc.).
 */
function pickAutoApiKeyForCustomProvider(
  provider: string,
  baseUrl: string,
  profile?: string,
): string | null {
  if (provider !== "custom" || !baseUrl) return null;
  const envKey = expectedEnvKeyForModel(provider, baseUrl);
  if (!envKey) return null;
  const env = readEnv(profile);
  const raw = env[envKey];
  if (!raw) return null;
  const trimmed = raw.trim().replace(/^["']|["']$/g, "");
  return trimmed || null;
}



export function setModelConfig(
  provider: string,
  model: string,
  baseUrl: string,
  profile?: string,
): void {
  invalidateCache(`mc:${profile || "default"}`);
  const { configFile } = profilePaths(profile);

  let content = existsSync(configFile) ? readFileSync(configFile, "utf-8") : "";

  content = setYamlValue(content, "model.provider", provider);
  content = setYamlValue(content, "model.default", model);

  const effectiveBaseUrl = baseUrl || canonicalProviderBaseUrl(provider) || "";
  if (effectiveBaseUrl) {
    content = setYamlValue(content, "model.base_url", effectiveBaseUrl);
  } else {
    content = deleteYamlValue(content, "model.base_url");
  }

  const autoApiKey = pickAutoApiKeyForCustomProvider(
    provider,
    baseUrl,
    profile,
  );
  if (autoApiKey) {
    content = setYamlValue(content, "model.api_key", autoApiKey);
  } else {
    content = deleteYamlValue(content, "model.api_key");
  }

  // Disable smart_model_routing
  content = setYamlValue(content, "smart_model_routing.enabled", "false");

  // Enable streaming
  if (getYamlValue(content, "streaming") !== null) {
    content = setYamlValue(content, "streaming", "true");
  }

  safeWriteFile(configFile, content);
}

export function getHermesHome(profile?: string): string {
  return profilePaths(profile).home;
}

/**
 * Resolve the API server's shared secret. Honoured by the local hermes
 * gateway (`api_server.token` in `config.yaml` / `API_SERVER_KEY` in
 * `.env`) when present; the desktop must include it as
 * `Authorization: Bearer …` on every chat request, otherwise the gateway
 * responds with "Invalid API key" / "Session continuation requires API
 * key authentication".
 *
 * Search order — explicit overrides first, canonical locations after:
 *
 *   1. Profile `config.yaml` top-level `API_SERVER_KEY` (legacy override)
 *   2. Default `config.yaml` top-level `API_SERVER_KEY` (legacy override)
 *   3. Profile `.env` `API_SERVER_KEY` (matches what the gateway reads)
 *   4. Default `.env` `API_SERVER_KEY`
 *   5. Profile `config.yaml` `api_server.token` (canonical hermes-agent
 *      gateway-secret location — issue #333)
 *   6. Default `config.yaml` `api_server.token`
 *
 * The `api_server.token` candidates are the bug fix for #333: users who
 * ran `hermes setup` (which writes `api_server.token` into `config.yaml`
 * but does not touch `.env`) would otherwise see chat fail on the
 * second message with *"Session continuation requires API key
 * authentication. Configure API_SERVER_KEY to enable this feature."*
 *
 * `.env` is checked **before** `api_server.token` so that the
 * documented manual workaround — add `API_SERVER_KEY=…` to `.env` to
 * unblock the second message — still takes precedence when a user has
 * set it explicitly.
 *
 * Returns "" when none of the six locations are configured.
 *
 * Hot path: called per chat message and per error-probe. Reuse the same
 * 5s TTL cache as `readEnv()` so we do not re-parse `config.yaml` +
 * `.env` every call. Invalidated by `setEnvValue` / `setConfigValue`
 * when the key being written is `API_SERVER_KEY` or any
 * `api_server.*` subkey.
 */
export function getApiServerKey(profile?: string): string {
  const cacheKey = `apiServerKey:${profile || "default"}`;
  const cached = getCached<string>(cacheKey);
  if (cached !== undefined) return cached;

  const envForProfile = readEnv(profile);
  const sources: ApiKeySources = {
    configTopLevelProfile: getConfigValue("API_SERVER_KEY", profile),
    configTopLevelDefault:
      profile && profile !== "default"
        ? getConfigValue("API_SERVER_KEY")
        : null,
    envProfile: envForProfile.API_SERVER_KEY ?? null,
    envDefault:
      profile && profile !== "default"
        ? (readEnv().API_SERVER_KEY ?? null)
        : null,
    apiServerTokenProfile: getConfigValue("api_server.token", profile),
    apiServerTokenDefault:
      profile && profile !== "default"
        ? getConfigValue("api_server.token")
        : null,
  };
  let { value, source } = resolveApiServerKeyWithSource(sources);

  if (!value) {
    // Zero Trust Secure Fallback: Retrieve the key encrypted inside desktop.json
    try {
      const desktopConfig = readDesktopConfig();
      if (
        typeof desktopConfig.apiServerKey === "string" &&
        desktopConfig.apiServerKey
      ) {
        value = desktopConfig.apiServerKey;
        source = "envProfile"; // Skip migration warning to plaintext .env
      }
    } catch {
      value = "";
    }
  }

  // Migration on read — if we resolved the key from a non-canonical
  // location AND the canonical `.env` slot is empty for this profile,
  // copy the value into `.env`. Keeps the original copy alone (additive
  // only — never deletes), so a user who explicitly wrote to
  // `api_server.token:` can still see their original entry there.
  //
  // The point of the migration is to make the gateway's own
  // `os.getenv("API_SERVER_KEY")` lookup find the value: the gateway's
  // env hydration at spawn time also injects it (Piece 0), but a
  // user-edited `.env` is the canonical, file-of-record storage.
  //
  // Per-profile scope: cross-profile migration (e.g. copy default .env
  // value into a profile that has neither) is out of scope — a user
  // running multiple profiles may have intentionally per-profile keys.
  const isNamedProfile = Boolean(profile && profile !== "default");
  const sourceBelongsToProfile =
    !isNamedProfile ||
    source === "configTopLevelProfile" ||
    source === "apiServerTokenProfile";
  if (
    value &&
    source &&
    sourceBelongsToProfile &&
    !CANONICAL_API_KEY_SOURCES.has(source) &&
    !(envForProfile.API_SERVER_KEY ?? "").trim()
  ) {
    try {
      setEnvValue("API_SERVER_KEY", value, profile);
      appendConfigFixLog({
        ts: Date.now(),
        issueCode: "API_SERVER_KEY_NON_CANONICAL",
        action: "migrate",
        from: source,
        to:
          profile && profile !== "default"
            ? `~/.hermes/profiles/${profile}/.env`
            : "~/.hermes/.env",
        profile: profile || "default",
        valueMasked: maskKey(value),
      });
    } catch {
      // best-effort — don't block the read on a failed migration
    }
  }

  setCache(cacheKey, value);
  return value;
}

/**
 * Identifies which of the six candidate locations a resolved
 * `API_SERVER_KEY` was sourced from. Used by the migration-on-read
 * heuristic in `getApiServerKey` and by the config-health audit to
 * surface keys living outside the canonical `.env` location.
 */
export type ApiKeySource =
  | "configTopLevelProfile"
  | "configTopLevelDefault"
  | "envProfile"
  | "envDefault"
  | "apiServerTokenProfile"
  | "apiServerTokenDefault";

export interface ApiKeySources {
  configTopLevelProfile: string | null;
  configTopLevelDefault: string | null;
  envProfile: string | null;
  envDefault: string | null;
  apiServerTokenProfile: string | null;
  apiServerTokenDefault: string | null;
}

export interface ApiKeyResolution {
  value: string;
  source: ApiKeySource | null;
}

/**
 * Source-aware variant of `resolveApiServerKey`. Returns both the
 * resolved value and a tag indicating which candidate won, so callers
 * can decide whether the value lives in the canonical `.env` location
 * or somewhere that warrants a migration / health-audit warning.
 */
export function resolveApiServerKeyWithSource(
  sources: ApiKeySources,
): ApiKeyResolution {
  const order: Array<{ source: ApiKeySource; value: string | null }> = [
    { source: "configTopLevelProfile", value: sources.configTopLevelProfile },
    { source: "configTopLevelDefault", value: sources.configTopLevelDefault },
    { source: "envProfile", value: sources.envProfile },
    { source: "envDefault", value: sources.envDefault },
    { source: "apiServerTokenProfile", value: sources.apiServerTokenProfile },
    { source: "apiServerTokenDefault", value: sources.apiServerTokenDefault },
  ];
  for (const { source, value } of order) {
    const trimmed = String(value ?? "").trim();
    if (trimmed) return { value: trimmed, source };
  }
  return { value: "", source: null };
}

/**
 * Pure precedence-resolution for the API server's shared secret. Split
 * out from `getApiServerKey` so the candidate-ordering policy can be
 * unit-tested without filesystem fixtures (the I/O — `getConfigValue` /
 * `readEnv` — happens in the caller).
 *
 * Returns the first non-empty trimmed candidate, or "" when all six
 * sources are empty / null / whitespace.
 */
export function resolveApiServerKey(sources: ApiKeySources): string {
  return resolveApiServerKeyWithSource(sources).value;
}

/**
 * Sources that are considered the canonical location for
 * `API_SERVER_KEY`. Reads from anywhere else are still honoured but
 * trigger a migration write to `.env` (see Piece 1) so future reads —
 * and crucially the gateway's own `os.getenv("API_SERVER_KEY")` —
 * find the value in the canonical spot.
 */
export const CANONICAL_API_KEY_SOURCES: ReadonlySet<ApiKeySource> =
  new Set<ApiKeySource>(["envProfile", "envDefault"]);

/**
 * Mask a credential for safe logging: keep the first 4 and last 4
 * characters, replace the middle with a fixed-width ellipsis. Returns
 * "" for empty input and "***" for very short values where masking
 * would still expose most of the key.
 */
export function maskKey(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "***";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

/**
 * Append a JSONL entry to `~/.hermes/logs/config-fixes.log` recording
 * an automated or user-initiated config migration. Auto-truncates the
 * log to the most-recent 1000 entries on each write so it doesn't grow
 * unbounded. Best-effort — any I/O error is silently swallowed so a
 * broken log directory never blocks the migration itself.
 */
export interface ConfigFixLogEntry {
  ts: number;
  issueCode: string;
  action: "migrate" | "autofix" | "manual-fix";
  from?: string;
  to?: string;
  profile?: string;
  valueMasked?: string;
  detail?: string;
}

const CONFIG_FIX_LOG_MAX_LINES = 1000;

export function appendConfigFixLog(entry: ConfigFixLogEntry): void {
  try {
    const logDir = join(HERMES_HOME, "logs");
    if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
    const logFile = join(logDir, "config-fixes.log");
    let existing = "";
    if (existsSync(logFile)) {
      existing = readFileSync(logFile, "utf-8");
      const lines = existing.split("\n").filter((l) => l.trim() !== "");
      if (lines.length >= CONFIG_FIX_LOG_MAX_LINES) {
        existing =
          lines.slice(lines.length - CONFIG_FIX_LOG_MAX_LINES + 1).join("\n") +
          "\n";
      } else if (existing && !existing.endsWith("\n")) {
        existing += "\n";
      }
    }
    const line = JSON.stringify(entry) + "\n";
    writeFileSync(logFile, existing + line, "utf-8");
  } catch {
    // intentionally silent — never let log I/O block a migration
  }
}

// ── Platform enabled/disabled ─────────────────────────────
//
// The Python hermes gateway (gateway/config.py) decides which messaging
// platforms to start from env vars in .env; it doesn't look at a fictional
// `platforms:` YAML section. config.yaml only carries an override-disable
// switch: `<platform>.enabled: false` at the top level. Earlier the desktop
// read and wrote a `platforms:\n  <name>:\n    enabled: …` block that the
// gateway never inspected, so the Gateway UI's toggles were cosmetic.
//
// `envCheck` returns true when the platform's required env vars are present
// (and, for whatsapp, set to a truthy literal). Add new platforms here as
// their Python-side activation rules are confirmed.
interface PlatformRule {
  envCheck: (env: Record<string, string>) => boolean;
  // YAML key for the override-disable lookup. Defaults to the platform key
  // itself; provide an explicit value when the desktop's display key
  // diverges from the Python CLI's config.yaml key (e.g. "home_assistant"
  // in the desktop vs "homeassistant" in the Python gateway).
  configKey?: string;
}

const TRUTHY_VALUES = new Set(["true", "1", "yes", "on"]);

const PLATFORM_RULES: Record<string, PlatformRule> = {
  telegram: { envCheck: (e) => !!e.TELEGRAM_BOT_TOKEN?.trim() },
  discord: { envCheck: (e) => !!e.DISCORD_BOT_TOKEN?.trim() },
  slack: { envCheck: (e) => !!e.SLACK_BOT_TOKEN?.trim() },
  whatsapp: {
    envCheck: (e) =>
      TRUTHY_VALUES.has((e.WHATSAPP_ENABLED || "").trim().toLowerCase()),
  },
  signal: {
    envCheck: (e) => !!e.SIGNAL_HTTP_URL?.trim() && !!e.SIGNAL_ACCOUNT?.trim(),
  },
  matrix: {
    envCheck: (e) =>
      !!e.MATRIX_ACCESS_TOKEN?.trim() || !!e.MATRIX_PASSWORD?.trim(),
  },
  mattermost: { envCheck: (e) => !!e.MATTERMOST_TOKEN?.trim() },
  home_assistant: {
    envCheck: (e) => !!e.HASS_TOKEN?.trim(),
    configKey: "homeassistant",
  },
};

const SUPPORTED_PLATFORMS = Object.keys(PLATFORM_RULES);

/**
 * Match a top-level YAML block's `enabled: <bool>` field, e.g.:
 *
 *     telegram:
 *       reactions: false
 *       enabled: false      ← captured
 *       allowed_chats: ''
 *
 * Returns true/false if found, null if absent. The block must start at
 * column 0; `enabled:` is captured if it sits anywhere inside the
 * contiguous indented sub-block (any depth, in any position).
 */
function readPlatformOverride(
  content: string,
  platform: string,
): boolean | null {
  const blockStartRe = new RegExp(
    `^${escapeRegex(platform)}:[ \\t]*\\r?\\n`,
    "m",
  );
  const startMatch = content.match(blockStartRe);
  if (!startMatch || startMatch.index === undefined) return null;

  const after = content.slice(startMatch.index + startMatch[0].length);
  const lines = after.split(/\r?\n/);
  for (const line of lines) {
    if (line.trim() === "") continue;
    if (!/^\s/.test(line)) break; // hit next top-level key
    const m = line.match(/^[ \t]+enabled:[ \t]*(true|false)\b/);
    if (m) return m[1] === "true";
  }
  return null;
}

export function getPlatformEnabled(profile?: string): Record<string, boolean> {
  const env = readEnv(profile);
  const { configFile } = profilePaths(profile);
  const content = existsSync(configFile)
    ? readFileSync(configFile, "utf-8")
    : "";

  const result: Record<string, boolean> = {};
  for (const platform of SUPPORTED_PLATFORMS) {
    const rule = PLATFORM_RULES[platform];
    const envEnabled = rule.envCheck(env);
    const configKey = rule.configKey || platform;
    const override = content ? readPlatformOverride(content, configKey) : null;
    // Python's rule: env-driven activation, config.yaml `enabled: false`
    // can force-disable. An explicit `enabled: true` doesn't bypass a
    // missing token (the Python gateway still requires the credential),
    // so reflect that here too.
    result[platform] = envEnabled && override !== false;
  }
  return result;
}

/**
 * Toggle a platform's force-disable override in config.yaml.
 *
 * The Python gateway activates a platform when its env vars are set;
 * config can force-disable with `<platform>.enabled: false` at the top
 * level. So toggling here writes/removes that single key:
 *
 *   - enabled=false → ensure `enabled: false` exists in the top-level
 *     `<platform>:` block (modify in place, append a child, or create
 *     the block).
 *   - enabled=true  → remove any existing `enabled: false` line.
 *
 * Filling in the platform's token env vars is what actually starts it;
 * this function only manages the disable override.
 */
export function setPlatformEnabled(
  platform: string,
  enabled: boolean,
  profile?: string,
): void {
  const rule = PLATFORM_RULES[platform];
  if (!rule) return;
  // Use the Python-side YAML key when writing the override, not the
  // desktop's display key (matters for home_assistant → homeassistant).
  const configKey = rule.configKey || platform;

  const { configFile } = profilePaths(profile);
  if (!existsSync(configFile)) {
    // Only need to write a file when we're recording a disable override;
    // enabling a platform that has no config is the default.
    if (enabled) return;
    safeWriteFile(configFile, `${configKey}:\n  enabled: false\n`);
    return;
  }

  let content = readFileSync(configFile, "utf-8");
  const enabledLineRe = new RegExp(
    `^([ \\t]+enabled:[ \\t]*)(true|false)\\b([ \\t]*)$`,
    "m",
  );
  const blockStartRe = new RegExp(
    `^(${escapeRegex(configKey)}:[ \\t]*\\r?\\n)`,
    "m",
  );
  const flowStyleRe = new RegExp(
    `^${escapeRegex(configKey)}:[ \\t]*\\{\\s*\\}[ \\t]*$`,
    "m",
  );

  const blockMatch = content.match(blockStartRe);
  const hasBlock = !!blockMatch;
  const isFlowEmpty = flowStyleRe.test(content);

  if (isFlowEmpty) {
    // Convert `<platform>: {}` to a block we can edit.
    content = content.replace(
      flowStyleRe,
      `${configKey}:\n  enabled: ${enabled}`,
    );
    safeWriteFile(configFile, content);
    return;
  }

  if (hasBlock && blockMatch?.index !== undefined) {
    const blockStart = blockMatch.index + blockMatch[0].length;
    const rest = content.slice(blockStart);
    const restLines = rest.split(/\r?\n/);

    // Find the extent of the platform's sub-block (indented children).
    let subBlockEndOffset = 0;
    let existingEnabledLineStart: number | null = null;
    let existingEnabledLineEnd: number | null = null;
    for (const line of restLines) {
      const lineLen = line.length + 1; // include trailing \n
      if (line.trim() === "") {
        subBlockEndOffset += lineLen;
        continue;
      }
      if (!/^\s/.test(line)) break;
      const localStart = blockStart + subBlockEndOffset;
      const enabledMatch = line.match(enabledLineRe);
      if (enabledMatch) {
        existingEnabledLineStart = localStart;
        existingEnabledLineEnd = localStart + line.length;
      }
      subBlockEndOffset += lineLen;
    }

    if (existingEnabledLineStart !== null && existingEnabledLineEnd !== null) {
      if (enabled) {
        // Remove the entire `  enabled: false` line, including its newline.
        const removeEnd =
          content[existingEnabledLineEnd] === "\n"
            ? existingEnabledLineEnd + 1
            : existingEnabledLineEnd;
        content =
          content.slice(0, existingEnabledLineStart) + content.slice(removeEnd);
      } else {
        content =
          content.slice(0, existingEnabledLineStart) +
          `  enabled: false` +
          content.slice(existingEnabledLineEnd);
      }
    } else if (!enabled) {
      // Append `enabled: false` as the first child of the block.
      content =
        content.slice(0, blockStart) +
        `  enabled: false\n` +
        content.slice(blockStart);
    }
    // (enabled=true with no existing override: nothing to do.)

    safeWriteFile(configFile, content);
    return;
  }

  // No block at all — only need to materialize one when recording a disable.
  if (!enabled) {
    const trailingNewline = content.endsWith("\n") ? "" : "\n";
    content += `${trailingNewline}${configKey}:\n  enabled: false\n`;
    safeWriteFile(configFile, content);
  }
}

// ── Credential Pool / OAuth store (auth.json) ─────────────────────────

function authFilePath(profile?: string): string {
  return join(profileHome(profile || getActiveProfileNameSync()), "auth.json");
}

/**
 * Shape of a credential-pool entry as the upstream gateway expects it.
 *
 * The engine's resolver (`hermes_cli/auth.py` and the credential-pool
 * entry parser) reads `access_token` (not `key`), needs an
 * `auth_type` to distinguish OAuth from API-key entries inside the
 * same pool, and uses `id` / `priority` / `source` for rotation and
 * telemetry. Issue #367 — pool entries written by the desktop with
 * just `{key, label}` were rejected at runtime ("Hermes is not
 * logged into Nous Portal") because none of the canonical fields
 * were present.
 *
 * `key` is retained for read-only compatibility — old auth.json files
 * that already contain `{key, label}` entries are still parsed
 * (otherwise a user's existing manual entries would vanish on first
 * read). New writes always use the full canonical shape.
 */
interface CredentialEntry {
  id?: string;
  label?: string;
  auth_type?: "api_key" | "oauth_device_code" | string;
  priority?: number;
  source?: string;
  access_token?: string;
  refresh_token?: string;
  api_key?: string;
  base_url?: string;
  request_count?: number;
  /** Legacy field — historical pool entries written with `{key, label}`. */
  key?: string;
}

export function readAuthStore(profile?: string): Record<string, unknown> {
  try {
    const p = authFilePath(profile);
    if (!existsSync(p)) return {};
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return {};
  }
}

function writeAuthStore(
  store: Record<string, unknown>,
  profile?: string,
): void {
  safeWriteFile(authFilePath(profile), JSON.stringify(store, null, 2));
}

export function getCredentialPool(
  profile?: string,
): Record<string, CredentialEntry[]> {
  const store = readAuthStore(profile);
  const pool = store.credential_pool;
  if (!pool || typeof pool !== "object") return {};
  return pool as Record<string, CredentialEntry[]>;
}

export function setCredentialPool(
  provider: string,
  entries: CredentialEntry[],
  profile?: string,
): void {
  const store = readAuthStore(profile);
  if (!store.credential_pool || typeof store.credential_pool !== "object") {
    store.credential_pool = {};
  }
  (store.credential_pool as Record<string, CredentialEntry[]>)[provider] =
    entries;
  writeAuthStore(store, profile);
}

/**
 * Build a credential-pool entry in the canonical engine shape from a
 * user-typed (key, label). Used by the Providers screen so the
 * renderer doesn't need to know the upstream schema — issue #367.
 *
 * The base URL for known providers comes from `canonicalProviderBaseUrl`;
 * unknown providers (`custom`, user-defined) get an empty `base_url`
 * and the engine falls back to its own registry.
 */
export function buildCredentialPoolEntry(
  provider: string,
  apiKey: string,
  label: string,
  existingEntries: CredentialEntry[] = [],
): CredentialEntry {
  const baseUrl = canonicalProviderBaseUrl(provider) || "";
  // Next priority — pool entries are sorted ascending, so a new entry
  // appended at the end gets the highest priority value.
  const nextPriority = existingEntries.reduce(
    (max, e) =>
      typeof e.priority === "number" ? Math.max(max, e.priority + 1) : max,
    0,
  );
  return {
    id: cryptoRandomId(),
    label: label.trim() || `Key ${existingEntries.length + 1}`,
    auth_type: "api_key",
    priority: nextPriority,
    source: "manual",
    access_token: apiKey.trim(),
    base_url: baseUrl,
    request_count: 0,
  };
}

function cryptoRandomId(): string {
  // 8-hex-char id — matches the existing pool entries' id length.
  // Uses `randomBytes(4)` so the name finally matches the impl: four
  // cryptographically-strong bytes → 8 hex chars. Post-#382 review
  // feedback flagged the previous `Math.random()` loop as both
  // misleadingly named and collision-prone at scale.
  return randomBytes(4).toString("hex");
}

/**
 * Append a manually-typed credential pool entry, constructing the
 * full canonical shape. Used by the renderer's "Add" button so the
 * shape stays consistent with what the engine's resolver expects.
 *
 * Returns the updated entries list for that provider.
 */
export function addCredentialPoolEntry(
  provider: string,
  apiKey: string,
  label: string,
  profile?: string,
): CredentialEntry[] {
  const existing = getCredentialPool(profile)[provider] || [];
  const entry = buildCredentialPoolEntry(provider, apiKey, label, existing);
  const next = [...existing, entry];
  setCredentialPool(provider, next, profile);
  return next;
}

/**
 * True iff the given provider has usable OAuth or stored-credential evidence
 * in auth.json. Recognized fields are `access_token`, `refresh_token`, and
 * `api_key`, looked up under both `providers[<name>]` and any entry in
 * `credential_pool[<name>]`. When a named profile is given without its own
 * auth.json, fall back to the default-profile store.
 *
 * Stricter than just "provider key exists in JSON" — an empty
 * `providers: { anthropic: {} }` or a bare `active_provider` no longer
 * counts as configured. The previous looser check masked real onboarding
 * errors where a credential record existed but contained no token.
 */
export function hasOAuthCredentials(
  provider: string,
  profile?: string,
): boolean {
  const cleanProvider = provider.trim();
  if (!cleanProvider) return false;

  const stores = [readAuthStore(profile)];
  if (profile && profile !== "default") {
    stores.push(readAuthStore());
  }

  for (const store of stores) {
    const providers = store.providers;
    if (providers && typeof providers === "object") {
      const entry = (providers as Record<string, CredentialEntry>)[
        cleanProvider
      ];
      if (
        entry &&
        (String(entry.access_token || "").trim() ||
          String(entry.refresh_token || "").trim() ||
          String(entry.api_key || "").trim())
      ) {
        return true;
      }
    }

    const pool = store.credential_pool;
    const entries =
      pool && typeof pool === "object"
        ? (pool as Record<string, CredentialEntry[]>)[cleanProvider]
        : undefined;
    if (
      Array.isArray(entries) &&
      entries.some(
        (entry) =>
          !!(
            entry &&
            (String(entry.api_key || "").trim() ||
              String(entry.access_token || "").trim() ||
              String(entry.refresh_token || "").trim())
          ),
      )
    ) {
      return true;
    }
  }

  return false;
}
