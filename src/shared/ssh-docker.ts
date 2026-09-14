// Docker-backed SSH target types (issue #432), shared by the main-process
// inspection/provisioning in src/main/ssh-docker.ts, the preload bridge, and
// the renderer target-selection UI.

export interface SshHermesDockerContainer {
  id: string;
  name: string;
  image: string;
  ports: string;
  /** Host path mounted at /opt/data, "" when the container has no data mount. */
  dataHome: string;
  /** True when the container publishes the configured remote API port. */
  matchesRemotePort: boolean;
}

export interface SshHermesTargetInspection {
  /** A host-level CLI install plus a real ~/.hermes were found. */
  hostInstallFound: boolean;
  /** State of ~/.hermes on the host: missing | directory | symlink. */
  hermesHomeState: "missing" | "directory" | "symlink";
  /**
   * True when hermesHomeState is "directory" and the directory is empty —
   * setup can replace it with the data-volume symlink, so it is not a
   * conflict.
   */
  hermesHomeEmpty: boolean;
  /** Symlink target when hermesHomeState is "symlink". */
  hermesHomeTarget: string | null;
  /** Desktop-managed docker hook, some other executable, or none. */
  launcherState: "missing" | "docker" | "custom";
  /** Container the managed hook routes to (launcherState "docker"). */
  launcherContainerName: string | null;
  dockerAvailable: boolean;
  dockerContainers: SshHermesDockerContainer[];
  selectedDockerContainerName: string;
  error?: string;
}

export interface SshDockerProvisionResult {
  ok: boolean;
  containerName: string;
  /** Host path of the container's /opt/data mount. */
  dataHome: string;
  /** `docker exec` user flag baked into the hook ("" = container default). */
  execUser: string;
  /** Hermes CLI path inside the container. */
  cliPath: string;
  /** `hermes --version` output through the provisioned launcher. */
  version: string;
  warnings: string[];
  error?: string;
}
