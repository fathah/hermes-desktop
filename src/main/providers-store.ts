// @lat: [[provider-setup#Provider setup#LLM-provider keys are configured-only, via modals#Named custom providers]]
import { existsSync, readFileSync } from "fs";
import { randomUUID } from "crypto";
import { join } from "path";
import {
  type CustomProviderFile,
  type CustomProviderRecord,
} from "../shared/custom-providers";
import { customProviderEnvKey } from "../shared/url-key-map";
import { isValidProfileName, profileHome, safeWriteFile } from "./utils";

// Per-profile store of user-configured custom providers. Sits alongside the
// profile's `.env` (holds the key) and the global `models.json` (holds models);
// this file owns provider *identity* so a card renders as soon as it's saved,
// independent of whether any model has been added yet. Mirrors the shape and
// conventions of `wallet-store.ts` (versioned envelope, atomic writes), but is
// plaintext — it stores no secrets, only a name + base URL.
const PROVIDERS_FILE = "providers.json";

function providersPath(profile?: string): string {
  return join(profileHome(profile), PROVIDERS_FILE);
}

function normalizeProfile(profile?: string): string | undefined {
  const normalized =
    profile === "" || profile === "default" ? undefined : profile;
  if (normalized !== undefined && !isValidProfileName(normalized)) {
    throw new Error("Invalid profile name.");
  }
  return normalized;
}

function isRecord(value: unknown): value is CustomProviderRecord {
  const r = value as Partial<CustomProviderRecord>;
  return (
    !!r &&
    typeof r.id === "string" &&
    typeof r.name === "string" &&
    typeof r.baseUrl === "string" &&
    typeof r.createdAt === "number"
  );
}

function readProvidersFile(profile?: string): CustomProviderFile {
  const file = providersPath(profile);
  if (!existsSync(file)) return { version: 1, providers: [] };
  try {
    const parsed = JSON.parse(
      readFileSync(file, "utf-8"),
    ) as Partial<CustomProviderFile>;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.providers)) {
      return { version: 1, providers: [] };
    }
    return { version: 1, providers: parsed.providers.filter(isRecord) };
  } catch {
    // A corrupt file shouldn't wipe the Providers screen — degrade to empty.
    return { version: 1, providers: [] };
  }
}

function writeProvidersFile(
  profile: string | undefined,
  data: CustomProviderFile,
): void {
  safeWriteFile(providersPath(profile), JSON.stringify(data, null, 2));
}

/** All custom providers configured for `profile` (empty when none/no file). */
export function listCustomProviders(profile?: string): CustomProviderRecord[] {
  const normalized = normalizeProfile(profile);
  return readProvidersFile(normalized).providers;
}

/**
 * Create or update a custom provider by identity. Records are keyed by their
 * derived env-key name (`customProviderEnvKey(name)`) — the same anchor the
 * runtime uses to look the API key back up — so a re-save with the same name
 * updates the base URL in place instead of duplicating. Blank name or base URL
 * is a no-op (nothing durable to record yet).
 */
export function upsertCustomProvider(
  profile: string | undefined,
  input: { name: string; baseUrl: string },
): CustomProviderRecord | null {
  const normalized = normalizeProfile(profile);
  const name = (input.name || "").trim();
  const baseUrl = (input.baseUrl || "").trim();
  if (!name || !baseUrl) return null;

  const anchor = customProviderEnvKey(name);
  const data = readProvidersFile(normalized);
  const existing = data.providers.find(
    (p) => customProviderEnvKey(p.name) === anchor,
  );

  let record: CustomProviderRecord;
  if (existing) {
    // Preserve id/createdAt; refresh the display name + base URL.
    existing.name = name;
    existing.baseUrl = baseUrl;
    record = existing;
  } else {
    record = { id: randomUUID(), name, baseUrl, createdAt: Date.now() };
    data.providers.push(record);
  }
  writeProvidersFile(normalized, data);
  return record;
}

/** Remove a custom provider by name (matched via its derived env-key anchor). */
export function removeCustomProvider(
  profile: string | undefined,
  name: string,
): void {
  const normalized = normalizeProfile(profile);
  const anchor = customProviderEnvKey((name || "").trim());
  const data = readProvidersFile(normalized);
  const next = data.providers.filter(
    (p) => customProviderEnvKey(p.name) !== anchor,
  );
  if (next.length !== data.providers.length) {
    writeProvidersFile(normalized, { version: 1, providers: next });
  }
}
