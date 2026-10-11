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
  const file = storePath();
  if (!existsSync(file)) return { version: 1, sessions: [] };
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf-8"));
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      (parsed as Partial<SessionLocationData>).version !== 1 ||
      !Array.isArray((parsed as Partial<SessionLocationData>).sessions) ||
      !(parsed as SessionLocationData).sessions.every(isSessionLocation)
    ) {
      throw new Error("invalid store");
    }
    return parsed as SessionLocationData;
  } catch {
    throw new Error(
      "Hermes Desktop could not read session-locations.json; the existing file was left unchanged.",
    );
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
