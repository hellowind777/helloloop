[CmdletBinding()]
param(
  [string]$CodexHome = (Join-Path $HOME ".codex"),
  [switch]$Force
)

$sourceRoot = Split-Path -Parent $PSScriptRoot
$manifestFile = Join-Path $sourceRoot ".codex-plugin\plugin.json"

if (-not (Test-Path $manifestFile)) {
  throw "未找到插件 manifest：$manifestFile"
}

$resolvedCodexHome = [System.IO.Path]::GetFullPath($CodexHome)
$targetPluginsRoot = Join-Path $resolvedCodexHome "plugins"
$targetPluginRoot = Join-Path $targetPluginsRoot "autoloop"
$resolvedTargetPluginRoot = [System.IO.Path]::GetFullPath($targetPluginRoot)

if (-not $resolvedTargetPluginRoot.StartsWith($resolvedCodexHome, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "目标插件目录超出 Codex Home：$resolvedTargetPluginRoot"
}

if (Test-Path $targetPluginRoot) {
  if (-not $Force) {
    throw "目标插件目录已存在：$targetPluginRoot。若要覆盖，请追加 -Force。"
  }
  Remove-Item -LiteralPath $targetPluginRoot -Recurse -Force
}

New-Item -ItemType Directory -Path $targetPluginsRoot -Force | Out-Null
Copy-Item -LiteralPath $sourceRoot -Destination $targetPluginRoot -Recurse -Force

$marketplaceFile = Join-Path $resolvedCodexHome ".agents\plugins\marketplace.json"
$marketplaceDir = Split-Path -Parent $marketplaceFile
New-Item -ItemType Directory -Path $marketplaceDir -Force | Out-Null

if (Test-Path $marketplaceFile) {
  $marketplace = Get-Content $marketplaceFile -Raw | ConvertFrom-Json -AsHashtable
} else {
  $marketplace = @{
    name = "local-plugins"
    interface = @{
      displayName = "Local Plugins"
    }
    plugins = @()
  }
}

if (-not $marketplace.ContainsKey("interface") -or -not $marketplace.interface) {
  $marketplace.interface = @{
    displayName = "Local Plugins"
  }
}

if (-not $marketplace.ContainsKey("plugins") -or -not $marketplace.plugins) {
  $marketplace.plugins = @()
}

$entry = @{
  name = "autoloop"
  source = @{
    source = "local"
    path = "./plugins/autoloop"
  }
  policy = @{
    installation = "AVAILABLE"
    authentication = "ON_INSTALL"
  }
  category = "Coding"
}

$plugins = @($marketplace.plugins)
$existingIndex = -1
for ($index = 0; $index -lt $plugins.Count; $index += 1) {
  if ($plugins[$index].name -eq "autoloop") {
    $existingIndex = $index
    break
  }
}

if ($existingIndex -ge 0) {
  $plugins[$existingIndex] = $entry
} else {
  $plugins += $entry
}

$marketplace.plugins = $plugins
$marketplace | ConvertTo-Json -Depth 8 | Set-Content -Path $marketplaceFile -Encoding utf8

Write-Host "Autoloop 已安装到：$targetPluginRoot"
Write-Host "Marketplace 已更新：$marketplaceFile"
Write-Host ""
Write-Host "下一步示例："
Write-Host ("node {0} doctor --repo D:\GitHub\dev\your-repo" -f (Join-Path $targetPluginRoot "scripts\autoloop.mjs"))
