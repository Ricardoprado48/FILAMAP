# O9 - Diario da impressora na PRODUCAO: dois tipos novos de evento na Central (Agent 4.3.0).
#   1) confere o arquivo (SHA256) e o historico da producao
#   2) ENSAIO na propria producao com ROLLBACK (nada e gravado)
#   3) backup JSON de todas as tabelas
#   4) pede confirmacao (digitar APLICAR)
#   5) aplica; desfaz sozinho se qualquer verificacao falhar ou se algum dado mudar
# So amplia o CHECK de ops_events.event_type (PRINTER_HMS, PRINTER_ERROR). Nenhum dado muda.
# Pode rodar antes ou depois de instalar o Agent 4.3.0: sem ela, so esses dois tipos sao recusados.
# Uso:  powershell -ExecutionPolicy Bypass -File <repo>\ops\o9-diario-impressora.ps1 [-SoEnsaio]
# -EnsaioNoTeste: uso do desenvolvedor; mesmo ensaio no banco de TESTE (sempre ROLLBACK).
param([switch]$SoEnsaio, [switch]$EnsaioNoTeste)
# Parametro desconhecido NUNCA cai no modo padrao (incidente 2026-09-29).
if ($args.Count -gt 0) { throw "Parametro nao reconhecido: $($args -join ' '). Nada foi feito." }
$ErrorActionPreference = "Stop"
$TokArq = Join-Path $env:APPDATA "Filamap-dev\prod-access-token.dpapi"
if (-not $EnsaioNoTeste -and -not (Test-Path $TokArq)) { throw "Token da producao nao encontrado. Rode uma vez: ops\salvar-token-producao.ps1. Nada foi feito." }
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$ProdRef = "gqtlszffgvxsqcmefhyd"
$TestRef = "zllbzjwhdyxbryhbqrfg"
$Stg = "$(Split-Path $PSScriptRoot -Parent)"
$Mig = "$Stg\supabase\migrations"
$Rb = "$Stg\supabase\rollbacks"
$Ops = Split-Path -Parent $MyInvocation.MyCommand.Path
$Esperadas = [ordered]@{
    "20261008100000_ops_printer_diagnostics" = "491AE629CF99FAE8581CA235313D5E7A2593D1001E63CA4325AFA0F33C8BD630"
}
$Versoes = @($Esperadas.Keys | ForEach-Object { $_.Split("_")[0] })
$ListaSql = ($Versoes | ForEach-Object { "'$_'" }) -join ","

Set-Location $Stg
if ((Get-Content "$Stg\supabase\.temp\project-ref" -Raw).Trim() -ne $ProdRef) { throw "$Stg nao esta ligado a producao. Nada foi feito." }
function ConvertFrom-SbRows([string]$Raw) {
    $p = ConvertFrom-Json -InputObject $Raw
    if ($null -ne $p -and -not ($p -is [array]) -and ($p.PSObject.Properties.Name -contains "rows")) { return ,@($p.rows) }
    return ,@($p)
}
function Invoke-Db([string]$Sql) {
    $id = [guid]::NewGuid().ToString("N")
    $arq = Join-Path $env:TEMP "o9-$id.sql"
    $err = Join-Path $env:TEMP "o9-$id.err"
    [IO.File]::WriteAllText($arq, $Sql, (New-Object Text.UTF8Encoding($false)))
    if ($EnsaioNoTeste) {
        $alvo = @("--linked", "--project-ref", $TestRef)
        $sec = (Get-Content "$env:APPDATA\Filamap-dev\staging-access-token.dpapi" -Raw).Trim() | ConvertTo-SecureString
        $env:SUPABASE_ACCESS_TOKEN = [System.Net.NetworkCredential]::new("", $sec).Password
    } else {
        $alvo = @("--linked")
        $env:SUPABASE_ACCESS_TOKEN = [System.Net.NetworkCredential]::new("", ((Get-Content $TokArq -Raw).Trim() | ConvertTo-SecureString)).Password
    }
    $ErrorActionPreference = "Continue"
    $out = & supabase db query @alvo --agent no -o json -f $arq 2> $err | Out-String
    $code = $LASTEXITCODE
    $env:SUPABASE_ACCESS_TOKEN = $null
    $ErrorActionPreference = "Stop"
    $msg = ""
    if (Test-Path $err) { $msg = (Get-Content $err -Raw); Remove-Item $err -Force }
    Remove-Item $arq -Force
    if ($code -ne 0) { throw "Banco recusou (exit $code). Nada foi gravado.`n$out`n$msg" }
    $i = $out.IndexOf("[")
    $j = $out.IndexOf("{")
    if ($i -lt 0 -or ($j -ge 0 -and $j -lt $i)) { $i = $j }
    if ($i -lt 0) { return ,@() }
    return (ConvertFrom-SbRows $out.Substring($i))
}
function Get-NormHash([string]$Path) {
    $t = [IO.File]::ReadAllText($Path).Replace("`r`n", "`n")
    $sha = [Security.Cryptography.SHA256]::Create()
    return (($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($t)) | ForEach-Object { $_.ToString("X2") }) -join "")
}

