import { getCredentialPool, setCredentialPool } from "./credential-pool";
import { setEnvValue } from "./env-store";

export interface ExtendedCredentialEntry {
  id?: string;
  label?: string;
  auth_type?: string;
  priority?: number;
  source?: string;
  access_token?: string;
  refresh_token?: string;
  api_key?: string;
  base_url?: string;
  request_count?: number;
  cooldown_until?: number; // timestamp in milliseconds
}

export class CredentialPoolManager {
  /**
   * Resolve the environment variable name corresponding to a provider.
   */
  public static getEnvKeyForProvider(provider: string): string {
    const p = provider.trim().toLowerCase();
    switch (p) {
      case "openai":
        return "OPENAI_API_KEY";
      case "anthropic":
        return "ANTHROPIC_API_KEY";
      case "google":
      case "gemini":
        return "GEMINI_API_KEY";
      case "deepseek":
        return "DEEPSEEK_API_KEY";
      case "groq":
        return "GROQ_API_KEY";
      case "openrouter":
        return "OPENROUTER_API_KEY";
      case "together":
        return "TOGETHER_API_KEY";
      default:
        return `${p.toUpperCase()}_API_KEY`;
    }
  }

  /**
   * Puts a specific key (resolved by its API key token value) on cooldown.
   */
  public static markKeyCooldown(
    provider: string,
    apiKey: string,
    durationMs: number,
    profile?: string,
  ): void {
    const cleanProvider = provider.trim().toLowerCase();
    const entries = (getCredentialPool(profile)[cleanProvider] || []) as ExtendedCredentialEntry[];

    const matched = entries.find(
      (e) => e.access_token === apiKey || e.api_key === apiKey || e.refresh_token === apiKey,
    );

    if (matched) {
      matched.cooldown_until = Date.now() + durationMs;
      setCredentialPool(cleanProvider, entries, profile);
    }
  }

  /**
   * Rotates and selects the next available key with the highest priority (lowest priority value).
   * Automatically updates the profile's active environment file on disk.
   */
  public static rotateKey(provider: string, profile?: string): string | null {
    const cleanProvider = provider.trim().toLowerCase();
    const entries = (getCredentialPool(profile)[cleanProvider] || []) as ExtendedCredentialEntry[];

    if (entries.length === 0) return null;

    const now = Date.now();
    // Filter available entries that are NOT on cooldown
    const available = entries.filter((e) => {
      const cooldown = e.cooldown_until ?? 0;
      return cooldown <= now;
    });

    if (available.length === 0) {
      // If all keys are on cooldown, fall back to clearing the cooldown on the oldest one
      const sortedByCooldown = [...entries].sort((a, b) => {
        return (a.cooldown_until ?? 0) - (b.cooldown_until ?? 0);
      });
      const fallback = sortedByCooldown[0];
      if (fallback) {
        fallback.cooldown_until = 0;
        setCredentialPool(cleanProvider, entries, profile);
        const token = fallback.access_token ?? fallback.api_key ?? "";
        if (token) {
          this.updateActiveKey(cleanProvider, token, profile);
          return token;
        }
      }
      return null;
    }

    // Sort by priority ascending (priority 0 > priority 1 > priority 2)
    const sorted = available.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
    const selected = sorted[0];
    const token = selected.access_token ?? selected.api_key ?? "";

    if (token) {
      this.updateActiveKey(cleanProvider, token, profile);
      // Increment request count for stats
      selected.request_count = (selected.request_count ?? 0) + 1;
      setCredentialPool(cleanProvider, entries, profile);
      return token;
    }

    return null;
  }

  /**
   * Helper to write the active key to environmental variables and profiles.
   */
  private static updateActiveKey(provider: string, key: string, profile?: string): void {
    const envKey = this.getEnvKeyForProvider(provider);
    try {
      setEnvValue(envKey, key, profile);
    } catch (err) {
      console.error(`[CredentialPoolManager] Failed to write rotated env key:`, err);
    }
  }
}
