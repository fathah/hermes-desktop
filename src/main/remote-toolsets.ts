import type { ConnectionConfig } from "./config";
import { remoteDashboardRequestJson } from "./remote-api";
import type { ToolsetInfo } from "./tools";

type RemoteToolsetRow = {
  name?: unknown;
  label?: unknown;
  description?: unknown;
  enabled?: unknown;
};

export async function remoteGetToolsets(
  connection: ConnectionConfig,
  profile?: string,
): Promise<ToolsetInfo[]> {
  const rows = await remoteDashboardRequestJson<RemoteToolsetRow[]>(
    connection,
    "/api/tools/toolsets",
    {},
    profile,
  );
  if (!Array.isArray(rows)) return [];
  return rows
    .filter(
      (row): row is RemoteToolsetRow & { name: string } =>
        typeof row?.name === "string" && row.name.length > 0,
    )
    .map((row) => ({
      key: row.name,
      label: typeof row.label === "string" ? row.label : row.name,
      description:
        typeof row.description === "string" ? row.description : "",
      enabled: row.enabled === true,
    }));
}

export async function remoteSetToolsetEnabled(
  connection: ConnectionConfig,
  key: string,
  enabled: boolean,
  profile?: string,
): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]+$/.test(key)) {
    throw new Error("Invalid toolset key.");
  }
  const result = await remoteDashboardRequestJson<{ ok?: boolean }>(
    connection,
    `/api/tools/toolsets/${encodeURIComponent(key)}`,
    { method: "PUT", body: { enabled } },
    profile,
  );
  return result?.ok !== false;
}
