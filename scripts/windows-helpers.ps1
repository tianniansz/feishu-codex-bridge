function Normalize-BridgeProcessPath {
  if (-not $IsWindows -and $PSVersionTable.PSEdition -eq "Core") { return }

  $CurrentPath = $env:Path
  if ([string]::IsNullOrWhiteSpace($CurrentPath)) { return }

  # Start-Process builds a case-insensitive environment dictionary on Windows.
  # Parent processes may contain both Path and PATH, which otherwise throws.
  [Environment]::SetEnvironmentVariable("PATH", $null, "Process")
  [Environment]::SetEnvironmentVariable("Path", $CurrentPath, "Process")
}

function Refresh-BridgeProcessPath {
  $MachinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $Parts = @($MachinePath, $UserPath) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
  if ($Parts.Count -gt 0) {
    [Environment]::SetEnvironmentVariable("PATH", $null, "Process")
    [Environment]::SetEnvironmentVariable("Path", ($Parts -join ";"), "Process")
  }
}

function Get-BridgeGlobalPackageDir {
  param(
    [Parameter(Mandatory = $true)][string]$NpmPrefix,
    [Parameter(Mandatory = $true)][string]$PackageName
  )

  $PackageParts = @($PackageName -split "/" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
  if ($PackageParts.Count -eq 0) { throw "无效的 npm 包名：$PackageName" }
  $Result = Join-Path $NpmPrefix "node_modules"
  foreach ($Part in $PackageParts) { $Result = Join-Path $Result $Part }
  return [IO.Path]::GetFullPath($Result)
}

function Get-BridgeInstallRoot {
  param([string]$LocalAppData = [Environment]::GetFolderPath("LocalApplicationData"))

  if ([string]::IsNullOrWhiteSpace($LocalAppData)) { throw "无法确定当前 Windows 用户的本地数据目录。" }
  return Join-Path (Join-Path ([IO.Path]::GetFullPath($LocalAppData)) "FeishuCodexBridge") "install"
}

function Write-BridgeUtf8File {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [AllowEmptyString()][string]$Content
  )

  $Parent = Split-Path -Parent $Path
  if (-not [string]::IsNullOrWhiteSpace($Parent)) { New-Item -ItemType Directory -Path $Parent -Force | Out-Null }
  [IO.File]::WriteAllText($Path, $Content, [Text.UTF8Encoding]::new($false))
}

function Set-BridgeFileAtomically {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [AllowEmptyString()][string]$Content
  )

  $Temporary = "$Path.new-$PID-$([Guid]::NewGuid().ToString('N'))"
  try {
    Write-BridgeUtf8File -Path $Temporary -Content $Content
    Move-Item -LiteralPath $Temporary -Destination $Path -Force
  } finally {
    Remove-Item -LiteralPath $Temporary -Force -ErrorAction SilentlyContinue
  }
}

