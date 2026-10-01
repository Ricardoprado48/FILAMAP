param([switch]$Ensaio, [switch]$Restaurar)
# Parametro desconhecido NUNCA cai no modo padrao (incidente 2026-09-29).
if ($args.Count -gt 0) { throw "Parametro nao reconhecido: $($args -join ' '). Nada foi feito." }
# Deixa o PC como o de um tester que nunca usou o Filamap, para reinstalar pelo guia:
#   1. confere: sem impressao ativa, sem finalizacao pendente;
#   2. para o Agent, roda o desinstalador (o Windows pede permissao);
#   3. MOVE a pasta de dados do Agent (%APPDATA%\Filamap: configuracao, sessao, Access Code)
#      para %APPDATA%\Filamap-dev\antes-da-reinstalacao-<data> -- nada e apagado.
# O Bambu Studio, o banco e o seu estoque nao sao tocados.
#   -Ensaio     so confere, nao muda nada
#   -Restaurar  volta a pasta guardada (use se a reinstalacao pelo guia der errado;
#               depois rode ops\o5-instalar-agent.ps1 para reinstalar o Agent)
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$Dados = Join-Path $env:APPDATA "Filamap"
$Guarda = Join-Path $env:APPDATA "Filamap-dev"
$AppDir = "C:\Program Files\Filamap Agent"
$Unins = Join-Path $AppDir "unins000.exe"
$TaskName = "FilamapAgentAutoStart"

function Stop-Agent {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Get-CimInstance Win32_Process -Filter "Name='wscript.exe'" | Where-Object { $_.CommandLine -match "run-agent\.vbs|start-agent\.vbs" } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Get-Process filamap-agent -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Seconds 2
}

if ($Restaurar) {
    $ultima = Get-ChildItem $Guarda -Directory -Filter "antes-da-reinstalacao-*" -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1
    if (-not $ultima) { Write-Host "Nenhuma pasta guardada encontrada. Nada foi feito." -ForegroundColor Red; exit 1 }
    $resp = Read-Host "Digite RESTAURAR para voltar a pasta $($ultima.Name) (qualquer outra coisa cancela)"
    if ($resp -cne "RESTAURAR") { Write-Host "Cancelado. Nada foi feito."; exit 0 }
    Stop-Agent
    if (Test-Path $Dados) {
        $tentativa = Join-Path $Guarda ("tentativa-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
        Move-Item $Dados $tentativa
        Write-Host "Pasta da reinstalacao guardada em $tentativa."
    }
    Move-Item $ultima.FullName $Dados
    Write-Host "Pasta original de volta em $Dados." -ForegroundColor Green
    Write-Host "Agora rode: & `"$(Split-Path $PSScriptRoot -Parent)\ops\o5-instalar-agent.ps1`" (digite INSTALAR)."
    exit 0
}

$bloqueios = @()
function Check([bool]$ok, [string]$msg) {
    if ($ok) { Write-Host "OK        $msg" } else { Write-Host "BLOQUEADO $msg" -ForegroundColor Red; $script:bloqueios += $msg }
}
Write-Host "=== Desinstalar o Filamap deste PC (para reinstalar como tester) ==="
Check (-not (Test-Path (Join-Path $Dados "agent-state.json"))) "sem impressao ativa (agent-state.json ausente)"
Check (-not (Test-Path (Join-Path $Dados "agent-pending-finalize.json"))) "sem finalizacao pendente"
Check (Test-Path $Unins) "desinstalador encontrado em $AppDir"
Check (Test-Path $Dados) "pasta de dados do Agent encontrada ($Dados)"
if ($bloqueios.Count -gt 0) { Write-Host ""; Write-Host "Nada foi feito. Resolva os itens BLOQUEADO (impressao ativa: espere terminar)." -ForegroundColor Red; exit 1 }
if ($Ensaio) { Write-Host ""; Write-Host "ENSAIO_OK (nada foi alterado)"; exit 0 }

Write-Host ""
Write-Host "Vai PARAR o Agent, DESINSTALAR e guardar a pasta de dados (nada e apagado)."
Write-Host "Ate reinstalar pelo guia, impressoes NAO serao descontadas do estoque."
$resp = Read-Host "Digite DESINSTALAR para continuar (qualquer outra coisa cancela)"
if ($resp -cne "DESINSTALAR") { Write-Host "Cancelado. Nada foi feito."; exit 0 }
if ((Test-Path (Join-Path $Dados "agent-state.json")) -or (Test-Path (Join-Path $Dados "agent-pending-finalize.json"))) {
    Write-Host "Uma impressao comecou agora. Nada foi feito; rode de novo quando ela terminar." -ForegroundColor Red
    exit 1
}

Stop-Agent
Write-Host "Agent parado. Abrindo o desinstalador (aceite a permissao do Windows)..."
$p = Start-Process -FilePath $Unins -ArgumentList "/SILENT", "/SUPPRESSMSGBOXES" -Wait -PassThru
# O desinstalador do Inno se copia para a pasta temporaria e sai; espera o processo filho terminar.
for ($i = 1; $i -le 60 -and (Test-Path (Join-Path $AppDir "filamap-agent.exe")); $i++) { Start-Sleep -Seconds 2 }
if (Test-Path (Join-Path $AppDir "filamap-agent.exe")) { Write-Host "O desinstalador nao removeu o Agent (codigo $($p.ExitCode)). Pasta de dados NAO foi movida. Me chame." -ForegroundColor Red; exit 1 }
Write-Host "OK        programa desinstalado"
Start-Sleep -Seconds 2
if (Get-Process filamap-agent -ErrorAction SilentlyContinue) { Write-Host "Ainda ha um Agent rodando. Pasta de dados NAO foi movida. Me chame." -ForegroundColor Red; exit 1 }

$destino = Join-Path $Guarda ("antes-da-reinstalacao-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
New-Item -ItemType Directory -Force -Path $Guarda | Out-Null
Move-Item $Dados $destino
Write-Host "OK        pasta de dados guardada em $destino"
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) { Write-Host "AVISO     a tarefa de inicio automatico ainda existe (o instalador novo a substitui)." -ForegroundColor Yellow }
else { Write-Host "OK        inicio automatico removido" }
Write-Host ""
Write-Host "PC_LIMPO: agora siga o Guia do Tester como se fosse a primeira vez."
