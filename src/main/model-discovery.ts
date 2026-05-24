/**
 * Provider model discovery.
 *
 * Hits the provider's OpenAI-compatible `/models` endpoint and returns the
 * list of model ids it advertises.  Used to power autocomplete in the
 * Providers UI Model field and the Models page Add/Edit dialog so users
 * don't have to type the exact id from memory.
 *
 * Upstream `hermes-agent` has an equivalent helper at
 * ``hermes_cli/models.py::fetch_api_models`` used by the TUI's /model
 * picker; this mirrors that flow on the desktop side without going
 * through the Python CLI.
 */
import http from "http";
import https from "https";
import { URL } from "url";
import { execFile } from "child_process";
import { readEnv } from "./config";
import {
  expectedEnvKeyForModel,
  HERMES_PYTHON,
  HERMES_REPO,
  HERMES_HOME,
  getEnhancedPath,
} from "./installer";

/** Canonical inference base URL for each named provider, mirroring
 *  hermes-agent's PROVIDER_REGISTRY defaults.  Only the providers whose
 *  `/models` endpoint we know responds usefully are listed; everything
 *  else falls through to caller-supplied baseUrl or no discovery. */
const PROVIDER_BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  deepseek: "https://api.deepseek.com/v1",
  groq: "https://api.groq.com/openai/v1",
  mistral: "https://api.mistral.ai/v1",
  together: "https://api.together.xyz/v1",
  fireworks: "https://api.fireworks.ai/inference/v1",
  cerebras: "https://api.cerebras.ai/v1",
  perplexity: "https://api.perplexity.ai",
  huggingface: "https://router.huggingface.co/v1",
  zai: "https://api.z.ai/api/paas/v4",
  anthropic: "https://api.anthropic.com/v1",
};

/** Providers whose `/models` we never call — either they don't expose it,
 *  use a different protocol, or rely on OAuth credentials we can't
 *  reproduce from a static env var. The OAuth providers below are handled
 *  separately via `discoverOAuthModels`, so they're not listed here. */
const NON_DISCOVERABLE_PROVIDERS = new Set<string>([
  "auto",
  "custom",
  "nous",
  "google",
  "xai",
  "qwen",
  "minimax",
  "kimi-coding",
]);

/** OAuth/subscription providers — no static-key `/v1/models` endpoint.
 *  Their model lists come from hermes-agent's `provider_model_ids`
 *  (live + account-aware for Codex), reached via a short Python call. */
const OAUTH_DISCOVERY_PROVIDERS = new Set<string>([
  "openai-codex",
  "xai-oauth",
  "qwen-oauth",
  "google-gemini-cli",
  "minimax-oauth",
]);

/** Curated fallback model lists, mirrored from hermes-agent's
 *  `hermes_cli/models.py` (`_PROVIDER_MODELS`) and `codex_models.py`
 *  (`DEFAULT_CODEX_MODELS`). Used only when the Python call below is
 *  unavailable (agent not installed, import error, timeout). The live
 *  call is always preferred — these will drift as new models ship. */
const OAUTH_PROVIDER_CURATED: Record<string, string[]> = {
  "openai-codex": [
    "gpt-5.5",
    "gpt-5.4",
    "gpt-5.4-mini",
    "gpt-5.3-codex",
    "gpt-5.3-codex-spark",
    "gpt-5.2-codex",
    "gpt-5.1-codex-max",
    "gpt-5.1-codex-mini",
  ],
  "xai-oauth": [
    "grok-4.3",
    "grok-4.20-0309-reasoning",
    "grok-4.20-0309-non-reasoning",
    "grok-4.20-multi-agent-0309",
  ],
  "google-gemini-cli": [
    "gemini-3.1-pro-preview",
    "gemini-3-pro-preview",
    "gemini-3-flash-preview",
  ],
  "minimax-oauth": ["MiniMax-M2.7", "MiniMax-M2.7-highspeed"],
  "qwen-oauth": [],
};

