import {
  readDesktopConfig,
  writeDesktopConfig,
  type ConnectionConfig,
} from "./config";
import { isValidProfileName, PROFILE_NAME_ERROR } from "./utils";

// @lat: [[remote-profiles#Remote profiles#Desktop selection]]
export function getRemoteSelectedProfile(
  connectionId: string,
  connection: ConnectionConfig,
): string {
  const stored = readDesktopConfig().remoteProfileSelections;
  if (!stored || typeof stored !== "object" || Array.isArray(stored))
    return "default";
  const entry = (stored as Record<string, unknown>)[connectionId];
  if (!entry || typeof entry !== "object") return "default";
  const { url, profile } = entry as { url?: unknown; profile?: unknown };
  return url === connection.remoteUrl && isValidProfileName(profile)
    ? profile
    : "default";
}

export function setRemoteSelectedProfile(
  connectionId: string,
  connection: ConnectionConfig,
  profile: string,
): void {
  if (connection.mode !== "remote" || !isValidProfileName(profile))
    throw new Error(PROFILE_NAME_ERROR);
  const config = readDesktopConfig();
  const previous = config.remoteProfileSelections;
  const selections =
    previous && typeof previous === "object" && !Array.isArray(previous)
      ? previous
      : {};
  writeDesktopConfig({
    ...config,
    remoteProfileSelections: {
      ...selections,
      [connectionId]: { url: connection.remoteUrl, profile },
    },
  });
}
