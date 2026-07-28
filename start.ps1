param([switch]$Foreground)

$ErrorActionPreference = "Stop"
$ProjectRoot = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$RuntimeDir = Join-Path $ProjectRoot ".runtime"
$PidFile = Join-Path $RuntimeDir "bridge.pid"
$ReadyFile = Join-Path $RuntimeDir "bridge.ready"
$StopFile = Join-Path $RuntimeDir "bridge.stop"
New-Item -ItemType Directory -Path $RuntimeDir -Force | Out-Null
. (Join-Path $ProjectRoot "scripts\windows-helpers.ps1")

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
    throw "服务启动失败，请查看 .runtime\bridge.error.log"
  }
  if (Test-Path -LiteralPath $ReadyFile) {
    Write-Host "服务已启动并就绪，PID：$($Process.Id)" -ForegroundColor Green
    Write-Host "使用 .\status.ps1 查看状态，使用 .\stop.ps1 停止服务。"
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
throw "服务在 30 秒内未就绪，已停止。请查看 .runtime\bridge.error.log"
