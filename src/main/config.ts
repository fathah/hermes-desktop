import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { HERMES_HOME } from "./installer";
import { profileHome, escapeRegex, safeWriteFile } from "./utils";

// ── In-memory cache with TTL ─────────────────────────────
const CACHE_TTL = 5000; // 5 seconds
const _cache = new Map<string, { data: unknown; ts: number }>();

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

function profilePaths(profile?: string): {
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

    if (value) result[key] = value;
  }

  setCache(cacheKey, result);
  return result;
}

export function setEnvValue(
  key: string,
  value: string,
  profile?: string,
): void {
  const { envFile } = profilePaths(profile);
  invalidateCache(`env:${profile || "default"}`);

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

export function getConfigValue(key: string, profile?: string): string | null {
  const { configFile } = profilePaths(profile);
  if (!existsSync(configFile)) return null;

  const content = readFileSync(configFile, "utf-8");
  const regex = new RegExp(
    `^\\s*${escapeRegex(key)}:\\s*["']?([^"'\\n#]+)["']?`,
    "m",
  );
  const match = content.match(regex);
  return match ? match[1].trim() : null;
}

export function setConfigValue(
  key: string,
  value: string,
  profile?: string,
): void {
  const { configFile } = profilePaths(profile);
  if (!existsSync(configFile)) return;

  let content = readFileSync(configFile, "utf-8");
  const regex = new RegExp(
    `^(\\s*#?\\s*${escapeRegex(key)}:\\s*)["']?[^"'\\n#]*["']?`,
    "m",
  );

  if (regex.test(content)) {
    content = content.replace(regex, `$1"${value}"`);
  }

  safeWriteFile(configFile, content);
}

export function getModelConfig(profile?: string): {
  provider: string;
  model: string;
  baseUrl: string;
} {
  const cacheKey = `mc:${profile || "default"}`;
  const cached = getCached<{ provider: string; model: string; baseUrl: string }>(cacheKey);
  if (cached) return cached;

  const { configFile } = profilePaths(profile);
  const defaults = { provider: "auto", model: "", baseUrl: "" };
  if (!existsSync(configFile)) return defaults;

  const content = readFileSync(configFile, "utf-8");

  const providerMatch = content.match(/^\s*provider:\s*["']?([^"'\n#]+)["']?/m);
  const modelMatch = content.match(/^\s*default:\s*["']?([^"'\n#]+)["']?/m);
  const baseUrlMatch = content.match(/^\s*base_url:\s*["']?([^"'\n#]+)["']?/m);

  const result = {
    provider: providerMatch ? providerMatch[1].trim() : defaults.provider,
    model: modelMatch ? modelMatch[1].trim() : defaults.model,
    baseUrl: baseUrlMatch ? baseUrlMatch[1].trim() : defaults.baseUrl,
  };

  setCache(cacheKey, result);
  return result;
}

export function setModelConfig(
  provider: string,
  model: string,
  baseUrl: string,
  profile?: string,
): void {
  invalidateCache(`mc:${profile || "default"}`);
  const { configFile } = profilePaths(profile);
  if (!existsSync(configFile)) return;

  let content = readFileSync(configFile, "utf-8");

  const providerRegex = /^(\s*provider:\s*)["']?[^"'\n#]*["']?/m;
  if (providerRegex.test(content)) {
    content = content.replace(providerRegex, `$1"${provider}"`);
  }

  const modelRegex = /^(\s*default:\s*)["']?[^"'\n#]*["']?/m;
  if (modelRegex.test(content)) {
    content = content.replace(modelRegex, `$1"${model}"`);
  }

  const baseUrlRegex = /^(\s*base_url:\s*)["']?[^"'\n#]*["']?/m;
  if (baseUrlRegex.test(content)) {
    content = content.replace(baseUrlRegex, `$1"${baseUrl}"`);
  }

  // Disable smart_model_routing
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (
      /^\s*enabled:\s*(true|false)/.test(lines[i]) &&
      i > 0 &&
      /smart_model_routing/.test(lines[i - 1])
    ) {
      lines[i] = lines[i].replace(/(enabled:\s*)(true|false)/, "$1false");
    }
  }
  content = lines.join("\n");

  // Enable streaming
  const streamingRegex = /^(\s*streaming:\s*)(\S+)/m;
  if (streamingRegex.test(content)) {
    content = content.replace(streamingRegex, "$1true");
  }

  safeWriteFile(configFile, content);
}

export function getHermesHome(profile?: string): string {
  return profilePaths(profile).home;
}

