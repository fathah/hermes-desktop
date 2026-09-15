import { getConnectionConfig } from "./config";
import { requestLocalBotGroup } from "./hermes";
import {
  validateBotGroupRequest,
  type BotGroupOperation,
} from "../shared/bot-groups";

/** Installation-owner capability. No credentials or execution state cross IPC. */
export async function botGroupsRequest(
  connectionId: unknown,
  operation: string,
  input: unknown = {},
): Promise<unknown> {
  const params = validateBotGroupRequest(operation, input);
  const enabled = ["1", "true"].includes(
    process.env.HERMES_DESKTOP_BOT_GROUPS || "",
  );
  if (!enabled) {
    if (operation === "capabilities")
      return { enabled: false, available: false };
    throw new Error(
      "Enable HERMES_DESKTOP_BOT_GROUPS to use experimental Bot groups.",
    );
  }
  if (typeof connectionId !== "string" || !connectionId.trim())
    throw new Error("A connection is required.");
  // Do not silently fall back to the local installation while viewing a remote
  // connection. Remote owner/authentication scope needs a separate reviewed adapter.
  const config = getConnectionConfig(connectionId);
  if (config.mode !== "local") {
    const error =
      "Experimental Bot groups currently require a local Hermes installation. Remote and SSH connections are not supported yet.";
    if (operation === "capabilities")
      return { enabled: true, available: false, error };
    throw new Error(error);
  }
  try {
    const result = await requestLocalBotGroup(
      operation as BotGroupOperation,
      params,
    );
    if (operation === "capabilities") {
      return {
        enabled: true,
        available: result.protocol_version === 2,
        capabilities: {
          protocol_version: result.protocol_version,
          driver: result.driver,
          methods: result.methods,
        },
      };
    }
    if (operation === "profiles") {
      const profiles = Array.isArray(result.profiles) ? result.profiles : [];
      return {
        profiles: profiles
          .filter((p) => p && typeof p.name === "string")
          .map((p) => ({
            name: p.name,
            display_name:
              typeof p.display_name === "string" ? p.display_name : p.name,
          })),
      };
    }
    return result;
  } catch {
    // A gateway exception may embed its authenticated WebSocket URL or paths.
    const error =
      "Hermes could not complete the group request. Check the Dashboard and update to a groups protocol v2 runtime. Refresh before retrying.";
    if (operation === "capabilities")
      return { enabled: true, available: false, error };
    throw new Error(error);
  }
}
