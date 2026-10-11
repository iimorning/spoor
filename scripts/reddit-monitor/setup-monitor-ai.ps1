[CmdletBinding()]
param(
  [string]$ApiKey,
  [string]$BaseUrl = 'https://ark.cn-beijing.volces.com/api/v3',
  [string]$Model = 'doubao-seed-2-1-turbo-260628',
  [string]$Provider = 'openai-compatible'
)

$ErrorActionPreference = 'Stop'

if (-not $ApiKey) {
  $secure = Read-Host 'Enter an OpenAI-compatible API key (input hidden)' -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    $ApiKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

$values = @{
  REDDIT_MONITOR_AI_API_KEY = $ApiKey
  REDDIT_MONITOR_AI_BASE_URL = $BaseUrl
  REDDIT_MONITOR_AI_MODEL = $Model
  REDDIT_MONITOR_AI_PROVIDER = $Provider
}

foreach ($entry in $values.GetEnumerator()) {
  if ([string]::IsNullOrWhiteSpace([string]$entry.Value)) {
    throw "$($entry.Key) cannot be empty"
  }
  if ([string]$entry.Value -match "[`r`n]") {
    throw "$($entry.Key) cannot contain newlines"
  }
}

$target = Join-Path $PSScriptRoot '.env.local'
$content = @(
  '# Reddit monitor server-side AI configuration. DO NOT COMMIT.'
  "REDDIT_MONITOR_AI_API_KEY=$ApiKey"
  "REDDIT_MONITOR_AI_BASE_URL=$BaseUrl"
  "REDDIT_MONITOR_AI_MODEL=$Model"
  "REDDIT_MONITOR_AI_PROVIDER=$Provider"
) -join [Environment]::NewLine

[IO.File]::WriteAllText($target, "$content$([Environment]::NewLine)", [Text.UTF8Encoding]::new($false))
Write-Host "AI configuration saved to $target" -ForegroundColor Green
Write-Host 'If the monitor is running, stop it and run start-monitor.cmd again.'
