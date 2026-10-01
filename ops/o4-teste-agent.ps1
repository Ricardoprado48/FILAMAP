param([switch]$Ensaio, [switch]$Restaurar, [switch]$Limpo)
# Parametro desconhecido NUNCA cai no modo padrao (incidente 2026-09-29: "-EnsaioNoTeste"
# repassado como texto fez o script rodar no modo producao).
if ($args.Count -gt 0) { throw "Parametro nao reconhecido: $($args -join ' '). Nada foi feito." }
# O4 - Agent 4.2 (codigo de C:\PROJETOS\ATIVOS\FILAMAP_WORKTREES\staging) contra o banco de TESTE com a impressora real.
#
# A Bambu A1 aceita UMA conexao MQTT por vez: o Agent de producao precisa ficar
# parado durante o teste. Este script:
#   1. confere que NAO ha impressao ativa nem finalizacao pendente na producao;
#   2. para o Agent de producao (launcher + processo);
#   3. roda o Agent 4.2 numa pasta ISOLADA (%APPDATA%\Filamap-teste-o4), gravando
#      so no banco de TESTE - nunca le a fila/estado da producao;
#   4. ao sair (Ctrl+C), religa o Agent de producao.
# Impressoes feitas durante o teste descontam do estoque de TESTE, nao da producao.
#
#   -Ensaio     so confere, nao para nem inicia nada
#   -Restaurar  so religa o Agent de producao (use se a janela foi fechada no meio)
#   -Limpo      instalacao limpa: pasta vazia e SEM credenciais -> a janela de configuracao
#               aparece como para um tester (codigo do site de STAGING + Access Code).
#               Ao fechar o Agent, pergunta se quer abrir de novo (como o atalho).
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$ProdRef = "gqtlszffgvxsqcmefhyd"
$TaskName = "FilamapAgentAutoStart"
$Repo = "$(Split-Path $PSScriptRoot -Parent)\desktop-agent"
$ProdDir = Join-Path $env:APPDATA "Filamap"
$TestDir = Join-Path $env:APPDATA $(if ($Limpo) { "Filamap-teste-limpo" } else { "Filamap-teste-o4" })
$Bridge = "C:\Program Files\Filamap Agent\bambu-bridge\filamap-bambu-bridge.exe"

function Start-ProdAgent {
    Start-ScheduledTask -TaskName $TaskName
    Start-Sleep -Seconds 8
    $p = Get-Process filamap-agent -ErrorAction SilentlyContinue
    if ($p) { Write-Host "Agent de PRODUCAO religado (pid $($p.Id))." -ForegroundColor Green }
    else { Write-Host "ATENCAO: Agent de producao nao apareceu. Rode: Start-ScheduledTask -TaskName $TaskName" -ForegroundColor Red }
}

if ($Restaurar) { Start-ProdAgent; return }

function Get-Dp([string]$Name) {
    $sec = (Get-Content (Join-Path $env:APPDATA "Filamap-dev\$Name.dpapi") -Raw).Trim() | ConvertTo-SecureString
    return [System.Net.NetworkCredential]::new("", $sec).Password
}

# ---------------------------------------------------------------- conferencias
$bloqueios = @()
function Check([bool]$ok, [string]$msg) {
    if ($ok) { Write-Host "OK        $msg" } else { Write-Host "BLOQUEADO $msg" -ForegroundColor Red; $script:bloqueios += $msg }
}

Check (-not (Test-Path (Join-Path $ProdDir "agent-state.json"))) "sem impressao ativa na producao (agent-state.json ausente)"
Check (-not (Test-Path (Join-Path $ProdDir "agent-pending-finalize.json"))) "sem finalizacao pendente na producao"
Check (Test-Path (Join-Path $Repo "dist\index.js")) "Agent 4.2 compilado em $Repo\dist"
Check (Test-Path $Bridge) "bridge da nuvem Bambu instalado"
$cfg = $null
try { $cfg = Get-Content (Join-Path $ProdDir "config.json") -Raw | ConvertFrom-Json } catch {}
Check ($null -ne $cfg -and [string]$cfg.printerSerial -ne "") "serial da impressora lido do config.json"

$keys = Get-Dp "staging-keys" | ConvertFrom-Json
Check (-not ([string]$keys.url).Contains($ProdRef)) "credenciais sao do banco de TESTE"

