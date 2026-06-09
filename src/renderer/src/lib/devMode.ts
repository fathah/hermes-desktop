// devMode.ts — "Developer mode" preference. When on, the Chat header exposes the
// niche power-user controls (worktree panel + filesystem checkpoints). DEFAULT
// OFF so a normal user gets a clean chat; tool-use itself is always available
// (gateway-driven) — this flag only affects which CONTROLS are shown, not what
// the agent can do.
//
// Persisted to localStorage (purely local, works offline — not a gateway config).
// Mirrors lib/grounding.ts, but default-false and with a change event because two
// components (the Settings toggle and the Chat header) must stay in sync live.
const KEY = "hermes-developer-mode-v1";

export const DEV_MODE_EVENT = "hermes:devmode-changed";

export function getDevMode(): boolean {
  try {
    // Absent ⇒ default false; only an explicit "true" enables it.
    return localStorage.getItem(KEY) === "true";
  } catch {
    return false;
  }
}

export function setDevMode(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "true" : "false");
  } catch {
    /* ignore — persistence is best-effort */
  }
  window.dispatchEvent(new Event(DEV_MODE_EVENT));
}