function Install-BridgeCliSideBySide {
  param(
    [Parameter(Mandatory = $true)][string]$PackageFile,
    [Parameter(Mandatory = $true)][string]$ProjectRoot,
    [string]$InstallRoot = (Get-BridgeInstallRoot),
    [string]$NpmPrefix = ((& npm.cmd prefix -g | Select-Object -Last 1).Trim()),
    [string]$TarCommand = "tar.exe",
    [string]$NodeCommand = "node",
    [string]$ExpectedPackageName
  )

  if ([string]::IsNullOrWhiteSpace($ExpectedPackageName)) {
    $ProjectMetadata = Get-Content -LiteralPath (Join-Path $ProjectRoot "package.json") -Raw -Encoding UTF8 | ConvertFrom-Json
    $ExpectedPackageName = [string]$ProjectMetadata.name
  }
  if ([string]::IsNullOrWhiteSpace($ExpectedPackageName)) { throw "无法确定预期 npm 包名。" }

  $VersionsDir = Join-Path $InstallRoot "versions"
  $StagingDir = Join-Path $InstallRoot ".staging-$PID-$([Guid]::NewGuid().ToString('N'))"
  $ExtractedPackageDir = Join-Path $StagingDir "package"
  $LauncherSource = Join-Path $ProjectRoot "scripts\stable-launcher.mjs"
  $LauncherPath = Join-Path $InstallRoot "launcher.mjs"
  $CurrentFile = Join-Path $InstallRoot "current.json"
  $CliCommand = Join-Path $NpmPrefix "feishu-codex-bridge.cmd"
  $ShimPaths = @(
    $CliCommand,
    (Join-Path $NpmPrefix "feishu-codex-bridge.ps1"),
    (Join-Path $NpmPrefix "feishu-codex-bridge")
  )
  $PreviousCurrentExists = Test-Path -LiteralPath $CurrentFile -PathType Leaf
  $PreviousCurrent = if ($PreviousCurrentExists) { Get-Content -LiteralPath $CurrentFile -Raw -Encoding UTF8 } else { $null }
  $PreviousShims = @()
  foreach ($ShimPath in $ShimPaths) {
    $Exists = Test-Path -LiteralPath $ShimPath -PathType Leaf
    $PreviousShims += [pscustomobject]@{
      Path = $ShimPath
      Exists = $Exists
      Content = if ($Exists) { Get-Content -LiteralPath $ShimPath -Raw -Encoding UTF8 } else { $null }
    }
  }

  New-Item -ItemType Directory -Path $VersionsDir -Force | Out-Null
  New-Item -ItemType Directory -Path $StagingDir -Force | Out-Null
  try {
    & $TarCommand -xf $PackageFile -C $StagingDir
    if ($LASTEXITCODE -ne 0) { throw "CLI 安装包解压失败，退出码 $LASTEXITCODE。" }
    $ExtractedMetadataPath = Join-Path $ExtractedPackageDir "package.json"
    if (-not (Test-Path -LiteralPath $ExtractedMetadataPath -PathType Leaf)) { throw "CLI 安装包缺少 package.json。" }
    $ExtractedMetadata = Get-Content -LiteralPath $ExtractedMetadataPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($ExtractedMetadata.name -ne $ExpectedPackageName -or [string]::IsNullOrWhiteSpace($ExtractedMetadata.version)) {
      throw "CLI 安装包元数据不匹配：$($ExtractedMetadata.name)@$($ExtractedMetadata.version)。"
    }
    $TargetDir = Join-Path $VersionsDir ([string]$ExtractedMetadata.version)
    $ExtractedCli = Join-Path $ExtractedPackageDir "bin\cli.js"
    $ReportedVersion = (& $NodeCommand $ExtractedCli version | Select-Object -Last 1).Trim()
    if ($LASTEXITCODE -ne 0 -or $ReportedVersion -ne $ExtractedMetadata.version) {
      throw "CLI 安装包验证失败：预期 $($ExtractedMetadata.version)，实际 $ReportedVersion。"
    }

    if (-not (Test-Path -LiteralPath $TargetDir -PathType Container)) {
      Move-Item -LiteralPath $ExtractedPackageDir -Destination $TargetDir
    }
    if (-not (Test-Path -LiteralPath (Join-Path $TargetDir "bin\cli.js") -PathType Leaf)) {
      throw "版本目录不完整：$TargetDir"
    }

    $LauncherContent = Get-Content -LiteralPath $LauncherSource -Raw -Encoding UTF8
    Set-BridgeFileAtomically -Path $LauncherPath -Content $LauncherContent
    $CurrentContent = [ordered]@{
      version = [string]$ExtractedMetadata.version
      packageRoot = [IO.Path]::GetFullPath($TargetDir)
      updatedAt = [DateTime]::UtcNow.ToString("o")
    } | ConvertTo-Json
    Set-BridgeFileAtomically -Path $CurrentFile -Content $CurrentContent

    $EscapedLauncherForCmd = $LauncherPath.Replace("%", "%%")
    Set-BridgeFileAtomically -Path $ShimPaths[0] -Content "@echo off`r`nnode `"$EscapedLauncherForCmd`" %*`r`n"
    $EscapedLauncherForPowerShell = $LauncherPath.Replace("'", "''")
    Set-BridgeFileAtomically -Path $ShimPaths[1] -Content "#!/usr/bin/env pwsh`n& node '$EscapedLauncherForPowerShell' @args`nexit `$LASTEXITCODE`n"
    $LauncherForShell = $LauncherPath.Replace("\", "/").Replace('"', '\"')
    Set-BridgeFileAtomically -Path $ShimPaths[2] -Content "#!/bin/sh`nexec node `"$LauncherForShell`" `"`$@`"`n"
  } catch {
    if ($PreviousCurrentExists) {
      Set-BridgeFileAtomically -Path $CurrentFile -Content $PreviousCurrent
    } else {
      Remove-Item -LiteralPath $CurrentFile -Force -ErrorAction SilentlyContinue
    }
    foreach ($PreviousShim in $PreviousShims) {
      if ($PreviousShim.Exists) {
        Set-BridgeFileAtomically -Path $PreviousShim.Path -Content $PreviousShim.Content
      } else {
        Remove-Item -LiteralPath $PreviousShim.Path -Force -ErrorAction SilentlyContinue
      }
    }
    throw
  } finally {
    Remove-Item -LiteralPath $StagingDir -Recurse -Force -ErrorAction SilentlyContinue
  }

  return [pscustomobject]@{
    Name = [string]$ExtractedMetadata.name
    Version = [string]$ExtractedMetadata.version
    PackageRoot = [IO.Path]::GetFullPath($TargetDir)
    InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
    LauncherPath = $LauncherPath
    CurrentFile = $CurrentFile
    CliCommand = $CliCommand
    PreviousCurrentExists = $PreviousCurrentExists
    PreviousCurrent = $PreviousCurrent
    PreviousShims = $PreviousShims
  }
}

