import http from "http";
import https from "https";
import { dashboardApiUrl, type RemoteSessionConfig } from "./remote-sessions";

type RemoteRecord = Record<string, unknown>;

class RemoteMetadataHttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "RemoteMetadataHttpError";
  }
}

function asRecord(value: unknown): RemoteRecord {
  return value && typeof value === "object" ? (value as RemoteRecord) : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function remoteRecord(
  config: RemoteSessionConfig,
  path: "/api/status" | "/health",
): Promise<RemoteRecord> {
  return new Promise((resolve, reject) => {
    // Shared builder from remote-sessions so /api/status carries the same
    // `?profile=` scoping as every other dashboard request — on the unified
    // SSH machine dashboard an unscoped status reads the DEFAULT profile's
    // hermes home/version instead of the requested one.
    const parsed = new URL(dashboardApiUrl(config, path));
    const client = parsed.protocol === "https:" ? https : http;
    const token = config.apiKey.trim();
    const req = client.request(
      parsed,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          ...(token && path === "/api/status"
            ? { "X-Hermes-Session-Token": token }
            : {}),
          ...(token && path === "/health"
            ? { Authorization: `Bearer ${token}` }
            : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("error", reject);
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          if ((res.statusCode ?? 500) >= 400) {
            reject(
              new RemoteMetadataHttpError(
                res.statusCode ?? 500,
                `${res.statusCode}: ${text || res.statusMessage}`,
              ),
            );
            return;
          }
          try {
            resolve(asRecord(JSON.parse(text || "{}")));
          } catch {
            if (path === "/health") resolve({});
            else reject(new Error(`Invalid JSON from ${parsed.toString()}`));
          }
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(30_000, () => {
      req.destroy(new Error("Timed out connecting to remote Hermes dashboard"));
    });
    req.end();
  });
}

async function remoteStatus(
  config: RemoteSessionConfig,
): Promise<RemoteRecord> {
  try {
    return await remoteRecord(config, "/api/status");
  } catch (error) {
    if (
      error instanceof RemoteMetadataHttpError &&
      (error.statusCode === 404 || error.statusCode === 405)
    ) {
      return remoteRecord(config, "/health");
    }
    throw error;
  }
}

export async function remoteGetHermesHome(
  config: RemoteSessionConfig,
): Promise<string> {
  const status = await remoteStatus(config);
  return stringValue(status.hermes_home) || stringValue(status.home) || "";
}

export async function remoteGetHermesVersion(
  config: RemoteSessionConfig,
): Promise<string | null> {
  const status = await remoteStatus(config);
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
