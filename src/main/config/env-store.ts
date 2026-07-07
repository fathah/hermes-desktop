import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { escapeRegex, profilePaths, safeWriteFile } from "../utils";
import { getCached, setCache, invalidateCache } from "./cache";
import {
  canDecryptSecret,
  decryptSecret,
  encryptSecret,
  isSecretEncryptionAvailable,
} from "./secrets";
import { formatLogError, log } from "../log";

const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ENV_SECRET_SIDECAR = ".env.secrets.json";

const SENSITIVE_ENV_KEYS = new Set([
  "API_SERVER_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_API_KEY",
  "GEMINI_API_KEY",
  "DEEPSEEK_API_KEY",
  "GROQ_API_KEY",
  "OPENROUTER_API_KEY",
  "TOGETHER_API_KEY",
  "FIREWORKS_API_KEY",
  "CEREBRAS_API_KEY",
  "MISTRAL_API_KEY",
  "PERPLEXITY_API_KEY",
  "XAI_API_KEY",
  "QWEN_API_KEY",
  "MINIMAX_API_KEY",
  "GLM_API_KEY",
  "HF_TOKEN",
  "HUGGINGFACE_API_KEY",
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
  "HASS_TOKEN",
]);

function isSensitiveEnvKey(key: string): boolean {
  if (SENSITIVE_ENV_KEYS.has(key)) return true;
  return /(^|_)(API_KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD|ACCESS_KEY|PRIVATE_KEY)$/i.test(
    key,
  );
}

function secretStoreErrorSummary(
  err: unknown,
): Record<string, unknown> | string {
  if (!err || typeof err !== "object") return typeof err;
  const detail = err as {
    code?: unknown;
    killed?: unknown;
    signal?: unknown;
    status?: unknown;
  };
  const summary: Record<string, unknown> = {};
  for (const field of ["status", "signal", "code", "killed"] as const) {
    const value = detail[field];
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null
    ) {
      summary[field] = value;
    }
  }
  return Object.keys(summary).length ? summary : "redacted";
}

interface EnvSecretSidecar {
  version: 1;
  secrets: Record<string, string>;
}

function emptySecretSidecar(): EnvSecretSidecar {
  return { version: 1, secrets: {} };
}

function envSecretFile(profile?: string): string {
  return join(profilePaths(profile).home, ENV_SECRET_SIDECAR);
}

function readEnvSecretSidecar(
  profile?: string,
  strict = false,
): EnvSecretSidecar {
  const secretFile = envSecretFile(profile);
  if (!existsSync(secretFile)) return emptySecretSidecar();

  try {
    const parsed = JSON.parse(readFileSync(secretFile, "utf-8")) as {
      secrets?: unknown;
    };
    const rawSecrets =
      parsed && typeof parsed.secrets === "object" && parsed.secrets !== null
        ? parsed.secrets
        : {};
    const secrets: Record<string, string> = {};
    for (const [key, value] of Object.entries(rawSecrets)) {
      if (typeof value === "string") secrets[key] = value;
    }
    return { version: 1, secrets };
  } catch (err) {
    if (strict) {
      throw err;
    }
    log.error("secret-store", {
      msg: "failed to read encrypted environment secret sidecar",
      profile,
      error: secretStoreErrorSummary(err),
    });
    return emptySecretSidecar();
  }
}

function readEnvSecret(key: string, profile?: string): string {
  const payload = readEnvSecretSidecar(profile).secrets[key];
  if (!payload) return "";
  if (!isSecretEncryptionAvailable() || !canDecryptSecret(payload)) {
    log.error("secret-store", {
      msg: "failed to decrypt encrypted environment secret sidecar entry",
      key,
      profile,
      error: "redacted",
    });
    return "";
  }
  return decryptSecret(payload);
}

function encryptEnvSecret(key: string, value: string): string {
  if (!isSecretEncryptionAvailable()) {
    throw new Error("Secret encryption is unavailable.");
  }

  const payload = encryptSecret(value);
  if (!payload || payload === value || !canDecryptSecret(payload)) {
    throw new Error(`Encrypted payload for ${key} could not be verified.`);
  }
  return payload;
}

function writeEnvSecret(key: string, value: string, profile?: string): void {
  const sidecar = readEnvSecretSidecar(profile, true);
  if (value.trim()) {
    sidecar.secrets[key] = encryptEnvSecret(key, value);
  } else {
    delete sidecar.secrets[key];
  }
  safeWriteFile(
    envSecretFile(profile),
    JSON.stringify(sidecar, null, 2) + "\n",
  );
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

    if (value === "__keychain__") {
      try {
        value = readEnvSecret(key, profile);
      } catch (err) {
        log.error("secret-store", {
          msg: "failed to retrieve encrypted environment secret sidecar entry",
          key,
          profile,
          error: secretStoreErrorSummary(err),
        });
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
  if (isSensitiveEnvKey(key)) {
    try {
      writeEnvSecret(key, value, profile);
      finalValue = value.trim() ? "__keychain__" : "";
    } catch (err) {
      log.error("secret-store", {
        msg: "failed to store encrypted environment secret sidecar entry",
        key,
        profile,
        error: secretStoreErrorSummary(err),
      });
      throw new Error(
        `Failed to store sensitive environment variable ${key} in encrypted desktop storage; refusing to write plaintext.`,
      );
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
    log.error("keychain", {
      msg: "failed to read env file to resolve keychain keys",
      path: envFile,
      error: formatLogError(err),
    });
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
  vertex: "GOOGLE_APPLICATION_CREDENTIALS",
};

export function resolveProviderEnvKey(provider: string): string | null {
  return PROVIDER_ENV_KEYS[String(provider).trim().toLowerCase()] ?? null;
}
