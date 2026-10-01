param([switch]$Ensaio)
# Parametro desconhecido NUNCA cai no modo padrao (incidente 2026-09-29).
if ($args.Count -gt 0) { throw "Parametro nao reconhecido: $($args -join ' '). Nada foi feito." }
# Instala o Agent 4.2.1 na PRODUCAO, somente fora de impressao.
#   Rode DEPOIS do publicar-web-producao.ps1 e do o8-funcao-cadastro.ps1.
#   1. confere: sem impressao ativa, sem finalizacao pendente,
#      instalador e o mesmo que foi gerado e testado (SHA256);
#   2. pede confirmacao (digitar INSTALAR) e abre o instalador (o Windows pede permissao);
#   3. confere que o Agent instalado e o 4.2.1 e que voltou a rodar.
# Volta para o 4.2.0, se precisar: rode C:\PROJETOS\ATIVOS\FILAMAP_WORKTREES\staging\releases\FilamapAgentSetup-4.2.0-98866BDB.exe
#   -Ensaio  so confere, nao instala nada
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$ProdDir = Join-Path $env:APPDATA "Filamap"
$Setup = "$(Split-Path $PSScriptRoot -Parent)\desktop-agent\installer\output\FilamapAgentSetup.exe"
$SetupSha = "5E8505B8D02145F889966CC05E9D148162F23E3D2779EE967F7F6AEBB1840D14"
$AgentSha = "680A0F0E17EAD302F8251D73ABB2B52E6E882065BD98D2DA140F9330B004E654"
$AgentExe = "C:\Program Files\Filamap Agent\filamap-agent.exe"
$Rollback = "$(Split-Path $PSScriptRoot -Parent)\releases\FilamapAgentSetup-4.2.0-98866BDB.exe"

$bloqueios = @()
function Check([bool]$ok, [string]$msg) {
    if ($ok) { Write-Host "OK        $msg" } else { Write-Host "BLOQUEADO $msg" -ForegroundColor Red; $script:bloqueios += $msg }
}

Write-Host "=== Instalar Agent 4.2.1 na PRODUCAO ==="
Check (-not (Test-Path (Join-Path $ProdDir "agent-state.json"))) "sem impressao ativa (agent-state.json ausente)"
Check (-not (Test-Path (Join-Path $ProdDir "agent-pending-finalize.json"))) "sem finalizacao pendente"
Check ((Test-Path $Setup) -and ((Get-FileHash $Setup -Algorithm SHA256).Hash -eq $SetupSha)) "instalador e o 4.2.1 testado (SHA256 confere)"
Check (Test-Path $Rollback) "instalador 4.2.0 guardado para voltar atras"

if ($bloqueios.Count -gt 0) {
    Write-Host ""
    Write-Host "Nada foi instalado. Resolva os itens BLOQUEADO acima (impressao ativa: espere terminar e rode de novo)." -ForegroundColor Red
    exit 1
}
if ($Ensaio) { Write-Host ""; Write-Host "ENSAIO_OK (nada foi instalado)"; exit 0 }

Write-Host ""
Write-Host "Nao comece nenhuma impressao ate o fim da instalacao."
$resp = Read-Host "Digite INSTALAR para abrir o instalador (qualquer outra coisa cancela)"
if ($resp -cne "INSTALAR") { Write-Host "Cancelado. Nada foi instalado. (Digite exatamente INSTALAR, em maiusculas.)"; exit 0 }

# Confere de novo: a impressao pode ter comecado enquanto a pergunta estava aberta.
if ((Test-Path (Join-Path $ProdDir "agent-state.json")) -or (Test-Path (Join-Path $ProdDir "agent-pending-finalize.json"))) {
    Write-Host "Uma impressao comecou agora. Nada foi instalado; rode de novo quando ela terminar." -ForegroundColor Red
    exit 1
}

Write-Host "Abrindo o instalador. Aceite a permissao do Windows e clique em Avancar ate Concluir."
$p = Start-Process -FilePath $Setup -Wait -PassThru
if ($p.ExitCode -ne 0) { Write-Host "O instalador terminou com codigo $($p.ExitCode) (cancelado ou erro). Me chame." -ForegroundColor Red; exit 1 }

$instalado = (Get-FileHash $AgentExe -Algorithm SHA256).Hash
if ($instalado -ne $AgentSha) { Write-Host "O Agent instalado nao e o 4.2.1 (SHA256 $($instalado.Substring(0,12))). Me chame." -ForegroundColor Red; exit 1 }
Write-Host "OK        Agent instalado e o 4.2.1"

$rodando = $null
for ($i = 1; $i -le 12 -and -not $rodando; $i++) {
    Start-Sleep -Seconds 5
    $rodando = Get-Process filamap-agent -ErrorAction SilentlyContinue
}
if (-not $rodando) {
    Start-ScheduledTask -TaskName "FilamapAgentAutoStart"
    Start-Sleep -Seconds 10
    $rodando = Get-Process filamap-agent -ErrorAction SilentlyContinue
}
if (-not $rodando) { Write-Host "O Agent 4.2.1 foi instalado mas nao esta rodando. Me chame." -ForegroundColor Red; exit 1 }
Write-Host "OK        Agent 4.2.1 rodando (pid $($rodando[0].Id))"
Write-Host ""
Write-Host "AGENT_421_INSTALADO"