function Update-BridgeScheduledTaskLauncher {
  param(
    [Parameter(Mandatory = $true)][string]$LauncherPath,
    [Parameter(Mandatory = $true)][string]$DataDir
  )

  $TaskName = "FeishuCodexBridge-$($env:USERNAME)"
  $PreviousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    & schtasks.exe /Query /TN $TaskName 1>$null 2>$null
    $QueryExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $PreviousErrorActionPreference
  }
  if ($QueryExitCode -ne 0) { return $true }

  $NodePath = (Get-Command "node" -ErrorAction Stop).Source
  $TaskCommand = "`"$NodePath`" `"$LauncherPath`" --home `"$DataDir`" start"
  try {
    $ErrorActionPreference = "Continue"
    & schtasks.exe /Change /TN $TaskName /TR $TaskCommand 1>$null
    $ChangeExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $PreviousErrorActionPreference
  }
  if ($ChangeExitCode -ne 0) {
    Write-Warning "自动启动任务未能切换到稳定启动器，已保留旧 npm 包目录：$TaskName"
    return $false
  }
  return $true
}

function Restore-BridgeCliSideBySide {
  param([Parameter(Mandatory = $true)]$InstallResult)

  if ($InstallResult.PreviousCurrentExists) {
    Set-BridgeFileAtomically -Path $InstallResult.CurrentFile -Content $InstallResult.PreviousCurrent
  } else {
    Remove-Item -LiteralPath $InstallResult.CurrentFile -Force -ErrorAction SilentlyContinue
  }
  foreach ($PreviousShim in $InstallResult.PreviousShims) {
    if ($PreviousShim.Exists) {
      Set-BridgeFileAtomically -Path $PreviousShim.Path -Content $PreviousShim.Content
    } else {
      Remove-Item -LiteralPath $PreviousShim.Path -Force -ErrorAction SilentlyContinue
    }
  }
}

function Remove-BridgeLegacyGlobalPackage {
  param(
    [Parameter(Mandatory = $true)][string]$PackageDir,
    [Parameter(Mandatory = $true)][string]$PackageName,
    [Parameter(Mandatory = $true)][string]$InstallRoot
  )

  if (-not (Test-Path -LiteralPath $PackageDir -PathType Container)) { return $true }
  $MetadataPath = Join-Path $PackageDir "package.json"
  try {
    $Metadata = Get-Content -LiteralPath $MetadataPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($Metadata.name -ne $PackageName) { throw "拒绝清理名称不匹配的目录：$PackageDir" }
    Remove-Item -LiteralPath $PackageDir -Recurse -Force -ErrorAction Stop
    return $true
  } catch {
    $PendingFile = Join-Path $InstallRoot "pending-cleanup.json"
    $Pending = [ordered]@{ packageDir = $PackageDir; packageName = $PackageName; recordedAt = [DateTime]::UtcNow.ToString("o") }
    Set-BridgeFileAtomically -Path $PendingFile -Content ($Pending | ConvertTo-Json)
    Write-Warning "旧版本目录仍被占用，已延迟清理，不影响当前升级：$PackageDir"
    return $false
  }
}

function Get-BridgeDescendantProcessIds {
  param([Parameter(Mandatory = $true)][int]$RootProcessId)

  $Seen = @{}
  $Pending = New-Object System.Collections.Queue
  $Pending.Enqueue($RootProcessId)
  while ($Pending.Count -gt 0) {
    $ParentId = [int]$Pending.Dequeue()
    try {
      $Children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $ParentId" -ErrorAction SilentlyContinue)
    } catch {
      $Children = @()
    }
    foreach ($Child in $Children) {
      $ChildId = [int]$Child.ProcessId
      if ($ChildId -le 0 -or $Seen.ContainsKey($ChildId)) { continue }
      $Seen[$ChildId] = $true
      $Pending.Enqueue($ChildId)
    }
  }
  return @($Seen.Keys | ForEach-Object { [int]$_ })
}

