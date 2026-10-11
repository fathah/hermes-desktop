import { createHmac, randomBytes } from "node:crypto";
import type { ConnectionConfig } from "./config";

// An opaque process-local revision fences edits without exposing a credential
// fingerprint that a renderer could test against guessed low-entropy secrets.
const revisionSecret = randomBytes(32);
const authRevisions = new Map<string, number>();
const authChanges = new Map<string, number>();
function origin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

export function providerTargetRevision(connection: ConnectionConfig): string {
  const owner = origin(connection.remoteUrl);
  if (connection.mode === "remote" && (authChanges.get(owner) || 0) > 0) {
    throw new Error(
      "Remote sign-in is changing; wait for it to finish, then reload.",
    );
  }
  return createHmac("sha256", revisionSecret)
    .update(JSON.stringify([connection, authRevisions.get(owner) || 0]))
    .digest("hex");
}

export function beginProviderAuthChange(url: string): void {
  const owner = origin(url);
  authChanges.set(owner, (authChanges.get(owner) || 0) + 1);
  authRevisions.set(owner, (authRevisions.get(owner) || 0) + 1);
}

export function finishProviderAuthChange(url: string): void {
  const owner = origin(url);
  const remaining = Math.max(0, (authChanges.get(owner) || 0) - 1);
  if (remaining) authChanges.set(owner, remaining);
  else authChanges.delete(owner);
  authRevisions.set(owner, (authRevisions.get(owner) || 0) + 1);
}
