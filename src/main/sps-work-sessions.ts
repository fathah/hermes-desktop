// sps-work-sessions.ts — the resumable `/work` session map (M1C), split out from
// sps-agent.ts so it can be unit-tested under vitest. It imports ONLY fs/path +
// the path helpers in utils (no better-sqlite3, no gateway), so a test importing
// it doesn't drag in the Electron-ABI native module.
//
// Why a sidecar: PageMeta.workSessionId rides the workspace blob, but in `vault`
// storage mode the blob is frozen as a rollback net and meta is rebuilt from
// frontmatter (title/icon/cover only). This page→session map survives reload in
// BOTH modes. It is derived RUNTIME state (same category as .note-index.db),
// kept OUT of the markdown source of truth so plan files stay clean.
import { promises as fs } from "fs";
import { join, dirname } from "path";
import { profileHome, getActiveProfileNameSync } from "./utils";

function workSessionsPath(profile?: string): string {
  return join(
    profileHome(profile || getActiveProfileNameSync()),
    "sps-agent",
    "work-sessions.json",
  );
}

export async function spsGetWorkSession(
  pageId: string,
  profile?: string,
): Promise<string | null> {
  try {
    const raw = await fs.readFile(workSessionsPath(profile), "utf-8");
    const map = JSON.parse(raw) as Record<string, string>;
    const id = map[pageId];
    return typeof id === "string" && id ? id : null;
  } catch {
    return null;
  }
}

export async function spsSetWorkSession(
  pageId: string,
  sessionId: string,
  profile?: string,
): Promise<boolean> {
  try {
    const p = workSessionsPath(profile);
    await fs.mkdir(dirname(p), { recursive: true });
    let map: Record<string, string> = {};
    try {
      map = JSON.parse(await fs.readFile(p, "utf-8")) as Record<string, string>;
    } catch {
      // No sidecar yet — start fresh.
    }
    map[pageId] = sessionId;
    await fs.writeFile(p, JSON.stringify(map), "utf-8");
    return true;
  } catch {
    return false;
  }
}