Push-Location $Repo
try {
    $code = & node -e "require('./dist/config/secretStore').resolveSecretStore('win32').load().then(s=>process.stdout.write(s.printerAccessCode||''),()=>process.stdout.write(''))"
} finally { Pop-Location }
Check ([string]$code -ne "") "Access Code lido do cofre do Agent (nao exibido)"

$launcher = @(Get-CimInstance Win32_Process -Filter "Name='wscript.exe'" | Where-Object { $_.CommandLine -match "run-agent\.vbs" })
$agent = @(Get-Process filamap-agent -ErrorAction SilentlyContinue)
Write-Host ("INFO      Agent de producao rodando: {0} processo(s), launcher: {1}" -f $agent.Count, $launcher.Count)

if ($bloqueios.Count -gt 0) {
    Write-Host ""
    Write-Host "NAO PODE RODAR AGORA ($($bloqueios.Count) bloqueio(s)). Nada foi alterado." -ForegroundColor Red
    return
}
if ($Ensaio) {
    Write-Host ""
    Write-Host "ENSAIO OK: tudo pronto. Nada foi parado nem iniciado." -ForegroundColor Green
    return
}

Write-Host ""
Write-Host "Vai PARAR o Agent de producao e rodar o Agent novo contra o banco de TESTE." -ForegroundColor Yellow
if ($Limpo) { Write-Host "Modo LIMPO: o codigo de pareamento vem do site de TESTE: https://staging.filamap.pages.dev (Computadores > Conectar computador)." -ForegroundColor Cyan }
Write-Host "Impressoes durante o teste NAO descontam do seu estoque real."
$resp = Read-Host "Digite TESTAR para continuar"
if ($resp -cne "TESTAR") { Write-Host "Cancelado. Nada foi alterado."; return }

# ---------------------------------------------------------------- execucao
foreach ($l in $launcher) { Stop-Process -Id $l.ProcessId -Force -ErrorAction SilentlyContinue }
Get-Process filamap-agent -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2
Write-Host "Agent de producao parado." -ForegroundColor Yellow

try {
    if ($Limpo -and (Test-Path $TestDir)) {
        $velha = "$TestDir-" + (Get-Date -Format "yyyyMMdd-HHmmss")
        Move-Item $TestDir $velha
        Write-Host "Pasta de teste anterior guardada em $velha (comeca do zero)."
    }
    New-Item -ItemType Directory -Force -Path $TestDir | Out-Null
    $env:FILAMAP_CONFIG_DIR = $TestDir
    $env:FILAMAP_BAMBU_BRIDGE_PATH = $Bridge
    $env:SUPABASE_URL = $keys.url
    $env:SUPABASE_ANON_KEY = $keys.anon
    if ($Limpo) {
        $env:FILAMAP_WEB_URL = "https://staging.filamap.pages.dev"
    } else {
        $env:AGENT_EMAIL = $keys.email
        $env:AGENT_PASSWORD = $keys.password
        $env:PRINTER_SERIAL = [string]$cfg.printerSerial
        $env:PRINTER_IP = [string]$cfg.lastKnownPrinterIp
        $env:PRINTER_ACCESS_CODE = [string]$code
    }
    Write-Host ""
    Write-Host "Agent de TESTE rodando. Quando terminar o roteiro, aperte Ctrl+C." -ForegroundColor Cyan
    Write-Host ""
    Push-Location $Repo
    try {
        do {
            & node dist\index.js
            $denovo = ""
            if ($Limpo) { $denovo = Read-Host "O Agent encerrou. Digite DENOVO para abrir de novo (como o atalho Filamap) ou Enter para terminar" }
        } while ($denovo -ceq "DENOVO")
    } finally { Pop-Location }
} finally {
    foreach ($v in "FILAMAP_CONFIG_DIR", "FILAMAP_BAMBU_BRIDGE_PATH", "FILAMAP_WEB_URL", "SUPABASE_URL", "SUPABASE_ANON_KEY", "AGENT_EMAIL", "AGENT_PASSWORD", "PRINTER_SERIAL", "PRINTER_IP", "PRINTER_ACCESS_CODE") {
        Remove-Item "Env:$v" -ErrorAction SilentlyContinue
    }
    $code = $null
    Write-Host ""
    Write-Host "Teste encerrado. Religando o Agent de producao..." -ForegroundColor Yellow
    Start-ProdAgent
}
