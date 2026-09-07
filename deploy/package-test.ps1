param(
  [string]$OutputPath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'output\星轨智评测试部署包.zip')
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$stagingRoot = Join-Path $env:TEMP 'xinggui-test-deploy'
$packageRoot = Join-Path $stagingRoot '星轨智评测试部署包'

Remove-Item -LiteralPath $stagingRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $packageRoot -Force | Out-Null

$excludedDirectories = @('node_modules', '.git', '.trae', '.workbuddy', '.env', 'logs', 'backups', 'uploads', 'dist', 'tools', 'output', 'archive', 'qa-verify', 'dist_qa_verify')
$excludedFileNames = @('.env')

Get-ChildItem -LiteralPath $projectRoot -Recurse -Force -File | ForEach-Object {
  $relativePath = $_.FullName.Substring($projectRoot.Length).TrimStart('\')
  $pathParts = $relativePath -split '[\\/]'
  $directoryParts = if ($pathParts.Length -gt 1) { $pathParts[0..($pathParts.Length - 2)] } else { @() }
  $containsExcludedDirectory = $directoryParts | Where-Object { $excludedDirectories -contains $_ }

  if ($containsExcludedDirectory -or $excludedFileNames -contains $_.Name -or $_.Extension -eq '.log') {
    return
  }

  $destinationPath = Join-Path $packageRoot $relativePath
  New-Item -ItemType Directory -Path (Split-Path -Parent $destinationPath) -Force | Out-Null
  Copy-Item -LiteralPath $_.FullName -Destination $destinationPath -Force
}

$serverEnv = Join-Path -Path (Join-Path -Path $packageRoot -ChildPath 'server') -ChildPath '.env'
if (Test-Path -LiteralPath $serverEnv) {
  Remove-Item -LiteralPath $serverEnv -Force
}

New-Item -ItemType Directory -Path (Split-Path -Parent $OutputPath) -Force | Out-Null
if (Test-Path -LiteralPath $OutputPath) {
  Remove-Item -LiteralPath $OutputPath -Force
}
Compress-Archive -LiteralPath $packageRoot -DestinationPath $OutputPath
Remove-Item -LiteralPath $stagingRoot -Recurse -Force
Write-Host "测试部署包已生成：$OutputPath"
