$ProjectRoot = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$RuntimeDir = Join-Path $ProjectRoot ".runtime"
$PidFile = Join-Path $RuntimeDir "bridge.pid"
$ReadyFile = Join-Path $RuntimeDir "bridge.ready"

if (-not (Test-Path -LiteralPath $PidFile)) {
  Write-Host "服务状态：未运行"
  exit 1
}

$BridgePid = [int](Get-Content -LiteralPath $PidFile -Raw)
if (Get-Process -Id $BridgePid -ErrorAction SilentlyContinue) {
  if (Test-Path -LiteralPath $ReadyFile) {
    Write-Host "服务状态：运行中（飞书事件监听已就绪）" -ForegroundColor Green
  } else {
    Write-Host "服务状态：启动中（尚未收到飞书事件 ready marker）" -ForegroundColor Yellow
  }
  Write-Host "PID：$BridgePid"
  exit 0
}

Write-Host "服务状态：异常退出" -ForegroundColor Red
Write-Host "请查看 .runtime\bridge.error.log"
exit 1
