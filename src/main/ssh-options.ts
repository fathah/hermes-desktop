export interface SshControlOptions {
  // Long-running tunnel processes (ssh -N -L) must keep the spawned ssh
  // process in the foreground so tunnelProcess lifecycle tracking works.
  // ControlPersist forks a background master and exits the foreground
  // process, which breaks lifecycle tracking on Linux and macOS (#195, #159).
  forTunnel?: boolean;
}

export function buildSshControlOptions(
  platform = process.platform,
  options: SshControlOptions = {},
): string[] {
  if (platform === "win32" || options.forTunnel) {
    return [
      "-o",
      "ControlMaster=no",
      "-o",
      "ControlPath=none",
      "-o",
      "ControlPersist=no",
    ];
  }

  return [
    "-o",
    "ControlMaster=auto",
    "-o",
    "ControlPath=~/.ssh/cm-hermes-%r@%h:%p",
    "-o",
    "ControlPersist=60s",
  ];
}
