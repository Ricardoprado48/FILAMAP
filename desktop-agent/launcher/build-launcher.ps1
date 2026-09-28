# Compila o launcher sem janela (filamap-launcher.exe) com o csc.exe do .NET Framework 4,
# presente em todo Windows 10/11. Saida: launcher\bin\filamap-launcher.exe
$ErrorActionPreference = "Stop"

$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Csc  = Join-Path $env:SystemRoot "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$Icon = Join-Path $Here "..\installer\filamap.ico"
$Out  = Join-Path $Here "bin\filamap-launcher.exe"

if (-not (Test-Path $Csc)) { throw "csc.exe nao encontrado em $Csc" }
New-Item -ItemType Directory -Force (Split-Path $Out) | Out-Null

& $Csc /nologo /target:winexe /optimize+ "/win32icon:$Icon" "/out:$Out" (Join-Path $Here "FilamapLauncher.cs")
if ($LASTEXITCODE -ne 0) { throw "Falha ao compilar o launcher (csc codigo $LASTEXITCODE)" }

Write-Host "OK $Out"
Write-Host ("SHA256 " + (Get-FileHash $Out -Algorithm SHA256).Hash)
