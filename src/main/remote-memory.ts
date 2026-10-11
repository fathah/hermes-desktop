import { getConnectionConfig, type ConnectionConfig } from "./config";
import {
  remoteDashboardRequestJson,
  type RemoteDashboardRequestOptions,
} from "./remote-api";
import { probeRemoteAuthMode } from "./remote-oauth";
import { providerTargetRevision } from "./provider-request-target";
import { getYamlPath } from "./yaml-path";
import { parseMemoryLimitsConfig } from "./memory-limits";
import type { MemoryInfo } from "./memory";

// Remote (HTTP) mode backing for the Memory screen. The dashboard has no
// content API for MEMORY.md / USER.md (GET /api/memory returns provider status
// and file sizes only), so the files are READ through the managed-file preview
// endpoint /api/fs/read-text. Nothing here writes them: editing stays disabled
// remotely rather than going through a general-purpose file-write endpoint.
// SOUL.md has a first-class API (/api/profiles/{name}/soul) and is read+write.

const ENTRY_DELIMITER = "\n§\n";

export const REMOTE_MEMORY_READ_ONLY_ERROR =
  "Memory is read-only in remote mode.";

function profileName(profile?: string): string {
  return profile?.trim() || "default";
}

const authSnapshots = new WeakMap<ConnectionConfig, string>();

function capture(connection: ConnectionConfig): ConnectionConfig {
  const snapshot = structuredClone(connection);
  if (snapshot.mode !== "remote")
    throw new Error("Remote Memory requires a direct Remote connection.");
  authSnapshots.set(snapshot, providerTargetRevision(snapshot));
  return snapshot;
}

async function memoryRequest<T>(
  connection: ConnectionConfig,
  path: string,
  options?: RemoteDashboardRequestOptions,
): Promise<T> {
  const revision = authSnapshots.get(connection);
  const assertAuth = (): void => {
    if (!revision || revision !== providerTargetRevision(connection))
      throw new Error("Remote authentication changed; reload before editing.");
  };
  assertAuth();
  const authMode =
    connection.remoteAuthMode === "auto"
      ? (await probeRemoteAuthMode(connection.remoteUrl)).authMode
      : connection.remoteAuthMode;
  assertAuth();
  const result = await remoteDashboardRequestJson<T>(
    { ...connection, remoteAuthMode: authMode },
    path,
    options,
  );
  assertAuth();
  return result;
}

async function profileConfig(
  conn: ConnectionConfig,
  profile?: string,
): Promise<{ yaml: string; path: string }> {
  const result = await memoryRequest<{
    yaml?: unknown;
    path?: unknown;
  }>(
    conn,
    `/api/config/raw?profile=${encodeURIComponent(profileName(profile))}`,
  );
  if (
    typeof result?.yaml !== "string" ||
    typeof result?.path !== "string" ||
    !/^(?:\/|[A-Za-z]:[\\/])/.test(result.path) ||
    !/[\\/]config\.yaml$/.test(result.path)
  ) {
    throw new Error("The remote profile configuration path is unavailable.");
  }
  return { yaml: result.yaml, path: result.path };
}

async function readRemoteText(
  conn: ConnectionConfig,
  path: string,
): Promise<{ content: string; exists: boolean }> {
  try {
    const res = await memoryRequest<{
      text?: string;
      binary?: boolean;
    }>(conn, `/api/fs/read-text?path=${encodeURIComponent(path)}`);
    if (typeof res?.text !== "string" || res.binary)
      throw new Error("The remote memory preview is not text.");
    return { content: res.text, exists: true };
  } catch (err) {
    // A missing file is a normal state (no memory written yet); anything else
    // (auth, outside the managed read boundary) should not look like "empty".
    if ((err as { statusCode?: number }).statusCode === 404) {
      return { content: "", exists: false };
    }
    throw err;
  }
}

