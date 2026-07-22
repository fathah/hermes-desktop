/**
 * Session title policy shared by main (state.db writes) and the renderer
 * (optimistic UI). Mirrors Hermes Agent: unique non-NULL titles, 100-char
 * max, whitespace collapsed.
 */

/** Hermes Agent caps session titles at 100 characters (schema + CLI). */
export const MAX_SESSION_TITLE_LENGTH = 100;

/** Trim and collapse internal whitespace so UI and DB agree on the title. */
export function normalizeSessionTitle(title: string): string {
  return title.trim().replace(/\s+/g, " ");
}

export type SessionTitleValidationError = "empty" | "too_long";

/**
 * Validate an already-normalized title. Returns an error code, or null when
 * the title is acceptable for a durable write.
 */
export function validateNormalizedSessionTitle(
  title: string,
): SessionTitleValidationError | null {
  if (!title) return "empty";
  if (title.length > MAX_SESSION_TITLE_LENGTH) return "too_long";
  return null;
}

/** True when a SQLite error is the sessions.title UNIQUE constraint. */
export function isSessionTitleUniqueViolation(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? "");
  if (/UNIQUE constraint failed:\s*sessions\.title/i.test(message)) {
    return true;
  }
  if (!err || typeof err !== "object") return false;
  const code = "code" in err ? String((err as { code: unknown }).code) : "";
  // better-sqlite3: SQLITE_CONSTRAINT_UNIQUE; message usually names the column.
  return code === "SQLITE_CONSTRAINT_UNIQUE" && /title/i.test(message);
}
