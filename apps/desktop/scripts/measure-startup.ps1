param([Parameter(Mandatory=$true)][string]$Executable, [Parameter(Mandatory=$true)][string]$Label, [string]$CacheDirectory)
$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$qaDirectory = Join-Path $workspace ('tmp\desktop-qa\startup-' + $Label + '-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $qaDirectory -Force | Out-Null
$env:ELECTRON_RUN_AS_NODE = $null
if ($CacheDirectory) { $env:ANCHOR_PORTABLE_CACHE = [IO.Path]::GetFullPath($CacheDirectory) }
$timer = [Diagnostics.Stopwatch]::StartNew()
$probe = Start-Process -FilePath ([IO.Path]::GetFullPath($Executable)) -ArgumentList ('"--startup-probe=' + $qaDirectory + '"') -WindowStyle Hidden -PassThru
$report = Join-Path $qaDirectory 'startup.json'
while (-not (Test-Path -LiteralPath $report)) {
  if (Test-Path -LiteralPath (Join-Path $qaDirectory 'error.txt')) { throw (Get-Content -LiteralPath (Join-Path $qaDirectory 'error.txt') -Raw) }
  if ($timer.Elapsed.TotalSeconds -gt 180) { throw "Startup probe timed out: $qaDirectory" }
  Start-Sleep -Milliseconds 100
}
$timer.Stop()
$result = Get-Content -LiteralPath $report -Raw | ConvertFrom-Json
[pscustomobject]@{ Label=$Label; WallTimeMs=$timer.ElapsedMilliseconds; MainToPaintMs=$result.mainToPaintMs; LaunchToPaintMs=$result.launchToPaintMs; ExtractionMs=$result.extractionMs; Report=$report } | ConvertTo-Json
