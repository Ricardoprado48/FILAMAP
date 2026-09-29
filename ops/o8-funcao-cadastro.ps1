param([switch]$Ensaio)
# Parametro desconhecido NUNCA cai no modo padrao (incidente 2026-09-29).
if ($args.Count -gt 0) { throw "Parametro nao reconhecido: $($args -join ' '). Nada foi feito." }
# O8 - Publica na PRODUCAO a funcao signup-invite nova: o cadastro por convite passa
# a EXIGIR e registrar o aceite do aviso de privacidade (versao + data, na conta).
#   Rode DEPOIS do publicar-web-producao.ps1 (a Web nova ja manda o aceite; a Web
#   antiga nao manda e teria o cadastro recusado).
#   1. confere o token da producao e que o site no ar ja e a Web nova
#   2. pede confirmacao (digitar PUBLICAR) e publica a funcao
#   3. confere no ar: cadastro sem aceite e recusado com "terms_required"
# Nao mexe no banco nem em nenhuma conta.
#   -Ensaio  so confere, nao publica nada
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$ProdRef = "gqtlszffgvxsqcmefhyd"
$Stg = "C:\FILAMAP-staging"
$TokArq = Join-Path $env:APPDATA "Filamap-dev\prod-access-token.dpapi"

Write-Host "=== O8: funcao de cadastro com aceite dos termos (PRODUCAO) ==="
if (-not (Test-Path $TokArq)) { throw "Token da producao nao encontrado. Rode uma vez: ops\salvar-token-producao.ps1. Nada foi feito." }
if ((Get-Content "$Stg\supabase\.temp\project-ref" -Raw).Trim() -ne $ProdRef) { throw "$Stg nao esta ligado a producao. Nada foi feito." }
$fn = Get-Content "$Stg\supabase\functions\signup-invite\index.ts" -Raw
if ($fn -notmatch "terms_required") { throw "A funcao local nao e a versao com aceite dos termos. Nada foi feito." }
$js = ""
try {
    $html = (Invoke-WebRequest -UseBasicParsing "https://filamap.pages.dev/?v=o8").Content
    $bundle = [regex]::Match($html, "/assets/index-[A-Za-z0-9_-]+\.js").Value
    if ($bundle) { $js = (Invoke-WebRequest -UseBasicParsing ("https://filamap.pages.dev" + $bundle)).Content }
} catch {}
if (-not ($js -match "piloto-2026-09-29")) { throw "O site no ar ainda e a Web antiga (nao manda o aceite). Rode antes o publicar-web-producao.ps1. Nada foi feito." }
Write-Host "[1] Token OK; o site no ar ja manda o aceite dos termos."

if ($Ensaio) { Write-Host "ENSAIO_OK (nada foi publicado)"; exit 0 }

$resp = Read-Host "Digite PUBLICAR para publicar a funcao na producao (qualquer outra coisa cancela)"
if ($resp -cne "PUBLICAR") { Write-Host "Cancelado. Nada foi publicado."; exit 0 }

Set-Location $Stg
$tok = [System.Net.NetworkCredential]::new("", ((Get-Content $TokArq -Raw).Trim() | ConvertTo-SecureString)).Password
$env:SUPABASE_ACCESS_TOKEN = $tok
$ErrorActionPreference = "Continue"
$dep = & supabase functions deploy signup-invite --no-verify-jwt --use-api --project-ref $ProdRef 2>&1 | Out-String
$ErrorActionPreference = "Stop"
$env:SUPABASE_ACCESS_TOKEN = $null
if ($dep -notmatch "Deployed Functions") { throw "Falha ao publicar signup-invite:`n$dep" }

# Chave publica (anon) lida da API na hora; nao fica gravada neste arquivo.
$chaves = Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/$ProdRef/api-keys" -Headers @{ Authorization = "Bearer $tok" }
$tok = $null
$anon = ""
foreach ($c in $chaves) { if ($c.name -eq "anon" -and -not $anon) { $anon = [string]$c.api_key } }
if (-not $anon) { throw "Funcao publicada, mas nao consegui ler a chave publica para conferir. Me chame." }
$status = 0; $erro = ""
try {
    Invoke-RestMethod -Method Post -Uri "https://$ProdRef.supabase.co/functions/v1/signup-invite" -Headers @{ apikey = $anon; Authorization = "Bearer $anon" } -ContentType "application/json" -Body '{"code":"AAAAA-AAAAA","email":"teste-o8@example.com","password":"12345678"}' | Out-Null
} catch {
    $status = [int]$_.Exception.Response.StatusCode
    try { $erro = (New-Object IO.StreamReader($_.Exception.Response.GetResponseStream())).ReadToEnd() } catch {}
}
if ($status -ne 400 -or $erro -notmatch "terms_required") { throw "signup-invite respondeu $status $erro (esperado 400 terms_required). Me chame." }
Write-Host "[2] signup-invite nova no ar (cadastro sem aceite recusado)."
Write-Host ""
Write-Host "O8_CONCLUIDA"
