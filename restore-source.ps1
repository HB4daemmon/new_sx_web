$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$parts = Get-ChildItem 'bootstrap/source.part.*.b64' | Sort-Object Name
$base64 = ($parts | ForEach-Object { Get-Content $_ -Raw }) -join ''
[IO.File]::WriteAllBytes("$env:TEMP\fengshen-source.tar.xz", [Convert]::FromBase64String($base64))
tar -xJf "$env:TEMP\fengshen-source.tar.xz"
Write-Host 'Fengshen source restored.'
Write-Host 'Run: npm install; npm test'
