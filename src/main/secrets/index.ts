import type { SecretsProvider } from "./provider";
import { EnvSecretsProvider } from "./envProvider";
import { CommandSecretsProvider } from "./commandProvider";
import { getConfigValue } from "../config";

export type { SecretsProvider } from "./provider";

// Providers are constructed LAZILY (first use), never at module-init. Reason:
// ./secrets sits in an import cycle (config -> secrets -> commandProvider ->
// config). When a consumer of config.ts triggers that cycle, evaluating
// `new CommandSecretsProvider()` at THIS module's top level can run while
// commandProvider.ts is still mid-initialization → "CommandSecretsProvider is
// not a constructor". Deferring construction to call time (by which point all
// modules in the cycle are fully initialized) breaks the init-order hazard
// without forcing every consumer to lazy-import the secrets barrel.
let _envProvider: EnvSecretsProvider | undefined;
let _commandProvider: CommandSecretsProvider | undefined;
function envProviderInstance(): EnvSecretsProvider {
  return (_envProvider ??= new EnvSecretsProvider());
}
function commandProviderInstance(): CommandSecretsProvider {
  return (_commandProvider ??= new CommandSecretsProvider());
}

/** Unknown `secrets.provider` ids already warned about — one log line per id. */
const warnedUnknownProviderIds = new Set<string>();

/**
 * Select the configured secrets provider for a profile. Reads
 * `secrets.provider` from config.yaml; anything other than "command" (including
 * unset) falls back to the default `env` provider — so a zero-config install is
 * unchanged. An unrecognized NON-EMPTY id still falls back to `env`, but warns
 * once so a typo (e.g. "comand") doesn't silently mask a vault-backed setup.
 */
export function getSecretsProvider(profile?: string): SecretsProvider {
  const id = (getConfigValue("secrets.provider", profile) || "").trim();
  if (id === "command") return commandProviderInstance();
  if (id && id !== "env" && !warnedUnknownProviderIds.has(id)) {
    warnedUnknownProviderIds.add(id);
    console.warn(
      `[secrets] unknown secrets.provider "${id}"; falling back to env`,
    );
  }
  return envProviderInstance();
}

/**
 * Resolve a single secret by its env-var name, applying the resolution order:
 *   1. process.env[key]     — runtime-injected secrets (e.g. a vault that
 *      unseals into the process environment) take precedence.
 *   2. configured provider  — env (.env file) or command (a helper).
 *   3. null.
 *
 * Never throws. This is the entry point secret consumers should call instead of
 * reaching into `readEnv()` directly when they want the FULLY-resolved value.
 */
export function getSecret(key: string, profile?: string): string | null {
  const fromEnv = process.env[key];
  if (fromEnv != null && fromEnv !== "") return fromEnv;
  // Route command-provider single-key resolution through the get-path spawn
  // floor (S1, get() side) so a per-key caller loop cannot spawn the helper
  // unbounded on the Electron main process. Env provider is a pass-through.
  return getSecretSafe(key, profile);
}

/**
 * SECURITY (S1, get() side): a per-(profile,key) hard spawn floor for the
 * command provider's single-key get(), mirroring the one `providerListSafe()`
 * gives list(). `getSecret()` is the resolution entry point the consumer-wiring
 * layer calls PER KEY at gateway-spawn time; without a floor, a caller resolving
 * many keys (or a buggy/compromised one looping a single key) would spawn the
 * helper once PER call — each a SYNCHRONOUS `/bin/sh -c` of up to 3s on the
 * Electron main process — wedging the UI. providerListSafe already closes this
 * for the enumeration path; this closes it for the single-key path the wiring
 * PR introduces.
 *
 * DELIBERATELY NOT A VALUE CACHE. Unlike list(), this records only the last
 * spawn TIMESTAMP per key, never the resolved secret. Caching plaintext secret
 * values in a long-lived main-process map would be a new at-rest exposure
 * surface that the provider design explicitly avoids ("resolved values are
 * never logged or written to disk"). So inside the floor window we DEGRADE to
 * null rather than spawn OR replay a cached value.
 *
 * TRADEOFF (degrade-not-stale): because there is no retained value, a second
 * get() for the same key inside MIN_SPAWN_INTERVAL_MS returns null instead of
 * the real secret. This is acceptable and intentional: the wiring PR resolves
 * each key at most once per gateway spawn, so the floor only bites under an
 * abnormal/hostile tight loop — exactly the case where degrading beats wedging.
 * A legitimate caller that needs the value simply calls outside the ~1s window.
 * (list() can serve stale data because it already holds the map; get() cannot
 * without retaining secrets, so it chooses null over a new exposure surface.)
 */
