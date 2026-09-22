# XINGGUI local one-click start (backend 3000 + frontend 5173)
# Database: local PostgreSQL 17 (service postgresql-x64-17), see server/.env
# NOTE: messages are ASCII so they render correctly in Windows PowerShell 5.1.

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

function Test-Port($port) {
  $conn = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
  return [bool]$conn
}

# database dependency check (kept ASCII-only on purpose: PS 5.1 reads BOM-less files as ANSI)
$pg = Get-Service -Name "postgresql-x64-17" -ErrorAction SilentlyContinue
if (-not $pg) {
  Write-Host "[WARN] PostgreSQL service 'postgresql-x64-17' not found; backend will fail to connect."
} elseif ($pg.Status -ne "Running") {
  Write-Host "[START] PostgreSQL service ..."
  Start-Service -Name "postgresql-x64-17"
} else {
  Write-Host "[SKIP] PostgreSQL service already running"
}

if (Test-Port 3000) {
  Write-Host "[SKIP] backend already listening on 3000"
} else {
  Write-Host "[START] backend http://127.0.0.1:3000 ..."
  Start-Process -FilePath "node" -ArgumentList "app.js" `
    -WorkingDirectory (Join-Path $root "server") `
    -RedirectStandardOutput (Join-Path $root "server\server-live.out.log") `
    -RedirectStandardError  (Join-Path $root "server\server-live.err.log") `
    -WindowStyle Hidden
}

if (Test-Port 5173) {
  Write-Host "[SKIP] frontend already listening on 5173"
} else {
  Write-Host "[START] frontend http://localhost:5173 ..."
  Start-Process -FilePath "npm.cmd" -ArgumentList "run", "dev" `
    -WorkingDirectory $root `
    -RedirectStandardOutput (Join-Path $root "frontend-live.out.log") `
    -RedirectStandardError  (Join-Path $root "frontend-live.err.log") `
    -WindowStyle Hidden
}

Start-Sleep -Seconds 6
Write-Host ""
Write-Host "Frontend : http://localhost:5173"
Write-Host "Backend  : http://127.0.0.1:3000/api/health"
Write-Host "Logs     : server\server-live.out.log / frontend-live*.log"
