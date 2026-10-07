$ErrorActionPreference = 'Stop'
$desktopRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runtimeDirectory = Join-Path $desktopRoot 'release\build\win-unpacked'
$outputDirectory = Join-Path $desktopRoot 'release\standalone'
$buildDirectory = Join-Path $desktopRoot 'release\build'
$version = (Get-Content -LiteralPath (Join-Path $desktopRoot 'package.json') -Raw | ConvertFrom-Json).version
if (-not (Test-Path -LiteralPath (Join-Path $runtimeDirectory 'AnchorProposal.exe'))) { throw 'Build the Windows runtime first.' }
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$payloadPath = Join-Path $buildDirectory 'portable-payload.zip'
if (Test-Path -LiteralPath $payloadPath) { Remove-Item -LiteralPath $payloadPath -Force }
[IO.Compression.ZipFile]::CreateFromDirectory($runtimeDirectory, $payloadPath, [IO.Compression.CompressionLevel]::Fastest, $false)
$payloadHash = (Get-FileHash -LiteralPath $payloadPath -Algorithm SHA256).Hash.ToLowerInvariant()
$executableHash = (Get-FileHash -LiteralPath (Join-Path $runtimeDirectory 'AnchorProposal.exe') -Algorithm SHA256).Hash.ToLowerInvariant()
$appHash = (Get-FileHash -LiteralPath (Join-Path $runtimeDirectory 'resources\app.asar') -Algorithm SHA256).Hash.ToLowerInvariant()
$source = (Get-Content -LiteralPath (Join-Path $desktopRoot 'launcher\PortableLauncher.cs') -Raw).Replace('__BUILD_HASH__', $payloadHash).Replace('__EXE_HASH__', $executableHash).Replace('__APP_HASH__', $appHash).Replace('__APP_VERSION__', ($version.Split('-')[0] + '.0'))
$sourcePath = Join-Path $buildDirectory 'PortableLauncher.generated.cs'
[IO.File]::WriteAllText($sourcePath, $source)
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$executable = Join-Path $outputDirectory 'AnchorProposal.exe'
& $compiler /nologo /target:winexe /platform:x64 /optimize+ /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.IO.Compression.dll /reference:System.Core.dll "/win32icon:$desktopRoot\assets\icon.ico" "/resource:$payloadPath,AnchorPayload" "/out:$executable" $sourcePath
if ($LASTEXITCODE -ne 0) { throw 'Portable launcher compilation failed.' }
[pscustomobject]@{ Version = $version; BuildHash = $payloadHash; ExecutableHash = $executableHash; AppHash = $appHash; Portable = $executable; Bytes = (Get-Item -LiteralPath $executable).Length } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $buildDirectory 'portable-build.json')
Write-Output "Fast portable executable: $executable"