export async function remoteReadMemory(
  profile?: string,
  connection: ConnectionConfig = getConnectionConfig(),
): Promise<MemoryInfo> {
  // One connection for the whole read: the home path belongs to THIS server, so
  // every follow-up request must go to it even if the user switches meanwhile.
  const conn = capture(connection);
  const config = await profileConfig(conn, profile);
  const limits = parseMemoryLimitsConfig(config.yaml);
  const root = config.path.replace(/[\\/][^\\/]+$/, "");
  let mem = { content: "", exists: false };
  let user = { content: "", exists: false };
  let contentUnavailable = false;

  try {
    [mem, user] = await Promise.all([
      readRemoteText(conn, `${root}/memories/MEMORY.md`),
      readRemoteText(conn, `${root}/memories/USER.md`),
    ]);
  } catch (err) {
    // The managed file boundary may deliberately exclude a profile's memory.
    // /api/memory is process-scoped, so its sizes must never stand in for this profile.
    if (
      (err as { statusCode?: number }).statusCode !== 403 ||
      !/outside (?:the )?managed (?:read boundary|files root)/i.test(
        err instanceof Error ? err.message : "",
      )
    )
      throw err;
    contentUnavailable = true;
  }
  const entries = mem.content.trim()
    ? mem.content
        .split(ENTRY_DELIMITER)
        .map((entry, index) => ({ index, content: entry.trim() }))
    : [];
  return {
    memory: {
      content: mem.content,
      exists: mem.exists,
      lastModified: null,
      entries,
      charCount: mem.content.length,
      charLimit: limits.memoryCharLimit,
    },
    user: {
      content: user.content,
      exists: user.exists,
      lastModified: null,
      charCount: user.content.length,
      charLimit: limits.userCharLimit,
    },
    stats: { totalSessions: 0, totalMessages: 0 },
    // Configuration omits inherited defaults; do not infer unmeasured limits
    // or session counts from the desktop defaults.
    limitsUnknown: true,
    statsUnknown: true,
    ...(contentUnavailable ? { contentUnavailable: true } : {}),
  };
}

function configuredProvider(yaml: string): string | null {
  const value = getYamlPath(yaml, "memory.provider")?.trim();
  return !value ||
    ["built-in", "builtin", "none", "null", "~"].includes(value.toLowerCase())
    ? null
    : value;
}

export async function remoteActiveMemoryProvider(
  profile?: string,
  connection: ConnectionConfig = getConnectionConfig(),
): Promise<string | null> {
  const config = await profileConfig(capture(connection), profile);
  return configuredProvider(config.yaml);
}

export async function remoteDiscoverMemoryProviders(
  profile?: string,
  connection: ConnectionConfig = getConnectionConfig(),
): Promise<
  Array<{
    name: string;
    description: string;
    installed: boolean;
    active: boolean;
    envVars: string[];
  }>
> {
  const conn = capture(connection);
  const [active, schema] = await Promise.all([
    profileConfig(conn, profile).then((config) =>
      configuredProvider(config.yaml),
    ),
    memoryRequest<{
      fields?: Record<string, { options?: unknown }>;
    }>(
      conn,
      `/api/config/schema?profile=${encodeURIComponent(profileName(profile))}`,
    ),
  ]);
  const options = schema?.fields?.["memory.provider"]?.options;
  if (!Array.isArray(options))
    throw new Error("The remote memory provider schema is unavailable.");
  const names = [
    ...new Set([
      ...options.filter(
        (name): name is string => typeof name === "string" && !!name.trim(),
      ),
      ...(active ? [active] : []),
    ]),
  ];
  return names.map((name) => ({
    name,
    description: "",
    installed: true,
    active: name === active,
    envVars: [],
  }));
}

export async function remoteReadSoul(
  profile?: string,
  connection: ConnectionConfig = getConnectionConfig(),
): Promise<string> {
  const conn = capture(connection);
  const res = await memoryRequest<{ content?: string }>(
    conn,
    `/api/profiles/${encodeURIComponent(profileName(profile))}/soul`,
  );
  if (typeof res?.content !== "string")
    throw new Error("The remote Soul response has no text content.");
  return res.content;
}

export async function remoteWriteSoul(
  content: string,
  profile?: string,
  connection: ConnectionConfig = getConnectionConfig(),
): Promise<boolean> {
  const conn = capture(connection);
  const result = await memoryRequest<{ ok?: unknown }>(
    conn,
    `/api/profiles/${encodeURIComponent(profileName(profile))}/soul`,
    { method: "PUT", body: { content } },
  );
  if (result?.ok !== true)
    throw new Error("The remote Soul save was not confirmed.");
  return true;
}
