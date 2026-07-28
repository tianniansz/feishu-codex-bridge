param([switch]$Foreground)

$ErrorActionPreference = "Stop"
$ProjectRoot = (Resolve-Path -LiteralPath $PSScriptRoot).Path
. (Join-Path $ProjectRoot "scripts\windows-helpers.ps1")
$BridgePaths = Get-BridgeDataPaths -ProjectRoot $ProjectRoot
$env:FEISHU_CODEX_ENV_FILE = $BridgePaths.ConfigFile
$SetupGuide = if ($BridgePaths.CliMode) { "feishu-codex-bridge setup" } else { ".\setup.ps1" }
$StatusGuide = if ($BridgePaths.CliMode) { "feishu-codex-bridge status" } else { ".\status.ps1" }
$StopGuide = if ($BridgePaths.CliMode) { "feishu-codex-bridge stop" } else { ".\stop.ps1" }

if (-not (Get-Command "node" -ErrorAction SilentlyContinue)) {
  Write-Host "尚未安装 Node.js，服务无法启动。请先运行 $SetupGuide 完成安装和配置。" -ForegroundColor Red
  exit 1
}
if (-not (Test-Path -LiteralPath $BridgePaths.ConfigFile -PathType Leaf)) {
  Write-Host "尚未完成项目配置（缺少 $($BridgePaths.ConfigFile)）。请先运行 $SetupGuide。" -ForegroundColor Red
  exit 1
}

$RuntimeDir = $BridgePaths.RuntimeDir
$PidFile = Join-Path $RuntimeDir "bridge.pid"
$ReadyFile = Join-Path $RuntimeDir "bridge.ready"
$StopFile = Join-Path $RuntimeDir "bridge.stop"
New-Item -ItemType Directory -Path $RuntimeDir -Force | Out-Null

if (Test-Path -LiteralPath $PidFile) {
  $ExistingPid = [int](Get-Content -LiteralPath $PidFile -Raw)
  if (Get-Process -Id $ExistingPid -ErrorAction SilentlyContinue) {
    $State = if (Test-Path -LiteralPath $ReadyFile) { "已就绪" } else { "启动中" }
    Write-Host "服务已在运行（$State），PID：$ExistingPid"
    exit 0
  }
}

Remove-Item -LiteralPath $PidFile, $ReadyFile, $StopFile -Force -ErrorAction SilentlyContinue

if ($Foreground) {
  Set-Location -LiteralPath $ProjectRoot
  & node src/index.js
  exit $LASTEXITCODE
}

Normalize-BridgeProcessPath
$Process = Start-Process -FilePath "node" -ArgumentList "src/index.js" -WorkingDirectory $ProjectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $RuntimeDir "bridge.log") -RedirectStandardError (Join-Path $RuntimeDir "bridge.error.log") -PassThru
Set-Content -LiteralPath $PidFile -Value $Process.Id -Encoding ASCII

$StartupDeadline = [DateTime]::UtcNow.AddSeconds(30)
while ([DateTime]::UtcNow -lt $StartupDeadline) {
  if (-not (Get-Process -Id $Process.Id -ErrorAction SilentlyContinue)) {
    Remove-Item -LiteralPath $PidFile, $ReadyFile, $StopFile -Force -ErrorAction SilentlyContinue
    throw "服务启动失败，请查看 $RuntimeDir\bridge.error.log"
  }
  if (Test-Path -LiteralPath $ReadyFile) {
    Write-Host "服务已启动并就绪，PID：$($Process.Id)" -ForegroundColor Green
    Write-Host "使用 $StatusGuide 查看状态，使用 $StopGuide 停止服务。"
    exit 0
  }
  Start-Sleep -Milliseconds 250
}

Set-Content -LiteralPath $StopFile -Value "startup-timeout" -Encoding ASCII
Start-Sleep -Seconds 2
if (Get-Process -Id $Process.Id -ErrorAction SilentlyContinue) {
  Stop-Process -Id $Process.Id -Force
}
Remove-Item -LiteralPath $PidFile, $ReadyFile, $StopFile -Force -ErrorAction SilentlyContinue
throw "服务在 30 秒内未就绪，已停止。请查看 $RuntimeDir\bridge.error.log"
