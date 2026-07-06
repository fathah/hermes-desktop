/**
 * Pluggable secrets-provider interface.
 *
 * The desktop has historically resolved provider/API keys exactly one way: read
 * the plaintext `.env` file (`readEnv()` in config.ts). That forces anyone who
 * keeps secrets in a vault / keyring / secret manager to either write plaintext
 * into `.env` (defeating the vault) or patch the app.
 *
 * This interface lets a secret be resolved from somewhere other than plaintext
 * `.env`, without changing the call sites that consume secrets. The DEFAULT
 * provider (`env`) is byte-for-byte today's behavior, so a zero-config install
 * is unchanged.
 *
 * Resolution order applied by `getSecret()` (see index.ts in this dir):
 *   1. process.env[key]      — runtime-injected secrets (highest precedence)
 *   2. configured provider   — env (the .env file) or command (a helper)
 *   3. null
 */
export interface SecretsProvider {
  /** Stable id of the backend: "env" | "command". */
  readonly id: string;
  /**
   * Resolve a single secret by its env-var name. Returns the value, or null if
   * this provider has no value for that key. Must never throw — a failing
   * backend resolves to null so callers degrade gracefully.
   */
  get(key: string, profile?: string): string | null;
  /**
   * Enumerate every secret this provider can list. The `env` backend returns
   * the parsed `.env` map; a backend that cannot enumerate (e.g. a per-key
   * command) returns `{}` while `get()` still works. Must never throw.
   */
  list(profile?: string): Record<string, string>;
}
