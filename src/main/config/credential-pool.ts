import { readFileSync, existsSync } from "fs";
import { randomBytes } from "crypto";
import { join } from "path";
import { getActiveProfileNameSync, profileHome, safeWriteFile } from "../utils";
import { canonicalProviderBaseUrl } from "../provider-registry";

// ── Credential Pool / OAuth store (auth.json) ─────────────────────────

function authFilePath(profile?: string): string {
  return join(profileHome(profile || getActiveProfileNameSync()), "auth.json");
}

/**
 * Shape of a credential-pool entry as the upstream gateway expects it.
 *
 * The engine's resolver (`hermes_cli/auth.py` and the credential-pool
 * entry parser) reads `access_token` (not `key`), needs an
 * `auth_type` to distinguish OAuth from API-key entries inside the
 * same pool, and uses `id` / `priority` / `source` for rotation and
 * telemetry. Issue #367 — pool entries written by the desktop with
 * just `{key, label}` were rejected at runtime ("Hermes is not
 * logged into Nous Portal") because none of the canonical fields
 * were present.
 *
 * `key` is retained for read-only compatibility — old auth.json files
 * that already contain `{key, label}` entries are still parsed
 * (otherwise a user's existing manual entries would vanish on first
 * read). New writes always use the full canonical shape.
 */
export interface CredentialEntry {
  id?: string;
  label?: string;
  auth_type?: "api_key" | "oauth_device_code" | string;
  priority?: number;
  source?: string;
  access_token?: string;
  refresh_token?: string;
  api_key?: string;
  base_url?: string;
  request_count?: number;
  /** Legacy field — historical pool entries written with `{key, label}`. */
  key?: string;
}

export interface OAuthProviderStatus {
  provider: string;
  signedIn: boolean;
  source: "providers" | "credential_pool" | null;
}

export interface OAuthProviderRemovalResult {
  provider: string;
  removed: boolean;
}

export function readAuthStore(profile?: string): Record<string, unknown> {
  try {
    const p = authFilePath(profile);
    if (!existsSync(p)) return {};
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return {};
  }
}

function writeAuthStore(
  store: Record<string, unknown>,
  profile?: string,
): void {
  safeWriteFile(authFilePath(profile), JSON.stringify(store, null, 2));
}

export function getCredentialPool(
  profile?: string,
): Record<string, CredentialEntry[]> {
  const store = readAuthStore(profile);
  const pool = store.credential_pool;
  if (!pool || typeof pool !== "object") return {};
  return pool as Record<string, CredentialEntry[]>;
}

export function setCredentialPool(
  provider: string,
  entries: CredentialEntry[],
  profile?: string,
): void {
  const store = readAuthStore(profile);
  if (!store.credential_pool || typeof store.credential_pool !== "object") {
    store.credential_pool = {};
  }
  (store.credential_pool as Record<string, CredentialEntry[]>)[provider] =
    entries;
  writeAuthStore(store, profile);
}

function entryHasUsableSecret(entry: CredentialEntry | undefined): boolean {
  if (!entry) return false;
  return !!(
    String(entry.access_token || "").trim() ||
    String(entry.refresh_token || "").trim() ||
    String(entry.api_key || "").trim()
  );
}

function isOAuthCredentialEntry(entry: CredentialEntry | undefined): boolean {
  if (!entryHasUsableSecret(entry)) return false;
  return entry?.auth_type !== "api_key";
}

export function getOAuthProviderStatus(
  provider: string,
  profile?: string,
): OAuthProviderStatus {
  const cleanProvider = provider.trim();
  const empty: OAuthProviderStatus = {
    provider: cleanProvider,
    signedIn: false,
    source: null,
  };
  if (!cleanProvider) return empty;

  const store = readAuthStore(profile);
  const providers = store.providers;
  if (providers && typeof providers === "object") {
    const entry = (providers as Record<string, CredentialEntry>)[cleanProvider];
    if (isOAuthCredentialEntry(entry)) {
      return { provider: cleanProvider, signedIn: true, source: "providers" };
    }
  }

  const pool = store.credential_pool;
  const entries =
    pool && typeof pool === "object"
      ? (pool as Record<string, CredentialEntry[]>)[cleanProvider]
      : undefined;
  if (Array.isArray(entries) && entries.some(isOAuthCredentialEntry)) {
    return {
      provider: cleanProvider,
      signedIn: true,
      source: "credential_pool",
    };
  }

  return empty;
}

