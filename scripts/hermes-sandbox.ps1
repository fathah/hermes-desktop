param(
  [Parameter(Position = 0)]
  [ValidateSet("test", "dev", "typecheck", "sync-config", "cmd")]
  [string]$Task = "test",

  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Rest
)

$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$SandboxRoot = Join-Path $RepoRoot ".sandbox"
$HermesHome = Join-Path $SandboxRoot "hermes-home"
$ElectronUserData = Join-Path $SandboxRoot "electron-user-data"
$PortsFile = Join-Path $SandboxRoot "ports.json"

function Looks-LikeHermesHome([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return $false }
  return (
    (Test-Path -LiteralPath (Join-Path $Path "config.yaml")) -or
    (Test-Path -LiteralPath (Join-Path $Path ".env")) -or
    (Test-Path -LiteralPath (Join-Path $Path "auth.json")) -or
    (Test-Path -LiteralPath (Join-Path $Path "hermes-agent")) -or
    (Test-Path -LiteralPath (Join-Path $Path "desktop.json"))
  )
}

function Resolve-SourceHermesHome {
  $candidates = @()
  if ($env:HERMES_HOME) { $candidates += $env:HERMES_HOME }
  if ($env:LOCALAPPDATA) { $candidates += (Join-Path $env:LOCALAPPDATA "hermes") }
  $candidates += (Join-Path $HOME ".hermes")

  foreach ($candidate in $candidates) {
    if (Looks-LikeHermesHome $candidate) {
      return (Resolve-Path -LiteralPath $candidate).Path
    }
  }

  throw "Could not find a source Hermes home. Set HERMES_HOME and rerun."
}

function Ensure-SandboxHome {
  New-Item -ItemType Directory -Force -Path $SandboxRoot, $HermesHome, $ElectronUserData | Out-Null

  $desktopConfig = Join-Path $HermesHome "desktop.json"
  if (-not (Test-Path -LiteralPath $desktopConfig)) {
    @{
      connectionMode = "local"
      remoteUrl = ""
      remoteApiKey = ""
    } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $desktopConfig -Encoding UTF8
  }
}