const getSpawnFloor = new Map<string, number>();

function getSecretSafe(key: string, profile?: string): string | null {
  try {
    const provider = getSecretsProvider(profile);
    // Env provider reads the .env file (already cached in config.ts) — no spawn,
    // no floor needed. Pass straight through so the default backend is unchanged.
    if (provider.id !== "command") return provider.get(key, profile);

    const floorKey = `${profile || "default"}\u0000${key}`;
    const now = Date.now();
    const last = getSpawnFloor.get(floorKey);
    if (last != null && now - last < MIN_SPAWN_INTERVAL_MS) {
      // Inside the floor: refuse the spawn and degrade. No cached value to serve.
      return null;
    }
    getSpawnFloor.set(floorKey, now);
    return provider.get(key, profile);
  } catch {
    // Honor getSecret()'s "Never throws" contract. getSecretsProvider() ->
    // getConfigValue() can throw on a malformed config.yaml or a first-read I/O
    // error; providerListSafe() guards the same path with a top-level catch.
    // Without this, an uncaught throw here would abort a per-key gateway-spawn
    // loop instead of gracefully degrading that key to null.
    return null;
  }
}

/**
 * The fully-resolved secret map: the configured provider's enumerable secrets
 * with the current process environment overlaid (process.env wins, mirroring
 * `getSecret`'s precedence). Use when a caller needs the whole set rather than
 * one key. Callers that specifically want the on-disk `.env` file view should
 * keep using `readEnv()`.
 */
export function resolvedSecrets(profile?: string): Record<string, string> {
  // Route through providerListSafe (NOT provider.list() directly) so this
  // path is covered by the S1 spawn-rate floor: a caller polling
  // resolvedSecrets() must not be able to re-spawn the command helper on
  // every call, bypassing the TTL cache + 1s hard floor that protect the
  // Electron main process. providerListSafe is a no-op wrapper for the env
  // provider, so this is free for the default backend.
  const base = providerListSafe(profile);
  const merged: Record<string, string> = { ...base };
  for (const [k, v] of Object.entries(process.env)) {
    if (v != null && v !== "") merged[k] = v;
  }
  return merged;
}

/**
 * SECURITY (S1): TTL cache for the command provider's list() output. The
 * renderer can trigger list() indirectly (config-health rerun, API-key status
 * polls, "Refresh from vault") and `invalidate-secrets-cache` is a
 * renderer-callable IPC with no throttle — without a floor here, a
 * compromised or buggy renderer could spam helper executions, each a
 * SYNCHRONOUS spawn of up to 3s on the Electron main process (UI wedge).
 * The cache bounds helper spawns to at most one per TTL window per profile
 * regardless of renderer behavior. Explicit invalidation (vault rotation)
 * clears it via invalidateProviderListCache(), so a "Refresh from vault"
 * still takes effect immediately — it just can't run the helper more than
 * once per window.
 */
const LIST_CACHE_TTL_MS = 5_000;
/**
 * Hard floor between helper SPAWNS that survives cache invalidation. Without
 * it, alternating the renderer-callable `invalidate-secrets-cache` IPC with a
 * status check defeats the TTL cache entirely (invalidate → re-spawn → repeat
 * = main-process wedge). Invalidation marks the cached DATA stale, but a
 * spawn is still refused until this many ms since the last one — the stale
 * data is served for at most this window after an explicit refresh.
 */
const MIN_SPAWN_INTERVAL_MS = 1_000;
const listCache = new Map<
  string,
  { data: Record<string, string>; ts: number; stale?: boolean }
>();

/**
 * Mark cached command-provider list() results stale (vault rotation /
 * "Refresh from vault"). Data is re-resolved on the next read, subject to
 * MIN_SPAWN_INTERVAL_MS — so refresh takes effect promptly but invalidation
 * spam cannot turn into helper-spawn spam.
 */
export function invalidateProviderListCache(): void {
  for (const entry of listCache.values()) entry.stale = true;
  // Also clear the get()-path spawn-floor timestamps so a "Refresh from vault"
  // lets the very next single-key get() spawn immediately (subject only to a
  // fresh floor window from that spawn). The get floor holds no secret values —
  // only timestamps — so clearing it leaks nothing; it just stops a refresh
  // from being silently swallowed by a still-open floor window.
  getSpawnFloor.clear();
}

