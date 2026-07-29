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

function Install-BridgeCliPackageWithRetry {
  param(
    [Parameter(Mandatory = $true)][string]$PackageFile,
    [string]$NpmCommand = "npm.cmd",
    [int]$MaxAttempts = 3,
    [int]$RetryDelayMilliseconds = 3000,
    [string]$GlobalPackageDir
  )

  for ($Attempt = 1; $Attempt -le $MaxAttempts; $Attempt++) {
    $PreviousErrorActionPreference = $ErrorActionPreference
    try {
      $ErrorActionPreference = "Continue"
      & $NpmCommand install -g $PackageFile
      $InstallExitCode = $LASTEXITCODE
    } finally {
      $ErrorActionPreference = $PreviousErrorActionPreference
    }

    if ($InstallExitCode -eq 0) { return }
    if ($Attempt -ge $MaxAttempts) {
      $TargetHint = if ([string]::IsNullOrWhiteSpace($GlobalPackageDir)) { "npm 全局包目录" } else { $GlobalPackageDir }
      throw "CLI 全局安装连续失败 $MaxAttempts 次。Bridge 进程树已停止；请关闭工作目录位于 '$TargetHint' 的终端或文件管理工具，并检查安全软件占用后重试。"
    }

    Write-Warning "CLI 安装失败，可能是 Windows 文件锁尚未释放；即将进行第 $($Attempt + 1)/$MaxAttempts 次尝试。"
    Start-Sleep -Milliseconds ($RetryDelayMilliseconds * $Attempt)
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
