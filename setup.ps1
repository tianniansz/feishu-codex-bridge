param()

$ErrorActionPreference = "Stop"
$ProjectRoot = (Resolve-Path -LiteralPath $PSScriptRoot).Path
Set-Location -LiteralPath $ProjectRoot
. (Join-Path $ProjectRoot "scripts\windows-helpers.ps1")
$BridgePaths = Get-BridgeDataPaths -ProjectRoot $ProjectRoot
$env:FEISHU_CODEX_ENV_FILE = $BridgePaths.ConfigFile

function Require-Command {
  param([string]$Name, [string]$Guide)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "未找到 $Name。$Guide"
  }
}

function Offer-Install {
  param([string]$Command, [string]$Question, [scriptblock]$Installer)
  if (Get-Command $Command -ErrorAction SilentlyContinue) { return }
  $Answer = Read-WithDefault $Question "y"
  if ($Answer -notmatch "^(y|yes)$") { throw "缺少必要命令：$Command" }
  & $Installer
  if ($LASTEXITCODE -ne 0 -or -not (Get-Command $Command -ErrorAction SilentlyContinue)) {
    throw "$Command 安装失败，请查看 docs\INSTALLATION.md 手动安装。"
  }
}

function Read-WithDefault {
  param([string]$Prompt, [string]$Default)
  $Value = Read-Host "$Prompt [$Default]"
  if ([string]::IsNullOrWhiteSpace($Value)) { return $Default }
  return $Value.Trim()
}

function Get-NodeMajorVersion {
  if (-not (Get-Command "node" -ErrorAction SilentlyContinue)) { return $null }
  try {
    return [int]((& node --version).TrimStart("v").Split(".")[0])
  } catch {
    return $null
  }
}

function Ensure-Node {
  $NodeMajor = Get-NodeMajorVersion
  if ($null -ne $NodeMajor -and $NodeMajor -ge 20) { return }

  $Reason = if ($null -eq $NodeMajor) { "未找到 Node.js" } else { "Node.js 版本过低（当前主版本：$NodeMajor）" }
  Write-Host "$Reason，需要安装 Node.js 20 或更高版本。" -ForegroundColor Yellow

  $Installed = $false
  if (Get-Command "winget" -ErrorAction SilentlyContinue) {
    $Answer = Read-WithDefault "是否通过 winget 自动安装 Node.js LTS？输入 y 或 n" "y"
    if ($Answer -match "^(y|yes)$") {
      & winget install --id OpenJS.NodeJS.LTS --exact --silent --accept-package-agreements --accept-source-agreements
      $Installed = $LASTEXITCODE -eq 0
      Refresh-BridgeProcessPath
    }
  }

  $DetectedNodeMajor = Get-NodeMajorVersion
  if (-not $Installed -or $null -eq $DetectedNodeMajor -or $DetectedNodeMajor -lt 20) {
    $DownloadUrl = "https://nodejs.org/en/download"
    Write-Host "无法自动完成安装，请安装 Node.js LTS：$DownloadUrl" -ForegroundColor Yellow
    $OpenPage = Read-WithDefault "是否打开官方下载页面？输入 y 或 n" "y"
    if ($OpenPage -match "^(y|yes)$") {
      try { Start-Process $DownloadUrl } catch { Write-Host "无法打开浏览器，请手动访问上面的地址。" -ForegroundColor Yellow }
    }
    Read-Host "安装完成后回到此窗口，按 Enter 继续检测"
    Refresh-BridgeProcessPath
  }

  $NodeMajor = Get-NodeMajorVersion
  if ($null -eq $NodeMajor -or $NodeMajor -lt 20) {
    throw "仍未检测到 Node.js 20 或更高版本。请完成安装后重新运行 .\setup.ps1。"
  }
  Write-Host "Node.js 已就绪：$(& node --version)" -ForegroundColor Green
}

function Install-And-RunBridgeCli {
  $UseCli = Read-WithDefault "是否安装统一管理命令 feishu-codex-bridge？输入 y 或 n" "y"
  if ($UseCli -notmatch "^(y|yes)$") { return }

  $TempDir = [IO.Path]::GetTempPath()
  $PackageFile = Get-BridgePackageArchivePath -ProjectRoot $ProjectRoot -Destination $TempDir
  Remove-Item -LiteralPath $PackageFile -Force -ErrorAction SilentlyContinue
  try {
    & npm.cmd pack --silent --pack-destination $TempDir | Out-Host
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $PackageFile -PathType Leaf)) {
      throw "CLI 安装包生成失败：未找到 $PackageFile"
    }
    & npm.cmd install -g $PackageFile
    if ($LASTEXITCODE -ne 0) { throw "CLI 全局安装失败。" }
  } finally {
    Remove-Item -LiteralPath $PackageFile -Force -ErrorAction SilentlyContinue
  }

  $NpmPrefix = (& npm.cmd prefix -g | Select-Object -Last 1).Trim()
  $CliCommand = Join-Path $NpmPrefix "feishu-codex-bridge.cmd"
  if (-not (Test-Path -LiteralPath $CliCommand -PathType Leaf)) {
    throw "CLI 已安装但未找到命令入口。请重新打开 PowerShell 后运行 feishu-codex-bridge setup。"
  }

  Write-Host "统一管理命令安装完成，继续进入配置向导。" -ForegroundColor Green
  & $CliCommand setup
  if ($LASTEXITCODE -ne 0) {
    throw "CLI 配置向导退出，代码 $LASTEXITCODE。请直接运行 feishu-codex-bridge setup 查看原始错误。"
  }
  exit 0
}

