import { providerTargetRevision } from "./provider-request-target";
import { probeRemoteAuthMode } from "./remote-oauth";
import type { RemoteDashboardRequestOptions } from "./remote-api";
import { getConnectionConfig, type ConnectionConfig } from "./config";
import { remoteDashboardRequestJson } from "./remote-api";
import type { DiscoverModelsResult } from "./model-discovery";
import { normalizeModelEndpointUrl } from "../shared/model-endpoint";

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
type PoolEntry = RemoteCredentialEntry & { token_preview?: string };
const shownPreviews = new Map<string, Map<string, string>>();
const authSnapshots = new WeakMap<ConnectionConfig, string>();

function capture(connection?: ConnectionConfig): ConnectionConfig {
  const current = connection ?? getConnectionConfig();
  if (current.mode !== "remote") {
    throw new Error("Remote providers require a direct Remote connection.");
  }
  const captured = { ...current, ssh: { ...current.ssh } };
  authSnapshots.set(captured, providerTargetRevision(captured));
  return captured;
}

async function providerRequest<T>(
  connection: ConnectionConfig,
  path: string,
  options?: RemoteDashboardRequestOptions,
): Promise<T> {
  const revision = authSnapshots.get(connection);
  const assertAuth = (): void => {
    if (revision !== providerTargetRevision(connection))
      throw new Error("Remote authentication changed; reload and retry.");
  };
  assertAuth();
  const authMode =
    connection.remoteAuthMode === "auto"
      ? (await probeRemoteAuthMode(connection.remoteUrl)).authMode
      : connection.remoteAuthMode;
  assertAuth();
  const result = await remoteDashboardRequestJson<T>(
    { ...connection, remoteAuthMode: authMode },
    path,
    options,
  );
  assertAuth();
  return result;
}

function targetKey(connection: ConnectionConfig, profile?: string): string {
  // Equal URLs can belong to different token accounts. This private cache key
  // never crosses IPC, and an awaited reply retains its original owner.
  return JSON.stringify([
    connection.remoteUrl,
    connection.remoteAuthMode,
    connection.apiKey,
    authSnapshots.get(connection),
    profile || "default",
  ]);
}

function profileQuery(path: string, profile?: string): string {
  return `${path}${path.includes("?") ? "&" : "?"}profile=${encodeURIComponent(profile || "default")}`;
}

function requireDefaultPoolProfile(profile?: string): void {
  // Current Agent pool routes ignore profile parameters entirely. Do not
  // pretend that a named-profile query protects another profile's accounts.
  if (profile && profile !== "default") {
    throw new Error(
      "Remote credential pools are available only for the default profile; this server API does not support profile-scoped pool operations.",
    );
  }
}

export async function remoteGetEnv(
  profile?: string,
  connection?: ConnectionConfig,
): Promise<Record<string, string>> {
  const conn = capture(connection);
  const owner = targetKey(conn, profile);
  const rows = await providerRequest<Record<string, EnvRow>>(
    conn,
    profileQuery("/api/env", profile),
  );
  if (!rows || typeof rows !== "object" || Array.isArray(rows)) {
    throw new Error("Remote environment response was invalid.");
  }
  const env: Record<string, string> = {};
  const previews = new Map<string, string>();
  for (const [key, row] of Object.entries(rows)) {
    if (!row?.is_set) continue;
    const preview = row.redacted_value || "***";
    env[key] = preview;
    previews.set(key, preview);
  }
  shownPreviews.set(owner, previews);
  return env;
}

