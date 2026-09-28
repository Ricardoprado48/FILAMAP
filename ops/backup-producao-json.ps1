# Backup SOMENTE LEITURA da producao: exporta cada tabela public em JSON (1 arquivo por tabela)
# + manifesto com contagem de linhas e SHA256. Substitui "supabase db dump" (exige Docker).
param([string]$Destino = "$env:APPDATA\Filamap-dev\backups")
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
# A CLI do Supabase responde {"rows":[...]} quando detecta agente de IA e [...] num terminal comum.
# Aceita os dois formatos (causa raiz dos erros de 28/09 no terminal do usuario).
function ConvertFrom-SbRows([string]$Raw) {
    $p = ConvertFrom-Json -InputObject $Raw
    if ($null -ne $p -and -not ($p -is [array]) -and ($p.PSObject.Properties.Name -contains "rows")) { return ,@($p.rows) }
    return ,@($p)
}
$pasta = Join-Path $Destino ("prod-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
New-Item -ItemType Directory -Force -Path $pasta | Out-Null
Set-Location C:\FILAMAP
$tabelas = "printers","spools","ams_slots","print_logs","user_filament_profiles","catalog_items","filament_presets","print_jobs"
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
