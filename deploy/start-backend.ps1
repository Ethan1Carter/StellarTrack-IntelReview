param(
  [int]$Port = 3000
)

$ErrorActionPreference = 'Stop'
$serverRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $serverRoot '.env'

if (-not (Test-Path -LiteralPath $envFile)) {
  Copy-Item -LiteralPath (Join-Path $serverRoot '.env.example') -Destination $envFile
  Write-Host '已创建 server/.env。请先填写数据库连接信息和 JWT_SECRET，再重新运行本脚本。'
  exit 1
}

$env:PORT = $Port
Set-Location $serverRoot
npm ci
npm run start
