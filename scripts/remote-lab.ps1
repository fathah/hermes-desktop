param(
  [ValidateSet("init", "up", "down", "status", "logs", "configure-desktop", "clean")]
  [string]$Command = "status",
  [int]$Port = 19080,
  [string]$Image = "hermes-two-remote-lab-agent:local",
  [string]$AgentRepo = ""
)

$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$LabDir = Join-Path $Root ".sandbox\remote-lab"
$LabHome = Join-Path $LabDir "hermes-home"
$LabAgentBuildContext = Join-Path $LabDir "hermes-agent-build"
$EnvFile = Join-Path $LabDir ".env"
$ComposeFile = Join-Path $Root "scripts\remote-lab\docker-compose.yml"
$NginxConf = Join-Path $Root "scripts\remote-lab\nginx.conf"
$DesktopHome = Join-Path $Root ".sandbox\hermes-home"
$DesktopConfig = Join-Path $DesktopHome "desktop.json"
if (!$AgentRepo) {
  $AgentRepo = Join-Path $DesktopHome "hermes-agent"
}

function Convert-ToComposePath([string]$Path) {
  return $Path.Replace("\", "/")
}

function New-Token {
  $bytes = [byte[]]::new(24)
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($bytes)
  } finally {
    $rng.Dispose()
  }
  return ([BitConverter]::ToString($bytes) -replace "-", "").ToLowerInvariant()
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

function Read-LabEnv {
  $values = @{}
  if (Test-Path $EnvFile) {
    Get-Content -LiteralPath $EnvFile | ForEach-Object {
      if ($_ -match "^\s*([^#][^=]+)=(.*)$") {
        $values[$matches[1].Trim()] = $matches[2].Trim()
      }
    }
  }
  return $values
}

function Write-LabEnv {
  param([string]$Token)
  New-Item -ItemType Directory -Force -Path $LabDir, $LabHome | Out-Null
  $openRouterKey = Get-DotEnvValue -Path (Join-Path $LabHome ".env") -Key "OPENROUTER_API_KEY"
  $lines = @(
    "HERMES_LAB_HOME=$(Convert-ToComposePath $LabHome)",
    "HERMES_LAB_NGINX_CONF=$(Convert-ToComposePath $NginxConf)",
    "HERMES_LAB_AGENT_REPO=$(Convert-ToComposePath $LabAgentBuildContext)",
    "HERMES_LAB_PROXY_PORT=$Port",
    "HERMES_LAB_IMAGE=$Image",
    "HERMES_LAB_TOKEN=$Token",
    "HERMES_LAB_COMFYUI_HOST=http://host.docker.internal:49000",
    "HERMES_LAB_OPENROUTER_API_KEY=$openRouterKey"
  )
  Set-Content -LiteralPath $EnvFile -Value $lines -Encoding UTF8
}

function Get-DotEnvValue {
  param(
    [string]$Path,
    [string]$Key
  )
  if (!(Test-Path $Path)) { return "" }
  foreach ($line in Get-Content -LiteralPath $Path) {
    if ($line -match "^\s*$([regex]::Escape($Key))=(.*)$") {
      return $matches[1].Trim()
    }
  }
  return ""
}

function Set-DotEnvValues {
  param(
    [string]$Path,
    [hashtable]$Values
  )
  $lines = @()
  if (Test-Path $Path) {
    $lines = @(Get-Content -LiteralPath $Path)
  }
  foreach ($key in $Values.Keys) {
    $pattern = "^\s*$([regex]::Escape($key))="
    $replacement = "$key=$($Values[$key])"
    $found = $false
    $lines = @($lines | ForEach-Object {
      if ($_ -match $pattern) {
        $found = $true
        $replacement
      } else {
        $_
      }
    })
    if (!$found) {
      $lines += $replacement
    }
  }
  Set-Content -LiteralPath $Path -Value $lines -Encoding UTF8
}

function Remove-DotEnvKeys {
  param(
    [string]$Path,
    [string[]]$Prefixes,
    [string[]]$Keys
  )
  if (!(Test-Path $Path)) { return }
  $lines = @(Get-Content -LiteralPath $Path | Where-Object {
    $line = $_
    if ($line -notmatch "^\s*([^#][^=]+)=") { return $true }
    $key = $matches[1].Trim()
    foreach ($exact in $Keys) {
      if ($key -eq $exact) { return $false }
    }
    foreach ($prefix in $Prefixes) {
      if ($key.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        return $false
      }
    }
    return $true
  })
  Set-Content -LiteralPath $Path -Value $lines -Encoding UTF8
}

function Set-YamlScalarValues {
  param(
    [string]$Path,
    [hashtable]$Values
  )
  if (!(Test-Path $Path)) { return }
  $lines = @(Get-Content -LiteralPath $Path)
  foreach ($key in $Values.Keys) {
    $pattern = "^\s*$([regex]::Escape($key))\s*:"
    $replacement = "$key`: $($Values[$key])"
    $found = $false
    $lines = @($lines | ForEach-Object {
      if ($_ -match $pattern) {
        $found = $true
        $replacement
      } else {
        $_
      }
    })
    if (!$found) {
      $lines += $replacement
    }
  }
  Set-Content -LiteralPath $Path -Value $lines -Encoding UTF8
}

function Set-LabApprovalConfig {
  param([string]$Path)

  if (!(Test-Path $Path)) { return }
  $text = Get-Content -LiteralPath $Path -Raw
  $block = @"
approvals:
  mode: off
  timeout: 60
  cron_mode: deny
  mcp_reload_confirm: true
  destructive_slash_confirm: true
"@
  if ($text -match "(?ms)^approvals:\r?\n(?:^[ \t]+[^\r\n]*(?:\r?\n|$))*") {
    $text = [regex]::Replace(
      $text,
      "(?ms)^approvals:\r?\n(?:^[ \t]+[^\r\n]*(?:\r?\n|$))*",
      $block + "`r`n",
      1
    )
  } else {
    $text = $text.TrimEnd() + "`r`n" + $block + "`r`n"
  }
  Set-Content -LiteralPath $Path -Value $text -Encoding UTF8
}

function Set-LabAuxiliaryVisionConfig {
  param([string]$Path)

  if (!(Test-Path $Path)) { return }
  $lines = @(Get-Content -LiteralPath $Path)
  $inAuxiliary = $false
  $inVision = $false
  $sawProvider = $false
  $sawModel = $false
  $out = New-Object System.Collections.Generic.List[string]

  for ($i = 0; $i -lt $lines.Count; $i++) {
    $line = $lines[$i]
    if ($line -match "^\S" -and $line.Trim() -ne "auxiliary:") {
      if ($inVision) {
        if (!$sawProvider) { $out.Add("    provider: openrouter") }
        if (!$sawModel) { $out.Add("    model: google/gemini-3-flash-preview") }
      }
      $inAuxiliary = $false
      $inVision = $false
    }

    if ($line -match "^auxiliary:\s*$") {
      $inAuxiliary = $true
      $inVision = $false
      $out.Add($line)
      continue
    }

    if ($inAuxiliary -and $line -match "^  vision:\s*$") {
      if ($inVision) {
        if (!$sawProvider) { $out.Add("    provider: openrouter") }
        if (!$sawModel) { $out.Add("    model: google/gemini-3-flash-preview") }
      }
      $inVision = $true
      $sawProvider = $false
      $sawModel = $false
      $out.Add($line)
      continue
    }

    if ($inVision -and $line -match "^  [A-Za-z0-9_-]+:\s*$" -and $line -notmatch "^  vision:\s*$") {
      if (!$sawProvider) { $out.Add("    provider: openrouter") }
      if (!$sawModel) { $out.Add("    model: google/gemini-3-flash-preview") }
      $inVision = $false
      $out.Add($line)
      continue
    }

    if ($inVision -and $line -match "^\s{4}provider\s*:") {
      $out.Add("    provider: openrouter")
      $sawProvider = $true
      continue
    }

    if ($inVision -and $line -match "^\s{4}model\s*:") {
      $out.Add("    model: google/gemini-3-flash-preview")
      $sawModel = $true
      continue
    }

    $out.Add($line)
  }

  if ($inVision) {
    if (!$sawProvider) { $out.Add("    provider: openrouter") }
    if (!$sawModel) { $out.Add("    model: google/gemini-3-flash-preview") }
  }

  Set-Content -LiteralPath $Path -Value $out -Encoding UTF8
}

function Copy-WorkingConfig {
  $sourceHome = Join-Path $Root ".sandbox\hermes-home"
  if (!(Test-Path $sourceHome)) { return }
  New-Item -ItemType Directory -Force -Path $LabHome | Out-Null

  foreach ($name in @(".env", "config.yaml", "auth.json")) {
    $src = Join-Path $sourceHome $name
    if (Test-Path $src) {
      Copy-Item -LiteralPath $src -Destination (Join-Path $LabHome $name) -Force
    }
  }

  $sourceProfiles = Join-Path $sourceHome "profiles"
  if (Test-Path $sourceProfiles) {
    Get-ChildItem -LiteralPath $sourceProfiles -Directory | ForEach-Object {
      $destProfile = Join-Path (Join-Path $LabHome "profiles") $_.Name
      New-Item -ItemType Directory -Force -Path $destProfile | Out-Null
      foreach ($name in @(".env", "config.yaml", "auth.json")) {
        $src = Join-Path $_.FullName $name
        if (Test-Path $src) {
          Copy-Item -LiteralPath $src -Destination (Join-Path $destProfile $name) -Force
        }
      }
    }
  }
}

function Sync-AgentBuildContext {
  if (!(Test-Path (Join-Path $AgentRepo "Dockerfile"))) {
    throw "Hermes Agent checkout not found at $AgentRepo"
  }
  Assert-UnderPath -Path $LabAgentBuildContext -Parent $LabDir
  New-Item -ItemType Directory -Force -Path $LabAgentBuildContext | Out-Null

  & robocopy $AgentRepo $LabAgentBuildContext /MIR /XD .git node_modules venv .venv __pycache__ .pytest_cache .mypy_cache .ruff_cache .tox /XF *.pyc /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -gt 7) {
    throw "robocopy failed while preparing remote lab build context (exit code $LASTEXITCODE)"
  }

  $dockerDir = Join-Path $LabAgentBuildContext "docker"
  if (Test-Path $dockerDir) {
    $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
    Get-ChildItem -LiteralPath $dockerDir -Recurse -File | ForEach-Object {
      $text = [System.IO.File]::ReadAllText($_.FullName)
      $text = $text -replace "`r`n", "`n"
      [System.IO.File]::WriteAllText($_.FullName, $text, $utf8NoBom)
    }
  }
}

