[CmdletBinding()]
param(
  [string]$WorkflowName = 'Spoor · Reddit RSS monitor (note-taking pain points)',
  [string]$WorkflowId = $env:SPOOR_N8N_WORKFLOW_ID,
  [switch]$SkipRun,
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$monitorDir = $PSScriptRoot
$repoRoot = (Resolve-Path (Join-Path $monitorDir '..\..')).Path
$dataDir = Join-Path $monitorDir 'data'
$composeFile = Join-Path $repoRoot 'n8n-only-compose.yml'
$viewerUrl = 'http://localhost:3780/'
$n8nUrl = 'http://localhost:5678/'

function Invoke-Native {
  param(
    [Parameter(Mandatory)][string]$FilePath,
    [Parameter(Mandatory)][string[]]$Arguments,
    [switch]$Quiet
  )

  if ($Quiet) {
    $previousErrorAction = $ErrorActionPreference
    try {
      $ErrorActionPreference = 'Continue'
      $output = & $FilePath @Arguments 2>&1
      $exitCode = $LASTEXITCODE
    } finally {
      $ErrorActionPreference = $previousErrorAction
    }
    if ($exitCode -ne 0) {
      $output | Select-Object -Last 40 | ForEach-Object { Write-Host $_ -ForegroundColor Red }
      throw "$FilePath failed with exit code $exitCode"
    }
  } else {
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
      throw "$FilePath failed with exit code $LASTEXITCODE"
    }
  }
}

function Test-ListeningPort {
  param([Parameter(Mandatory)][int]$Port)
  return $null -ne (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

function Wait-ListeningPort {
  param(
    [Parameter(Mandatory)][int]$Port,
    [int]$TimeoutSeconds = 20
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-ListeningPort -Port $Port) { return }
    Start-Sleep -Milliseconds 300
  }
  throw "Timed out waiting for localhost:$Port"
}

Write-Host '[1/4] Checking Docker...'
Invoke-Native -FilePath 'docker' -Arguments @('info') -Quiet

$containerExists = $true
& docker inspect n8n *> $null
if ($LASTEXITCODE -ne 0) { $containerExists = $false }

if (-not $containerExists) {
  Write-Host 'Creating n8n from n8n-only-compose.yml...'
  Invoke-Native -FilePath 'docker' -Arguments @(
    'compose', '-f', $composeFile, 'up', '-d'
  )
} else {
  $containerState = (& docker inspect n8n --format '{{.State.Status}}').Trim()
  if ($containerState -ne 'running') {
    Write-Host 'Starting the existing n8n container...'
    Invoke-Native -FilePath 'docker' -Arguments @('start', 'n8n')
  }
}

Write-Host '[2/4] Starting the monitor viewer...'
if (-not (Test-ListeningPort -Port 3780)) {
  $node = (Get-Command node -ErrorAction Stop).Source
  Start-Process `
    -FilePath $node `
    -ArgumentList @('serve.mjs', '--host=127.0.0.1') `
    -WorkingDirectory $monitorDir `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $env:TEMP 'spoor-reddit-monitor.out.log') `
    -RedirectStandardError (Join-Path $env:TEMP 'spoor-reddit-monitor.err.log')
  Wait-ListeningPort -Port 3780
}

if (-not $SkipRun) {
  Write-Host '[3/4] Locating and executing the n8n workflow...'
  if ([string]::IsNullOrWhiteSpace($WorkflowId)) {
    $workflowLines = & docker exec n8n n8n list:workflow 2>&1
    if ($LASTEXITCODE -ne 0) {
      throw 'Could not list workflows from the n8n container.'
    }

    foreach ($line in $workflowLines) {
      if ($line -match '^([^|]+)\|(.+)$' -and $Matches[2].Trim() -eq $WorkflowName) {
        $WorkflowId = $Matches[1].Trim()
        break
      }
    }
    if ([string]::IsNullOrWhiteSpace($WorkflowId)) {
      throw "Workflow not found: $WorkflowName"
    }
  }

  # n8n CLI execution starts its own task broker, so the main n8n container
  # must be paused briefly. The named volume keeps all workflows and settings.
  Invoke-Native -FilePath 'docker' -Arguments @('stop', 'n8n')
  $executionFailed = $false
  try {
    $executorName = "spoor-n8n-executor-$PID"
    Invoke-Native -FilePath 'docker' -Arguments @(
      'run', '--rm',
      '--name', $executorName,
      '-v', 'n8n_data:/home/node/.n8n',
      '-v', "${dataDir}:/data",
      '-e', 'N8N_RESTRICT_FILE_ACCESS_TO=/data',
      '-e', 'TZ=Asia/Shanghai',
      'n8nio/n8n:latest',
      'execute', "--id=$WorkflowId"
    ) -Quiet
  } catch {
    $executionFailed = $true
    Write-Error $_
  } finally {
    Invoke-Native -FilePath 'docker' -Arguments @('start', 'n8n')
  }
  if ($executionFailed) {
    throw 'The workflow failed. n8n has been restarted; review the error above.'
  }
} else {
  Write-Host '[3/4] Immediate workflow execution skipped.'
}

Write-Host '[4/4] Ready.'
Write-Host "Viewer: $viewerUrl"
Write-Host "n8n:    $n8nUrl"

if (-not $NoBrowser) {
  Start-Process $viewerUrl
}
