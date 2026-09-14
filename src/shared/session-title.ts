/**
 * Session title policy shared by main (state.db writes) and the renderer
 * (optimistic UI). Mirrors Hermes Agent: unique non-NULL titles, 100-char
 * max, whitespace collapsed.
 */

/** Hermes Agent caps session titles at 100 characters (schema + CLI). */
export const MAX_SESSION_TITLE_LENGTH = 100;

/** Trim and collapse internal whitespace so UI and DB agree on the title. */
export function normalizeSessionTitle(title: string): string {
  return Array.from(title)
    .map((character) => {
      const point = character.codePointAt(0)!;
      if (point >= 0xd800 && point <= 0xdfff) return "\ufffd";
      return point === 0x85 ? " " : character;
    })
    .filter((character) => {
      const point = character.codePointAt(0)!;
      return !(
        (point < 32 && ![9, 10, 13].includes(point)) ||
        point === 127 ||
        (point >= 0x200b && point <= 0x200f) ||
        (point >= 0x2028 && point <= 0x202e) ||
        (point >= 0x2060 && point <= 0x2069) ||
        point === 0xfeff ||
        (point >= 0xfff9 && point <= 0xfffc)
      );
    })
    .join("")
    .trim()
    .replace(/\s+/g, " ");
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
  if (Array.from(title).length > MAX_SESSION_TITLE_LENGTH) return "too_long";
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
