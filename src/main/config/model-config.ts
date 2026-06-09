import { readFileSync, existsSync } from "fs";
import { profilePaths, safeWriteFile } from "../utils";
import { getYamlValue, setYamlValue, deleteYamlValue } from "../yaml-utils";
import { canonicalProviderBaseUrl } from "../provider-registry";
import {
  expectedEnvKeyForUrl,
  OPENAI_COMPAT_PROVIDERS,
} from "../../shared/url-key-map";
import { expectedEnvKeyForModel } from "../installer";
import { getCached, setCache, invalidateCache } from "./cache";
import { readEnv } from "./env-store";

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
 * here to keep config free of a models.ts import — the generic chain covers
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
