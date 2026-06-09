import { getCached, setCache } from "./cache";
import { readEnv, setEnvValue } from "./env-store";
import { getConfigValue } from "./yaml-config";
import { readDesktopConfig } from "./desktop-store";
import { appendConfigFixLog } from "./fix-log";

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