function Wait-BridgeProcessIdsExit {
  param(
    [int[]]$ProcessIds = @(),
    [int]$TimeoutMilliseconds = 5000
  )

  $Deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMilliseconds)
  do {
    $Remaining = @($ProcessIds | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue })
    if ($Remaining.Count -eq 0) { return @() }
    Start-Sleep -Milliseconds 250
  } while ([DateTime]::UtcNow -lt $Deadline)
  return @($Remaining | ForEach-Object { [int]$_ })
}

function Stop-InstalledBridgeForUpgrade {
  param(
    [Parameter(Mandatory = $true)][string]$ProjectRoot,
    [string]$DataDir = $env:FEISHU_CODEX_HOME
  )

  if ([string]::IsNullOrWhiteSpace($DataDir)) {
    $LocalAppData = [Environment]::GetFolderPath("LocalApplicationData")
    if ([string]::IsNullOrWhiteSpace($LocalAppData)) {
      throw "无法确定当前 Windows 用户的本地数据目录。"
    }
    $DataDir = Join-Path $LocalAppData "FeishuCodexBridge"
  }

  $PreviousHome = [Environment]::GetEnvironmentVariable("FEISHU_CODEX_HOME", "Process")
  $PreviousErrorActionPreference = $ErrorActionPreference
  $PowerShellExe = (Get-Process -Id $PID).Path
  $StopScript = Join-Path $ProjectRoot "stop.ps1"
  $PidFile = Join-Path (Join-Path $DataDir "runtime") "bridge.pid"
  $TrackedProcessIds = @()
  if (Test-Path -LiteralPath $PidFile -PathType Leaf) {
    $BridgePidText = (Get-Content -LiteralPath $PidFile -Raw).Trim()
    $BridgePid = 0
    if ([int]::TryParse($BridgePidText, [ref]$BridgePid) -and $BridgePid -gt 0) {
      $TrackedProcessIds = @($BridgePid) + @(Get-BridgeDescendantProcessIds -RootProcessId $BridgePid)
    }
  }
  try {
    $env:FEISHU_CODEX_HOME = [IO.Path]::GetFullPath($DataDir)
    $ErrorActionPreference = "Continue"
    $StopOutput = & $PowerShellExe -NoProfile -ExecutionPolicy Bypass -File $StopScript 2>&1
    $StopExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $PreviousErrorActionPreference
    if ($null -eq $PreviousHome) {
      Remove-Item Env:\FEISHU_CODEX_HOME -ErrorAction SilentlyContinue
    } else {
      $env:FEISHU_CODEX_HOME = $PreviousHome
    }
  }
  if ($StopOutput) { $StopOutput | Out-Host }
  if ($StopExitCode -ne 0) { return [int]$StopExitCode }

  $RemainingProcessIds = @(Wait-BridgeProcessIdsExit -ProcessIds $TrackedProcessIds -TimeoutMilliseconds 5000)
  if ($RemainingProcessIds.Count -gt 0) {
    Write-Warning "Bridge 子进程未随主服务退出，将停止已确认的进程：$($RemainingProcessIds -join ', ')"
    foreach ($ProcessId in $RemainingProcessIds) {
      Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
    }
    $RemainingProcessIds = @(Wait-BridgeProcessIdsExit -ProcessIds $RemainingProcessIds -TimeoutMilliseconds 5000)
    if ($RemainingProcessIds.Count -gt 0) {
      Write-Warning "以下 Bridge 进程仍未退出：$($RemainingProcessIds -join ', ')"
      return 1
    }
  }

  # Give Windows a short, deterministic window to release cwd/module handles.
  Start-Sleep -Milliseconds 1500
  return [int]$StopExitCode
}

function Get-BridgeDataPaths {
  param([string]$ProjectRoot)

  $RequestedDir = $env:FEISHU_CODEX_HOME
  if ([string]::IsNullOrWhiteSpace($RequestedDir)) {
    return [pscustomobject]@{
      DataDir = $ProjectRoot
      ConfigFile = Join-Path $ProjectRoot ".env"
      RuntimeDir = Join-Path $ProjectRoot ".runtime"
      CliMode = $false
    }
  }

  $DataDir = [IO.Path]::GetFullPath($RequestedDir)
  return [pscustomobject]@{
    DataDir = $DataDir
    ConfigFile = Join-Path $DataDir "config.env"
    RuntimeDir = Join-Path $DataDir "runtime"
    CliMode = $true
  }
}

