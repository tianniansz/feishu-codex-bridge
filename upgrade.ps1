param([string]$Version = "latest")

$ErrorActionPreference = "Stop"
$ProjectRoot = (Resolve-Path -LiteralPath $PSScriptRoot).Path
. (Join-Path $ProjectRoot "scripts\windows-helpers.ps1")
$BridgePaths = Get-BridgeDataPaths -ProjectRoot $ProjectRoot
$env:FEISHU_CODEX_ENV_FILE = $BridgePaths.ConfigFile

if ($Version -notmatch "^[0-9A-Za-z._-]+$") { throw "无效的版本号：$Version" }
if (-not (Get-Command "npm.cmd" -ErrorAction SilentlyContinue)) { throw "未找到 npm.cmd，无法下载升级包。" }

$Metadata = Get-Content -LiteralPath (Join-Path $ProjectRoot "package.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$NpmPrefix = (& npm.cmd prefix -g | Select-Object -Last 1).Trim()
$GlobalPackageDir = Get-BridgeGlobalPackageDir -NpmPrefix $NpmPrefix -PackageName $Metadata.name
$TempDir = Join-Path ([IO.Path]::GetTempPath()) "feishu-codex-upgrade-$PID-$([Guid]::NewGuid().ToString('N'))"
$RuntimeDir = $BridgePaths.RuntimeDir
$PidFile = Join-Path $RuntimeDir "bridge.pid"
$WasRunning = $false
if (Test-Path -LiteralPath $PidFile -PathType Leaf) {
  $BridgePid = 0
  $PidText = (Get-Content -LiteralPath $PidFile -Raw).Trim()
  $WasRunning = [int]::TryParse($PidText, [ref]$BridgePid) -and $BridgePid -gt 0 -and $null -ne (Get-Process -Id $BridgePid -ErrorAction SilentlyContinue)
}

$InstallResult = $null
New-Item -ItemType Directory -Path $TempDir -Force | Out-Null
try {
  $Specifier = "$($Metadata.name)@$Version"
  Write-Host "正在从 npm 官方源下载 $Specifier ..." -ForegroundColor Cyan
  $PreviousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    $PackOutput = & npm.cmd pack $Specifier --silent --pack-destination $TempDir --registry=https://registry.npmjs.org 2>&1
    $PackExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $PreviousErrorActionPreference
  }
  $Packages = @(Get-ChildItem -LiteralPath $TempDir -Filter "*.tgz" -File)
  if ($PackExitCode -ne 0 -or $Packages.Count -ne 1) {
    $PackOutput | Out-Host
    throw "升级包下载失败。"
  }

  Write-Host "正在停止旧版本服务并安装到独立版本目录..." -ForegroundColor Cyan
  $StopExitCode = Stop-InstalledBridgeForUpgrade -ProjectRoot $ProjectRoot
  if ($StopExitCode -ne 0) { throw "旧版本服务停止失败，无法安全升级。" }

  $InstallResult = Install-BridgeCliSideBySide `
    -PackageFile $Packages[0].FullName `
    -ProjectRoot $ProjectRoot `
    -NpmPrefix $NpmPrefix `
    -ExpectedPackageName $Metadata.name

  & $InstallResult.CliCommand doctor
  if ($LASTEXITCODE -ne 0) { throw "新版本环境自检失败。" }
  if ($WasRunning) {
    & $InstallResult.CliCommand start
    if ($LASTEXITCODE -ne 0) { throw "新版本启动失败。" }
  }

  $TaskUpdated = Update-BridgeScheduledTaskLauncher -LauncherPath $InstallResult.LauncherPath -DataDir $BridgePaths.DataDir
  if ($TaskUpdated) {
    $null = Remove-BridgeLegacyGlobalPackage `
      -PackageDir $GlobalPackageDir `
      -PackageName $Metadata.name `
      -InstallRoot $InstallResult.InstallRoot
  }
  Write-Host "升级完成：$($InstallResult.Version)" -ForegroundColor Green
} catch {
  if ($null -ne $InstallResult) {
    Write-Warning "新版本验证失败，正在恢复升级前入口。"
    Restore-BridgeCliSideBySide -InstallResult $InstallResult
    if ($WasRunning) {
      & $InstallResult.CliCommand start
      if ($LASTEXITCODE -ne 0) { Write-Warning "旧版本入口已恢复，但服务未能自动重启。" }
    }
  }
  throw
} finally {
  Remove-Item -LiteralPath $TempDir -Recurse -Force -ErrorAction SilentlyContinue
}
