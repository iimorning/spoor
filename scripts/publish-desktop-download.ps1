# Copy the latest built NSIS installer to public/downloads for Netlify deploy.
# Usage (from repo root):
#   .\scripts\publish-desktop-download.ps1
#   npm run build && netlify deploy --prod   # or your usual deploy

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$destDir = Join-Path $root 'public\downloads'
$dest = Join-Path $destDir 'Spoor-latest-x64-setup.exe'

$sources = @(
  (Join-Path $root 'release\Spoor_0.3.0_x64-setup.exe'),
  (Join-Path $root 'src-tauri\target\release\bundle\nsis\Spoor_0.3.0_x64-setup.exe')
)

$src = $sources | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $src) {
  Write-Error "No installer found. Run scripts\tauri-build-release.cmd first."
}

New-Item -ItemType Directory -Force -Path $destDir | Out-Null
Copy-Item -Force $src $dest
Write-Host "Copied $src -> $dest ($((Get-Item $dest).Length) bytes)"
