# Publica a Web aprovada (+ instalador do Agent em /downloads) na PRODUCAO e avanca o main (fast-forward) para a mesma versao.
#   1) confere que o repositorio esta exatamente na versao homologada pelo usuario
#   2) roda os testes e o typecheck
#   3) gera o pacote de PRODUCAO (sem variaveis de teste) e confere que so aponta para a producao
#   4) pede confirmacao (digitar PUBLICAR)
#   5) avanca o main no GitHub e ESPERA a montagem automatica do Cloudflare (ligado ao GitHub)
#      terminar -- ela nao tem o instalador do Agent e, se viesse depois, apagava o download
#      (incidente 09/10: /downloads servia a pagina do site em vez do instalador)
#   6) publica em https://filamap.pages.dev com o instalador e confere pacote e download,
#      de novo 2 minutos depois
# Uso: powershell -ExecutionPolicy Bypass -File C:\PROJETOS\ATIVOS\FILAMAP_WORKTREES\staging\ops\publicar-web-producao.ps1 [-Ensaio]
param([switch]$Ensaio)
# Parametro desconhecido NUNCA cai no modo padrao (incidente 2026-09-29).
if ($args.Count -gt 0) { throw "Parametro nao reconhecido: $($args -join ' '). Nada foi publicado." }
# Rode ANTES do o8-funcao-cadastro.ps1 (a Web nova ja manda o aceite dos termos).
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$Repo = "$(Split-Path $PSScriptRoot -Parent)"
$Aprovado = "00da4c43f1881c6aad3d17b42a3497775de57106"
$Setup = "$(Split-Path $PSScriptRoot -Parent)\desktop-agent\installer\output\FilamapAgentSetup.exe"
$SetupSha = "525D1D8E7DD57E50D8FDE9CE95E65E0E606F20B00E05B752AFC139D247C4BF86"
$AgentVersao = "4.4.0"
$ProdRef = "gqtlszffgvxsqcmefhyd"
$TestRef = "zllbzjwhdyxbryhbqrfg"

# Roda um comando externo pelo cmd (stderr junto do stdout; sem erro falso do PowerShell 5.1).
function Invoke-Cmd([string]$Linha) {
    $out = cmd /c "$Linha 2>&1" | Out-String
    return @{ Code = $LASTEXITCODE; Out = $out }
}
function Assert-Cmd([string]$Linha, [string]$Erro) {
    $r = Invoke-Cmd $Linha
    if ($r.Code -ne 0) { Write-Host $r.Out; throw "$Erro Nada foi publicado." }
    return $r.Out
}

Set-Location $Repo
Write-Host "=== Publicar Web na PRODUCAO ==="

$null = Assert-Cmd "git fetch origin" "Falha ao consultar o GitHub."
$head = (Assert-Cmd "git rev-parse HEAD" "Falha no git.").Trim()
$anc = Invoke-Cmd "git merge-base --is-ancestor $Aprovado HEAD"
# So a Web precisa ser a aprovada: Agent e banco tem os proprios scripts (o10-*), com SHA256 e ensaio.
$dif = Invoke-Cmd "git diff --quiet $Aprovado HEAD -- web-app"
if ($anc.Code -ne 0 -or $dif.Code -ne 0) { throw "O codigo mudou desde a versao aprovada ($($Aprovado.Substring(0,7))). Nada foi publicado." }
$sujo = (Assert-Cmd "git status --porcelain" "Falha no git.") -split "`n" | Where-Object { $_.Trim() -and $_ -notmatch "web-app/dist-staging/" }
if ($sujo) { throw "Ha alteracoes locais nao salvas: $($sujo -join ', '). Nada foi publicado." }
$ff = Invoke-Cmd "git merge-base --is-ancestor origin/main HEAD"
if ($ff.Code -ne 0) { throw "O main no GitHub mudou e nao avanca direto para esta versao. Me chame. Nada foi publicado." }
Write-Host "[1] Codigo identico ao aprovado ($($Aprovado.Substring(0,7))); publicando $($head.Substring(0,7)); main avanca direto."

Set-Location (Join-Path $Repo "web-app")
$env:VITE_SUPABASE_URL = $null
$env:VITE_SUPABASE_ANON_KEY = $null
$null = Assert-Cmd "npx vitest run" "Testes falharam."
$null = Assert-Cmd "npx tsc --noEmit -p ." "Typecheck falhou."
Write-Host "[2] Testes e typecheck OK."

