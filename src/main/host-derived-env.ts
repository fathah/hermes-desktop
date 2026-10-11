import { matchesProviderUrl, URL_KEY_MAP } from "../shared/url-key-map";

/**
 * Shared URL → host-derived env-var lookup.
 *
 * This is a main-process wrapper around PR369's shared URL map. PR400
 * depends on PR369 so the desktop only maintains one provider URL table.
 */

/**
 * Return the canonical `<VENDOR>_API_KEY` env-var name for a base URL,
 * or null if the URL doesn't match a known vendor pattern.
 *
 * Used by both:
 *   - `hermes.ts` runtime spawn (CLI path) — writes the host-derived
 *     var into the child process env so a freshly-spawned hermes-agent
 *     can resolve the key.
 *   - `models.ts` custom-provider persistence — writes the host-derived
 *     var into `.env` so the long-running gateway (started from
 *     `.env`-only state) can resolve it without a respawn.
 *
 * Local LLM hosts (localhost, 127.0.0.1, RFC1918) and unknown commercial
 * hosts (e.g. unsloth.ai) intentionally return null — no vendor binding,
 * the upstream engine falls back to `no-key-required` for those.
 */
export function hostDerivedEnvKeyForUrl(baseUrl: string): string | null {
  for (const { pattern, envKey, matchHostname } of URL_KEY_MAP) {
    if (matchesProviderUrl(baseUrl, pattern, matchHostname)) return envKey;
  }
  return null;
}

export function shouldPruneOpenRouterApiKey(
  hostDerivedEnvKey: string | null,
): boolean {
  return hostDerivedEnvKey !== "OPENROUTER_API_KEY";
}
