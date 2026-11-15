param(
  [Parameter(Mandatory = $true)][string]$ResearchRoot,
  [Parameter(Mandatory = $true)][string]$ProgramPath,
  [string]$GhidraHome = ''
)

$ErrorActionPreference = 'Stop'
$skillRoot = Split-Path -Parent $PSScriptRoot
$research = (Resolve-Path -LiteralPath $ResearchRoot).Path
$baselinePath = Join-Path $research 'baseline.json'
if (!(Test-Path -LiteralPath $baselinePath -PathType Leaf)) { throw "Missing research baseline: $baselinePath" }
$baseline = Get-Content -LiteralPath $baselinePath -Raw -Encoding UTF8 | ConvertFrom-Json
$sourceRoot = (Resolve-Path -LiteralPath $baseline.sourcePath).Path
$program = (Resolve-Path -LiteralPath $ProgramPath).Path
$sourcePrefix = $sourceRoot.TrimEnd('\') + '\'
if (!$program.StartsWith($sourcePrefix, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'ProgramPath must be inside the original game directory recorded in baseline.json.'
}

if ([string]::IsNullOrWhiteSpace($GhidraHome)) {
  $GhidraHome = $env:GHIDRA_HOME
}
if ([string]::IsNullOrWhiteSpace($GhidraHome)) {
  $repoRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $skillRoot))
  $localCfgPath = Join-Path $repoRoot '.hgame.local.json'
  $tcPath = $env:HGAME_RE_TOOLCHAIN
  if ([string]::IsNullOrWhiteSpace($tcPath) -and (Test-Path -LiteralPath $localCfgPath -PathType Leaf)) {
    $localCfg = Get-Content -LiteralPath $localCfgPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $tcPath = $localCfg.reToolchainPath
  }
  if (![string]::IsNullOrWhiteSpace($tcPath) -and (Test-Path -LiteralPath $tcPath -PathType Leaf)) {
    $tc = Get-Content -LiteralPath $tcPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $GhidraHome = $tc.tools.ghidra.path
  }
}
if ([string]::IsNullOrWhiteSpace($GhidraHome)) {
  throw 'Ghidra home not configured. Pass -GhidraHome, set GHIDRA_HOME, or configure reToolchainPath in .hgame.local.json.'
}
$headless = Join-Path $GhidraHome 'support\analyzeHeadless.bat'
if (!(Test-Path -LiteralPath $headless -PathType Leaf)) { throw "Ghidra headless launcher not found: $headless (set GHIDRA_HOME)" }

$raw = Join-Path $research 'raw'
$projectDir = Join-Path $raw 'ghidra-project'
$output = Join-Path $raw 'ghidra-function-index.json'
$scriptDir = Join-Path $skillRoot 'tools\ghidra'
if (Test-Path -LiteralPath $projectDir) { throw "Refusing to reuse existing Ghidra project: $projectDir" }
if (Test-Path -LiteralPath $output) { throw "Refusing to overwrite existing export: $output" }
New-Item -ItemType Directory -Force -Path $raw | Out-Null
New-Item -ItemType Directory -Force -Path $projectDir | Out-Null

$projectName = ($baseline.gameId -replace '[^A-Za-z0-9_-]', '-') + '-function-index'
Write-Output "Importing game binary into an isolated Ghidra project: $program"
& $headless $projectDir $projectName -import $program -scriptPath $scriptDir -postScript 'ExportGameFunctionIndex.java' $output
if ($LASTEXITCODE -ne 0) { throw "Ghidra headless failed with exit code $LASTEXITCODE" }
if (!(Test-Path -LiteralPath $output -PathType Leaf)) { throw 'Ghidra completed without producing the expected function index.' }
Write-Output "Function index exported: $output"
Write-Output 'Next: review entry points, inspect unresolved indirect calls, then audit the export with audit-function-index.mjs.'
