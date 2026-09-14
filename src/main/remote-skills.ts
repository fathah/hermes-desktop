import { getApiUrl, getRemoteAuthHeader } from "./hermes";
import type { InstalledSkill, SkillCliResult } from "./skills";

// Remote (HTTP) mode routing for the Skills screen. The skills IPC handlers
// used to fall through to the local CLI in remote mode, so the desktop showed
// (and mutated!) the LOCAL machine's skills while connected to a remote
// dashboard — or errored outright on a machine without a local install. The
// remote dashboard serves the real data: GET /api/skills, GET
// /api/skills/content, POST /api/skills/hub/install|uninstall (web_server.py).
// SSH mode has its own path (sshListInstalledSkills et al.) and is unaffected.

// Marker prefix for skill "paths" that live on the remote dashboard. The
// desktop keys skill content lookups by path; remote skills are keyed by
// NAME + PROFILE on the API, so the path we hand the renderer is
// `remote-skill:<profile>:<name>` and remoteGetSkillContent unwraps both.
// The profile must ride in the path (mirroring how local/SSH paths carry the
// full location): the content lookup has no other channel for it, and using
// the globally active profile instead would query the wrong profile whenever
// the Skills screen is scoped to a named one.
export const REMOTE_SKILL_PREFIX = "remote-skill:";

export function remoteSkillPath(name: string, profile?: string): string {
  return `${REMOTE_SKILL_PREFIX}${profile?.trim() || "default"}:${name}`;
}

async function skillsApi<T>(
  path: string,
  init: RequestInit = {},
  profile?: string,
  query?: Record<string, string>,
): Promise<T> {
  const url = new URL(`${getApiUrl()}${path}`);
  // All query params go through searchParams so encoding stays consistent —
  // mixing pre-encoded params in `path` with searchParams.set() would
  // re-serialize the former (%20 → +) only when a named profile is present.
  for (const [key, value] of Object.entries(query ?? {})) {
    url.searchParams.set(key, value);
  }
  // Scope to the requested profile on the unified dashboard; "default" needs
  // no param (matches dashboardApiUrl's convention in remote-sessions.ts).
  if (profile && profile !== "default") {
    url.searchParams.set("profile", profile);
  }
  const headers: Record<string, string> = {
    ...getRemoteAuthHeader(),
    ...((init.headers as Record<string, string>) || {}),
  };
  if (init.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  const response = await fetch(url.toString(), { ...init, headers });
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = (await response.json()) as { detail?: string };
      if (body?.detail) detail = body.detail;
    } catch {
      // non-JSON error body — keep statusText
    }
    throw new Error(`Remote skills API ${response.status}: ${detail}`);
  }
  return (await response.json()) as T;
}

export async function remoteListInstalledSkills(
  profile?: string,
): Promise<InstalledSkill[]> {
  try {
    const skills = await skillsApi<
      Array<{ name?: string; category?: string; description?: string }>
    >("/api/skills", {}, profile);
    if (!Array.isArray(skills)) return [];
    return skills
      .filter((s) => typeof s?.name === "string" && s.name)
      .map((s) => ({
        name: s.name as string,
        category: s.category || "",
        description: s.description || "",
        path: remoteSkillPath(s.name as string, profile),
      }));
  } catch {
    // Unreachable remote — an empty list beats a renderer error toast here,
    // matching sshListInstalledSkills' behavior.
    return [];
  }
}

export async function remoteGetSkillContent(
  skillPath: string,
  fallbackProfile?: string,
): Promise<string> {
  // Paths from remoteListInstalledSkills embed the profile they were listed
  // under (`remote-skill:<profile>:<name>`). A path without the separator is
  // treated as a bare name and scoped to fallbackProfile.
  let name = skillPath;
  let profile = fallbackProfile;
  if (skillPath.startsWith(REMOTE_SKILL_PREFIX)) {
    name = skillPath.slice(REMOTE_SKILL_PREFIX.length);
    const sep = name.indexOf(":");
    if (sep !== -1) {
      profile = name.slice(0, sep);
      name = name.slice(sep + 1);
    }
  }
  const result = await skillsApi<{ content?: string }>(
    "/api/skills/content",
    {},
    profile,
    { name },
  );
  return result.content ?? "";
}

// NB: the hub endpoints SPAWN `hermes skills install/uninstall` on the remote
// and return immediately ({ok, pid}) — unlike the local/SSH paths, success
// here means "started", not "completed". The renderer's list refresh picks up
// the result; a resolution failure surfaces only in the remote's logs.
export async function remoteInstallSkill(
  identifier: string,
  profile?: string,
): Promise<SkillCliResult> {
  try {
    const result = await skillsApi<{ ok?: boolean }>(
      "/api/skills/hub/install",
      { method: "POST", body: JSON.stringify({ identifier, profile }) },
      profile,
    );
    return result.ok
      ? { success: true }
      : { success: false, error: "Remote install did not start." };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function remoteUninstallSkill(
  name: string,
  profile?: string,
): Promise<SkillCliResult> {
  try {
    const result = await skillsApi<{ ok?: boolean }>(
      "/api/skills/hub/uninstall",
      { method: "POST", body: JSON.stringify({ name, profile }) },
      profile,
    );
    return result.ok
      ? { success: true }
      : { success: false, error: "Remote uninstall did not start." };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