export function removeOAuthProviderCredentials(
  provider: string,
  profile?: string,
): OAuthProviderRemovalResult {
  const cleanProvider = provider.trim();
  if (!cleanProvider) return { provider: cleanProvider, removed: false };

  const store = readAuthStore(profile);
  let removed = false;

  const providers = store.providers;
  if (providers && typeof providers === "object") {
    const providerMap = providers as Record<string, CredentialEntry>;
    if (isOAuthCredentialEntry(providerMap[cleanProvider])) {
      delete providerMap[cleanProvider];
      removed = true;
    }
  }

  const pool = store.credential_pool;
  if (pool && typeof pool === "object") {
    const poolMap = pool as Record<string, CredentialEntry[]>;
    const entries = poolMap[cleanProvider];
    if (Array.isArray(entries)) {
      const next = entries.filter((entry) => !isOAuthCredentialEntry(entry));
      if (next.length !== entries.length) {
        removed = true;
        if (next.length > 0) poolMap[cleanProvider] = next;
        else delete poolMap[cleanProvider];
      }
    }
  }

  if (store.active_provider === cleanProvider) {
    delete store.active_provider;
    removed = true;
  }

  if (removed) writeAuthStore(store, profile);
  return { provider: cleanProvider, removed };
}

/**
 * Build a credential-pool entry in the canonical engine shape from a
 * user-typed (key, label). Used by the Providers screen so the
 * renderer doesn't need to know the upstream schema — issue #367.
 *
 * The base URL for known providers comes from `canonicalProviderBaseUrl`;
 * unknown providers (`custom`, user-defined) get an empty `base_url`
 * and the engine falls back to its own registry.
 */
export function buildCredentialPoolEntry(
  provider: string,
  apiKey: string,
  label: string,
  existingEntries: CredentialEntry[] = [],
): CredentialEntry {
  const baseUrl = canonicalProviderBaseUrl(provider) || "";
  // Next priority — pool entries are sorted ascending, so a new entry
  // appended at the end gets the highest priority value.
  const nextPriority = existingEntries.reduce(
    (max, e) =>
      typeof e.priority === "number" ? Math.max(max, e.priority + 1) : max,
    0,
  );
  return {
    id: cryptoRandomId(),
    label: label.trim() || `Key ${existingEntries.length + 1}`,
    auth_type: "api_key",
    priority: nextPriority,
    source: "manual",
    access_token: apiKey.trim(),
    base_url: baseUrl,
    request_count: 0,
  };
}

function cryptoRandomId(): string {
  // 8-hex-char id — matches the existing pool entries' id length.
  // Uses `randomBytes(4)` so the name finally matches the impl: four
  // cryptographically-strong bytes → 8 hex chars. Post-#382 review
  // feedback flagged the previous `Math.random()` loop as both
  // misleadingly named and collision-prone at scale.
  return randomBytes(4).toString("hex");
}

/**
 * Append a manually-typed credential pool entry, constructing the
 * full canonical shape. Used by the renderer's "Add" button so the
 * shape stays consistent with what the engine's resolver expects.
 *
 * Returns the updated entries list for that provider.
 */
export function addCredentialPoolEntry(
  provider: string,
  apiKey: string,
  label: string,
  profile?: string,
): CredentialEntry[] {
  const existing = getCredentialPool(profile)[provider] || [];
  const entry = buildCredentialPoolEntry(provider, apiKey, label, existing);
  const next = [...existing, entry];
  setCredentialPool(provider, next, profile);
  return next;
}

/**
 * True iff the given provider has usable OAuth or stored-credential evidence
 * in auth.json. Recognized fields are `access_token`, `refresh_token`, and
 * `api_key`, looked up under both `providers[<name>]` and any entry in
 * `credential_pool[<name>]`. When a named profile is given without its own
 * auth.json, fall back to the default-profile store.
 *
 * Stricter than just "provider key exists in JSON" — an empty
 * `providers: { anthropic: {} }` or a bare `active_provider` no longer
 * counts as configured. The previous looser check masked real onboarding
 * errors where a credential record existed but contained no token.
 */
export function hasOAuthCredentials(
  provider: string,
  profile?: string,
): boolean {
  const cleanProvider = provider.trim();
  if (!cleanProvider) return false;

  const stores = [readAuthStore(profile)];
  if (profile && profile !== "default") {
    stores.push(readAuthStore());
  }

  for (const store of stores) {
    const providers = store.providers;
    if (providers && typeof providers === "object") {
      const entry = (providers as Record<string, CredentialEntry>)[
        cleanProvider
      ];
      if (
        entry &&
        (String(entry.access_token || "").trim() ||
          String(entry.refresh_token || "").trim() ||
          String(entry.api_key || "").trim())
      ) {
        return true;
      }
    }

    const pool = store.credential_pool;
    const entries =
      pool && typeof pool === "object"
        ? (pool as Record<string, CredentialEntry[]>)[cleanProvider]
        : undefined;
    if (
      Array.isArray(entries) &&
      entries.some((entry) => entryHasUsableSecret(entry))
    ) {
      return true;
    }
  }

  return false;
}