// One-liner that prints hermes-agent's model list for a provider as a
// JSON array. `provider_model_ids` does the heavy lifting — curated
// lists for most, plus a live account-aware query for openai-codex.
const PROVIDER_MODELS_SNIPPET =
  "import json,sys; from hermes_cli.models import provider_model_ids; " +
  "print(json.dumps(list(provider_model_ids(sys.argv[1]))))";

/** Ask hermes-agent's `provider_model_ids` for a provider's models by
 *  running a short Python snippet against the bundled venv. Returns the
 *  parsed list, or null on any failure (so the caller can fall back). */
function runProviderModelIdsPython(provider: string): Promise<string[] | null> {
  return new Promise((resolve) => {
    execFile(
      HERMES_PYTHON,
      ["-c", PROVIDER_MODELS_SNIPPET, provider],
      {
        cwd: HERMES_REPO,
        env: { ...process.env, PATH: getEnhancedPath(), HERMES_HOME },
        timeout: 20_000,
        windowsHide: true,
      },
      (err, stdout) => {
        if (err) {
          resolve(null);
          return;
        }
        try {
          const parsed: unknown = JSON.parse(String(stdout).trim());
          if (Array.isArray(parsed)) {
            resolve(parsed.filter((x): x is string => typeof x === "string"));
            return;
          }
        } catch {
          /* unparseable — fall through */
        }
        resolve(null);
      },
    );
  });
}

/** Resolve an OAuth provider's models: hermes-agent's live list first,
 *  curated fallback when that's unavailable. */
async function discoverOAuthModels(provider: string): Promise<string[]> {
  const live = await runProviderModelIdsPython(provider);
  if (live && live.length > 0) return uniqueSorted(live);
  return OAUTH_PROVIDER_CURATED[provider] ?? [];
}

// In-memory result cache to avoid hammering the provider on every keystroke.
interface CacheEntry {
  models: string[];
  ts: number;
}
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const _cache = new Map<string, CacheEntry>();

function cacheKey(provider: string, baseUrl: string): string {
  return `${provider.toLowerCase()}|${baseUrl.replace(/\/+$/, "").toLowerCase()}`;
}

function fromCache(provider: string, baseUrl: string): string[] | null {
  const key = cacheKey(provider, baseUrl);
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    _cache.delete(key);
    return null;
  }
  return entry.models;
}

function setCache(provider: string, baseUrl: string, models: string[]): void {
  _cache.set(cacheKey(provider, baseUrl), { models, ts: Date.now() });
}

/** Resolve the canonical base URL for a provider name, or null if we
 *  don't have a mapping (caller must supply baseUrl explicitly). */
function canonicalBaseUrl(provider: string): string | null {
  const direct = PROVIDER_BASE_URLS[provider.toLowerCase()];
  return direct || null;
}

