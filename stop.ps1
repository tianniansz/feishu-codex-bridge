$ErrorActionPreference = "Stop"
$ProjectRoot = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$RuntimeDir = Join-Path $ProjectRoot ".runtime"
$PidFile = Join-Path $RuntimeDir "bridge.pid"
$ReadyFile = Join-Path $RuntimeDir "bridge.ready"
$StopFile = Join-Path $RuntimeDir "bridge.stop"

if (-not (Test-Path -LiteralPath $PidFile)) {
  Remove-Item -LiteralPath $ReadyFile, $StopFile -Force -ErrorAction SilentlyContinue
  Write-Host "服务未运行。"
  exit 0
}

$BridgePid = [int](Get-Content -LiteralPath $PidFile -Raw)
$Process = Get-Process -Id $BridgePid -ErrorAction SilentlyContinue
if ($Process) {
  Set-Content -LiteralPath $StopFile -Value "requested" -Encoding ASCII
  $StopDeadline = [DateTime]::UtcNow.AddSeconds(15)
  while ([DateTime]::UtcNow -lt $StopDeadline -and (Get-Process -Id $BridgePid -ErrorAction SilentlyContinue)) {
    Start-Sleep -Milliseconds 250
  }

  if (Get-Process -Id $BridgePid -ErrorAction SilentlyContinue) {
    Write-Warning "服务未在 15 秒内优雅退出，将强制停止 Node.js 进程。"
    Stop-Process -Id $BridgePid -Force
  }
  Write-Host "服务已停止，PID：$BridgePid" -ForegroundColor Green
} else {
  Write-Host "未找到对应进程，已清理状态文件。"
}
Remove-Item -LiteralPath $PidFile, $ReadyFile, $StopFile -Force -ErrorAction SilentlyContinue
