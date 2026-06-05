// grounding.ts — KB Phase 1: whether chat answers are grounded in the workspace.
// When on, the main process runs the SPS vault index over the message and
// injects the top sources as context (local mode only; main ignores the flag
// when remote). Persisted to localStorage like the other chat UI settings.
// Default ON so a freshly-ingested knowledgebase is used without extra steps.
const KEY = "hermes-ground-in-workspace-v1";

export function getGroundInWorkspace(): boolean {
  try {
    // Absent ⇒ default true; only an explicit "false" disables it.
    return localStorage.getItem(KEY) !== "false";
  } catch {
    return true;
  }
}

export function setGroundInWorkspace(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "true" : "false");
  } catch {
    /* ignore */
  }
}
