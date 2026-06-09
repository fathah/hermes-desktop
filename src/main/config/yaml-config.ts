import { readFileSync, existsSync } from "fs";
import { profilePaths, safeWriteFile } from "../utils";
import { getYamlValue, setYamlValue } from "../yaml-utils";
import { invalidateCache } from "./cache";

export function getConfigValue(key: string, profile?: string): string | null {
  const { configFile } = profilePaths(profile);
  if (!existsSync(configFile)) return null;

  const content = readFileSync(configFile, "utf-8");
  return getYamlValue(content, key);
}

export function setConfigValue(
  key: string,
  value: string,
  profile?: string,
): void {
  if (
    key === "API_SERVER_KEY" ||
    key === "api_server.token" ||
    key.startsWith("api_server.")
  ) {
    invalidateCache("apiServerKey:");
  }
  const { configFile } = profilePaths(profile);
  if (!existsSync(configFile)) return;

  const content = readFileSync(configFile, "utf-8");
  const updated = setYamlValue(content, key, value, { upsert: false });
  safeWriteFile(configFile, updated);
}
