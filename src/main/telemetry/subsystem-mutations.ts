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
// Tonight-only strict allowlist for write-targets
// ---------------------------------------------------------------------------
//
// Plan v10 / PR-4 Mira-Migration: until backend stale-write
// protection (Open Question #3 — If-Match / 409) AND the SOUL /
// memory structural sanitiser (Open Question #1 / #4) land, the
// desktop's write surface is RESTRICTED to a disposable test
// profile. Any other value — undefined, empty, whitespace,
// "default", "current", or any real named profile — is refused
// at the adapter layer BEFORE an HTTP PUT fires.
//
// The renderer's UI also disables the write buttons unless the
// app-selected profile is "mira-uitest" — but the UI guard is
// not enough on its own (a malicious renderer state could still
// fire the IPC). This adapter is the second line of defence.
//
// To lift the restriction: replace the strict equality with a
// less-restrictive guard (e.g. `if (p === "default" && !haveIfMatch) reject`)
// once the backend gates are in place, then update the test list
// accordingly.

const TONIGHT_ONLY_PROFILE = "mira-uitest";

const REJECT_MESSAGE =
  "writes blocked tonight: only the 'mira-uitest' disposable " +
  "profile is approved. Real profiles ('default', 'mira', etc.) " +
  "need backend stale-write protection + memory/SOUL sanitiser " +
  "to land first.";

function _validateProfile(
  profile?: string,
): MutationResult<never> | null {
  const p = (profile || "").trim().toLowerCase();
  if (p !== TONIGHT_ONLY_PROFILE) {
    return { ok: false, status: 0, error: REJECT_MESSAGE };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Memory — /api/memory/entries + /api/memory/user
// ---------------------------------------------------------------------------

function _memoryQs(profile?: string): string {
  // profile is already validated by the caller — this just
  // builds the URL param. We pass through verbatim so the
  // backend resolves it (case-insensitively normalised
  // server-side via normalize_profile_name).
  return `?profile=${encodeURIComponent((profile || "").trim())}`;
}

export async function addMemoryEntry(
  content: string,
  profile?: string,
): Promise<MutationResult<unknown>> {
  const reject = _validateProfile(profile);
  if (reject) return reject;
  if (!content || !content.trim()) {
    return { ok: false, status: 400, error: "Memory entry must not be empty" };
  }
  return telemetryRequest(
    "POST",
    `/api/memory/entries${_memoryQs(profile)}`,
    { content },
  );
}

export async function updateMemoryEntry(
  index: number,
  content: string,
  profile?: string,
): Promise<MutationResult<unknown>> {
  const reject = _validateProfile(profile);
  if (reject) return reject;
  if (!Number.isInteger(index) || index < 0) {
    return { ok: false, status: 400, error: "Index must be a non-negative integer" };
  }
  if (!content || !content.trim()) {
    return { ok: false, status: 400, error: "Memory entry must not be empty" };
  }
  return telemetryRequest(
    "PUT",
    `/api/memory/entries/${encodeURIComponent(String(index))}${_memoryQs(profile)}`,
    { content },
  );
}

export async function deleteMemoryEntry(
  index: number,
  profile?: string,
): Promise<MutationResult<unknown>> {
  const reject = _validateProfile(profile);
  if (reject) return reject;
  if (!Number.isInteger(index) || index < 0) {
    return { ok: false, status: 400, error: "Index must be a non-negative integer" };
  }
  return telemetryRequest(
    "DELETE",
    `/api/memory/entries/${encodeURIComponent(String(index))}${_memoryQs(profile)}`,
  );
}

export async function writeUserProfile(
  content: string,
  profile?: string,
): Promise<MutationResult<unknown>> {
  const reject = _validateProfile(profile);
  if (reject) return reject;
  // Empty content is a valid clear of USER.md; allow it but
  // require an explicit string (not undefined). The UI-side
  // EditUserProfileDialog adds a destructive confirmation
  // before submitting an empty payload.
  if (typeof content !== "string") {
    return { ok: false, status: 400, error: "Content must be a string" };
  }
  return telemetryRequest(
    "PUT",
    `/api/memory/user${_memoryQs(profile)}`,
    { content },
  );
}

// ---------------------------------------------------------------------------
// Soul / Persona — /api/profiles/{name}/soul
// ---------------------------------------------------------------------------

export async function writeSoul(
  profileName: string,
  content: string,
): Promise<MutationResult<unknown>> {
  // Soul uses the profileName positional arg as its allowlist
  // target — same guard as memory, just on a different argument.
  const reject = _validateProfile(profileName);
  if (reject) return reject;
  if (typeof content !== "string") {
    return { ok: false, status: 400, error: "Soul content must be a string" };
  }
  return telemetryRequest(
    "PUT",
    `/api/profiles/${encodeURIComponent(profileName.trim())}/soul`,
    { content },
  );
}

export async function resetSoul(
  profileName: string,
): Promise<MutationResult<unknown>> {
  const reject = _validateProfile(profileName);
  if (reject) return reject;
  return telemetryRequest(
    "POST",
    `/api/profiles/${encodeURIComponent(profileName.trim())}/soul/reset`,
  );
}

// ---------------------------------------------------------------------------
// Toolset toggle — /api/tools/toolsets/{key}
//
// Option A scope: NO profile parameter. The backend
// (/api/tools/toolsets) doesn't read ?profile= — it operates
// on its own active profile via load_config(). We send only
// ?platform=api_server so the wire is unambiguous (instead of
// relying on the backend default).
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
    `/api/tools/toolsets/${encodeURIComponent(key)}?platform=api_server`,
    { enabled: Boolean(enabled) },
  );
}
