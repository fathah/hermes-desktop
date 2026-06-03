// persistence.ts — workspace persistence through the Electron main process
// (durable JSON under the active profile's home dir). Replaces the standalone
// localStorage adapter. Load is async (IPC); the store hydrates after mount.
import type { Workspace } from "../types";

export async function loadWorkspace(): Promise<Workspace | null> {
  try {
    const data = await window.hermesAPI.spsLoad();
    return (data as Workspace | null) ?? null;
  } catch {
    return null;
  }
}

export function saveWorkspace(ws: Workspace): void {
  try {
    void window.hermesAPI.spsSave(ws);
  } catch {
    /* main unavailable — fail silent */
  }
}

export function clearWorkspace(): void {
  try {
    void window.hermesAPI.spsSave(null);
  } catch {
    /* ignore */
  }
}
