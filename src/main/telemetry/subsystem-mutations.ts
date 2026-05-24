/**
 * Write-side counterparts to ``subsystems.ts``.
 *
 * One function per Codex mutation endpoint we need:
 *
 *   POST   /api/memory/entries           → addMemoryEntry
 *   PUT    /api/memory/entries/{index}   → updateMemoryEntry
 *   DELETE /api/memory/entries/{index}   → deleteMemoryEntry
 *   PUT    /api/memory/user              → writeUserProfile
 *   PUT    /api/profiles/{name}/soul     → writeSoul
 *   POST   /api/profiles/{name}/soul/reset → resetSoul
 *   PUT    /api/tools/toolsets/{key}     → setToolset
 *
 * All functions return ``MutationResult<T>``. The caller (IPC
 * handler) passes it through to the renderer as-is, which then
 * branches on ``ok``. No exceptions cross the IPC bridge.
 */

import { telemetryRequest } from "./mutations";
import type { MutationResult } from "./mutations";

// ---------------------------------------------------------------------------
// Memory — /api/memory/entries + /api/memory/user
// ---------------------------------------------------------------------------

export async function addMemoryEntry(
  content: string,
): Promise<MutationResult<unknown>> {
  if (!content || !content.trim()) {
    return { ok: false, status: 400, error: "Memory entry must not be empty" };
  }
  return telemetryRequest("POST", "/api/memory/entries", { content });
}

export async function updateMemoryEntry(
  index: number,
  content: string,
): Promise<MutationResult<unknown>> {
  if (!Number.isInteger(index) || index < 0) {
    return { ok: false, status: 400, error: "Index must be a non-negative integer" };
  }
  if (!content || !content.trim()) {
    return { ok: false, status: 400, error: "Memory entry must not be empty" };
  }
  return telemetryRequest(
    "PUT",
    `/api/memory/entries/${encodeURIComponent(String(index))}`,
    { content },
  );
}

export async function deleteMemoryEntry(
  index: number,
): Promise<MutationResult<unknown>> {
  if (!Number.isInteger(index) || index < 0) {
    return { ok: false, status: 400, error: "Index must be a non-negative integer" };
  }
  return telemetryRequest(
    "DELETE",
    `/api/memory/entries/${encodeURIComponent(String(index))}`,
  );
}

export async function writeUserProfile(
  content: string,
): Promise<MutationResult<unknown>> {
  // Empty content is a valid clear of USER.md; allow it but
  // require an explicit string (not undefined).
  if (typeof content !== "string") {
    return { ok: false, status: 400, error: "Content must be a string" };
  }
  return telemetryRequest("PUT", "/api/memory/user", { content });
}

// ---------------------------------------------------------------------------
// Soul / Persona — /api/profiles/{name}/soul
// ---------------------------------------------------------------------------

export async function writeSoul(
  profileName: string,
  content: string,
): Promise<MutationResult<unknown>> {
  if (!profileName) {
    return { ok: false, status: 400, error: "Profile name is required" };
  }
  if (typeof content !== "string") {
    return { ok: false, status: 400, error: "Soul content must be a string" };
  }
  return telemetryRequest(
    "PUT",
    `/api/profiles/${encodeURIComponent(profileName)}/soul`,
    { content },
  );
}

export async function resetSoul(
  profileName: string,
): Promise<MutationResult<unknown>> {
  if (!profileName) {
    return { ok: false, status: 400, error: "Profile name is required" };
  }
  return telemetryRequest(
    "POST",
    `/api/profiles/${encodeURIComponent(profileName)}/soul/reset`,
  );
}

// ---------------------------------------------------------------------------
// Toolset toggle — /api/tools/toolsets/{key}
// ---------------------------------------------------------------------------

export async function setToolset(
  key: string,
  enabled: boolean,
): Promise<MutationResult<unknown>> {
  if (!key) {
    return { ok: false, status: 400, error: "Toolset key is required" };
  }
  return telemetryRequest(
    "PUT",
    `/api/tools/toolsets/${encodeURIComponent(key)}`,
    { enabled: Boolean(enabled) },
  );
}
