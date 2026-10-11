import { getConnectionConfig, type ConnectionConfig } from "./config";
import {
  remoteDashboardRequestJson,
  type RemoteDashboardRequestOptions,
} from "./remote-api";
import { providerTargetRevision } from "./provider-request-target";
import { probeRemoteAuthMode } from "./remote-oauth";
import { defaultColorForName } from "../shared/profileColors";
import { isValidProfileName, PROFILE_NAME_ERROR } from "./utils";
import type { ProfileInfo } from "./profiles";
import { dashboardApiUrl } from "./remote-sessions";

async function profileRequest<T>(
  connection: ConnectionConfig,
  options?: RemoteDashboardRequestOptions,
): Promise<T> {
  const conn = structuredClone(connection);
  if (conn.mode !== "remote")
    throw new Error("Remote profiles require a Remote connection.");
  const revision = providerTargetRevision(conn);
  const assertCurrent = (): void => {
    if (providerTargetRevision(conn) !== revision)
      throw new Error(
        "Remote authentication changed; reload before continuing.",
      );
  };
  const mode =
    conn.remoteAuthMode === "auto"
      ? (await probeRemoteAuthMode(conn.remoteUrl)).authMode
      : conn.remoteAuthMode;
  assertCurrent();
  let result: T;
  if (mode === "token" && !conn.apiKey.trim()) {
    // Explicit anonymous token dashboards do not use the legacy gateway /p path.
    const url = new URL(
      dashboardApiUrl(
        { remoteUrl: conn.remoteUrl, apiKey: "" },
        "/api/profiles",
      ),
    );
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    // Bare fetch rejects URL userinfo; preserve the supported Basic proxy boundary.
    if (url.username || url.password) {
      headers.Authorization = `Basic ${Buffer.from(
        `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`,
      ).toString("base64")}`;
      url.username = "";
      url.password = "";
    }
    const response = await fetch(url.toString(), {
      method: options?.method || "GET",
      headers,
      body:
        options?.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok)
      throw new Error(`Remote profiles HTTP ${response.status}`);
    result = (await response.json()) as T;
  } else {
    result = await remoteDashboardRequestJson<T>(
      { ...conn, remoteAuthMode: mode },
      "/api/profiles",
      options,
    );
  }
  assertCurrent();
  return result;
}

interface RemoteProfileRow {
  name: string;
  path?: string;
  is_default?: boolean;
  model?: string | null;
  provider?: string | null;
  has_env?: boolean;
  skill_count?: number;
  gateway_running?: boolean;
  display_name?: string;
}

function validProfileRow(row: unknown): row is RemoteProfileRow {
  if (!row || typeof row !== "object" || Array.isArray(row)) return false;
  const value = row as Record<string, unknown>;
  return (
    isValidProfileName(value.name) &&
    ["path", "display_name"].every(
      (key) => value[key] === undefined || typeof value[key] === "string",
    ) &&
    ["model", "provider"].every(
      (key) => value[key] == null || typeof value[key] === "string",
    ) &&
    ["is_default", "has_env", "gateway_running"].every(
      (key) => value[key] === undefined || typeof value[key] === "boolean",
    ) &&
    (value.skill_count === undefined ||
      (typeof value.skill_count === "number" &&
        Number.isFinite(value.skill_count) &&
        value.skill_count >= 0))
  );
}

export async function remoteListProfiles(
  activeName: string,
  connection: ConnectionConfig = getConnectionConfig(),
): Promise<ProfileInfo[]> {
  const data = await profileRequest<{ profiles?: RemoteProfileRow[] }>(
    connection,
  );
  if (
    !Array.isArray(data?.profiles) ||
    data.profiles.some((p) => !validProfileRow(p))
  )
    throw new Error("Remote profiles response was invalid.");
  const list = data.profiles.map(
    (p): ProfileInfo => ({
      id: p.name,
      name: p.display_name || p.name,
      path: p.path || "",
      isDefault: p.is_default === true || p.name === "default",
      isActive: p.name === activeName,
      model: p.model || "",
      provider: p.provider || "auto",
      hasEnv: p.has_env === true,
      hasSoul: false,
      skillCount: typeof p.skill_count === "number" ? p.skill_count : 0,
      gatewayRunning: p.gateway_running === true,
      color: defaultColorForName(p.name),
      avatar: null,
    }),
  );
  return list;
}

export async function remoteCreateProfile(
  name: string,
  cloneFrom: string | null,
  connection: ConnectionConfig = getConnectionConfig(),
): Promise<{ success: boolean; error?: string; id?: string }> {
  const safe = name.trim();
  if (
    !isValidProfileName(safe) ||
    (cloneFrom !== null && !isValidProfileName(cloneFrom))
  )
    return { success: false, error: PROFILE_NAME_ERROR };
  try {
    const result = await profileRequest<{ ok?: boolean; name?: string }>(
      connection,
      {
        method: "POST",
        body: { name: safe, clone_from: cloneFrom || undefined },
      },
    );
    if (result?.ok !== true || result.name !== safe)
      throw new Error("The server did not confirm profile creation.");
    return { success: true, id: safe };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
