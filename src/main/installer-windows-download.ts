import {
  PINNED_INSTALL_COMMIT,
  INSTALLER_VERIFICATION_FAILED,
} from "./installer-download";

export const PINNED_WINDOWS_INSTALL_SHA256 =
  "44bb5b021498c0bba95f77ac30b6c4676f3ffb7aa92ea48c731cd0940e941cdc";
function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function verifiedWindowsInstallerScript(
  hermesHome: string,
  installDir: string,
): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    `$hermesHome = ${psQuote(hermesHome)}`,
    `$installDir = ${psQuote(installDir)}`,
    "try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}",
    "$installer = Join-Path $env:TEMP ('hermes-install-script-' + [guid]::NewGuid().ToString() + '.ps1')",
    `$exit = ${INSTALLER_VERIFICATION_FAILED}`,
    "try {",
    `  Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/NousResearch/hermes-agent/${PINNED_INSTALL_COMMIT}/scripts/install.ps1' -OutFile $installer -UseBasicParsing`,
    `  if ((Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant() -ne '${PINNED_WINDOWS_INSTALL_SHA256}') { throw 'Hermes installer checksum mismatch; refusing to execute.' }`,
    // PowerShell 5.1 needs a BOM; hash original downloaded bytes first.
    "  $text = [System.IO.File]::ReadAllText($installer, [System.Text.Encoding]::UTF8)",
    "  if ($text.Length -gt 0 -and $text[0] -eq [char]0xFEFF) { $text = $text.Substring(1) }",
    "  [System.IO.File]::WriteAllText($installer, $text, (New-Object System.Text.UTF8Encoding $true))",
    "  $exit = 1",
    `  & $installer -SkipSetup -NonInteractive -HermesHome $hermesHome -InstallDir $installDir -Commit '${PINNED_INSTALL_COMMIT}'`,
    "  $exit = $LASTEXITCODE",
    "} catch {",
    "  [Console]::Error.WriteLine($_.Exception.Message)",
    "} finally {",
    "  Remove-Item -LiteralPath $installer -Force -ErrorAction SilentlyContinue",
    "}",
  ].join("\r\n");
}