function Clear-CopiedRuntimeState {
  $runtimeTargets = @(
    (Join-Path $HermesHome "desktop\sessions.json"),
    (Join-Path $HermesHome "sessions"),
    (Join-Path $HermesHome "audio_cache"),
    (Join-Path $HermesHome "image_cache")
  )

  foreach ($target in $runtimeTargets) {
    if (Test-Path -LiteralPath $target) {
      Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
}

function Test-PortFree([int]$Port) {
  $listener = $null
  try {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
    $listener.Start()
    return $true
  } catch {
    return $false
  } finally {
    if ($listener) { $listener.Stop() }
  }
}

function Find-FreePort([int]$Start) {
  for ($port = $Start; $port -lt 65000; $port++) {
    if (Test-PortFree $port) { return $port }
  }
  throw "Could not find a free port starting at $Start"
}

function ConvertTo-HashtableDeep($Value) {
  if ($null -eq $Value) { return $null }
  if ($Value -is [System.Collections.IDictionary]) {
    $result = @{}
    foreach ($key in $Value.Keys) {
      $result[$key] = ConvertTo-HashtableDeep $Value[$key]
    }
    return $result
  }
  if ($Value -is [System.Management.Automation.PSCustomObject]) {
    $result = @{}
    foreach ($property in $Value.PSObject.Properties) {
      $result[$property.Name] = ConvertTo-HashtableDeep $property.Value
    }
    return $result
  }
  if (($Value -is [System.Collections.IEnumerable]) -and -not ($Value -is [string])) {
    $items = @()
    foreach ($item in $Value) {
      $items += ,(ConvertTo-HashtableDeep $item)
    }
    return $items
  }
  return $Value
}

function Set-SandboxPorts {
  $apiPort = Find-FreePort 19642
  $sshLocalPort = Find-FreePort ($apiPort + 120)
  $rendererPort = Find-FreePort ($apiPort + 240)
  $claw3dPort = Find-FreePort ($apiPort + 360)

  $env:HERMES_DESKTOP_DEFAULT_API_PORT = [string]$apiPort
  $env:HERMES_DESKTOP_PORT_RANGE_START = [string]($apiPort + 1)
  $env:HERMES_DESKTOP_PORT_RANGE_END = [string]($apiPort + 99)
  $env:HERMES_DESKTOP_RENDERER_PORT = [string]$rendererPort

  @{
    apiPort = $apiPort
    profilePortStart = $apiPort + 1
    profilePortEnd = $apiPort + 99
    sshLocalPort = $sshLocalPort
    rendererPort = $rendererPort
    claw3dPort = $claw3dPort
  } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $PortsFile -Encoding UTF8

  $desktopConfig = Join-Path $HermesHome "desktop.json"
  $desktop = @{}
  if (Test-Path -LiteralPath $desktopConfig) {
    try {
      $desktop = ConvertTo-HashtableDeep (Get-Content -LiteralPath $desktopConfig -Raw | ConvertFrom-Json)
    } catch {
      $desktop = @{}
    }
  }
  if (-not $desktop.ContainsKey("connectionMode")) { $desktop.connectionMode = "local" }
  if (-not $desktop.ContainsKey("remoteUrl")) { $desktop.remoteUrl = "" }
  if (-not $desktop.ContainsKey("remoteApiKey")) { $desktop.remoteApiKey = "" }
  if (-not $desktop.ContainsKey("ssh") -or -not ($desktop.ssh -is [hashtable])) {
    $desktop.ssh = @{}
  }
  if (-not $desktop.ssh.ContainsKey("port")) { $desktop.ssh.port = 22 }
  if (-not $desktop.ssh.ContainsKey("remotePort")) { $desktop.ssh.remotePort = 8642 }
  $desktop.ssh.localPort = $sshLocalPort
  $desktop | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $desktopConfig -Encoding UTF8

  Set-Content -LiteralPath (Join-Path $HermesHome "claw3d-port") -Value ([string]$claw3dPort) -Encoding UTF8

  Write-Host "[hermes-sandbox] ports: api=$apiPort profiles=$($apiPort + 1)-$($apiPort + 99) renderer=$rendererPort ssh-local=$sshLocalPort claw3d=$claw3dPort"
}

function Sync-Config {
  Ensure-SandboxHome
  $source = Resolve-SourceHermesHome

  $excludedDirs = @(
    "audio_cache",
    "backups",
    "cache",
    "desktop",
    "desktop-staging",
    "gateway-service",
    "hermes-agent",
    "hermes-agent-backup-*",
    "hermes-office",
    "image_cache",
    "logs",
    "lsp",
    "sandboxes",
    "sessions",
    "state-snapshots",
    "tmp-*"
  )

  $excludedFiles = @(
    "*.db",
    "*.db-shm",
    "*.db-wal",
    "*.lock",
    "*.log",
    "*.pid",
    ".hermes_history",
    ".restart_last_processed.json",
    ".update_check",
    "HermesGateway.task-backup.xml",
    "sessions.json",
    "tmp_*.json"
  )

  $robocopyArgs = @(
    $source,
    $HermesHome,
    "/E",
    "/NFL",
    "/NDL",
    "/NJH",
    "/NJS",
    "/NP",
    "/XD"
  ) + $excludedDirs + @("/XF") + $excludedFiles

  & robocopy @robocopyArgs | Out-Host
  $code = $LASTEXITCODE
  if ($code -ge 8) {
    throw "robocopy failed with exit code $code"
  }

  Clear-CopiedRuntimeState
  $env:HERMES_HOME = $HermesHome
  Set-SandboxPorts
  Write-Host "[hermes-sandbox] copied config from $source"
  Write-Host "[hermes-sandbox] sandbox HERMES_HOME=$HermesHome"
}

function Use-SandboxEnv {
  Ensure-SandboxHome
  $env:HERMES_HOME = $HermesHome
  $env:HERMES_DESKTOP_SANDBOX = "1"
  $env:HERMES_DESKTOP_APP_NAME = "Hermes One"
  $env:HERMES_DESKTOP_USER_DATA_DIR = $ElectronUserData
  $env:VITE_HERMES_DESKTOP_APP_NAME = "Hermes One"
  Set-SandboxPorts
  Write-Host "[hermes-sandbox] HERMES_HOME=$HermesHome"
  Write-Host "[hermes-sandbox] userData=$ElectronUserData"
  Write-Host "[hermes-sandbox] app name=Hermes One"
  Write-Host "[hermes-sandbox] dashboard chat=default-on"
}

function Repair-SandboxUserEnvironment {
  $sandboxVenv = Join-Path $HermesHome "hermes-agent\venv\Scripts"
  $userHermesHome = [Environment]::GetEnvironmentVariable("HERMES_HOME", "User")
  if ($userHermesHome -and ($userHermesHome.TrimEnd("\") -ieq $HermesHome.TrimEnd("\"))) {
    [Environment]::SetEnvironmentVariable("HERMES_HOME", $null, "User")
    Write-Host "[hermes-sandbox] removed sandbox HERMES_HOME from user environment"
  }

  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  if ($userPath) {
    $hadSandboxPath = $false
    $parts = $userPath -split ";" | Where-Object {
      if (-not $_) { return $false }
      if ($_.TrimEnd("\") -ieq $sandboxVenv.TrimEnd("\")) {
        $hadSandboxPath = $true
        return $false
      }
      return $true
    }
    if ($hadSandboxPath) {
      [Environment]::SetEnvironmentVariable("Path", ($parts -join ";"), "User")
      Write-Host "[hermes-sandbox] removed sandbox venv from user PATH"
    }
  }
}

switch ($Task) {
  "sync-config" {
    Sync-Config
    Repair-SandboxUserEnvironment
    exit 0
  }
  "test" {
    Use-SandboxEnv
    & npm run test -- @Rest
    Repair-SandboxUserEnvironment
    exit $LASTEXITCODE
  }
  "dev" {
    Use-SandboxEnv
    & npm run dev -- @Rest
    Repair-SandboxUserEnvironment
    exit $LASTEXITCODE
  }
  "typecheck" {
    Use-SandboxEnv
    & npm run typecheck -- @Rest
    Repair-SandboxUserEnvironment
    exit $LASTEXITCODE
  }
  "cmd" {
    Use-SandboxEnv
    if (-not $Rest -or $Rest.Length -eq 0) {
      throw "cmd task requires a command after --"
    }
    $program = $Rest[0]
    $argsForProgram = if ($Rest.Length -gt 1) { $Rest[1..($Rest.Length - 1)] } else { @() }
    & $program @argsForProgram
    Repair-SandboxUserEnvironment
    exit $LASTEXITCODE
  }
}
