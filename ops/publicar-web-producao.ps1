# Publica a Web aprovada (F7) na PRODUCAO e avanca o main (fast-forward) para a mesma versao.
#   1) confere que o repositorio esta exatamente na versao homologada pelo usuario
#   2) roda os testes e o typecheck
#   3) gera o pacote de PRODUCAO (sem variaveis de teste) e confere que so aponta para a producao
#   4) pede confirmacao (digitar PUBLICAR)
#   5) publica em https://filamap.pages.dev e confere o pacote servido
#   6) avanca o main no GitHub para a mesma versao
# Uso: powershell -ExecutionPolicy Bypass -File C:\FILAMAP-staging\ops\publicar-web-producao.ps1 [-Ensaio]
param([switch]$Ensaio)
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$Repo = "C:\FILAMAP-staging"
$Aprovado = "d3e34a28c93e32068b6b7ad09aac45d7e942a803"
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
if ($head -ne $Aprovado) { throw "Versao local ($head) diferente da aprovada ($Aprovado). Nada foi publicado." }
$sujo = (Assert-Cmd "git status --porcelain" "Falha no git.") -split "`n" | Where-Object { $_.Trim() -and $_ -notmatch "web-app/dist-staging/" }
if ($sujo) { throw "Ha alteracoes locais nao salvas: $($sujo -join ', '). Nada foi publicado." }
$ff = Invoke-Cmd "git merge-base --is-ancestor origin/main HEAD"
if ($ff.Code -ne 0) { throw "O main no GitHub mudou e nao avanca direto para esta versao. Me chame. Nada foi publicado." }
Write-Host "[1] Versao aprovada conferida: $($head.Substring(0,7)); main avanca direto (fast-forward)."

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
if ($nProd -lt 1 -or $nTeste -ne 0 -or $nInbox -lt 1) { throw "Pacote errado (producao=$nProd teste=$nTeste inbox=$nInbox). Nada foi publicado." }
$bundle = $js[0].Name
Write-Host "[3] Pacote de producao: $bundle (aponta so para a producao)."

if ($Ensaio) { Write-Host "ENSAIO_OK (nada foi publicado)"; exit 0 }

$resp = Read-Host "Digite PUBLICAR para colocar a tela nova no ar (qualquer outra coisa cancela)"
if ($resp -cne "PUBLICAR") { Write-Host "Cancelado. Nada foi publicado. (Digite exatamente PUBLICAR, em maiusculas.)"; exit 0 }

$null = Assert-Cmd "npx wrangler pages deploy dist --project-name filamap --branch main --commit-hash $head --commit-message ""F7 estoque por produto e caixa de entrada""" "Publicacao falhou."
$servido = ""
for ($i = 1; $i -le 12; $i++) {
    Start-Sleep -Seconds 5
    try { $servido = [regex]::Match((Invoke-WebRequest -UseBasicParsing "https://filamap.pages.dev/?v=$i").Content, "index-[A-Za-z0-9_-]+\.js").Value } catch { $servido = "" }
    if ($servido -eq $bundle) { break }
}
if ($servido -ne $bundle) { throw "Publicado, mas o site ainda serve '$servido' (esperado $bundle). Me chame antes de repetir." }
Write-Host "[4] No ar: https://filamap.pages.dev serve $bundle."

Set-Location $Repo
$null = Assert-Cmd "git push origin HEAD:main" "Tela publicada, mas o main nao foi atualizado no GitHub. Me chame."
$remoto = ((Assert-Cmd "git ls-remote origin refs/heads/main" "Falha ao conferir o main.").Trim() -split "\s+")[0]
if ($remoto -ne $head) { throw "main no GitHub = $remoto (esperado $head). Me chame." }
Write-Host "[5] main no GitHub = $($head.Substring(0,7))."
Write-Host ""
Write-Host "WEB_PRODUCAO_PUBLICADA"
