param(
  [string]$OutputPath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'output\星轨智评测试部署包.zip'),
  [switch]$ListOnly
)

$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$excludedDirectories = @('node_modules', '.git', '.agents', '.codex', '.trae', '.workbuddy', '.aws', '.ssh', 'data',
  'logs', 'backups', 'uploads', 'dist', 'tools', 'output', 'tmp', 'archive', 'qa-verify', 'dist_qa_verify')

function Get-PackageFiles([string]$Directory) {
  foreach ($item in Get-ChildItem -LiteralPath $Directory -Force) {
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { continue }
    if ($item.PSIsContainer) {
      if ($item.Name -notin $excludedDirectories) { Get-PackageFiles $item.FullName }
      continue
    }
    if ($item.Name -like '.env*' -and $item.Name -ne '.env.example') { continue }
    if ($item.Name -in @('.npmrc', '.pypirc', '.git-credentials', 'id_rsa', 'id_ed25519')) { continue }
    if ($item.Extension -in @('.log', '.zip', '.sql', '.dump', '.backup', '.pem', '.key', '.pfx')) {
      if ($item.Extension -ne '.sql' -or -not $item.FullName.StartsWith((Join-Path $projectRoot 'server\scripts') + '\', [StringComparison]::OrdinalIgnoreCase)) { continue }
    }
    if ($item.FullName -eq [IO.Path]::GetFullPath($OutputPath)) { continue }
    $item
  }
}

$files = @(Get-PackageFiles $projectRoot)
if ($ListOnly) {
  $files | ForEach-Object { $_.FullName.Substring($projectRoot.Length + 1) }
  exit 0
}

$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$stagingRoot = Join-Path $tempRoot ('xinggui-deploy-' + [Guid]::NewGuid().ToString('N'))
$packageRoot = Join-Path $stagingRoot '星轨智评测试部署包'
try {
  New-Item -ItemType Directory -Path $packageRoot -Force | Out-Null
  foreach ($file in $files) {
    $relativePath = $file.FullName.Substring($projectRoot.Length + 1)
    $destination = Join-Path $packageRoot $relativePath
    New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
    Copy-Item -LiteralPath $file.FullName -Destination $destination
  }
  Set-Content -LiteralPath (Join-Path $packageRoot '.env.production') -Value 'VITE_API_BASE=/api' -Encoding utf8
  $outputFile = [IO.Path]::GetFullPath($OutputPath)
  New-Item -ItemType Directory -Path (Split-Path -Parent $outputFile) -Force | Out-Null
  if (Test-Path -LiteralPath $outputFile) { throw '输出文件已存在，请指定新名称，避免覆盖已有部署包。' }
  Compress-Archive -LiteralPath $packageRoot -DestinationPath $outputFile
  Write-Host "测试部署包已生成：$outputFile"
} finally {
  $resolvedStaging = [IO.Path]::GetFullPath($stagingRoot)
  $expectedParent = [IO.Path]::GetFullPath((Split-Path -Parent $resolvedStaging))
  if ($expectedParent.TrimEnd('\') -eq $tempRoot.TrimEnd('\') -and
      (Split-Path -Leaf $resolvedStaging) -match '^xinggui-deploy-[a-f0-9]{32}$' -and
      (Test-Path -LiteralPath $resolvedStaging)) {
    Remove-Item -LiteralPath $resolvedStaging -Recurse -Force
  }
}
