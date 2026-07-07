// ingestPrefs.ts — preferences for the second-brain ingest loop.
//
// Cached in localStorage for synchronous first paint, then mirrored into
// desktop.json so the main scheduler can honor the same settings app-open or
// app-closed. Two knobs:
//   • auto-apply — "Process inbox" commits the agent's changeset immediately,
//     skipping the manual review queue (full audit/undo still apply: pages go
//     to the Wiki folder and trash; memory entries to the Memory tab).
//   • interval  — minutes between automatic scheduler runs (0 = off).
import type {
  SpsAutomationPrefs,
  SpsAutomationPrefsPatch,
} from "../../../../../shared/sps-automation";

const AUTO_APPLY_KEY = "sps-ingest-autoapply-v1";
const INTERVAL_KEY = "sps-ingest-interval-min-v1";
const LINT_INTERVAL_KEY = "sps-lint-interval-min-v1";

/** Fired when a pref changes so mounted controls can refresh live if needed. */
export const INGEST_PREFS_EVENT = "sps:ingest-prefs-changed";

function readInterval(key: string): number {
  try {
    const raw = Number(localStorage.getItem(key));
    return Number.isFinite(raw) && raw > 0 ? raw : 0;
  } catch {
    return 0;
  }
}

function writeInterval(key: string, min: number): void {
  try {
    localStorage.setItem(key, String(min > 0 ? min : 0));
  } catch {
    /* ignore */
  }
}

function currentLocalPrefs(): SpsAutomationPrefs {
  return {
    autoApply: getAutoApply(),
    ingestIntervalMin: getIngestIntervalMin(),
    lintIntervalMin: getLintIntervalMin(),
  };
}

function cachePrefs(prefs: SpsAutomationPrefs): void {
  try {
    localStorage.setItem(AUTO_APPLY_KEY, prefs.autoApply ? "1" : "0");
  } catch {
    /* ignore */
  }
  writeInterval(INTERVAL_KEY, prefs.ingestIntervalMin);
  writeInterval(LINT_INTERVAL_KEY, prefs.lintIntervalMin);
}

function dispatchPrefsChanged(): void {
  try {
    window.dispatchEvent(new Event(INGEST_PREFS_EVENT));
  } catch {
    /* ignore */
  }
}

function syncMainPrefs(patch: SpsAutomationPrefsPatch, profile?: string): void {
  void window.hermesAPI?.setSpsAutomationPrefs?.(patch, profile).catch(() => {
    /* scheduler picks up the local cache after the next successful write */
  });
}

export async function refreshSpsAutomationPrefs(
  profile?: string,
): Promise<SpsAutomationPrefs> {
  const prefs = await window.hermesAPI?.getSpsAutomationPrefs?.(profile);
  if (!prefs) return currentLocalPrefs();
  cachePrefs(prefs);
  dispatchPrefsChanged();
  return prefs;
}

export function getAutoApply(): boolean {
  try {
    return localStorage.getItem(AUTO_APPLY_KEY) === "1";
  } catch {
    return false;
  }
}

export function setAutoApply(on: boolean, profile?: string): void {
  try {
    localStorage.setItem(AUTO_APPLY_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
  syncMainPrefs({ autoApply: on }, profile);
  dispatchPrefsChanged();
}

/** Auto-ingest interval in minutes (0 = disabled). */
export function getIngestIntervalMin(): number {
  return readInterval(INTERVAL_KEY);
}

export function setIngestIntervalMin(min: number, profile?: string): void {
  writeInterval(INTERVAL_KEY, min);
  syncMainPrefs({ ingestIntervalMin: min > 0 ? min : 0 }, profile);
  dispatchPrefsChanged();
}

// Opt-in scheduled deep-lint (Karpathy's periodic "Lint"). Notify-only: a
// background pass NEVER auto-edits existing pages (propose-then-commit). It just
// flashes when it finds semantic issues, nudging the user to open Vault health.

/** Auto deep-lint interval in minutes (0 = disabled). */
export function getLintIntervalMin(): number {
  return readInterval(LINT_INTERVAL_KEY);
}

export function setLintIntervalMin(min: number, profile?: string): void {
  writeInterval(LINT_INTERVAL_KEY, min);
  syncMainPrefs({ lintIntervalMin: min > 0 ? min : 0 }, profile);
  dispatchPrefsChanged();
}