Write-Host "=== O9: diario da impressora no banco ($(if ($EnsaioNoTeste) { 'TESTE' } else { 'PRODUCAO' })) ==="

# 1) arquivos
$corpo = New-Object Text.StringBuilder
foreach ($k in $Esperadas.Keys) {
    $p = Join-Path $Mig "$k.sql"
    if (-not (Test-Path $p)) { throw "Arquivo ausente: $p" }
    if ((Get-NormHash $p) -ne $Esperadas[$k]) { throw "Arquivo diferente do conferido: $k. Nada foi feito." }
    $v = $k.Split("_")[0]
    $n = $k.Substring($v.Length + 1)
    [void]$corpo.AppendLine("-- ==== $k")
    [void]$corpo.AppendLine([IO.File]::ReadAllText($p))
    [void]$corpo.AppendLine(";")
    [void]$corpo.AppendLine("insert into supabase_migrations.schema_migrations(version, name) values ('$v', '$n');")
}
Write-Host "[1] 1 arquivo conferido (SHA256)."

# 2) historico
if (-not $EnsaioNoTeste) {
    $hist = @(Invoke-Db "select version from supabase_migrations.schema_migrations" | ForEach-Object { [string]$_.version })
    $ja = @($Versoes | Where-Object { $hist -contains $_ })
    if ($ja.Count -eq $Versoes.Count) { Write-Host "O9 JA APLICADA no banco."; $jaAplicada = $true }
    elseif ($ja.Count -gt 0) { throw "Historico parcial ($($ja -join ', ')). Pare e me chame. Nada foi feito." }
    else {
        $locais = Get-ChildItem $Mig -Filter *.sql | ForEach-Object { $_.BaseName.Split("_")[0] }
        $estranhas = @($locais | Where-Object { ($hist -notcontains $_) -and ($Versoes -notcontains $_) })
        if ($estranhas.Count -gt 0) { throw "Migrations inesperadas pendentes: $($estranhas -join ', '). Nada foi feito." }
        Write-Host "[2] Historico da producao: $($hist.Count) aplicadas; pendente = exatamente a esperada."
    }
}

