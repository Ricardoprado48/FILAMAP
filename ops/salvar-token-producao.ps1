param([switch]$Conferir)
# Parametro desconhecido NUNCA cai no modo padrao (incidente 2026-09-29).
if ($args.Count -gt 0) { throw "Parametro nao reconhecido: $($args -join ' '). Nada foi feito." }
# Guarda o token de acesso da conta Supabase DONA DA PRODUCAO, cifrado pelo Windows (DPAPI:
# so o seu usuario, neste PC, consegue abrir). Os scripts de producao (backup, O6...) usam
# este token so durante a propria execucao e nao dependem mais do "supabase login", que e
# compartilhado com outros projetos deste PC (e foi trocado por outro projeto em 29/09).
#
# Onde criar o token: entre em supabase.com com a conta da PRODUCAO > Account > Access Tokens
# > Generate new token (nome: filamap-ops). Copie e cole aqui quando pedir. O token nao
# aparece na tela e nao e salvo em texto.
#   -Conferir  so confere se o token salvo ainda enxerga a producao
$ErrorActionPreference = "Stop"
$ProdRef = "gqtlszffgvxsqcmefhyd"
$Arq = Join-Path $env:APPDATA "Filamap-dev\prod-access-token.dpapi"

function Test-Token([string]$Tok) {
    try {
        $p = Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects" -Headers @{ Authorization = "Bearer $Tok" }
        return (@($p | Where-Object { $_.ref -eq $ProdRef }).Count -eq 1)
    } catch { return $false }
}

if ($Conferir) {
    if (-not (Test-Path $Arq)) { Write-Host "Nenhum token salvo. Rode sem parametro para salvar." -ForegroundColor Red; exit 1 }
    $tok = [System.Net.NetworkCredential]::new("", ((Get-Content $Arq -Raw).Trim() | ConvertTo-SecureString)).Password
    if (Test-Token $tok) { Write-Host "OK: o token salvo enxerga a producao." -ForegroundColor Green; exit 0 }
    Write-Host "O token salvo NAO enxerga a producao (expirado, apagado ou de outra conta). Rode sem parametro para salvar outro." -ForegroundColor Red
    exit 1
}

$sec = Read-Host "Cole o token da conta da PRODUCAO (nao aparece na tela) e aperte Enter" -AsSecureString
$tok = [System.Net.NetworkCredential]::new("", $sec).Password.Trim()
if ($tok.Length -lt 20) { Write-Host "Token vazio ou curto demais. Nada foi salvo." -ForegroundColor Red; exit 1 }
if (-not (Test-Token $tok)) {
    Write-Host "Este token NAO enxerga o projeto de producao ($ProdRef). Confira se voce estava logado na conta certa ao criar o token. Nada foi salvo." -ForegroundColor Red
    exit 1
}
New-Item -ItemType Directory -Force -Path (Split-Path $Arq) | Out-Null
$cifrado = ConvertTo-SecureString $tok -AsPlainText -Force | ConvertFrom-SecureString
Set-Content -Path $Arq -Value $cifrado -Encoding ASCII
$tok = $null
Write-Host "OK: token salvo cifrado em $Arq (enxerga a producao)." -ForegroundColor Green
