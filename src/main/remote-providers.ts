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

// Last redacted previews handed to the renderer, per profile. The Providers
// screen blur-saves every field it shows; writing an untouched preview back is
// pointless (the server rejects it), so those are skipped client-side.
const shownPreviews = new Map<string, Map<string, string>>();

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
  shownPreviews.set(profile || "default", previews);
  return env;
}

export async function remoteSetEnv(
  key: string,
  value: string,
  profile?: string,
): Promise<boolean> {
  const conn = getConnectionConfig();
  const previews = shownPreviews.get(profile || "default");
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

export async function remoteGetCredentialPool(
  profile?: string,
): Promise<Record<string, RemoteCredentialEntry[]>> {
  const pool = await listPool(profile);
  return Object.fromEntries(
    Object.entries(pool).map(([provider, entries]) => [
      provider,
      entries.map(toLocalEntry),
    ]),
  );
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
  return (await remoteGetCredentialPool(profile))[provider] ?? [];
}

/**
 * The renderer removes a key by sending the provider's remaining entries. The
 * server has no "replace" — it deletes by 1-based index — so delete whichever
 * server entries are no longer in the list, highest index first so earlier
 * indexes stay valid. Entries are matched by id; nothing is ever added here.
 */
export async function remoteSetCredentialPool(
  provider: string,
  entries: RemoteCredentialEntry[],
  profile?: string,
): Promise<boolean> {
  const keep = new Set(entries.map((e) => e.id).filter(Boolean));
  const current = (await listPool(profile))[provider] ?? [];
  const removals = current
    .filter((e) => e.id && !keep.has(e.id))
    .map((e) => e.index)
    .sort((a, b) => b - a);
  // The screen removes one key at a time. A bigger diff means the renderer's
  // list is stale or malformed — refuse rather than delete server secrets.
  if (removals.length > 1) {
    throw new Error(
      "Refusing to remove multiple remote credentials at once; reload and retry.",
    );
  }
  for (const index of removals) {
    await remoteDashboardRequestJson(
      getConnectionConfig(),
      profileQuery(
        `/api/credentials/pool/${encodeURIComponent(provider)}/${index}`,
        profile,
      ),
      { method: "DELETE" },
    );
  }
  return true;
}