/**
 * The configured provider's enumerable secrets only (no process.env overlay).
 * Intended for the gateway-spawn broadcast loop, which
 * already layers process.env separately and wants to fill ONLY the keys the
 * provider can positively enumerate — a bare-value `command` helper returns {}
 * here, so its single value is never sprayed across every known key name. Never
 * throws.
 *
 * The `command` provider's result is held in a short TTL cache (see S1 note
 * above); the `env` provider is NOT cached here because readEnv() already has
 * its own cache in config.ts and double-caching would mask set-env writes.
 */
export function providerListSafe(profile?: string): Record<string, string> {
  try {
    const provider = getSecretsProvider(profile);
    if (provider.id !== "command") return provider.list(profile);
    const cacheKey = profile || "default";
    const hit = listCache.get(cacheKey);
    const now = Date.now();
    if (hit) {
      const fresh = !hit.stale && now - hit.ts <= LIST_CACHE_TTL_MS;
      const spawnAllowed = now - hit.ts >= MIN_SPAWN_INTERVAL_MS;
      // Serve cached data when fresh, OR when stale/expired but a re-spawn
      // is still inside the hard floor (anti-spam: stale beats wedged).
      //
      // DELETION-WINDOW SEMANTIC (by design): invalidateProviderListCache()
      // marks the entry stale but does NOT reset `ts`, so the spawn floor is
      // measured from the ORIGINAL spawn. A key that was just deleted from the
      // vault (not merely rotated) therefore remains visible to callers — e.g.
      // a freshly-spawned gateway via buildGatewayEnv — for up to
      // MIN_SPAWN_INTERVAL_MS (~1s) after an explicit refresh. This is the
      // same "stale beats wedged" tradeoff that protects the Electron main
      // process from invalidate+poll spawn-floods (S1): a sub-second deletion
      // lag is preferred over an unbounded synchronous re-spawn. Rotation is
      // unaffected (the old value still authenticates briefly); only hard
      // deletion has the narrow visibility window.
      if (fresh || !spawnAllowed) return hit.data;
    }
    const data = provider.list(profile);
    listCache.set(cacheKey, { data, ts: now });
    return data;
  } catch {
    return {};
  }
}

/**
 * Audit-facing view: the same fully-resolved map as `resolvedSecrets()`, but
 * ALSO overlays the parsed `.env` file beneath the provider. This mirrors
 * getApiServerKey()'s order (process.env > .env > provider) and is the
 * authoritative "do I have this key, anywhere?" view for checks that need to
 * reason about whether a secret is configured at all, not about which layer it
 * came from.
 *
 * The default `env` provider returns the .env map unchanged, so env-provider
 * users see no behavior change. For a `command` provider pointing at a vault
 * dump, this is what lets the config-health audit avoid false
 * "API_SERVER_KEY is not set" warnings for vault-only users.
 *
 * Never throws.
 */
export function resolvedSecretMap(profile?: string): Record<string, string> {
  // Start with the provider (lowest precedence). .env then process.env
  // REPLACE any keys they have, in order — so the final precedence is
  // process.env > .env > provider, matching getSecret() and getApiServerKey().
  const merged: Record<string, string> = { ...providerListSafe(profile) };
  // Overlay the .env file above the provider — explicit .env entries win
  // over vault values, matching the gateway's own resolution policy. The
  // .env reader is a shared cached object, so copy before mutating.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- readEnv is required at call time, NOT to break a cycle: getConfigValue is already statically imported from "../config" at the top of this file, so the config<->secrets cycle is already established and carried safely (providers construct lazily). The lazy require here just keeps readEnv resolution at call time so a test that resets modules (vi.resetModules) re-binds the current ../config. Collapsing it to the static import would also work; kept lazy for the resetModules test path.
    const { readEnv } = require("../config") as typeof import("../config");
    const env = readEnv(profile);
    for (const [k, v] of Object.entries(env)) {
      if (v != null && v !== "") merged[k] = v;
    }
  } catch {
    // config not loadable — provider-only view is fine for the audit
  }
  // Overlay process.env above .env (top of the precedence chain).
  for (const [k, v] of Object.entries(process.env)) {
    if (v != null && v !== "") merged[k] = v;
  }
  return merged;
}
