// Pin the bootstrap script to reviewed upstream bytes. Agent/dependency updates
// performed by that script retain their own upstream update behavior.
export const PINNED_INSTALL_COMMIT = "503d863fcd2cbfc0be5a6d6c536fae2e98aa4204";
export const PINNED_INSTALL_SHA256 =
  "0582d9b1562efcb6e0ac62f4451021667830b830a72ce7d91eaea9fee8b6c09b";
export const INSTALLER_VERIFICATION_FAILED = 87;

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function verifiedInstallerCommand(
  url = `https://raw.githubusercontent.com/NousResearch/hermes-agent/${PINNED_INSTALL_COMMIT}/scripts/install.sh`,
  sha256 = PINNED_INSTALL_SHA256,
): string {
  if (!/^[a-f0-9]{64}$/.test(sha256))
    throw new Error("Invalid installer SHA-256");
  return [
    "set -eo pipefail",
    `installer_tmp="$(mktemp)" || exit ${INSTALLER_VERIFICATION_FAILED}`,
    `trap 'rm -f "$installer_tmp"' EXIT`,
    `curl -fsSL -o "$installer_tmp" -- ${shellQuote(url)} || exit ${INSTALLER_VERIFICATION_FAILED}`,
    `installer_actual="$( (sha256sum "$installer_tmp" 2>/dev/null || shasum -a 256 "$installer_tmp") | awk '{print $1}' )" || exit ${INSTALLER_VERIFICATION_FAILED}`,
    `if [ "$installer_actual" != "${sha256}" ]; then echo "Hermes installer checksum mismatch; refusing to execute." >&2; exit ${INSTALLER_VERIFICATION_FAILED}; fi`,
    'bash "$installer_tmp" --skip-setup',
  ].join("\n");
}
