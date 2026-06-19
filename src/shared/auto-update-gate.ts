/**
 * Single source of truth for the auto-updater opt-out decision.
 *
 * Used in two places that previously each maintained their own copy of the
 * `=== "false" || === "0"` normalization (a sibling-asymmetry drift risk —
 * if one side changed its accepted values the UI and the updater would
 * silently disagree):
 *   - Main process: the gate in setupUpdater() (via config.ts re-export)
 *   - Renderer: the "Automatic updates" toggle in Settings.tsx
 *
 * Contract (MUST hold for the community): auto-update is ENABLED BY DEFAULT.
 * Only an explicit falsey config value (`desktop.auto_update: false`, also
 * accepts "0") disables it. A null/unset/empty/whitespace/garbage setting —
 * the upstream default — keeps auto-update ON, so behavior is unchanged for
 * anyone who never sets the key. A typo in config.yaml must NEVER silently
 * disable updates for a community user; the gate fails safe to upstream-ON.
 *
 * The opt-out exists only so a user running a locally-built or patched /opt
 * artifact can stop electron-updater from re-downloading the public release
 * and overwriting their build on quit (autoInstallOnAppQuit).
 *
 * Input is the RAW config value (string | null, as getConfigValue returns, or
 * the unknown the renderer's getConfig yields). Normalization (coerce to
 * string, trim, lowercase) happens here so both callers stay thin and agree.
 */
export function isAutoUpdateDisabled(rawSetting: unknown): boolean {
  const v = (rawSetting == null ? "" : String(rawSetting)).trim().toLowerCase();
  return v === "false" || v === "0";
}
