import type { SecretsProvider } from "./provider";
import { readEnv } from "../config";

/**
 * Default secrets provider — resolves from the profile's plaintext `.env` file.
 * This is byte-for-byte the desktop's historical behavior: it delegates to the
 * existing `readEnv()` parser, so a zero-config install (no `secrets.provider`
 * set) behaves exactly as before.
 */
export class EnvSecretsProvider implements SecretsProvider {
  readonly id = "env";

  get(key: string, profile?: string): string | null {
    const value = readEnv(profile)[key];
    return value != null && value !== "" ? value : null;
  }

  list(profile?: string): Record<string, string> {
    return readEnv(profile);
  }
}
