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
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { readEnv, getModelContextLengthOverride } from "./config";
import { profileHome } from "./utils";
import {
  expectedEnvKeyForModel,
  HERMES_PYTHON,
  HERMES_REPO,
  HERMES_HOME,
  getEnhancedPath,
} from "./installer";
// PROVIDER_BASE_URLS lives in its own module so `config.ts` can use the
// same lookup without pulling in this whole file (and triggering a
// circular import via `model-discovery → config → ...`).
import { PROVIDER_BASE_URLS } from "./provider-registry";

/** Providers whose `/models` we never call — either they don't expose it,
 *  use a different protocol, or rely on OAuth credentials we can't
 *  reproduce from a static env var. The OAuth providers below are handled
 *  separately via `discoverOAuthModels`, so they're not listed here. */
const NON_DISCOVERABLE_PROVIDERS = new Set<string>([
  "auto",
  "custom",
  "google",
  "xai",
  "qwen",
  "minimax",
  "kimi-coding",
]);

/** OAuth/subscription providers — no static-key `/v1/models` endpoint.
 *  Their model lists come from hermes-agent's `provider_model_ids`
 *  (live + account-aware for Codex), reached via a short Python call.
 *  `nous` is included here since the desktop now exposes its OAuth
 *  sign-in surface (issue #367). */