if (-not $jaAplicada) {
    $hashDados = @"
(select md5(coalesce(string_agg(concat_ws(':', id, user_id, nfc_uid, brand, material, color_name, color_hex, spool_tare_weight, initial_weight, current_weight, price_paid, filament_profile_id, filament_product_id, bambu_spool_id, archived_at), '|' order by id), '')) from public.spools)
|| (select md5(coalesce(string_agg(concat_ws(':', id, spool_id, filament_used_g, status, job_id), '|' order by id), '')) from public.print_logs)
|| (select md5(coalesce(string_agg(concat_ws(':', id, printer_id, slot_index, spool_id), '|' order by id), '')) from public.ams_slots)
|| (select md5(coalesce(string_agg(concat_ws(':', id, user_id, serial, model, name), '|' order by id), '')) from public.printers)
|| (select md5(coalesce(string_agg(concat_ws(':', id, event_type, client_event_id), '|' order by id), '')) from public.ops_events)
"@
    $Def = "(select pg_get_constraintdef(oid) from pg_constraint where conname = 'ops_events_event_type_check' and conrelid = 'public.ops_events'::regclass)"

    $prelude = ""
    if ($EnsaioNoTeste) {
        $prelude = [IO.File]::ReadAllText((Join-Path $Rb "20261008100000_ops_printer_diagnostics.down.sql")) + "`n;`n"
    }

    function New-O9Sql([string]$Fim) {
        return @"
BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '15s';
$prelude
create temp table _o9_pre on commit drop as select $hashDados as h;
$($corpo.ToString())
NOTIFY pgrst, 'reload schema';
create temp table _o9_chk on commit drop as select json_build_object(
 'dados_iguais',          (select h from _o9_pre) = ($hashDados),
 'historico_1_versao',    (select count(*) from supabase_migrations.schema_migrations where version in ($ListaSql)) = 1,
 'check_unico',           (select count(*) from pg_constraint where conrelid = 'public.ops_events'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%event_type%') = 1,
 'aceita_printer_hms',    $Def like '%''PRINTER_HMS''%',
 'aceita_printer_error',  $Def like '%''PRINTER_ERROR''%',
 'mantem_tipos_antigos',  $Def like '%''AGENT_STARTED''%' and $Def like '%''FTPS_FAILED''%' and $Def like '%''SUPPORT_REQUEST''%'
) as c;
DO `$o9`$ DECLARE k text; BEGIN
  FOR k IN select key from json_each_text((select c from _o9_chk)) where value is distinct from 'true' LOOP
    RAISE EXCEPTION 'O9 verificacao falhou: %', k;
  END LOOP;
END `$o9`$;
select (select c from _o9_chk)::text as c, (select count(*) from public.ops_events) as eventos, (select count(*) from public.print_logs) as logs;
$Fim;
"@
    }
    function Show-Result($r, [string]$Titulo) {
        $c = ConvertFrom-Json -InputObject ([string]$r[0].c)
        Write-Host $Titulo
        foreach ($p in $c.PSObject.Properties) { Write-Host ("    {0,-26} {1}" -f $p.Name, $(if ($p.Value -eq $true) { "OK" } else { "FALHOU" })) }
        Write-Host "    ops_events=$($r[0].eventos)  print_logs=$($r[0].logs)"
    }

    # 3) ensaio
    $r = Invoke-Db (New-O9Sql "ROLLBACK")
    Show-Result $r "[3] ENSAIO (ROLLBACK, nada gravado):"
    if (-not $EnsaioNoTeste) {
        $hist2 = @(Invoke-Db "select version from supabase_migrations.schema_migrations where version in ($ListaSql)")
        if (@($hist2 | Where-Object { $_.version }).Count -ne 0) { throw "O ensaio deixou rastro no historico. Pare e me chame." }
        Write-Host "    Conferido: o ensaio nao gravou nada."
    }
    if ($EnsaioNoTeste -or $SoEnsaio) { Write-Host "ENSAIO_OK"; exit 0 }

    # 4) backup
    Write-Host "[4] Backup da producao..."
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Ops "backup-producao-json.ps1")
    if ($LASTEXITCODE -ne 0) { throw "Backup falhou. Nada foi aplicado." }

    # 5) aplicar
    $resp = Read-Host "Digite APLICAR para gravar na producao (qualquer outra coisa cancela)"
    if ($resp -cne "APLICAR") { Write-Host "Cancelado. Nada foi aplicado."; exit 0 }
    $r = Invoke-Db (New-O9Sql "COMMIT")
    Show-Result $r "[5] APLICADO (COMMIT):"
    $hist3 = @(Invoke-Db "select count(*) as n from supabase_migrations.schema_migrations where version in ($ListaSql)")
    if ([int]$hist3[0].n -ne 1) { throw "Historico com $($hist3[0].n)/1 depois do COMMIT. Me chame." }
}
if ($SoEnsaio) { Write-Host "ENSAIO_OK (banco ja estava aplicado)"; exit 0 }
Write-Host ""
Write-Host "O9_CONCLUIDA: a Central aceita PRINTER_HMS e PRINTER_ERROR."