export function getApiServerKey(profile?: string): string {
  const candidates = [
    getConfigValue("API_SERVER_KEY", profile),
    profile && profile !== "default" ? getConfigValue("API_SERVER_KEY") : null,
    readEnv(profile).API_SERVER_KEY || null,
    profile && profile !== "default" ? readEnv().API_SERVER_KEY || null : null,
  ];

  for (const candidate of candidates) {
    const value = String(candidate || "").trim();
    if (value) return value;
  }

  return "";
}

// ── Platform enabled/disabled in config.yaml ────────────

const SUPPORTED_PLATFORMS = ["telegram", "discord", "slack", "whatsapp", "signal"];

export function getPlatformEnabled(profile?: string): Record<string, boolean> {
  const { configFile } = profilePaths(profile);
  if (!existsSync(configFile)) return {};

  const content = readFileSync(configFile, "utf-8");
  const result: Record<string, boolean> = {};

  for (const platform of SUPPORTED_PLATFORMS) {
    // Match "  platform:\n    enabled: true/false" under the platforms: block
    const re = new RegExp(
      `^[ \\t]+${platform}:\\s*\\n[ \\t]+enabled:\\s*(true|false)`,
      "m",
    );
    const match = content.match(re);
    result[platform] = match ? match[1] === "true" : false;
  }

  return result;
}

export function setPlatformEnabled(
  platform: string,
  enabled: boolean,
  profile?: string,
): void {
  if (!SUPPORTED_PLATFORMS.includes(platform)) return;

  const { configFile } = profilePaths(profile);
  if (!existsSync(configFile)) return;

  let content = readFileSync(configFile, "utf-8");

  // Check if the platform entry already exists under platforms:
  const existingRe = new RegExp(
    `^([ \\t]+${platform}:\\s*\\n[ \\t]+enabled:\\s*)(?:true|false)`,
    "m",
  );

  if (existingRe.test(content)) {
    // Update existing entry
    content = content.replace(existingRe, `$1${enabled}`);
  } else {
    // Append new platform entry after the platforms: block
    // Find the platforms: line and insert after the last existing platform entry
    const platformsIdx = content.indexOf("\nplatforms:");
    if (platformsIdx === -1) {
      // No platforms section at all — append one
      content += `\nplatforms:\n  ${platform}:\n    enabled: ${enabled}\n`;
    } else {
      // Insert the new platform at the end of the platforms block.
      // Find the next top-level key (non-indented, non-comment, non-empty line)
      // after the platforms: line.
      const afterPlatforms = content.substring(platformsIdx + 1);
      const lines = afterPlatforms.split("\n");
      let insertOffset = platformsIdx + 1; // after the \n
      // Skip the "platforms:" line itself
      insertOffset += lines[0].length + 1;

      // Skip all indented lines (children of platforms:)
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim() === "" || /^\s/.test(line)) {
          insertOffset += line.length + 1;
        } else {
          break;
        }
      }

      const entry = `  ${platform}:\n    enabled: ${enabled}\n`;
      content =
        content.substring(0, insertOffset) +
        entry +
        content.substring(insertOffset);
    }
  }

  safeWriteFile(configFile, content);
}

// ── Credential Pool / OAuth store (auth.json) ─────────────────────────

function getActiveProfileNameSync(): string {
  try {
    const activeFile = join(HERMES_HOME, "active_profile");
    if (!existsSync(activeFile)) return "default";
    const name = readFileSync(activeFile, "utf-8").trim();
    return name || "default";
  } catch {
    return "default";
  }
}

function authFilePath(profile?: string): string {
  return join(profileHome(profile || getActiveProfileNameSync()), "auth.json");
}

interface CredentialEntry {
  key?: string;
  api_key?: string;
  access_token?: string;
  refresh_token?: string;
  label?: string;
}

function readAuthStore(profile?: string): Record<string, unknown> {
  try {
    const p = authFilePath(profile);
    if (!existsSync(p)) return {};
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return {};
  }
}

function writeAuthStore(store: Record<string, unknown>, profile?: string): void {
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

export function hasOAuthCredentials(provider: string, profile?: string): boolean {
  const cleanProvider = provider.trim();
  if (!cleanProvider) return false;

  const stores = [readAuthStore(profile)];
  if (profile && profile !== "default") {
    stores.push(readAuthStore());
  }

  for (const store of stores) {
    const providers = store.providers;
    if (providers && typeof providers === "object") {
      const entry = (providers as Record<string, CredentialEntry>)[cleanProvider];
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
