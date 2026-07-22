$ErrorActionPreference = "Stop"
$ProjectRoot = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$PidFile = Join-Path $ProjectRoot ".runtime\bridge.pid"

if (-not (Test-Path -LiteralPath $PidFile)) {
  Write-Host "服务未运行。"
  exit 0
}

$BridgePid = [int](Get-Content -LiteralPath $PidFile -Raw)
$Process = Get-Process -Id $BridgePid -ErrorAction SilentlyContinue
if ($Process) {
  Stop-Process -Id $BridgePid
  Write-Host "服务已停止，PID：$BridgePid" -ForegroundColor Green
} else {
  Write-Host "未找到对应进程，已清理状态文件。"
}
Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
