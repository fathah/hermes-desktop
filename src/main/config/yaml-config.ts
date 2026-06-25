import { readFileSync, existsSync } from "fs";
import { profilePaths, safeWriteFile } from "../utils";
import { getYamlValue, setYamlValue } from "../yaml-utils";
import { invalidateCache } from "./cache";

export function readYamlFile(filePath: string): string {
  try {
    if (!existsSync(filePath)) return "";
    return readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}

export function writeYamlFile(filePath: string, content: string): void {
  safeWriteFile(filePath, content);
}

export function readConfigYaml(profile?: string): string {
  return readYamlFile(profilePaths(profile).configFile);
}

export function writeConfigYaml(content: string, profile?: string): void {
  writeYamlFile(profilePaths(profile).configFile, content);
}

export function getYamlValuesFromContent(
  content: string,
  keys: string[],
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const key of keys) {
    values[key] = getYamlValue(content, key) || "";
  }
  return values;
}

export function getConfigValues(
  keys: string[],
  profile?: string,
): Record<string, string> {
  return getYamlValuesFromContent(readConfigYaml(profile), keys);
}

export function getConfigValue(key: string, profile?: string): string | null {
  const content = readConfigYaml(profile);
  if (!content) return null;

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

  const content = readConfigYaml(profile);
  const updated = setYamlValue(content, key, value, { upsert: false });
  writeConfigYaml(updated, profile);
}
