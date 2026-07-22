param([switch]$Foreground)

$ErrorActionPreference = "Stop"
$ProjectRoot = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$RuntimeDir = Join-Path $ProjectRoot ".runtime"
$PidFile = Join-Path $RuntimeDir "bridge.pid"
New-Item -ItemType Directory -Path $RuntimeDir -Force | Out-Null

if (Test-Path -LiteralPath $PidFile) {
  $ExistingPid = [int](Get-Content -LiteralPath $PidFile -Raw)
  if (Get-Process -Id $ExistingPid -ErrorAction SilentlyContinue) {
    Write-Host "服务已在运行，PID：$ExistingPid"
    exit 0
  }
}

if ($Foreground) {
  Set-Location -LiteralPath $ProjectRoot
  & node src/index.js
  exit $LASTEXITCODE
}

$Process = Start-Process -FilePath "node" -ArgumentList "src/index.js" -WorkingDirectory $ProjectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $RuntimeDir "bridge.log") -RedirectStandardError (Join-Path $RuntimeDir "bridge.error.log") -PassThru
Set-Content -LiteralPath $PidFile -Value $Process.Id -Encoding ASCII
Start-Sleep -Seconds 1

if (-not (Get-Process -Id $Process.Id -ErrorAction SilentlyContinue)) {
  throw "服务启动失败，请查看 .runtime\bridge.error.log"
}
Write-Host "服务已启动，PID：$($Process.Id)" -ForegroundColor Green
Write-Host "使用 .\status.ps1 查看状态，使用 .\stop.ps1 停止服务。"
