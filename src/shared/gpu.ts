/** User-facing hardware-acceleration preference. "auto" = crash-guard driven
 *  (default), "on"/"off" = explicit user choice from Settings → Appearance. */
export type GpuPreferenceMode = "auto" | "on" | "off";

/** Why hardware acceleration is currently off, surfaced to the renderer so the
 *  Office tab can explain SwiftShader slowness instead of failing silently. */
export interface GpuStatus {
  disabled: boolean;
  /** "env" = HERMES_DISABLE_GPU=1, "preference" = user chose "off" in
   *  Settings, "sentinel" = relaunched after a crash this session, "flag" =
   *  persisted crash flag from an earlier launch. */
  reason: "env" | "preference" | "sentinel" | "flag" | null;
  /** ISO timestamp from the flag file when reason is "flag". */
  flagWrittenAt: string | null;
  /** False when the env var or the user's own Settings choice forces GPU off —
   *  the Office banner's one-click re-enable only applies to crash fallbacks. */
  canReenable: boolean;
  /** The persisted Settings preference, independent of what disabled the GPU
   *  this session (a changed preference applies on next launch). */
  preference: GpuPreferenceMode;
  /** The preference this process actually launched with. When it differs from
   *  `preference`, a restart is pending — the Settings pane shows the prompt
   *  even after being closed and reopened. */
  bootPreference: GpuPreferenceMode;
}
