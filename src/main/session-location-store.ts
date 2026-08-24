import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { SessionLocation } from "../shared/session-location";
import { HERMES_HOME } from "./installer";
import { safeWriteFile } from "./utils";

interface SessionLocationData {
  version: 1;
  sessions: SessionLocation[];
}

function storePath(): string {
  return join(HERMES_HOME, "desktop", "session-locations.json");
}

function isSessionLocation(value: unknown): value is SessionLocation {
  if (!value || typeof value !== "object") return false;
  const location = value as Partial<SessionLocation>;
  return (
    typeof location.connectionId === "string" &&
    location.connectionId.trim().length > 0 &&
    typeof location.profile === "string" &&
    location.profile.trim().length > 0 &&
    typeof location.sessionId === "string" &&
    location.sessionId.trim().length > 0
  );
}

function readStore(): SessionLocationData {
  try {
    const file = storePath();
    if (!existsSync(file)) return { version: 1, sessions: [] };
    const parsed = JSON.parse(
      readFileSync(file, "utf-8"),
    ) as Partial<SessionLocationData>;
    return {
      version: 1,
      sessions: Array.isArray(parsed.sessions)
        ? parsed.sessions.filter(isSessionLocation)
        : [],
    };
  } catch {
    return { version: 1, sessions: [] };
  }
}

// @lat: [[connections#Session locations#Desktop metadata]]
export function recordSessionLocation(value: unknown): boolean {
  if (!isSessionLocation(value)) return false;
  const location = {
    connectionId: value.connectionId.trim(),
    profile: value.profile.trim(),
    sessionId: value.sessionId.trim(),
  };
  const data = readStore();
  if (
    data.sessions.some(
      (item) =>
        item.connectionId === location.connectionId &&
        item.profile === location.profile &&
        item.sessionId === location.sessionId,
    )
  ) {
    return true;
  }
  data.sessions.push(location);
  safeWriteFile(storePath(), JSON.stringify(data));
  return true;
}

export function getSessionLocations(sessionId: string): SessionLocation[] {
  if (!sessionId.trim()) return [];
  return readStore().sessions.filter((item) => item.sessionId === sessionId);
}
