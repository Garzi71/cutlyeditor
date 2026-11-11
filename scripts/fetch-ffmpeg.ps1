# Downloads a Windows FFmpeg build (with NVIDIA NVENC support) into resources/ffmpeg,
# so it can be bundled inside the installer. Used by the GitHub Actions release build.
$ErrorActionPreference = 'Stop'
# Pinned to a release branch: the master builds change command-line options without warning.
$url = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n9.0-latest-win64-gpl-shared-9.0.zip'
$root = Split-Path -Parent $PSScriptRoot
$dest = Join-Path $root 'resources\ffmpeg'
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) "cutly-ffmpeg-$([guid]::NewGuid())"
New-Item -ItemType Directory -Force $tmp | Out-Null
$zip = Join-Path $tmp 'ffmpeg.zip'
Write-Host "Downloading $url"
Invoke-WebRequest -Uri $url -OutFile $zip
Expand-Archive -Path $zip -DestinationPath $tmp
$bin = Get-ChildItem -Path $tmp -Recurse -Directory -Filter bin | Select-Object -First 1
if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
New-Item -ItemType Directory -Force $dest | Out-Null
# ffplay is not needed by Cutly.
Get-ChildItem $bin.FullName | Where-Object { $_.Name -ne 'ffplay.exe' -and ($_.Extension -in '.exe', '.dll') } |
  Copy-Item -Destination $dest
Remove-Item -Recurse -Force $tmp
& (Join-Path $dest 'ffmpeg.exe') -version | Select-Object -First 1
Get-ChildItem $dest | ForEach-Object { '{0,-30} {1,8:N1} MB' -f $_.Name, ($_.Length / 1MB) }
