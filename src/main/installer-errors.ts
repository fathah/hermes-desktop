/** Recovery guidance follows the installer platform without guessing a cause. */
export function buildInstallErrorMessage(
  exitCode: number | null,
  platform: NodeJS.Platform = process.platform,
): string {
  const status =
    exitCode === null ? "was interrupted" : `failed (exit code ${exitCode})`;
  const shell = platform === "win32" ? "PowerShell" : "a terminal";
  return `Installation ${status}.\n\nCheck the installation log above for the command that failed. Verify your network connection and write access to the installation directory, then retry.\n\nFor manual installation, open ${shell} and follow the platform instructions at https://github.com/NousResearch/hermes-agent#installation.\n\nKeep existing Hermes configuration and conversation data when troubleshooting.`;
}
