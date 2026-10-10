import { getConnectionConfig, type ConnectionConfig } from "./config";
import { remoteDashboardRequestJson } from "./remote-api";
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

async function serverHome(conn: ConnectionConfig): Promise<string> {
  const status = await remoteDashboardRequestJson<{
    hermes_home?: string;
    home?: string;
  }>(conn, "/api/status");
  return status?.hermes_home || status?.home || "";
}

async function readRemoteText(
  conn: ConnectionConfig,
  path: string,
): Promise<{ content: string; exists: boolean }> {
  try {
    const res = await remoteDashboardRequestJson<{
      text?: string;
      binary?: boolean;
    }>(conn, `/api/fs/read-text?path=${encodeURIComponent(path)}`);
    return { content: res?.binary ? "" : (res?.text ?? ""), exists: true };
  } catch (err) {
    // A missing file is a normal state (no memory written yet); anything else
    // (auth, outside the managed read boundary) should not look like "empty".
    if ((err as { statusCode?: number }).statusCode === 404) {
      return { content: "", exists: false };
    }
    throw err;
  }
}

export async function remoteReadMemory(profile?: string): Promise<MemoryInfo> {
  // One connection for the whole read: the home path belongs to THIS server, so
  // every follow-up request must go to it even if the user switches meanwhile.
  const conn = getConnectionConfig();
  const limits = parseMemoryLimitsConfig("");
  const home = await serverHome(conn);
  const name = profileName(profile);
  const root = name === "default" ? home : `${home}/profiles/${name}`;
  let mem = { content: "", exists: false };
  let user = { content: "", exists: false };
  let contentUnavailable = false;
  let sizes: { memory?: number; user?: number } = {};
  try {
    [mem, user] = await Promise.all([
      readRemoteText(conn, `${root}/memories/MEMORY.md`),
      readRemoteText(conn, `${root}/memories/USER.md`),
    ]);
  } catch (err) {
    // A hosted/locked dashboard refuses file reads outside its managed root
    // (403 "outside the managed read boundary") and ~/.hermes/memories is not
    // inside it. Don't fail the screen: fall back to what /api/memory does
    // expose (file sizes) and say that the contents are not available.
    if ((err as { statusCode?: number }).statusCode !== 403) throw err;
    contentUnavailable = true;
    sizes = (await memoryStatus(profile, conn)).builtin_files ?? {};
    mem = { content: "", exists: (sizes.memory ?? 0) > 0 };
    user = { content: "", exists: (sizes.user ?? 0) > 0 };
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
      // Sizes are bytes, an upper bound for characters; only used for the bar.
      charCount: contentUnavailable ? (sizes.memory ?? 0) : mem.content.length,
      charLimit: limits.memoryCharLimit,
    },
    user: {
      content: user.content,
      exists: user.exists,
      lastModified: null,
      charCount: contentUnavailable ? (sizes.user ?? 0) : user.content.length,
      charLimit: limits.userCharLimit,
    },
    stats: { totalSessions: 0, totalMessages: 0 },
    // The server API exposes neither the configured limits nor the session
    // counts, so these are not measured values: say so instead of showing the
    // defaults as if they were the server's.
    limitsUnknown: true,
    statsUnknown: true,
    ...(contentUnavailable ? { contentUnavailable: true } : {}),
  };
}

interface RemoteMemoryStatus {
  active?: string;
  builtin_files?: { memory?: number; user?: number };
  providers?: Array<{
    name: string;
    description?: string;
    available?: boolean;
  }>;
}

async function memoryStatus(
  profile?: string,
  conn: ConnectionConfig = getConnectionConfig(),
): Promise<RemoteMemoryStatus> {
  const name = profileName(profile);
  const path =
    name === "default"
      ? "/api/memory"
      : `/api/memory?profile=${encodeURIComponent(name)}`;
  return remoteDashboardRequestJson<RemoteMemoryStatus>(conn, path);
}

export async function remoteActiveMemoryProvider(
  profile?: string,
): Promise<string | null> {
  const status = await memoryStatus(profile);
  return status?.active || null;
}

export async function remoteDiscoverMemoryProviders(profile?: string): Promise<
  Array<{
    name: string;
    description: string;
    installed: boolean;
    active: boolean;
    envVars: string[];
  }>
> {
  const status = await memoryStatus(profile);
  return (status?.providers ?? []).map((p) => ({
    name: p.name,
    description: p.description || "",
    installed: Boolean(p.available),
    active: p.name === status.active,
    envVars: [],
  }));
}

export async function remoteReadSoul(profile?: string): Promise<string> {
  const res = await remoteDashboardRequestJson<{ content?: string }>(
    getConnectionConfig(),
    `/api/profiles/${encodeURIComponent(profileName(profile))}/soul`,
  );
  return res?.content ?? "";
}

export async function remoteWriteSoul(
  content: string,
  profile?: string,
): Promise<boolean> {
  await remoteDashboardRequestJson(
    getConnectionConfig(),
    `/api/profiles/${encodeURIComponent(profileName(profile))}/soul`,
    { method: "PUT", body: { content } },
  );
  return true;
}