function Set-LabApiServerConfig {
  param([string]$Token)
  New-Item -ItemType Directory -Force -Path $LabHome | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $LabHome "images") | Out-Null
  Set-Content -LiteralPath (Join-Path $LabHome ".no-bundled-skills") -Value "Remote lab skips bundled skill sync." -Encoding UTF8
  $labSkills = Join-Path $LabHome "skills"
  if (Test-Path $labSkills) {
    Assert-UnderPath -Path $labSkills -Parent $LabHome
    Remove-Item -LiteralPath $labSkills -Recurse -Force
  }
  $comfySkillSource = Join-Path $LabAgentBuildContext "skills\creative\comfyui"
  if (Test-Path $comfySkillSource) {
    $comfySkillDest = Join-Path $LabHome "skills\creative\comfyui"
    Assert-UnderPath -Path $comfySkillDest -Parent $LabHome
    New-Item -ItemType Directory -Force -Path (Split-Path $comfySkillDest -Parent) | Out-Null
    Copy-Item -LiteralPath $comfySkillSource -Destination $comfySkillDest -Recurse -Force
    Set-LabComfyUiBridge -SkillDir $comfySkillDest
  }
  Remove-DotEnvKeys -Path (Join-Path $LabHome ".env") -Prefixes @(
    "TELEGRAM_",
    "DISCORD_",
    "SLACK_",
    "WHATSAPP_",
    "SIGNAL_",
    "MATRIX_",
    "MATTERMOST_",
    "WEIXIN_",
    "FEISHU_",
    "DINGTALK_",
    "WECOM_",
    "QQBOT_",
    "BLUEBUBBLES_",
    "GOOGLE_CHAT_",
    "TEAMS_",
    "EMAIL_",
    "SMTP_",
    "IMAP_",
    "TWILIO_",
    "SMS_",
    "WEBHOOK_",
    "MSGGRAPH_WEBHOOK_",
    "HASS_",
    "HOMEASSISTANT_"
  ) -Keys @(
    "BOT_TOKEN",
    "APP_TOKEN",
    "HOME_CHANNEL",
    "HOME_CHANNEL_NAME",
    "ALLOWED_USERS",
    "ALLOWED_CHATS"
  )
  Set-DotEnvValues -Path (Join-Path $LabHome ".env") -Values @{
    "API_SERVER_ENABLED" = "true"
    "API_SERVER_HOST" = "0.0.0.0"
    "API_SERVER_PORT" = "8642"
    "API_SERVER_KEY" = $Token
  }
  Set-YamlScalarValues -Path (Join-Path $LabHome "config.yaml") -Values @{
    "API_SERVER_ENABLED" = "true"
    "API_SERVER_HOST" = "0.0.0.0"
    "API_SERVER_PORT" = "8642"
    "API_SERVER_KEY" = $Token
  }
  Set-LabApprovalConfig -Path (Join-Path $LabHome "config.yaml")
  if (Get-DotEnvValue -Path (Join-Path $LabHome ".env") -Key "OPENROUTER_API_KEY") {
    Set-LabAuxiliaryVisionConfig -Path (Join-Path $LabHome "config.yaml")
  }
}