function Ensure-CodexLogin {
  if (Test-CodexLoginStatus) { return }

  Write-Host "Codex CLI 尚未登录。" -ForegroundColor Yellow
  $LoginNow = Read-WithDefault "是否现在运行 codex login？输入 y 或 n" "y"
  if ($LoginNow -notmatch "^(y|yes)$") {
    throw "需要先完成 Codex 登录，然后重新运行 feishu-codex-bridge setup。"
  }
  & codex login
  if ($LASTEXITCODE -ne 0) { throw "Codex 登录未完成。" }
  if (-not (Test-CodexLoginStatus)) { throw "Codex 登录状态仍不可用。" }
}

Write-Host "Feishu Codex Bridge 配置向导" -ForegroundColor Cyan
Write-Host ""

Ensure-Node
Require-Command "npm" "Node.js 安装不完整，请重新安装 Node.js。"
if (-not $BridgePaths.CliMode) { Install-And-RunBridgeCli }
Offer-Install "codex" "未找到 Codex CLI，是否通过 npm 安装？输入 y 或 n" { npm install -g @openai/codex }
Ensure-CodexLogin
Offer-Install "lark-cli" "未找到 lark-cli，是否安装飞书官方 CLI？输入 y 或 n" { npx.cmd --yes @larksuite/cli@latest install }

$Profile = Read-WithDefault "请输入 lark-cli Profile 名称" "codex-bridge"
if (-not (Test-LarkProfile -Profile $Profile)) {
  Write-Host "Profile '$Profile' 不存在或当前不可用。" -ForegroundColor Yellow
  $Create = Read-WithDefault "是否现在创建新的飞书应用 Profile？输入 y 或 n" "y"
  if ($Create -notmatch "^(y|yes)$") {
    throw "需要有效的 lark-cli Profile。可运行 lark-cli config init --new 后重新执行 setup.ps1。"
  }

  $Profile = Read-WithDefault "请输入新 Profile 名称" "${Profile}-new"
  & lark-cli config init --new --name $Profile --lang zh_cn
  if ($LASTEXITCODE -ne 0) { throw "飞书应用初始化失败。" }
  if (-not (Test-LarkProfile -Profile $Profile)) {
    throw "Profile '$Profile' 仍不可用。请确认飞书应用已开启机器人能力、权限已配置并发布，然后重新运行 setup.ps1。"
  }
}

$DefaultWorkspace = if (-not [string]::IsNullOrWhiteSpace($env:FEISHU_CODEX_SETUP_CWD)) {
  $env:FEISHU_CODEX_SETUP_CWD
} elseif ($BridgePaths.CliMode) {
  [Environment]::GetFolderPath("MyDocuments")
} else {
  Split-Path -Parent $ProjectRoot
}
$Workspace = Read-WithDefault "请输入允许远程操作的 Codex 项目根目录" $DefaultWorkspace
if (-not (Test-Path -LiteralPath $Workspace -PathType Container)) {
  throw "目录不存在：$Workspace"
}
$Workspace = (Resolve-Path -LiteralPath $Workspace).Path

$EnvContent = @"
LARK_CLI_PROFILE=$Profile
ALLOWED_WORKSPACE_ROOTS=$Workspace
ALLOW_CREATE_TASK=false
ALLOW_GROUP_CHATS=false
LARK_CLI_BIN=lark-cli.cmd
LARK_EVENT_AS=bot
LARK_CLI_REPLY_AS=bot
CODEX_BIN=codex
CODEX_APP_SERVER_TIMEOUT_MS=3600000
TASK_LIMIT=50
TASK_PAGE_SIZE=8
RUNNING_NOTICE_DELAY_MS=180000
PROGRESS_NOTICE_INTERVAL_MS=60000
PAIRING_TTL_MINUTES=10
RUNTIME_DIR=$($BridgePaths.RuntimeDir)
"@
New-Item -ItemType Directory -Path $BridgePaths.DataDir -Force | Out-Null
Set-Content -LiteralPath $BridgePaths.ConfigFile -Value $EnvContent -Encoding UTF8
New-Item -ItemType Directory -Path $BridgePaths.RuntimeDir -Force | Out-Null

Write-Host ""
& node scripts/doctor.mjs
if ($LASTEXITCODE -ne 0) { throw "环境自检失败，请按上方提示处理。" }

Write-Host ""
& node scripts/pairing.mjs
Write-Host ""
$StartGuide = if ($BridgePaths.CliMode) { "feishu-codex-bridge start" } else { ".\start.ps1" }
Write-Host "配置完成。运行 $StartGuide 启动服务。" -ForegroundColor Green
