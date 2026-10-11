import { listMcpServers } from "./mcp-servers";
import { remoteListInstalledSkills } from "./remote-skills";
import type { InstallResult } from "./registry";

// Remote (HTTP) mode for Discover. The community catalog itself is fetched from
// the public registry repo, so browsing works in any connection mode. What does
// NOT work remotely is installing: registry installs unpack files into the
// LOCAL profile directory, which would install onto this machine while the
// user is looking at a remote server. So in remote mode Discover is
// browse-only, and "installed" reflects what the SERVER has.

export const REMOTE_INSTALL_UNSUPPORTED_ERROR =
  "Installing from Discover is not available in remote mode yet. Install on the server (e.g. `hermes skills install <id>`), or use the Skills / Tools screens.";

export async function remoteListInstalledRegistry(
  profile?: string,
): Promise<{ skills: string[]; mcps: string[]; workflows: string[] }> {
  const [skills, mcps] = await Promise.all([
    remoteListInstalledSkills(profile)
      .then((list) => list.map((s) => s.name))
      .catch(() => [] as string[]),
    listMcpServers(profile)
      .then((list) => list.map((s) => s.name))
      .catch(() => [] as string[]),
  ]);
  return { skills, mcps, workflows: [] };
}

export function remoteInstallRegistryItem(): InstallResult {
  return { success: false, error: REMOTE_INSTALL_UNSUPPORTED_ERROR };
}
