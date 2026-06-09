// ingestPrefs.ts — local preferences for the second-brain ingest loop.
//
// Persisted to localStorage (like storageMode). Two knobs:
//   • auto-apply — "Process inbox" commits the agent's changeset immediately,
//     skipping the manual review queue (full audit/undo still apply: pages go
//     to the Wiki folder and trash; memory entries to the Memory tab).
//   • interval  — minutes between automatic in-app ingest runs (0 = off). The
//     app must be open; truly headless scheduling needs the (deferred) direct-
//     write agent mode, since cron runs outside the desktop process.
const AUTO_APPLY_KEY = "sps-ingest-autoapply-v1";
const INTERVAL_KEY = "sps-ingest-interval-min-v1";

/** Fired when a pref changes so App.tsx can reconfigure the scheduler live. */
export const INGEST_PREFS_EVENT = "sps:ingest-prefs-changed";

export function getAutoApply(): boolean {
  try {
    return localStorage.getItem(AUTO_APPLY_KEY) === "1";
  } catch {
    return false;
  }
}

export function setAutoApply(on: boolean): void {
  try {
    localStorage.setItem(AUTO_APPLY_KEY, on ? "1" : "0");
    window.dispatchEvent(new Event(INGEST_PREFS_EVENT));
  } catch {
    /* ignore */
  }
}

/** Auto-ingest interval in minutes (0 = disabled). */
export function getIngestIntervalMin(): number {
  try {
    const raw = Number(localStorage.getItem(INTERVAL_KEY));
    return Number.isFinite(raw) && raw > 0 ? raw : 0;
  } catch {
    return 0;
  }
}

export function setIngestIntervalMin(min: number): void {
  try {
    localStorage.setItem(INTERVAL_KEY, String(min > 0 ? min : 0));
    window.dispatchEvent(new Event(INGEST_PREFS_EVENT));
  } catch {
    /* ignore */
  }
}

// Opt-in scheduled deep-lint (Karpathy's periodic "Lint"). Notify-only: a
// background pass NEVER auto-edits existing pages (propose-then-commit). It just
// flashes when it finds semantic issues, nudging the user to open Vault health.
const LINT_INTERVAL_KEY = "sps-lint-interval-min-v1";

/** Auto deep-lint interval in minutes (0 = disabled). */
export function getLintIntervalMin(): number {
  try {
    const raw = Number(localStorage.getItem(LINT_INTERVAL_KEY));
    return Number.isFinite(raw) && raw > 0 ? raw : 0;
  } catch {
    return 0;
  }
}

export function setLintIntervalMin(min: number): void {
  try {
    localStorage.setItem(LINT_INTERVAL_KEY, String(min > 0 ? min : 0));
    window.dispatchEvent(new Event(INGEST_PREFS_EVENT));
  } catch {
    /* ignore */
  }
}