$null = Assert-Cmd "npx vite build --outDir dist --emptyOutDir" "Build falhou."
$js = @(Get-ChildItem dist\assets\index-*.js)
if ($js.Count -ne 1) { throw "Esperado 1 pacote JS em dist\assets, achei $($js.Count). Nada foi publicado." }
$texto = Get-Content $js[0].FullName -Raw
$nProd = [regex]::Matches($texto, $ProdRef).Count
$nTeste = [regex]::Matches($texto, $TestRef).Count
$nInbox = [regex]::Matches($texto, "spool_inbox").Count
$nCentral = [regex]::Matches($texto, "ingest_ops_events").Count
if ($nProd -lt 1 -or $nTeste -ne 0 -or $nInbox -lt 1 -or $nCentral -lt 1) { throw "Pacote errado (producao=$nProd teste=$nTeste inbox=$nInbox central=$nCentral). Nada foi publicado." }
$bundle = $js[0].Name
Write-Host "[3] Pacote de producao: $bundle (aponta so para a producao)."
# Instalador do Agent servido em /downloads (botao "Baixar o Filamap Agent").
if (-not (Test-Path $Setup) -or (Get-FileHash $Setup -Algorithm SHA256).Hash -ne $SetupSha) { throw "Instalador do Agent ausente ou diferente do testado. Nada foi publicado." }
New-Item -ItemType Directory -Force -Path dist\downloads | Out-Null
Copy-Item -LiteralPath $Setup -Destination dist\downloads\FilamapAgentSetup.exe -Force
if ((Get-FileHash dist\downloads\FilamapAgentSetup.exe -Algorithm SHA256).Hash -ne $SetupSha) { throw "Copia do instalador corrompida. Nada foi publicado." }
if (-not (Test-Path dist\_headers)) { throw "dist\_headers ausente. Nada foi publicado." }
Write-Host "    Instalador do Agent $AgentVersao incluido em /downloads (SHA256 confere)."

if ($Ensaio) { Write-Host "ENSAIO_OK (nada foi publicado)"; exit 0 }

$resp = Read-Host "Digite PUBLICAR para colocar a tela nova no ar (qualquer outra coisa cancela)"
if ($resp -cne "PUBLICAR") { Write-Host "Cancelado. Nada foi publicado. (Digite exatamente PUBLICAR, em maiusculas.)"; exit 0 }

function Get-ProdDeploys {
    $r = Invoke-Cmd "npx wrangler pages deployment list --project-name filamap --environment production --json"
    if ($r.Code -ne 0) { Write-Host $r.Out; throw "Nao consegui listar as publicacoes do Cloudflare. Me chame." }
    $i = $r.Out.IndexOf("[")
    return @(ConvertFrom-Json $r.Out.Substring($i))
}
function Test-Download([string]$Base) {
    $tmp = Join-Path $env:TEMP "filamap-download-check.exe"
    try { Invoke-WebRequest -UseBasicParsing "$Base/downloads/FilamapAgentSetup.exe" -OutFile $tmp } catch { return "erro" }
    $sha = (Get-FileHash $tmp -Algorithm SHA256).Hash
    Remove-Item $tmp -Force
    return $sha
}

# 5) GitHub primeiro; a montagem automatica do Cloudflare precisa terminar ANTES da publicacao com o instalador.
$antes = @(Get-ProdDeploys | ForEach-Object { $_.Id })
Set-Location $Repo
$null = Assert-Cmd "git push origin HEAD:main" "Falha ao atualizar o main no GitHub."
$remoto = ((Assert-Cmd "git ls-remote origin refs/heads/main" "Falha ao conferir o main.").Trim() -split "\s+")[0]
if ($remoto -ne $head) { throw "main no GitHub = $remoto (esperado $head). Me chame." }
Write-Host "[4] main no GitHub = $($head.Substring(0,7)). Esperando a montagem automatica do Cloudflare (ate 10 min)..."
$auto = $null
for ($i = 1; $i -le 60 -and -not $auto; $i++) {
    Start-Sleep -Seconds 10
    $novo = @(Get-ProdDeploys | Where-Object { $antes -notcontains $_.Id })
    foreach ($d in $novo) {
        try { $pg = (Invoke-WebRequest -UseBasicParsing "$($d.Deployment)/?v=$i").Content } catch { $pg = "" }
        if ($pg -match "index-[A-Za-z0-9_-]+\.js") { $auto = $d }
    }
}
if ($auto) { Write-Host "    Montagem automatica terminou ($($auto.Id.Substring(0,8))); agora a publicacao com o instalador vem por cima." }
else { Write-Host "    Nenhuma montagem automatica apareceu em 10 min (pode estar desligada no Cloudflare). Seguindo." }

# 6) publicacao definitiva, com o instalador
Set-Location (Join-Path $Repo "web-app")
$null = Assert-Cmd "npx wrangler pages deploy dist --project-name filamap --branch main --commit-hash $head --commit-message ""Agent $AgentVersao em /downloads""" "Publicacao falhou."
$servido = ""
for ($i = 1; $i -le 12; $i++) {
    Start-Sleep -Seconds 5
    try { $servido = [regex]::Match((Invoke-WebRequest -UseBasicParsing "https://filamap.pages.dev/?v=$i").Content, "index-[A-Za-z0-9_-]+\.js").Value } catch { $servido = "" }
    if ($servido -eq $bundle) { break }
}
if ($servido -ne $bundle) { throw "Publicado, mas o site ainda serve '$servido' (esperado $bundle). Me chame antes de repetir." }
Write-Host "[5] No ar: https://filamap.pages.dev serve $bundle."
foreach ($espera in 0, 120) {
    if ($espera) { Write-Host "    Conferindo o download de novo em 2 minutos..."; Start-Sleep -Seconds $espera }
    $sha = Test-Download "https://filamap.pages.dev"
    if ($sha -ne $SetupSha) { throw "Site no ar, mas o download do Agent nao confere ($sha). Me chame." }
}
Write-Host "    Download do Agent $AgentVersao confere (SHA256), agora e 2 minutos depois."
Write-Host ""
Write-Host "WEB_PRODUCAO_PUBLICADA"
