# Backup SOMENTE LEITURA da producao: exporta cada tabela public em JSON (1 arquivo por tabela)
# + manifesto com contagem de linhas e SHA256. Substitui "supabase db dump" (exige Docker).
# -Prefixo: nome das pastas (padrao "prod"; o agendamento semanal usa "semanal").
# -Manter N: apaga as pastas <Prefixo>-* mais antigas, mantendo as N mais recentes (0 = nao apaga).
#            So toca pastas do MESMO prefixo: backups manuais (prod-*) nunca sao apagados pelo semanal.
param(
    [string]$Destino = "$env:APPDATA\Filamap-dev\backups",
    [string]$Projeto = "C:\FILAMAP",
    [string]$Prefixo = "prod",
    [int]$Manter = 0
)
$ErrorActionPreference = "Stop"
# Token da conta da producao (ops\salvar-token-producao.ps1), so para esta execucao:
# nao depende do "supabase login", que e compartilhado com outros projetos deste PC.
$TokArq = Join-Path $env:APPDATA "Filamap-dev\prod-access-token.dpapi"
if (-not (Test-Path $TokArq)) { throw "Token da producao nao encontrado. Rode uma vez: ops\salvar-token-producao.ps1. Nada foi feito." }
$env:SUPABASE_ACCESS_TOKEN = [System.Net.NetworkCredential]::new("", ((Get-Content $TokArq -Raw).Trim() | ConvertTo-SecureString)).Password
trap { $env:SUPABASE_ACCESS_TOKEN = $null; break }
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
# A CLI do Supabase responde {"rows":[...]} quando detecta agente de IA e [...] num terminal comum.
# Aceita os dois formatos (causa raiz dos erros de 28/09 no terminal do usuario).
function ConvertFrom-SbRows([string]$Raw) {
    $p = ConvertFrom-Json -InputObject $Raw
    if ($null -ne $p -and -not ($p -is [array]) -and ($p.PSObject.Properties.Name -contains "rows")) { return ,@($p.rows) }
    return ,@($p)
}
if ($Prefixo -notmatch '^[a-z]+$') { throw "Prefixo invalido: $Prefixo" }
$pasta = Join-Path $Destino ($Prefixo + "-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
New-Item -ItemType Directory -Force -Path $pasta | Out-Null
Set-Location $Projeto
# Dados do usuario (estoque, historico, perfis, caixa de entrada). ops_* (telemetria) fica de fora.
$tabelas = "printers","spools","ams_slots","print_logs","user_filament_profiles","catalog_items","filament_presets","print_jobs",
           "filament_products","spool_inbox","spools_identity_backup"
$manifesto = foreach ($t in $tabelas) {
    $ErrorActionPreference = "Continue"
    $raw = supabase db query --linked -o json "select count(*) as n, coalesce(json_agg(t), '[]'::json)::text as j from public.$t t" 2>$null | Out-String
    $code = $LASTEXITCODE
    $ErrorActionPreference = "Stop"
    if ($code -ne 0) { throw "Falha ao ler ${t} (exit $code)" }
    $row = (ConvertFrom-SbRows $raw)[0]
    $json = [string]$row.j
    if ($null -eq $json -or $json -eq "") { $json = "[]" }
    if (-not $json.StartsWith("[")) { $json = "[$json]" }
    $arq = Join-Path $pasta "$t.json"
    [IO.File]::WriteAllText($arq, $json, (New-Object Text.UTF8Encoding($false)))
    $parsed = ConvertFrom-Json -InputObject $json
    $n = if ($null -eq $parsed) { 0 } else { @($parsed).Count }
    if ($json -eq "[]") { $n = 0 }
    if ($n -ne [int]$row.n) { throw "${t}: contagem do banco ($($row.n)) difere do arquivo ($n)" }
    [pscustomobject]@{ tabela = $t; linhas = $n; sha256 = (Get-FileHash $arq -Algorithm SHA256).Hash }
}
$manifesto | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $pasta "MANIFESTO.json")
$manifesto | Format-Table -AutoSize
Write-Host "Backup em: $pasta"
$env:SUPABASE_ACCESS_TOKEN = $null

# Retencao: so depois de um backup completo e conferido.
if ($Manter -gt 0) {
    $antigas = @(Get-ChildItem $Destino -Directory -Filter "$Prefixo-*" | Sort-Object Name -Descending | Select-Object -Skip $Manter)
    foreach ($a in $antigas) {
        if (Test-Path (Join-Path $a.FullName "MANIFESTO.json")) {
            Remove-Item $a.FullName -Recurse -Force
            Write-Host "Removido backup antigo: $($a.Name)"
        }
    }
}