function Set-LabComfyUiBridge {
  param([string]$SkillDir)

  $commonPath = Join-Path $SkillDir "scripts\_common.py"
  if (Test-Path $commonPath) {
    $text = Get-Content -LiteralPath $commonPath -Raw
    $text = $text -replace 'DEFAULT_LOCAL_HOST = "http://127\.0\.0\.1:8188"', 'DEFAULT_LOCAL_HOST = os.environ.get("COMFYUI_HOST", "http://127.0.0.1:8188")'
    Set-Content -LiteralPath $commonPath -Value $text -Encoding UTF8
  }

  $skillPath = Join-Path $SkillDir "SKILL.md"
  if (Test-Path $skillPath) {
    $text = Get-Content -LiteralPath $skillPath -Raw
    $marker = "## Hermes One Remote Lab Bridge"
    if (!$text.Contains($marker)) {
      $note = @"
$marker

This disposable lab copy is allowed to reach the connecting Windows host for
regression testing. Use the host from `$COMFYUI_HOST` when present; the lab
container sets it to `http://host.docker.internal:49000`, AI Playground's
bundled ComfyUI endpoint on the Windows host. This is not normal remote
Hermes behavior.

When you create a container-local copy for display in Hermes One, write it
under `/opt/data/images` and mention that path in the final answer, preferably
as `MEDIA:/opt/data/images/<filename>.png`. Hermes Agent's dashboard media
endpoint is intentionally restricted to the Hermes media roots.

"@
      $text = $text -replace "# ComfyUI\r?\n", "# ComfyUI`r`n`r`n$note"
      Set-Content -LiteralPath $skillPath -Value $text -Encoding UTF8
    }
  }
}

