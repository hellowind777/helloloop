[CmdletBinding()]
param(
  [Alias("Host")]
  [ValidateSet("codex", "claude", "gemini", "all")]
  [string]$TargetHost = "codex",
  [string]$CodexHome = (Join-Path $HOME ".codex"),
  [string]$ClaudeHome = (Join-Path $HOME ".claude"),
  [string]$GeminiHome = (Join-Path $HOME ".gemini"),
  [switch]$Force
)

$sourceRoot = Split-Path -Parent $PSScriptRoot
$cliEntry = Join-Path $sourceRoot "scripts\helloloop.mjs"

if (-not (Test-Path $cliEntry)) {
  throw "未找到 CLI 入口：$cliEntry"
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "未找到 node，可先安装 Node.js 20+ 后再运行。"
}

$arguments = @(
  $cliEntry,
  "install",
  "--host",
  $TargetHost,
  "--codex-home",
  $CodexHome,
  "--claude-home",
  $ClaudeHome,
  "--gemini-home",
  $GeminiHome
)

if ($Force) {
  $arguments += "--force"
}

& node @arguments
exit $LASTEXITCODE