const OAUTH_DISCOVERY_PROVIDERS = new Set<string>([
  "openai-codex",
  "xai-oauth",
  "qwen-oauth",
  "google-gemini-cli",
  "minimax-oauth",
  "nous",
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

/**
 * Fetch the Nous Portal `/v1/models` catalogue with the OAuth token
 * stored in `auth.json`, and return the IDs of models whose prompt +
 * completion pricing are both zero — i.e. the free tier. Issue #367
 * found that a free-subscription user picking the default Nous model
 * (Hermes-4-405B) gets a billing error. Surfacing free models in the
 * autocomplete makes the right choice discoverable.
 *
 * Returns [] on any failure (no token, no inference_base_url, HTTP
 * error, parse error). Best-effort enrichment — never blocks the
 * main discovery call.
 */
async function fetchNousFreeModelIds(
  profile: string | undefined,
): Promise<string[]> {
  try {
    const authPath = join(profileHome(profile), "auth.json");
    if (!existsSync(authPath)) return [];
    const auth = JSON.parse(readFileSync(authPath, "utf-8")) as {
      providers?: {
        nous?: { access_token?: string; inference_base_url?: string };
      };
    };
    const token = (auth.providers?.nous?.access_token || "").trim();
    const base = (auth.providers?.nous?.inference_base_url || "").trim();
    if (!token || !base) return [];

    const url = `${base.replace(/\/+$/, "")}/models`;
    return await new Promise<string[]>((resolve) => {
      const u = new URL(url);
      const mod = u.protocol === "https:" ? https : http;
      const req = mod.request(
        {
          method: "GET",
          protocol: u.protocol,
          hostname: u.hostname,
          port: u.port || undefined,
          path: `${u.pathname}${u.search}`,
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${token}`,
          },
          timeout: 10_000,
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
          res.on("end", () => {
            try {
              const j = JSON.parse(body) as {
                data?: Array<{
                  id?: string;
                  pricing?: { prompt?: string; completion?: string };
                }>;
              };
              const free = (j.data || [])
                .filter((m) => {
                  // Free iff both prompt and completion cost zero. The
                  // Portal returns them as strings like "0.0000000000".
                  const pr = String(m.pricing?.prompt ?? "").trim();
                  const co = String(m.pricing?.completion ?? "").trim();
                  return (
                    pr !== "" &&
                    co !== "" &&
                    parseFloat(pr) === 0 &&
                    parseFloat(co) === 0
                  );
                })
                .map((m) => String(m.id || "").trim())
                .filter(Boolean);
              resolve(uniqueSorted(free));
            } catch {
              resolve([]);
            }
          });
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
  } catch {
    return [];
  }
}

// In-memory result cache to avoid hammering the provider on every keystroke.
interface CacheEntry {
  models: string[];
  ts: number;
}
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const _cache = new Map<string, CacheEntry>();
// Parallel cache of free-model ids, keyed by provider. Cleared together
// with the main cache via `_clearCache` for test isolation.
const _freeCache = new Map<string, string[]>();
// Parallel cache of per-model context-window sizes (tokens), keyed the same
// way as `_cache` (provider|baseUrl) and populated from the `/models`
// response when the provider advertises a `context_length` (OpenRouter and
// many OpenAI-compatible gateways do). Drives authoritative context-gauge
// sizing in the renderer; the static heuristic is only a fallback. Issue #597.
const _ctxCache = new Map<string, Record<string, number>>();

const LOCAL_NO_KEY_PROVIDERS = new Set([
  "lmstudio",
  "atomicchat",
  "ollama",
  "vllm",
  "llamacpp",
]);

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

interface RawModelMeta {
  id?: string;
  context_length?: number | string;
  context_window?: number | string;
  max_context_length?: number | string;
  max_context_window_tokens?: number | string;
  top_provider?: { context_length?: number | string };
}

function toPositiveInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === "string") {
    const n = parseInt(value.trim(), 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

/** Pull a context-window size out of a single `/models` entry, trying the
 *  field names different providers use (OpenRouter exposes both a top-level
 *  `context_length` and a nested `top_provider.context_length`). */
function extractContextLength(item: RawModelMeta): number | null {
  return (
    toPositiveInt(item.context_length) ??
    toPositiveInt(item.context_window) ??
    toPositiveInt(item.max_context_length) ??
    toPositiveInt(item.max_context_window_tokens) ??
    toPositiveInt(item.top_provider?.context_length)
  );
}

/** Map of model id -> advertised context-window size from a `/models`
 *  response body. Empty when the body is unparseable or carries no context
 *  metadata (e.g. OpenAI / DeepSeek, which omit it). */
function parseModelContextLengths(body: string): Record<string, number> {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return {};
  }
  if (!json || typeof json !== "object") return {};
  const j = json as { data?: RawModelMeta[]; models?: RawModelMeta[] };
  const arr = Array.isArray(j.data)
    ? j.data
    : Array.isArray(j.models)
      ? j.models
      : null;
  if (!arr) return {};
  const out: Record<string, number> = {};
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const id = typeof item.id === "string" ? item.id.trim() : "";
    if (!id) continue;
    const ctx = extractContextLength(item);
    if (ctx) out[id] = ctx;
  }
  return out;
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

interface FetchModelsResult {
  models: string[];
  reachable: boolean;
  /** Per-model context-window sizes parsed from the response, when present. */
  contextLengths?: Record<string, number>;
}

function authHeaders(provider: string, apiKey: string): Record<string, string> {
  if (!apiKey) return {};
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

function isLoopbackBaseUrl(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

function fetchModelsHttp(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<FetchModelsResult> {
  return new Promise((resolve) => {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      resolve({ models: [], reachable: false });
      return;
    }
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
          resolve({ models: [], reachable: true });
          return;
        }
        let body = "";
        res.setEncoding("utf-8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () =>
          resolve({
            models: parseModelIds(body),
            reachable: true,
            contextLengths: parseModelContextLengths(body),
          }),
        );
        res.on("error", () => resolve({ models: [], reachable: false }));
      },
    );
    req.on("error", () => resolve({ models: [], reachable: false }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ models: [], reachable: false });
    });
    req.end();
  });
}

export interface DiscoverModelsResult {
  models: string[];
  /** ``"ok"`` when the call succeeded (even if zero models came back).
   *  ``"no-key"`` when the caller didn't pass one and we couldn't find a
   *  matching ``<NAME>_API_KEY``.  ``"error"`` when the provider could not
   *  be reached.  ``"unsupported"`` for providers we know don't expose this
   *  endpoint.  ``"unknown-host"`` when neither caller nor mapping table can
   *  resolve a base URL. */
  status: "ok" | "no-key" | "error" | "unsupported" | "unknown-host";
  /** ``true`` when the result came from the in-memory cache. */
  cached: boolean;
  /** Subset of `models` flagged as free (no cost per token). Populated
   *  for providers whose catalog exposes pricing — Nous Portal today,
   *  others as we add them. Empty when no pricing info is available
   *  (everything is treated as paid by default in the UI). */
  freeModels?: string[];
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
    if (hit) {
      // Re-attach free flags from cache. Pricing is fetched fresh on
      // the next non-cache hit; meanwhile the renderer keeps the
      // previous free list.
      return {
        models: hit,
        status: "ok",
        cached: true,
        freeModels: _freeCache.get(lowerProvider) || [],
      };
    }
    const models = await discoverOAuthModels(lowerProvider);
    setCache(lowerProvider, "", models);
    // Nous Portal exposes pricing in its catalog — enrich with the
    // subset of models that are free, so the renderer can badge them.
    // Other OAuth providers have no equivalent yet.
    let freeModels: string[] = [];
    if (lowerProvider === "nous") {
      const allFree = await fetchNousFreeModelIds(profile);
      // Keep only the free IDs that are actually in the curated list
      // we're surfacing — avoids confusing the user with names that
      // wouldn't autocomplete anyway. If hermes-agent's list misses
      // some free ones, fall back to the full live list.
      const inCurated = allFree.filter((id) => models.includes(id));
      freeModels = inCurated.length > 0 ? inCurated : allFree;
      _freeCache.set(lowerProvider, freeModels);
    }
    return { models, status: "ok", cached: false, freeModels };
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
  const canDiscoverWithoutKey =
    LOCAL_NO_KEY_PROVIDERS.has(lowerProvider) ||
    (lowerProvider === "custom" && isLoopbackBaseUrl(baseUrl));
  if (!apiKey && !canDiscoverWithoutKey) {
    return { models: [], status: "no-key", cached: false };
  }

  const result = await fetchAndCacheModels(lowerProvider, baseUrl, apiKey);
  if (!result.reachable) {
    return { models: [], status: "error", cached: false };
  }
  return { models: result.models, status: "ok", cached: false };
}

/**
 * Fetch a provider's `/models` over HTTP and populate BOTH caches together.
 *
 * `_ctxCache` is always written when the endpoint is reachable — even when no
 * model advertises a `context_length` (OpenAI, DeepSeek) — so an empty map
 * doubles as a "already fetched, none advertised" marker. That lets
 * `getModelContextWindow` tell a genuine miss (don't re-fetch) from a
 * never-fetched key, which is what was broken when the model picker had
 * already populated `_cache` but not `_ctxCache` (issue #597 PR review).
 */
async function fetchAndCacheModels(
  lowerProvider: string,
  baseUrl: string,
  apiKey: string,
): Promise<FetchModelsResult> {
  const url = buildUrl(baseUrl);
  const headers = authHeaders(lowerProvider, apiKey);
  const result = await fetchModelsHttp(url, headers, 10_000);
  if (result.reachable) {
    setCache(lowerProvider, baseUrl, result.models);
    _ctxCache.set(
      cacheKey(lowerProvider, baseUrl),
      result.contextLengths ?? {},
    );
  }
  return result;
}

/**
 * Resolve the authoritative context-window size (in tokens) for a model by
 * consulting the provider's `/models` catalogue. Returns null when the
 * provider doesn't advertise it (OpenAI, DeepSeek, OAuth providers) or the
 * model id isn't found, in which case the renderer falls back to the static
 * heuristic in `contextWindows.ts`. Issue #597.
 */
// @lat: [[model-context#Model context window#Gauge resolution order]]
export async function getModelContextWindow(
  provider: string,
  model: string,
  baseUrlOverride: string | undefined,
  apiKeyOverride: string | undefined,
  profile: string | undefined,
): Promise<number | null> {
  const modelId = (model || "").trim();
  if (!modelId) return null;
  const lowerProvider = (provider || "").trim().toLowerCase();

  // A manual `model.context_length` override in config.yaml wins over /models
  // detection — it's what the user set explicitly and what the agent's
  // auto-compaction threshold uses. Apply it ONLY when it targets the model
  // being asked about (an exact match against the active `model.default`), so a
  // stale value can't leak onto a different model id — including the case where
  // `model.default` is absent (override.model === ""), which must NOT match.
  // This is the primary fix for providers (qwen, etc.) that don't advertise
  // `context_length`, leaving the gauge on its heuristic.
  const override = getModelContextLengthOverride(profile);
  if (override && override.model && override.model === modelId) {
    return override.contextLength;
  }

  // OAuth/subscription and non-discoverable providers have no static-key
  // `/models` endpoint to read `context_length` from — the renderer falls
  // back to the heuristic for these. ("custom" is discoverable.)
  if (
    OAUTH_DISCOVERY_PROVIDERS.has(lowerProvider) ||
    (NON_DISCOVERABLE_PROVIDERS.has(lowerProvider) &&
      lowerProvider !== "custom")
  ) {
    return null;
  }

  const explicitBase = (baseUrlOverride || "").trim().replace(/\/+$/, "");
  const baseUrl = explicitBase || canonicalBaseUrl(lowerProvider) || "";
  if (!baseUrl) return null;
  const key = cacheKey(lowerProvider, baseUrl);

  const readCtx = (): number | null => _ctxCache.get(key)?.[modelId] ?? null;

  const cached = readCtx();
  if (cached) return cached;
  // A present (even empty) ctx map means we've already fetched this
  // catalogue, so a missing entry is authoritative — don't re-fetch. This
  // also avoids hammering the endpoint for providers that omit the field.
  if (_ctxCache.has(key)) return null;

  // Not fetched yet (e.g. the model picker primed `_cache` but never the ctx
  // map). Fetch directly here rather than via `discoverProviderModels`, whose
  // `_cache`-hit early-return would skip the ctx fetch entirely.
  const apiKey =
    (apiKeyOverride || "").trim() ||
    envApiKeyFor(lowerProvider, baseUrl, profile);
  const canDiscoverWithoutKey =
    LOCAL_NO_KEY_PROVIDERS.has(lowerProvider) ||
    (lowerProvider === "custom" && isLoopbackBaseUrl(baseUrl));
  if (!apiKey && !canDiscoverWithoutKey) return null;

  await fetchAndCacheModels(lowerProvider, baseUrl, apiKey);
  return readCtx();
}

/** Internal: exposed for tests / debugging only.  Production callers
 *  should always go through ``discoverProviderModels``. */
export function _clearCache(): void {
  _cache.clear();
  _freeCache.clear();
  _ctxCache.clear();
}
