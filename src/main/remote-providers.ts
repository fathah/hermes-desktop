import { getConnectionConfig } from "./config";
import { remoteDashboardRequestJson } from "./remote-api";

// Remote (HTTP) mode backing for the Providers screen: API keys (.env) and the
// credential pool live on the server and are reached through the dashboard's
// /api/env and /api/credentials/pool. The server only ever returns REDACTED
// previews, so the renderer never holds a real secret from a remote read, and
// the server refuses to accept a preview back as a write.

export interface RemoteCredentialEntry {
  id?: string;
  label?: string;
  auth_type?: string;
  priority?: number;
  source?: string;
  access_token?: string;
  request_count?: number;
}

type EnvRow = { is_set?: boolean; redacted_value?: string | null };
type PoolEntry = {
  index: number;
  id?: string;
  label?: string;
  auth_type?: string;
  source?: string;
  priority?: number;
  request_count?: number;
  token_preview?: string;
};

// Last redacted previews handed to the renderer, per connection + profile. The
// Providers screen blur-saves every field it shows; writing an untouched preview
// back is pointless (the server rejects it), so those are skipped client-side.
// Keyed by server too: switching servers must not reuse another server's state.
const shownPreviews = new Map<string, Map<string, string>>();

function targetKey(profile?: string): string {
  return `${getConnectionConfig().remoteUrl}\u0000${profile || "default"}`;
}

/**
 * True for a value this module itself handed out as a redacted preview. Such a
 * value is display-only and must never be used as a credential (e.g. sent to a
 * provider as a bearer token).
 */
export function isShownRedactedPreview(value: string | undefined): boolean {
  if (!value) return false;
  for (const previews of shownPreviews.values()) {
    for (const preview of previews.values()) {
      if (preview === value) return true;
    }
  }
  return false;
}

function profileQuery(path: string, profile?: string): string {
  return profile && profile !== "default"
    ? `${path}?profile=${encodeURIComponent(profile)}`
    : path;
}

export async function remoteGetEnv(
  profile?: string,
): Promise<Record<string, string>> {
  const rows = await remoteDashboardRequestJson<Record<string, EnvRow>>(
    getConnectionConfig(),
    profileQuery("/api/env", profile),
  );
  const env: Record<string, string> = {};
  const previews = new Map<string, string>();
  for (const [key, row] of Object.entries(rows ?? {})) {
    if (!row?.is_set) continue;
    const preview = row.redacted_value || "***";
    env[key] = preview;
    previews.set(key, preview);
  }
  shownPreviews.set(targetKey(profile), previews);
  return env;
}

export async function remoteSetEnv(
  key: string,
  value: string,
  profile?: string,
): Promise<boolean> {
  const conn = getConnectionConfig();
  const previews = shownPreviews.get(targetKey(profile));
  if (value && previews?.get(key) === value) return true; // untouched preview
  if (!value) {
    try {
      await remoteDashboardRequestJson(
        conn,
        profileQuery("/api/env", profile),
        { method: "DELETE", body: { key } },
      );
    } catch (err) {
      // Clearing a key that is not set is already the desired state.
      if ((err as { statusCode?: number }).statusCode !== 404) throw err;
    }
    previews?.delete(key);
    return true;
  }
  await remoteDashboardRequestJson(conn, profileQuery("/api/env", profile), {
    method: "PUT",
    body: { key, value },
  });
  previews?.delete(key);
  return true;
}

async function listPool(
  profile?: string,
): Promise<Record<string, PoolEntry[]>> {
  const data = await remoteDashboardRequestJson<{
    providers?: Array<{ provider: string; entries: PoolEntry[] }>;
  }>(getConnectionConfig(), profileQuery("/api/credentials/pool", profile));
  const pool: Record<string, PoolEntry[]> = {};
  for (const p of data?.providers ?? []) pool[p.provider] = p.entries ?? [];
  return pool;
}

function toLocalEntry(entry: PoolEntry): RemoteCredentialEntry {
  return {
    id: entry.id,
    label: entry.label,
    auth_type: entry.auth_type,
    source: entry.source,
    priority: entry.priority,
    request_count: entry.request_count,
    access_token: entry.token_preview,
  };
}

// Ids of the pool entries last shown to the renderer, per connection + profile
// + provider. A removal is expressed by the renderer as "the list without X";
// only this record says which entry the user actually removed.
const shownPools = new Map<string, string[]>();

function poolKey(provider: string, profile?: string): string {
  return `${targetKey(profile)}\u0000${provider}`;
}

function rememberPool(
  provider: string,
  entries: RemoteCredentialEntry[],
  profile?: string,
): void {
  shownPools.set(
    poolKey(provider, profile),
    entries.map((e) => e.id).filter((id): id is string => Boolean(id)),
  );
}

export async function remoteGetCredentialPool(
  profile?: string,
): Promise<Record<string, RemoteCredentialEntry[]>> {
  const pool = await listPool(profile);
  const mapped = Object.fromEntries(
    Object.entries(pool).map(([provider, entries]) => [
      provider,
      entries.map(toLocalEntry),
    ]),
  );
  for (const [provider, entries] of Object.entries(mapped)) {
    rememberPool(provider, entries, profile);
  }
  return mapped;
}

export async function remoteAddCredentialPoolEntry(
  provider: string,
  apiKey: string,
  label: string,
  profile?: string,
): Promise<RemoteCredentialEntry[]> {
  await remoteDashboardRequestJson(
    getConnectionConfig(),
    profileQuery("/api/credentials/pool", profile),
    {
      method: "POST",
      body: { provider, api_key: apiKey, label: label || undefined },
    },
  );
  const entries = (await remoteGetCredentialPool(profile))[provider] ?? [];
  rememberPool(provider, entries, profile);
  return entries;
}

/**
 * The renderer removes a key by sending the provider's remaining entries. The
 * server has no "replace" — it deletes by 1-based index. The removed entry is
 * the one the renderer was SHOWN but no longer sends; it is then looked up by
 * id in a fresh server list, so an entry that another client changed in the
 * meantime is never deleted by mistake — if the chosen credential is gone, the
 * call is refused instead. Nothing is ever added here.
 */
export async function remoteSetCredentialPool(
  provider: string,
  entries: RemoteCredentialEntry[],
  profile?: string,
): Promise<boolean> {
  const shown = shownPools.get(poolKey(provider, profile));
  if (!shown) {
    throw new Error("Credential list was not loaded; reload and retry.");
  }
  const sent = new Set(entries.map((e) => e.id).filter(Boolean));
  const removedIds = shown.filter((id) => !sent.has(id));
  if (removedIds.length === 0) return true;
  // The screen removes one key at a time. A bigger diff means the renderer's
  // list is stale or malformed — refuse rather than delete server secrets.
  if (removedIds.length > 1) {
    throw new Error(
      "Refusing to remove multiple remote credentials at once; reload and retry.",
    );
  }
  const target = ((await listPool(profile))[provider] ?? []).find(
    (e) => e.id === removedIds[0],
  );
  if (!target) {
    throw new Error(
      "That credential no longer exists on the server; reload and retry.",
    );
  }
  await remoteDashboardRequestJson(
    getConnectionConfig(),
    profileQuery(
      `/api/credentials/pool/${encodeURIComponent(provider)}/${target.index}`,
      profile,
    ),
    { method: "DELETE" },
  );
  rememberPool(provider, entries, profile);
  return true;
}

/** Test seam: forget everything shown to the renderer. */
export function resetRemoteProvidersState(): void {
  shownPreviews.clear();
  shownPools.clear();
}
