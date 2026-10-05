param([switch]$SoZip)
# Parametro desconhecido NUNCA cai no modo padrao.
if ($args.Count -gt 0) { throw "Parametro nao reconhecido: $($args -join ' '). Nada foi feito." }
# Instala a Skill "video-viral-rprado3d" (recriar formula de video viral para produtos da rprado3d).
#
#  1. Copia a Skill para %USERPROFILE%\.claude\skills\ (Claude Code em qualquer pasta deste PC).
#  2. Gera video-viral-rprado3d.zip na Area de Trabalho para enviar no claude.ai
#     (Configuracoes > Capacidades > Skills > Enviar skill).
#
#   -SoZip   so gera o .zip, nao copia para o Claude Code
#
# O historico de resultados (historico\resultados.csv) ja instalado NUNCA e sobrescrito.
# Usa a pasta onde o script esta (repo\ops) para achar a Skill.
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$Nome = "video-viral-rprado3d"
$Origem = Join-Path (Split-Path $PSScriptRoot -Parent) ".claude\skills\$Nome"
if (-not (Test-Path (Join-Path $Origem "SKILL.md"))) { throw "Skill nao encontrada em $Origem. Nada foi feito." }

if (-not $SoZip) {
    $Destino = Join-Path $env:USERPROFILE ".claude\skills\$Nome"
    $Hist = Join-Path $Destino "historico\resultados.csv"
    $Backup = $null
    if (Test-Path $Hist) {
        $Backup = Join-Path $env:TEMP "resultados-$Nome-$(Get-Date -Format yyyyMMddHHmmss).csv"
        Copy-Item $Hist $Backup
    }
    New-Item -ItemType Directory -Force -Path $Destino | Out-Null
    Copy-Item -Path (Join-Path $Origem "*") -Destination $Destino -Recurse -Force
    if ($Backup) {
        Copy-Item $Backup $Hist -Force
        Write-Host "Historico existente preservado."
    }
    Write-Host "Skill instalada no Claude Code: $Destino"
}

$Zip = Join-Path ([Environment]::GetFolderPath("Desktop")) "$Nome.zip"
if (Test-Path $Zip) { Remove-Item $Zip -Force }
Compress-Archive -Path $Origem -DestinationPath $Zip
Write-Host "Zip para o claude.ai: $Zip"
Write-Host "No claude.ai: Configuracoes > Capacidades > Skills > Enviar skill > escolha o zip."

$Ffmpeg = Get-Command ffmpeg -ErrorAction SilentlyContinue
if (-not $Ffmpeg) {
    Write-Host ""
    Write-Host "Aviso: ffmpeg nao encontrado neste PC. Para analisar videos no Claude Code local, instale com:"
    Write-Host "  winget install --id Gyan.FFmpeg -e"
}
