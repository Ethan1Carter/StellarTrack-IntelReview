param(
  [int]$Port = 3000
)

$ErrorActionPreference = 'Stop'
$serverRoot = Join-Path (Split-Path -Parent $PSScriptRoot) 'server'
$envFile = Join-Path $serverRoot '.env'

if (-not (Test-Path -LiteralPath $envFile)) {
  Copy-Item -LiteralPath (Join-Path $serverRoot '.env.example') -Destination $envFile
  Write-Host '已创建 server/.env。请先填写数据库连接信息和 JWT_SECRET，再重新运行本脚本。'
  exit 1
}

$env:PORT = $Port
Push-Location $serverRoot
try {
  npm ci
  if ($LASTEXITCODE -ne 0) { throw '后端依赖安装失败，请检查网络和锁文件。' }
  npm run db:check
  if ($LASTEXITCODE -ne 0) { throw '数据库版本未就绪。请先查看 db:status，确认维护窗口并执行 db:upgrade，再启动服务。' }
  npm run start
  if ($LASTEXITCODE -ne 0) { throw '后端服务启动失败，请检查上面的错误信息。' }
} finally {
  Pop-Location
}
