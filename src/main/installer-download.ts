// Reviewed Hermes Agent v0.23.1: pin both bootstrap bytes and the fresh-install
// Agent baseline. Existing newer installs retain upstream's rollback guard.
// @lat: [[installer-runtime#Reviewed installation baseline]]
export const PINNED_INSTALL_COMMIT = "3b421578588243f920886e6fe79a6faa87ea026e";
export const PINNED_INSTALL_SHA256 =
  "abf338605dae6dd28d101673ac6aed7995c955745db46d47676bc591a7957209";
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
    `bash "$installer_tmp" --skip-setup --commit ${PINNED_INSTALL_COMMIT}`,
  ].join("\n");
}
