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
import type { ConnectionConfig } from "./config";
import { remoteDashboardRequestJson } from "./remote-api";

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

export async function fetchRemoteMessagingPlatforms(
  connection: ConnectionConfig,
  profile?: string,
): Promise<MessagingPlatformsResponse> {
  const data = await remoteDashboardRequestJson<MessagingPlatformsResponse>(
    connection,
    "/api/messaging/platforms",
    {},
    profile,
  );
  return { ...data, editable: true, source: "remote-api" };
}

export async function updateRemoteMessagingPlatform(
  connection: ConnectionConfig,
  platformId: string,
  update: MessagingPlatformUpdate,
  profile?: string,
): Promise<{ ok: boolean; platform: string }> {
  return remoteDashboardRequestJson(
    connection,
    `/api/messaging/platforms/${encodeURIComponent(platformId)}`,
    {
      method: "PUT",
      body: update,
    },
    profile,
  );
}

export async function testRemoteMessagingPlatform(
  connection: ConnectionConfig,
  platformId: string,
  profile?: string,
): Promise<MessagingPlatformTestResponse> {
  return remoteDashboardRequestJson(
    connection,
    `/api/messaging/platforms/${encodeURIComponent(platformId)}/test`,
    { method: "POST" },
    profile,
  );
}
