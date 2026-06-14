import { readFileSync, existsSync } from "fs";
import { execFileSync } from "child_process";
import { homedir } from "os";
import { escapeRegex, profilePaths, safeWriteFile } from "../utils";
import { getCached, setCache, invalidateCache } from "./cache";
import {
  HERMES_PYTHON,
  HERMES_REPO,
  HERMES_HOME,
  hermesCliArgs,
  getEnhancedPath,
} from "../installer";
import { HIDDEN_SUBPROCESS_OPTIONS } from "../process-options";

const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

const SENSITIVE_ENV_KEYS = new Set([
  "DISCORD_BOT_TOKEN",
  "SLACK_BOT_TOKEN",
  "SLACK_APP_TOKEN",
  "WHATSAPP_API_TOKEN",
  "WHATSAPP_CLOUD_ACCESS_TOKEN",
  "WHATSAPP_CLOUD_APP_SECRET",
  "WHATSAPP_CLOUD_VERIFY_TOKEN",
  "MATRIX_ACCESS_TOKEN",
  "MATTERMOST_TOKEN",
  "EMAIL_PASSWORD",
  "TWILIO_AUTH_TOKEN",
  "BLUEBUBBLES_PASSWORD",
  "DINGTALK_APP_SECRET",
  "FEISHU_APP_SECRET",
  "WECOM_SECRET",
  "WEBHOOK_SECRET",
  "HASS_TOKEN"
]);

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

    if (value === "__keychain__") {
      try {
        const activeProfile = profile || "default";
        const args = hermesCliArgs(["config", "get-secret", activeProfile, key]);
        const output = execFileSync(HERMES_PYTHON, args, {
          cwd: HERMES_REPO,
          env: {
            ...process.env,
            PATH: getEnhancedPath(),
            HOME: homedir(),
            HERMES_HOME,
          },
          stdio: "pipe",
          timeout: 10000,
          ...HIDDEN_SUBPROCESS_OPTIONS,
        });
        value = output.toString().trim();
      } catch (err) {
        console.error(`[Keychain] Failed to retrieve ${key} from OS Keychain:`, err);
        value = "";
      }
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

  let finalValue = value;
  if (SENSITIVE_ENV_KEYS.has(key)) {
    try {
      const activeProfile = profile || "default";
      const args = hermesCliArgs(["config", "set-secret", activeProfile, key, value]);
      execFileSync(HERMES_PYTHON, args, {
        cwd: HERMES_REPO,
        env: {
          ...process.env,
          PATH: getEnhancedPath(),
          HOME: homedir(),
          HERMES_HOME,
        },
        stdio: "ignore",
        timeout: 10000,
        ...HIDDEN_SUBPROCESS_OPTIONS,
      });
      finalValue = "__keychain__";
    } catch (err) {
      console.error(`[Keychain] Failed to store ${key} in OS Keychain:`, err);
    }
  }

  if (!existsSync(envFile)) {
    safeWriteFile(envFile, `${key}=${finalValue}\n`);
    return;
  }

  const content = readFileSync(envFile, "utf-8");
  const lines = content.split("\n");
  let found = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.match(new RegExp(`^#?\\s*${escapeRegex(key)}\\s*=`))) {
      lines[i] = `${key}=${finalValue}`;
      found = true;
      break;
    }
  }

  if (!found) {
    lines.push(`${key}=${finalValue}`);
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

export function getHermesHome(profile?: string): string {
  return profilePaths(profile).home;
}

export function getKeychainKeys(profile?: string): string[] {
  const { envFile } = profilePaths(profile);
  if (!existsSync(envFile)) return [];

  try {
    const content = readFileSync(envFile, "utf-8");
    const keychainKeys: string[] = [];

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

      if (value === "__keychain__") {
        keychainKeys.push(key);
      }
    }

    return keychainKeys;
  } catch (err) {
    console.error(`[Keychain] Failed to read ${envFile} to resolve keychain keys:`, err);
    return [];
  }
}

// MED-2: the only providers the AI co-author's "config" action may set keys for.
// A strict allowlist (resolver returns null for anything else) keeps that path
// from writing arbitrary credential env vars.
const PROVIDER_ENV_KEYS: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GEMINI_API_KEY",
};

export function resolveProviderEnvKey(provider: string): string | null {
  return PROVIDER_ENV_KEYS[String(provider).trim().toLowerCase()] ?? null;
}