function Ensure-Lab {
  New-Item -ItemType Directory -Force -Path $LabDir, $LabHome | Out-Null
  $envValues = Read-LabEnv
  $token = $envValues["HERMES_LAB_TOKEN"]
  if (!$token) {
    $token = New-Token
  }
  if (!(Test-Path $EnvFile)) {
    Copy-WorkingConfig
  }
  Sync-AgentBuildContext
  Write-LabEnv -Token $token
  Set-LabApiServerConfig -Token $token
  Write-Host "Remote lab initialized at $LabDir"
  Write-Host "Remote URL: http://127.0.0.1:$Port"
}

function Invoke-Compose {
  param([string[]]$ComposeArgs)
  & docker compose --env-file $EnvFile -f $ComposeFile -p hermes-two-remote-lab @ComposeArgs
  if ($LASTEXITCODE -ne 0) {
    throw "docker compose $($ComposeArgs -join ' ') failed with exit code $LASTEXITCODE"
  }
}

function Get-LabToken {
  $envValues = Read-LabEnv
  $token = $envValues["HERMES_LAB_TOKEN"]
  if (!$token) { throw "Lab is not initialized. Run: scripts\remote-lab.ps1 init" }
  return $token
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

function Test-Endpoint {
  param(
    [string]$Name,
    [string]$Url,
    [hashtable]$Headers = @{}
  )
  try {
    $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 20 -Uri $Url -Headers $Headers
    Write-Host "$Name OK ($($response.StatusCode))"
  } catch {
    Write-Host "$Name FAILED: $($_.Exception.Message)"
  }
}

function Show-Status {
  if (!(Test-Path $EnvFile)) {
    Write-Host "Remote lab is not initialized."
    return
  }
  Invoke-Compose @("ps")
  $token = Get-LabToken
  $base = "http://127.0.0.1:$Port"
  Test-Endpoint "dashboard status" "$base/api/status"
  Test-Endpoint "dashboard sessions auth" "$base/api/sessions?limit=1" @{
    "X-Hermes-Session-Token" = $token
  }
  Test-Endpoint "legacy OpenAI models auth" "$base/v1/models" @{
    "Authorization" = "Bearer $token"
  }
}

function Configure-Desktop {
  Ensure-Lab
  $token = Get-LabToken
  New-Item -ItemType Directory -Force -Path $DesktopHome | Out-Null
  $data = @{}
  if (Test-Path $DesktopConfig) {
    $data = Convert-JsonObjectToHashtable (Get-Content -LiteralPath $DesktopConfig -Raw | ConvertFrom-Json)
  }
  $data["connectionMode"] = "remote"
  $data["remoteUrl"] = "http://127.0.0.1:$Port"
  $data["remoteApiKey"] = $token
  $data["remoteChatTransport"] = "auto"
  $data["sshChatTransport"] = "auto"
  $data | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $DesktopConfig -Encoding UTF8
  Write-Host "Hermes One sandbox desktop config now points to http://127.0.0.1:$Port in remote auto mode."
}

switch ($Command) {
  "init" {
    Ensure-Lab
  }
  "up" {
    Ensure-Lab
    Invoke-Compose @("up", "-d")
    Start-Sleep -Seconds 8
    Show-Status
  }
  "down" {
    if (Test-Path $EnvFile) { Invoke-Compose @("down") }
  }
  "status" {
    Show-Status
  }
  "logs" {
    Invoke-Compose @("logs", "--tail", "120")
  }
  "configure-desktop" {
    Configure-Desktop
  }
  "clean" {
    if (Test-Path $EnvFile) { Invoke-Compose @("down", "-v", "--remove-orphans") }
    if (Test-Path $LabDir) { Remove-Item -LiteralPath $LabDir -Recurse -Force }
    Write-Host "Remote lab removed."
  }
}
