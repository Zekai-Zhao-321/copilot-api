param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateSet("start", "stop")]
  [string]$Action
)

$ErrorActionPreference = "Stop"
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$stateDir = Join-Path $env:LOCALAPPDATA "copilot-api-gateway"
$stateFile = Join-Path $stateDir "server.json"
$stderrFile = Join-Path $stateDir "server.stderr.log"

function Stop-Gateway {
  if (-not (Test-Path -LiteralPath $stateFile)) {
    Write-Host "No server started by start.bat is recorded."
    return
  }

  $record = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
  $serverPid = 0
  if (-not [int]::TryParse([string]$record.pid, [ref]$serverPid) -or $serverPid -le 0) {
    throw "Invalid server PID record; refusing to stop an unknown process."
  }
  if ($record.repo -ine $repo) {
    throw "PID record belongs to another checkout; refusing to stop it."
  }

  $server = Get-Process -Id $serverPid -ErrorAction SilentlyContinue
  if (-not $server) {
    Remove-Item -LiteralPath $stateFile
    Write-Host "Server was already stopped; removed stale PID record."
    return
  }
  if ($server.StartTime.ToUniversalTime().Ticks -ne [long]$record.started -or
    $server.Path -ine $record.bun) {
    throw "Recorded PID now belongs to a different process; refusing to stop it."
  }

  $details = Get-CimInstance Win32_Process -Filter "ProcessId=$serverPid"
  if (-not $details -or
    $details.CommandLine -notmatch "src[\\/]main\.ts\s+start\s+--host\s+127\.0\.0\.1") {
    throw "Recorded process is not this gateway; refusing to stop it."
  }

  Stop-Process -Id $serverPid -Force
  for ($i = 0; $i -lt 60; $i++) {
    $remaining = Get-Process -Id $serverPid -ErrorAction SilentlyContinue
    if (-not $remaining -or $remaining.StartTime.ToUniversalTime().Ticks -ne [long]$record.started) {
      break
    }
    Start-Sleep -Milliseconds 250
  }
  if ($remaining -and $remaining.StartTime.ToUniversalTime().Ticks -eq [long]$record.started) {
    throw "Server did not stop; leaving PID record for inspection."
  }

  Remove-Item -LiteralPath $stateFile
  Write-Host "Gateway stopped."
}

function Start-Gateway {
  if (-not (Test-Path -LiteralPath (Join-Path $repo "node_modules"))) {
    throw "Dependencies missing. Run bun install --frozen-lockfile --ignore-scripts after reviewing the lockfile."
  }

  $homeDir = if ($env:COPILOT_API_HOME) {
    $env:COPILOT_API_HOME
  } else {
    Join-Path $HOME ".local\share\copilot-api"
  }
  $configPath = Join-Path $homeDir "config.json"
  if (-not (Test-Path -LiteralPath $configPath)) {
    throw "No gateway config. Authenticate and configure an API key before starting."
  }
  $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
  $keys = @($config.auth.apiKeys | Where-Object { $_ -is [string] -and $_.Trim() })
  if ($keys.Count -eq 0) {
    throw "No gateway API key. Run: bun run ./src/main.ts auth keys --generate"
  }

  $savedTokenPath = Join-Path $homeDir "github_token"
  Remove-Item Env:GH_TOKEN -ErrorAction SilentlyContinue
  $savedToken = $null
  if (Test-Path -LiteralPath $savedTokenPath) {
    $savedToken = (Get-Content -LiteralPath $savedTokenPath -Raw).Trim()
  }
  $hasProviders = $false
  if ($config.providers) {
    $hasProviders = @($config.providers.PSObject.Properties |
      Where-Object { $_.Value.enabled -ne $false }).Count -gt 0
  }
  if (-not $savedToken -and -not $hasProviders) {
    throw "No GitHub token. Run: bun run ./src/main.ts auth login --provider copilot"
  }

  $listeners = @(Get-NetTCPConnection -LocalPort 4141 -State Listen -ErrorAction SilentlyContinue)
  if ($listeners.Count -gt 0) {
    throw "Port 4141 is already in use by process $($listeners[0].OwningProcess)."
  }
  if (Test-Path -LiteralPath $stateFile) {
    throw "An existing gateway PID record needs inspection. Run stop.bat first."
  }

  $bun = (Resolve-Path -LiteralPath (Get-Command bun.exe).Source).Path
  New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
  $stdoutFile = Join-Path $stateDir "server.stdout.log"
  $env:NODE_USE_SYSTEM_CA = "1"
  $env:NODE_ENV = "production"

  $server = Start-Process -FilePath $bun -WorkingDirectory $repo `
    -ArgumentList @("run", ".\src\main.ts", "start", "--host", "127.0.0.1", "--port", "4141") `
    -RedirectStandardOutput $stdoutFile -RedirectStandardError $stderrFile `
    -WindowStyle Hidden -PassThru
  @{
    pid = $server.Id
    started = $server.StartTime.ToUniversalTime().Ticks
    bun = $bun
    repo = $repo
  } | ConvertTo-Json -Compress | Set-Content -LiteralPath $stateFile

  for ($i = 0; $i -lt 45; $i++) {
    $server.Refresh()
    if ($server.HasExited) {
      Remove-Item -LiteralPath $stateFile
      if ((Test-Path -LiteralPath $stderrFile) -and
        (Select-String -LiteralPath $stderrFile -Pattern "403 Forbidden" -Quiet)) {
        throw "GitHub refused the Copilot token exchange (403). See $stderrFile"
      }
      throw "Gateway exited during startup. See $stderrFile"
    }

    $listener = Get-NetTCPConnection -LocalPort 4141 -State Listen -ErrorAction SilentlyContinue |
      Where-Object OwningProcess -eq $server.Id
    if ($listener) {
      Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:4141/v1/models" `
        -Headers @{ "x-api-key" = $keys[0] } -TimeoutSec 20 | Out-Null
      Write-Host "Gateway ready on http://127.0.0.1:4141 (PID $($server.Id)). Run stop.bat to close it."
      return
    }
    Start-Sleep -Seconds 1
  }
  throw "Gateway did not become ready. See $stderrFile"
}

try {
  if ($Action -eq "start") {
    Start-Gateway
  } else {
    Stop-Gateway
  }
} catch {
  Write-Error $_.Exception.Message
  exit 1
}
