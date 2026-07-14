import type { ConnectionConfig } from "./config";
import { remoteDashboardRequestJson } from "./remote-api";
import { remoteRequestJson, type RemoteSessionConfig } from "./remote-sessions";

type RemoteRecord = Record<string, unknown>;

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

type RemoteMetadataConnection = ConnectionConfig | RemoteSessionConfig;

function isConnectionConfig(
  config: RemoteMetadataConnection,
): config is ConnectionConfig {
  return "mode" in config;
}

function remoteStatus(
  config: RemoteMetadataConnection,
  profile?: string,
): Promise<RemoteRecord> {
  if (!isConnectionConfig(config))
    return remoteRequestJson(config, "/api/status", {});
  return profile === undefined
    ? remoteDashboardRequestJson(config, "/api/status", {})
    : remoteDashboardRequestJson(config, "/api/status", {}, profile);
}

export async function remoteGetHermesHome(
  config: RemoteMetadataConnection,
  profile?: string,
): Promise<string> {
  const status = await remoteStatus(config, profile);
  return stringValue(status.hermes_home) || stringValue(status.home) || "";
}

export async function remoteGetHermesVersion(
  config: RemoteMetadataConnection,
  profile?: string,
): Promise<string | null> {
  const status = await remoteStatus(config, profile);
  const version = stringValue(status.version);
  if (!version) return null;

  const releaseDate = stringValue(status.release_date);
  const project =
    stringValue(status.project) ||
    stringValue(status.repo_path) ||
    stringValue(status.config_path);
  const python =
    stringValue(status.python) || stringValue(status.python_version);
  const sdk =
    stringValue(status.openai_sdk) || stringValue(status.openai_sdk_version);
  const update =
    stringValue(status.update_available) || stringValue(status.update_info);

  const lines = [
    `Hermes Agent v${version}${releaseDate ? ` (${releaseDate})` : ""}`,
    project ? `Project: ${project}` : "",
    python ? `Python: ${python}` : "",
    sdk ? `OpenAI SDK: ${sdk}` : "",
    update ? `Update available: ${update}` : "",
  ].filter(Boolean);
  return lines.join("\n");
}
