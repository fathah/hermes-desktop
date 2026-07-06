param(
  [ValidateSet("init", "up", "down", "status", "configure-desktop", "clean")]
  [string]$Command = "status",
  [int]$SshPort = 19022
)

$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$LabDir = Join-Path $Root ".sandbox\ssh-lab"
$KeyPath = Join-Path $LabDir "id_ed25519"
$AuthorizedKeys = Join-Path $LabDir "authorized_keys"
$EnvFile = Join-Path $LabDir ".env"
$ComposeFile = Join-Path $Root "scripts\ssh-lab\docker-compose.yml"
$ComposeDir = Join-Path $Root "scripts\ssh-lab"
$RemoteLabScript = Join-Path $Root "scripts\remote-lab.ps1"
$RemoteLabEnv = Join-Path $Root ".sandbox\remote-lab\.env"
$DesktopHome = Join-Path $Root ".sandbox\hermes-home"
$DesktopConfig = Join-Path $DesktopHome "desktop.json"

function Convert-ToComposePath([string]$Path) {
  return $Path.Replace("\", "/")
}

function Assert-UnderPath {
  param(
    [string]$Path,
    [string]$Parent
  )
  $resolvedPath = [System.IO.Path]::GetFullPath($Path)
  $resolvedParent = [System.IO.Path]::GetFullPath($Parent)
  if (!$resolvedParent.EndsWith([System.IO.Path]::DirectorySeparatorChar)) {
    $resolvedParent += [System.IO.Path]::DirectorySeparatorChar
  }
  if (!$resolvedPath.StartsWith($resolvedParent, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to write outside lab directory: $resolvedPath"
  }
}

function Read-EnvFile {
  param([string]$Path)
  $values = @{}
  if (Test-Path -LiteralPath $Path) {
    Get-Content -LiteralPath $Path | ForEach-Object {
      if ($_ -match "^\s*([^#][^=]+)=(.*)$") {
        $values[$matches[1].Trim()] = $matches[2].Trim()
      }
    }
  }
  return $values
}

function Convert-JsonObjectToHashtable {
  param([object]$Object)
  $table = @{}
  if (!$Object) { return $table }
  $Object.PSObject.Properties | ForEach-Object {
    $table[$_.Name] = $_.Value
  }
  return $table
}

function Ensure-RemoteLab {
  & powershell -NoProfile -ExecutionPolicy Bypass -File $RemoteLabScript up
  if ($LASTEXITCODE -ne 0) {
    throw "remote-lab.ps1 up failed with exit code $LASTEXITCODE"
  }
}

function Ensure-Key {
  New-Item -ItemType Directory -Force -Path $LabDir | Out-Null
  if (!(Test-Path -LiteralPath $KeyPath)) {
    & cmd /c "ssh-keygen -t ed25519 -N """" -C hermes-two-ssh-lab -f ""$KeyPath""" | Out-Null
    if ($LASTEXITCODE -ne 0) {
      throw "ssh-keygen failed with exit code $LASTEXITCODE"
    }
  }
  $pub = "$KeyPath.pub"
  if (!(Test-Path -LiteralPath $pub)) {
    throw "SSH public key missing at $pub"
  }
  Copy-Item -LiteralPath $pub -Destination $AuthorizedKeys -Force
}

function Write-LabEnv {
  New-Item -ItemType Directory -Force -Path $LabDir | Out-Null
  $lines = @(
    "HERMES_SSH_LAB_DIR=$(Convert-ToComposePath $LabDir)",
    "HERMES_SSH_LAB_PORT=$SshPort"
  )
  Set-Content -LiteralPath $EnvFile -Value $lines -Encoding UTF8
}

function Ensure-Lab {
  Ensure-RemoteLab
  Ensure-Key
  Write-LabEnv
  Write-Host "SSH lab initialized at $LabDir"
  Write-Host "SSH endpoint: hermes@127.0.0.1:$SshPort"
}

function Invoke-Compose {
  param([string[]]$ComposeArgs)
  & docker compose --env-file $EnvFile -f $ComposeFile -p hermes-two-ssh-lab @ComposeArgs
  if ($LASTEXITCODE -ne 0) {
    throw "docker compose $($ComposeArgs -join ' ') failed with exit code $LASTEXITCODE"
  }
}

function Test-SshLab {
  & ssh-keygen -R "[127.0.0.1]:$SshPort" 2>$null | Out-Null
  $sshArgs = @(
    "-i", $KeyPath,
    "-p", "$SshPort",
    "-o", "BatchMode=yes",
    "-o", "StrictHostKeyChecking=accept-new",
    "hermes@127.0.0.1",
    "wget -qO- http://127.0.0.1:8642/api/status | head -c 160"
  )
  & ssh @sshArgs
  if ($LASTEXITCODE -ne 0) {
    throw "SSH dashboard probe failed with exit code $LASTEXITCODE"
  }
}

function Configure-Desktop {
  Ensure-Lab
  New-Item -ItemType Directory -Force -Path $DesktopHome | Out-Null
  $data = @{}
  if (Test-Path -LiteralPath $DesktopConfig) {
    $data = Convert-JsonObjectToHashtable (Get-Content -LiteralPath $DesktopConfig -Raw | ConvertFrom-Json)
  }
  $data["connectionMode"] = "ssh"
  $data["remoteChatTransport"] = "auto"
  $data["sshChatTransport"] = "auto"
  $data["sshConfig"] = @{
    host = "127.0.0.1"
    port = $SshPort
    username = "hermes"
    keyPath = $KeyPath
    remotePort = 8642
    localPort = 29642
  }
  $remoteEnv = Read-EnvFile $RemoteLabEnv
  if ($remoteEnv["HERMES_LAB_TOKEN"]) {
    $data["remoteApiKey"] = $remoteEnv["HERMES_LAB_TOKEN"]
  }
  $data | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $DesktopConfig -Encoding UTF8
  Write-Host "Hermes One sandbox desktop config now points to the SSH dashboard lab in auto mode."
}

switch ($Command) {
  "init" {
    Ensure-Lab
  }
  "up" {
    Ensure-Lab
    Push-Location $ComposeDir
    try {
      Invoke-Compose @("up", "-d", "--build")
    } finally {
      Pop-Location
    }
    Start-Sleep -Seconds 2
    Test-SshLab
    Write-Host ""
    Write-Host "SSH lab is ready."
  }
  "down" {
    if (Test-Path -LiteralPath $EnvFile) { Invoke-Compose @("down") }
  }
  "status" {
    if (!(Test-Path -LiteralPath $EnvFile)) {
      Write-Host "SSH lab is not initialized."
      return
    }
    Invoke-Compose @("ps")
    Test-SshLab
  }
  "configure-desktop" {
    Configure-Desktop
  }
  "clean" {
    if (Test-Path -LiteralPath $EnvFile) { Invoke-Compose @("down", "-v", "--remove-orphans") }
    if (Test-Path -LiteralPath $LabDir) {
      Assert-UnderPath -Path $LabDir -Parent (Join-Path $Root ".sandbox")
      Remove-Item -LiteralPath $LabDir -Recurse -Force
    }
    Write-Host "SSH lab removed."
  }
}
