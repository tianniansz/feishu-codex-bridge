function Normalize-BridgeProcessPath {
  if (-not $IsWindows -and $PSVersionTable.PSEdition -eq "Core") { return }

  $CurrentPath = $env:Path
  if ([string]::IsNullOrWhiteSpace($CurrentPath)) { return }

  # Start-Process builds a case-insensitive environment dictionary on Windows.
  # Parent processes may contain both Path and PATH, which otherwise throws.
  [Environment]::SetEnvironmentVariable("PATH", $null, "Process")
  [Environment]::SetEnvironmentVariable("Path", $CurrentPath, "Process")
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
