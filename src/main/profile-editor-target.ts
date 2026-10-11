import { createHmac, randomBytes } from "node:crypto";
import {
  getActiveConnection,
  getConnectionConfig,
  type ConnectionConfig,
} from "./config";
import { providerTargetRevision } from "./provider-request-target";
import { getActiveProfileNameSync } from "./utils";
import type { ProfileEditorTarget } from "../shared/profile-editor-target";

const tokenKey = randomBytes(32);

function scopeToken(
  connectionId: string,
  profile: string,
  connection: ConnectionConfig,
): string {
  return createHmac("sha256", tokenKey)
    .update(
      JSON.stringify({
        connectionId,
        profile,
        revision: providerTargetRevision(connection),
      }),
    )
    .digest("hex");
}

export function captureProfileEditorTarget(
  profile?: string,
  connectionId?: string,
): ProfileEditorTarget {
  const active = getActiveConnection();
  if (connectionId && connectionId !== active.connectionId)
    throw new Error("The editor connection is no longer selected.");
  const connection = getConnectionConfig(active.connectionId);
  const selectedProfile =
    profile?.trim() ||
    (connection.mode === "remote" ? "default" : getActiveProfileNameSync());
  return {
    connectionId: active.connectionId,
    profile: selectedProfile,
    mode: connection.mode,
    scopeToken: scopeToken(active.connectionId, selectedProfile, connection),
  };
}

// @lat: [[profile-editors#Profile editors#Captured request target]]
export function resolveProfileEditorTarget(
  profile?: string,
  target?: ProfileEditorTarget,
): { connection: ConnectionConfig; profile?: string } {
  if (!target)
    return { connection: structuredClone(getConnectionConfig()), profile };
  if (
    typeof target.connectionId !== "string" ||
    typeof target.profile !== "string" ||
    !target.profile ||
    typeof target.scopeToken !== "string"
  )
    throw new Error("Invalid editor target.");
  const active = getActiveConnection();
  if (
    target.connectionId !== active.connectionId ||
    (profile !== undefined && (profile.trim() || "default") !== target.profile)
  )
    throw new Error("The editor target changed; reload before editing.");
  const connection = structuredClone(getConnectionConfig(target.connectionId));
  if (
    target.mode !== connection.mode ||
    target.scopeToken !==
      scopeToken(target.connectionId, target.profile, connection)
  )
    throw new Error("The editor configuration changed; reload before editing.");
  return { connection, profile: target.profile };
}
