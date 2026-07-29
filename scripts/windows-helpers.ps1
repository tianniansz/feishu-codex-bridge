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

  $Output = & $LarkCli --profile $Profile whoami --as bot 2>$null | Out-String
  if ($LASTEXITCODE -ne 0) { return $false }
  return Test-LarkWhoamiOutput $Output
}
