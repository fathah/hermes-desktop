import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { profileHome } from "./utils";
import {
  buildMessagingPlatforms,
  getMessagingPlatformDefinition,
  type MessagingPlatformRuntimeState,
  type MessagingPlatformTestResponse,
  type MessagingPlatformsResponse,
  type MessagingPlatformUpdate,
  testMessagingPlatformStatus,
  validateMessagingPlatformUpdate,
} from "../shared/messaging-platforms";
import { getConnectionConfig } from "./config";
import { remoteDashboardRequestJson } from "./remote-api";
import { normaliseRemoteUrl } from "./hermes";

export function buildDesktopMessagingPlatforms(
  env: Record<string, string>,
  enabled: Record<string, boolean>,
  gatewayRunning: boolean,
  platformToolsets: Record<string, string[]> = {},
  platformStates: Record<string, MessagingPlatformRuntimeState> = {},
): MessagingPlatformsResponse {
  return buildMessagingPlatforms(
    env,
    enabled,
    gatewayRunning,
    platformToolsets,
    platformStates,
  );
}

const PLATFORM_STATE_KEY: Record<string, string> = {
  home_assistant: "homeassistant",
  webhooks: "webhook",
};

interface GatewayStateFile {
  gateway_state?: string | null;
  pid?: number | null;
  platforms?: Record<string, MessagingPlatformRuntimeState>;
}

export function readLocalGatewayPlatformStates(
  profile: string | undefined,
  gatewayRunning: boolean,
): Record<string, MessagingPlatformRuntimeState> {
  if (!gatewayRunning) return {};
  try {
    const statePath = join(profileHome(profile), "gateway_state.json");
    if (!existsSync(statePath)) return {};
    const parsed = JSON.parse(
      readFileSync(statePath, "utf-8"),
    ) as GatewayStateFile;
    // The caller already passed the local gateway liveness check. Avoid doing
    // another synchronous process lookup here; on Windows that can block the
    // Electron main process during the Gateway screen's refresh loop.
    if (parsed.gateway_state && parsed.gateway_state !== "running") return {};
    const platforms = parsed.platforms ?? {};
    const result: Record<string, MessagingPlatformRuntimeState> = {};
    for (const [platform, state] of Object.entries(platforms)) {
      result[platform] = state;
    }
    for (const [desktopKey, stateKey] of Object.entries(PLATFORM_STATE_KEY)) {
      if (platforms[stateKey] && !result[desktopKey]) {
        result[desktopKey] = platforms[stateKey];
      }
    }
    return result;
  } catch {
    return {};
  }
}

export function applyMessagingPlatformUpdate(
  platformId: string,
  update: MessagingPlatformUpdate,
  writeEnv: (key: string, value: string) => void | Promise<void>,
  setEnabled: (platform: string, enabled: boolean) => void | Promise<void>,
  setToolset?: (
    platform: string,
    toolset: string,
    enabled: boolean,
  ) => boolean | void | Promise<boolean>,
): Promise<void> {
  validateMessagingPlatformUpdate(platformId, update);
  return applyValidatedMessagingPlatformUpdate(
    platformId,
    update,
    writeEnv,
    setEnabled,
    setToolset,
  );
}

async function applyValidatedMessagingPlatformUpdate(
  platformId: string,
  update: MessagingPlatformUpdate,
  writeEnv: (key: string, value: string) => void | Promise<void>,
  setEnabled: (platform: string, enabled: boolean) => void | Promise<void>,
  setToolset?: (
    platform: string,
    toolset: string,
    enabled: boolean,
  ) => boolean | void | Promise<boolean>,
): Promise<void> {
  for (const key of update.clear_env ?? []) {
    await writeEnv(key, "");
  }
  for (const [key, value] of Object.entries(update.env ?? {})) {
    const trimmed = value.trim();
    if (trimmed) {
      await writeEnv(key, trimmed);
    }
  }
  if (update.enabled !== undefined) {
    await setEnabled(platformId, update.enabled);
  }
  if (update.toolsets) {
    if (!setToolset) {
      throw new Error("Messaging platform toolsets are not editable here.");
    }
    for (const [toolset, nextEnabled] of Object.entries(update.toolsets)) {
      const ok = await setToolset(platformId, toolset, nextEnabled);
      if (ok === false) {
        throw new Error(`Could not update ${platformId} ${toolset} toolset.`);
      }
    }
  }
}

export function testDesktopMessagingPlatform(
  platformId: string,
  response: MessagingPlatformsResponse,
): MessagingPlatformTestResponse {
  const platform = response.platforms.find((entry) => entry.id === platformId);
  if (!platform) {
    const definition = getMessagingPlatformDefinition(platformId);
    return {
      ok: false,
      state: "unknown",
      message: definition
        ? `${definition.name} is not available in the current messaging catalog.`
        : `Unknown messaging platform: ${platformId}`,
    };
  }
  return testMessagingPlatformStatus(platform);
}

// Remote messaging goes through the authenticated dashboard boundary: a bare
// fetch carries no OAuth cookie, so the Gateway page could not load its
// platform list for OAuth users.
async function remoteMessagingJson<T>(
  path: string,
  method: "GET" | "PUT" | "POST" = "GET",
  body?: unknown,
  profile?: string,
): Promise<T> {
  const connection = getConnectionConfig();
  const anonymousRequest = async (): Promise<T> => {
    const url = new URL(`${normaliseRemoteUrl(connection.remoteUrl)}${path}`);
    if (profile) url.searchParams.set("profile", profile);
    const response = await fetch(url.toString(), {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.error || data.detail || `HTTP ${response.status}`);
    return data as T;
  };
  if (connection.remoteAuthMode === "token" && !connection.apiKey?.trim()) {
    return anonymousRequest();
  }
  try {
    return await remoteDashboardRequestJson<T>(
      connection,
      path,
      { method, body },
      profile,
    );
  } catch (error) {
    // Auto mode may resolve to a keyless token server. Only this exact boundary
    // failure allows anonymous compatibility; OAuth and probe failures stay errors.
    if (
      !connection.apiKey?.trim() &&
      connection.remoteAuthMode !== "oauth" &&
      error instanceof Error &&
      error.message === "Remote Hermes dashboard token is not configured."
    ) {
      return anonymousRequest();
    }
    throw error;
  }
}

export async function fetchRemoteMessagingPlatforms(
  profile?: string,
): Promise<MessagingPlatformsResponse> {
  const data = await remoteMessagingJson<MessagingPlatformsResponse>(
    "/api/messaging/platforms",
    "GET",
    undefined,
    profile,
  );
  return { ...data, editable: true, source: "remote-api" };
}

export function updateRemoteMessagingPlatform(
  platformId: string,
  update: MessagingPlatformUpdate,
  profile?: string,
): Promise<{ ok: boolean; platform: string }> {
  return remoteMessagingJson(
    `/api/messaging/platforms/${encodeURIComponent(platformId)}`,
    "PUT",
    update,
    profile,
  );
}

export function testRemoteMessagingPlatform(
  platformId: string,
  profile?: string,
): Promise<MessagingPlatformTestResponse> {
  return remoteMessagingJson(
    `/api/messaging/platforms/${encodeURIComponent(platformId)}/test`,
    "POST",
    undefined,
    profile,
  );
}
