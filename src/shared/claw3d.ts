// Shared Claw3D status IPC type — single source of truth for the 3D-workspace
// status. Producer: src/main/claw3d.ts. Contract: src/preload/index.d.ts.

export interface Claw3dStatus {
  cloned: boolean;
  installed: boolean;
  devServerRunning: boolean;
  adapterRunning: boolean;
  running: boolean; // true when both dev + adapter are up
  port: number;
  portInUse: boolean;
  wsUrl: string;
  error: string; // last error from either process
  // Populated in SSH tunnel mode when a Claw3D / hermes-office service is
  // running on the remote host. Renderer should prefer this over launching
  // a local dev server. Null/undefined when not in SSH mode or when the
  // remote service is unreachable.
  remoteUrl?: string | null;
  remoteSource?: "ssh" | null;
}
