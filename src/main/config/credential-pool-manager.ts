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
    this.mutateProviderPool(cleanProvider, profile, (entries) => {
      const matched = entries.find(
        (e) =>
          e.access_token === apiKey ||
          e.api_key === apiKey ||
          e.refresh_token === apiKey,
      );

      if (matched) {
        matched.cooldown_until = Date.now() + durationMs;
        return true;
      }
      return false;
    });
  }

  /**
   * Rotates and selects the next available key with the highest priority (lowest priority value).
   * Automatically updates the profile's active environment file on disk.
   */
  public static rotateKey(provider: string, profile?: string): string | null {
    const cleanProvider = provider.trim().toLowerCase();
    return this.mutateProviderPool(cleanProvider, profile, (entries) => {
      if (entries.length === 0) return null;

      const now = Date.now();
      const available = entries.filter((e) => (e.cooldown_until ?? 0) <= now);

      let selected: ExtendedCredentialEntry | undefined;
      let shouldClearCooldown = false;
      if (available.length === 0) {
        selected = [...entries].sort(
          (a, b) => (a.cooldown_until ?? 0) - (b.cooldown_until ?? 0),
        )[0];
        shouldClearCooldown = !!selected;
      } else {
        selected = available.sort(
          (a, b) => (a.priority ?? 0) - (b.priority ?? 0),
        )[0];
      }

      const token = selected?.access_token ?? selected?.api_key ?? "";
      if (!selected || !token) return null;
      if (!this.updateActiveKey(cleanProvider, token, profile)) return null;

      if (shouldClearCooldown) selected.cooldown_until = 0;
      selected.request_count = (selected.request_count ?? 0) + 1;
      return token;
    });
  }

  private static mutateProviderPool<T>(
    provider: string,
    profile: string | undefined,
    mutator: (entries: ExtendedCredentialEntry[]) => T,
  ): T {
    const pool = getCredentialPool(profile);
    const entries = (pool[provider] || []) as ExtendedCredentialEntry[];
    const result = mutator(entries);
    setCredentialPool(provider, entries, profile);
    return result;
  }

  /**
   * Helper to write the active key to environmental variables and profiles.
   */
  private static updateActiveKey(
    provider: string,
    key: string,
    profile?: string,
  ): boolean {
    const envKey = this.getEnvKeyForProvider(provider);
    try {
      setEnvValue(envKey, key, profile);
      return true;
    } catch (err) {
      console.error(
        `[CredentialPoolManager] Failed to write rotated env key:`,
        err,
      );
      return false;
    }
  }
}
