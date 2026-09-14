import type { ConnectionConfig } from "./config";
import { remoteDashboardRequestJson } from "./remote-api";
import { remoteRequestJson, type RemoteSessionConfig } from "./remote-sessions";

type RemoteRecord = Record<string, unknown>;

function asRecord(value: unknown): RemoteRecord {
  return value && typeof value === "object" ? (value as RemoteRecord) : {};
}

export function emptyOAuthProviderStatuses(
  providers: readonly string[],
): Record<string, boolean> {
  return Object.fromEntries(providers.map((provider) => [provider, false]));
}

/**
 * Reduce the dashboard's OAuth catalogue to the boolean-only shape exposed to
 * the renderer. Token previews and all other account metadata are discarded in
 * the main process.
 */
export function normalizeRemoteOAuthProviderStatuses(
  response: unknown,
  supportedProviders: readonly string[],
): Record<string, boolean> {
  const statuses = emptyOAuthProviderStatuses(supportedProviders);
  const rows = asRecord(response).providers;
  if (!Array.isArray(rows)) return statuses;

  const supported = new Set(supportedProviders);
  for (const rawRow of rows) {
    const row = asRecord(rawRow);
    const id = typeof row.id === "string" ? row.id.trim() : "";
    if (!supported.has(id)) continue;
    statuses[id] = asRecord(row.status).logged_in === true;
  }
  return statuses;
}

/**
 * Read OAuth usability from the machine that owns the model library. Direct
 * Remote connections use their configured token/OAuth dashboard boundary;
 * SSH dashboard connections use the already-authenticated tunnel config.
 */
export async function remoteGetOAuthProviderStatuses(
  config: ConnectionConfig | RemoteSessionConfig,
  supportedProviders: readonly string[],
  profile?: string,
): Promise<Record<string, boolean>> {
  const response =
    "mode" in config
      ? await remoteDashboardRequestJson<unknown>(
          config,
          "/api/providers/oauth",
          { timeoutMs: 20_000 },
          profile,
        )
      : await remoteRequestJson<unknown>(config, "/api/providers/oauth", {
          timeoutMs: 20_000,
        });

  return normalizeRemoteOAuthProviderStatuses(response, supportedProviders);
}