/** Resolve the API key from the user's .env for a given provider. */
function envApiKeyFor(
  provider: string,
  baseUrl: string,
  profile: string | undefined,
): string {
  const envKey = expectedEnvKeyForModel(provider, baseUrl);
  if (!envKey) return "";
  const env = readEnv(profile);
  return (env[envKey] || "").trim().replace(/^["']|["']$/g, "");
}

interface DiscoveryRawResponse {
  data?: Array<{ id?: string }>;
  models?: Array<{ id?: string; name?: string }>;
}

function parseModelIds(body: string): string[] {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return [];
  }
  if (!json || typeof json !== "object") return [];
  const j = json as DiscoveryRawResponse;
  // OpenAI shape: { data: [{ id: "..." }, ...] }
  if (Array.isArray(j.data)) {
    return uniqueSorted(
      j.data
        .map((item) =>
          item && typeof item.id === "string" ? item.id.trim() : "",
        )
        .filter(Boolean),
    );
  }
  // Anthropic-style alternative: { models: [{ id, name }, ...] } — defensive.
  if (Array.isArray(j.models)) {
    return uniqueSorted(
      j.models
        .map((item) =>
          item && typeof item.id === "string" ? item.id.trim() : "",
        )
        .filter(Boolean),
    );
  }
  return [];
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}

function buildUrl(base: string): string {
  const trimmed = base.replace(/\/+$/, "");
  return `${trimmed}/models`;
}

function authHeaders(provider: string, apiKey: string): Record<string, string> {
  const lower = provider.toLowerCase();
  if (lower === "anthropic") {
    // Anthropic uses x-api-key + an API version header on /v1/models.
    return {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    };
  }
  return { Authorization: `Bearer ${apiKey}` };
}

function fetchModelsHttp(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<string[]> {
  return new Promise((resolve) => {
    const u = new URL(url);
    const mod = u.protocol === "https:" ? https : http;
    const req = mod.request(
      {
        method: "GET",
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || undefined,
        path: `${u.pathname}${u.search}`,
        headers: { Accept: "application/json", ...headers },
        timeout: timeoutMs,
      },
      (res) => {
        if (!res.statusCode || res.statusCode >= 400) {
          res.resume();
          resolve([]);
          return;
        }
        let body = "";
        res.setEncoding("utf-8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => resolve(parseModelIds(body)));
        res.on("error", () => resolve([]));
      },
    );
    req.on("error", () => resolve([]));
    req.on("timeout", () => {
      req.destroy();
      resolve([]);
    });
    req.end();
  });
}

export interface DiscoverModelsResult {
  models: string[];
  /** ``"ok"`` when the call succeeded (even if zero models came back).
   *  ``"no-key"`` when the caller didn't pass one and we couldn't find a
   *  matching ``<NAME>_API_KEY``.  ``"unsupported"`` for providers we know
   *  don't expose this endpoint.  ``"unknown-host"`` when neither caller
   *  nor mapping table can resolve a base URL. */
  status: "ok" | "no-key" | "unsupported" | "unknown-host";
  /** ``true`` when the result came from the in-memory cache. */
  cached: boolean;
}

/** Discover available models for a provider.  Returns an object so the
 *  UI can distinguish "no key set yet" from "no models advertised". */
export async function discoverProviderModels(
  provider: string,
  baseUrlOverride: string | undefined,
  apiKeyOverride: string | undefined,
  profile: string | undefined,
): Promise<DiscoverModelsResult> {
  const lowerProvider = (provider || "").trim().toLowerCase();

  // OAuth/subscription providers don't have a static-key /v1/models
  // endpoint — route them through hermes-agent's provider_model_ids.
  if (OAUTH_DISCOVERY_PROVIDERS.has(lowerProvider)) {
    const hit = fromCache(lowerProvider, "");
    if (hit) return { models: hit, status: "ok", cached: true };
    const models = await discoverOAuthModels(lowerProvider);
    setCache(lowerProvider, "", models);
    return { models, status: "ok", cached: false };
  }

  if (!lowerProvider || NON_DISCOVERABLE_PROVIDERS.has(lowerProvider)) {
    // For "custom", caller must pass baseUrl explicitly — fall through
    // and the canonicalBaseUrl() check below will redirect to that path.
    if (lowerProvider !== "custom") {
      return { models: [], status: "unsupported", cached: false };
    }
  }

  const explicitBase = (baseUrlOverride || "").trim().replace(/\/+$/, "");
  const baseUrl = explicitBase || canonicalBaseUrl(lowerProvider) || "";
  if (!baseUrl) return { models: [], status: "unknown-host", cached: false };

  const cached = fromCache(lowerProvider, baseUrl);
  if (cached) return { models: cached, status: "ok", cached: true };

  const apiKey =
    (apiKeyOverride || "").trim() ||
    envApiKeyFor(lowerProvider, baseUrl, profile);
  if (!apiKey) return { models: [], status: "no-key", cached: false };

  const url = buildUrl(baseUrl);
  const headers = authHeaders(lowerProvider, apiKey);
  const models = await fetchModelsHttp(url, headers, 10_000);
  setCache(lowerProvider, baseUrl, models);
  return { models, status: "ok", cached: false };
}

/** Internal: exposed for tests / debugging only.  Production callers
 *  should always go through ``discoverProviderModels``. */
export function _clearCache(): void {
  _cache.clear();
}
