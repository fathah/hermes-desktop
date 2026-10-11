/** Keep POSIX fragments out of the SSH account's login-shell parser. */
export function buildSshRemoteCommand(command: string): string {
  // Fish interprets \\ and \' even inside single quotes, unlike POSIX shells.
  // Escape both characters outside the quoted spans so either parser forwards
  // exactly the same bytes. Leave stdin free for Python scripts and file data.
  const quoted = `'${command.replace(/['\\]/g, (character) => `'\\${character}'`)}'`;
  return `exec /bin/sh -c ${quoted}`;
}
