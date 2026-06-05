// grounding.ts — whether assistant answers are grounded in the workspace vault.
// When on, the main process runs the SPS vault index over the message and
// injects the top sources as context (local mode only; main ignores the flag
// when remote). Persisted to localStorage. Default ON so a freshly-ingested
// knowledgebase is used without extra steps.
//
// Shared renderer module: read by BOTH the Chat header (ChatHeader) and the SPS
// co-author panel (AgentBody) so the single grounding preference has one home.
// (Previously lived under screens/Chat/lib, which made SPS — the product —
// import from Chat — the legacy screen; this is the corrected location.)
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