export async function remoteSetEnv(
  key: string,
  value: string,
  profile?: string,
  connection?: ConnectionConfig,
): Promise<boolean> {
  const conn = capture(connection);
  const previews = shownPreviews.get(targetKey(conn, profile));
  if (value && previews?.get(key) === value) return true;
  if (
    value &&
    Array.from(shownPreviews.values()).some((owner) =>
      Array.from(owner.values()).includes(value),
    )
  ) {
    throw new Error(
      "Display-only credential previews cannot be saved as keys.",
    );
  }
  if (!value) {
    try {
      await providerRequest(conn, profileQuery("/api/env", profile), {
        method: "DELETE",
        body: { key },
      });
    } catch (error) {
      if ((error as { statusCode?: number }).statusCode !== 404) throw error;
    }
  } else {
    await providerRequest(conn, profileQuery("/api/env", profile), {
      method: "PUT",
      body: { key, value },
    });
  }
  previews?.delete(key);
  return true;
}

async function listPool(
  conn: ConnectionConfig,
  profile?: string,
): Promise<Record<string, RemoteCredentialEntry[]>> {
  requireDefaultPoolProfile(profile);
  const data = await providerRequest<{
    providers: Array<{ provider: string; entries: PoolEntry[] }>;
  }>(conn, profileQuery("/api/credentials/pool", profile));
  if (!Array.isArray(data?.providers)) {
    throw new Error("Remote credential pool response was invalid.");
  }
  return Object.fromEntries(
    data.providers.map((provider) => [
      provider.provider,
      provider.entries.map((entry) => ({
        id: entry.id,
        label: entry.label,
        auth_type: entry.auth_type,
        source: entry.source,
        priority: entry.priority,
        request_count: entry.request_count,
        access_token: entry.token_preview,
      })),
    ]),
  );
}

export async function remoteGetCredentialPool(
  profile?: string,
  connection?: ConnectionConfig,
): Promise<Record<string, RemoteCredentialEntry[]>> {
  return listPool(capture(connection), profile);
}

export async function remoteAddCredentialPoolEntry(
  provider: string,
  apiKey: string,
  label: string,
  profile?: string,
  connection?: ConnectionConfig,
): Promise<RemoteCredentialEntry[]> {
  const conn = capture(connection);
  requireDefaultPoolProfile(profile);
  await providerRequest(conn, profileQuery("/api/credentials/pool", profile), {
    method: "POST",
    body: { provider, api_key: apiKey, label: label || undefined },
  });
  return (await listPool(conn, profile))[provider] ?? [];
}

// @lat: [[remote-providers#Remote Providers#Pool removal requires atomic identity]]
export async function remoteSetCredentialPool(
  _provider: string,
  _entries: RemoteCredentialEntry[],
  _profile?: string,
  connection?: ConnectionConfig,
): Promise<boolean> {
  capture(connection);
  // A fresh ID lookup followed by an index-only DELETE still races another
  // client. The Agent must atomically compare the chosen ID before removing it.
  throw new Error(
    "Remote credential removal is unavailable in this server API. Remove the selected account in the server dashboard.",
  );
}

/** Account-aware catalogs come from the selected Agent, never desktop keys/cache. */
export async function discoverModelsRemote(
  provider: string,
  baseUrl: string | undefined,
  profile?: string,
  connection?: ConnectionConfig,
): Promise<DiscoverModelsResult> {
  const conn = capture(connection);
  const data = await providerRequest<{
    providers?: Array<{
      slug?: string;
      provider?: string;
      api_url?: string;
      base_url?: string;
      models?: string[];
    }>;
  }>(conn, profileQuery("/api/model/options", profile));
  const wanted = provider.trim().toLowerCase();
  const row = data?.providers?.find(
    (candidate) =>
      (candidate.slug || candidate.provider || "").toLowerCase() === wanted &&
      (!baseUrl ||
        normalizeModelEndpointUrl(
          candidate.api_url || candidate.base_url || "",
        ) === normalizeModelEndpointUrl(baseUrl)),
  );
  // Catalog presence is not live credential verification. The UI may offer
  // the Agent's models without falsely claiming the redacted key was tested.
  return {
    models: row?.models?.filter((model) => typeof model === "string") ?? [],
    status: "unsupported",
    cached: false,
  };
}

export function resetRemoteProvidersState(): void {
  shownPreviews.clear();
}