function Get-BridgePackageArchivePath {
  param(
    [string]$ProjectRoot,
    [string]$Destination
  )

  $PackageJsonPath = Join-Path $ProjectRoot "package.json"
  $Metadata = Get-Content -LiteralPath $PackageJsonPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if ([string]::IsNullOrWhiteSpace($Metadata.name) -or [string]::IsNullOrWhiteSpace($Metadata.version)) {
    throw "package.json must include name and version."
  }
  $ArchiveName = [string]$Metadata.name
  if ($ArchiveName.Length -gt 0 -and $ArchiveName[0] -eq [char]64) {
    $ArchiveName = $ArchiveName.Substring(1)
  }
  $ArchiveName = $ArchiveName.Replace([char]47, [char]45).Replace([char]92, [char]45)
  return Join-Path $Destination "$ArchiveName-$($Metadata.version).tgz"
}

function Test-CodexLoginStatus {
  if ([string]::IsNullOrWhiteSpace($env:ComSpec)) { return $false }
  & $env:ComSpec /d /c "codex login status 1>nul 2>nul"
  return $LASTEXITCODE -eq 0
}

function Test-LarkWhoamiOutput {
  param([string]$Json)

  if ([string]::IsNullOrWhiteSpace($Json)) { return $false }
  try {
    $Status = $Json | ConvertFrom-Json
  } catch {
    return $false
  }

  return $Status.ok -ne $false -and $Status.available -ne $false
}

function Test-LarkProfile {
  param(
    [string]$Profile,
    [string]$LarkCli = "lark-cli"
  )

  $Result = Invoke-NativeCommandCapture -Command $LarkCli -Arguments @("--profile", $Profile, "whoami", "--as", "bot")
  if ($Result.ExitCode -ne 0) { return $false }
  return Test-LarkWhoamiOutput $Result.Output
}

function Get-ActiveLarkProfile {
  param([string]$LarkCli = "lark-cli.cmd")

  $Result = Invoke-NativeCommandCapture -Command $LarkCli -Arguments @("config", "show")
  if ($Result.ExitCode -ne 0 -or [string]::IsNullOrWhiteSpace($Result.Output)) { return $null }
  try {
    $Config = $Result.Output | ConvertFrom-Json
  } catch {
    return $null
  }

  if ($Config -is [array]) {
    $Active = @($Config | Where-Object { $_.active -eq $true })
    if ($Active.Count -eq 1 -and -not [string]::IsNullOrWhiteSpace($Active[0].name)) {
      return [string]$Active[0].name
    }
    return $null
  }

  if (-not [string]::IsNullOrWhiteSpace($Config.profile)) { return [string]$Config.profile }
  if (-not [string]::IsNullOrWhiteSpace($Config.name) -and $Config.active -eq $true) { return [string]$Config.name }
  return $null
}

function Invoke-NativeCommandCapture {
  param(
    [string]$Command,
    [string[]]$Arguments = @()
  )

  $PreviousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    $Output = & $Command @Arguments 2>$null | Out-String
    $ExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $PreviousErrorActionPreference
  }
  return [pscustomobject]@{ ExitCode = $ExitCode; Output = $Output }
}

function Get-BridgeConfigValue {
  param([string]$ConfigFile, [string]$Name)

  if (-not (Test-Path -LiteralPath $ConfigFile -PathType Leaf)) { return $null }
  $Prefix = "$Name="
  $Line = Get-Content -LiteralPath $ConfigFile -Encoding UTF8 |
    Where-Object { $_.StartsWith($Prefix, [StringComparison]::OrdinalIgnoreCase) } |
    Select-Object -First 1
  if ($null -eq $Line) { return $null }
  return $Line.Substring($Prefix.Length).Trim()
}

function Test-BridgeHasPairedUser {
  param([string]$RuntimeDir)

  $AccessFile = Join-Path $RuntimeDir "access.json"
  if (-not (Test-Path -LiteralPath $AccessFile -PathType Leaf)) { return $false }
  try {
    $Access = Get-Content -LiteralPath $AccessFile -Raw -Encoding UTF8 | ConvertFrom-Json
    return @($Access.authorizedUsers).Count -gt 0
  } catch {
    return $false
  }
}
