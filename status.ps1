$ProjectRoot = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$PidFile = Join-Path $ProjectRoot ".runtime\bridge.pid"

if (-not (Test-Path -LiteralPath $PidFile)) {
  Write-Host "服务状态：未运行"
  exit 1
}

$BridgePid = [int](Get-Content -LiteralPath $PidFile -Raw)
if (Get-Process -Id $BridgePid -ErrorAction SilentlyContinue) {
  Write-Host "服务状态：运行中" -ForegroundColor Green
  Write-Host "PID：$BridgePid"
  exit 0
}

Write-Host "服务状态：异常退出" -ForegroundColor Red
Write-Host "请查看 .runtime\bridge.error.log"
exit 1
