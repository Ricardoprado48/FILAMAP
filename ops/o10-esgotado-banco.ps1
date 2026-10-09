# O10 - Carretel esgotado no banco da PRODUCAO (Agent 4.4.0).
#   Aplica, numa transacao so, as migrations pendentes entre:
#     20261008100000_ops_printer_diagnostics  (diario da impressora, do 4.3.0)
#     20261009100000_finalize_depleted_spool  (finalize zera/arquiva o carretel que acabou)
#   1) confere os arquivos (SHA256) e o historico da producao
#   2) ENSAIO na propria producao com ROLLBACK (nada e gravado), incluindo um teste de
#      verdade da funcao: finaliza um job ficticio com um carretel "esgotado" e confere
#      que ele foi zerado, arquivado e solto do AMS -- tudo desfeito no fim
#   3) backup JSON de todas as tabelas
#   4) pede confirmacao (digitar APLICAR)
#   5) aplica; desfaz sozinho se qualquer verificacao falhar ou se algum dado mudar
# Nenhum dado existente muda. Agent antigo continua funcionando igual.
# Uso:  powershell -ExecutionPolicy Bypass -File <repo>\ops\o10-esgotado-banco.ps1 [-SoEnsaio]
# -EnsaioNoTeste: uso do desenvolvedor; mesmo ensaio no banco de TESTE (sempre ROLLBACK).
# Desfazer: supabase/rollbacks/20261009100000_finalize_depleted_spool.down.sql
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
$Todas = [ordered]@{
    "20261008100000_ops_printer_diagnostics" = "491AE629CF99FAE8581CA235313D5E7A2593D1001E63CA4325AFA0F33C8BD630"
    "20261009100000_finalize_depleted_spool" = "CB42EE56282527C2D4C4810D1639EDBA44C2B9546725CA65307955F4431D70B0"
}

Set-Location $Stg
if ((Get-Content "$Stg\supabase\.temp\project-ref" -Raw).Trim() -ne $ProdRef) { throw "$Stg nao esta ligado a producao. Nada foi feito." }
function ConvertFrom-SbRows([string]$Raw) {
    $p = ConvertFrom-Json -InputObject $Raw
    if ($null -ne $p -and -not ($p -is [array]) -and ($p.PSObject.Properties.Name -contains "rows")) { return ,@($p.rows) }
    return ,@($p)
}
function Invoke-Db([string]$Sql) {
    $id = [guid]::NewGuid().ToString("N")
    $arq = Join-Path $env:TEMP "o10-$id.sql"
    $err = Join-Path $env:TEMP "o10-$id.err"
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

Write-Host "=== O10: carretel esgotado no banco ($(if ($EnsaioNoTeste) { 'TESTE' } else { 'PRODUCAO' })) ==="

# 1) arquivos
foreach ($k in $Todas.Keys) {
    $p = Join-Path $Mig "$k.sql"
    if (-not (Test-Path $p)) { throw "Arquivo ausente: $p" }
    if ((Get-NormHash $p) -ne $Todas[$k]) { throw "Arquivo diferente do conferido: $k. Nada foi feito." }
}
Write-Host "[1] $($Todas.Count) arquivos conferidos (SHA256)."

# 2) historico: aplica so o que falta (o 1008 pode ja ter sido aplicado pelo o9)
$Pendentes = @($Todas.Keys)
if (-not $EnsaioNoTeste) {
    $hist = @(Invoke-Db "select version from supabase_migrations.schema_migrations" | ForEach-Object { [string]$_.version })
    $Pendentes = @($Todas.Keys | Where-Object { $hist -notcontains $_.Split("_")[0] })
    if ($Pendentes.Count -eq 0) { Write-Host "O10 JA APLICADA no banco."; $jaAplicada = $true }
    elseif ($Pendentes[0] -ne @($Todas.Keys)[0] -and $Pendentes.Count -ne 1) { throw "Historico fora de ordem. Pare e me chame. Nada foi feito." }
    else {
        $todasVersoes = @($Todas.Keys | ForEach-Object { $_.Split("_")[0] })
        $locais = Get-ChildItem $Mig -Filter *.sql | ForEach-Object { $_.BaseName.Split("_")[0] }
        $estranhas = @($locais | Where-Object { ($hist -notcontains $_) -and ($todasVersoes -notcontains $_) })
        if ($estranhas.Count -gt 0) { throw "Migrations inesperadas pendentes: $($estranhas -join ', '). Nada foi feito." }
        Write-Host "[2] Historico da producao: $($hist.Count) aplicadas; pendentes: $($Pendentes -join ', ')."
    }
}

if (-not $jaAplicada) {
    $Versoes = @($Pendentes | ForEach-Object { $_.Split("_")[0] })
    $ListaSql = ($Versoes | ForEach-Object { "'$_'" }) -join ","
    $corpo = New-Object Text.StringBuilder
    foreach ($k in $Pendentes) {
        $v = $k.Split("_")[0]
        $n = $k.Substring($v.Length + 1)
        [void]$corpo.AppendLine("-- ==== $k")
        [void]$corpo.AppendLine([IO.File]::ReadAllText((Join-Path $Mig "$k.sql")))
        [void]$corpo.AppendLine(";")
        [void]$corpo.AppendLine("insert into supabase_migrations.schema_migrations(version, name) values ('$v', '$n');")
    }

    $hashDados = @"
(select md5(coalesce(string_agg(concat_ws(':', id, user_id, nfc_uid, brand, material, color_name, color_hex, spool_tare_weight, initial_weight, current_weight, price_paid, filament_profile_id, filament_product_id, bambu_spool_id, archived_at), '|' order by id), '')) from public.spools)
|| (select md5(coalesce(string_agg(concat_ws(':', id, spool_id, filament_used_g, status, job_id), '|' order by id), '')) from public.print_logs)
|| (select md5(coalesce(string_agg(concat_ws(':', id, printer_id, slot_index, spool_id), '|' order by id), '')) from public.ams_slots)
|| (select md5(coalesce(string_agg(concat_ws(':', id, user_id, serial, model, name), '|' order by id), '')) from public.printers)
|| (select md5(coalesce(string_agg(concat_ws(':', id, event_type, client_event_id), '|' order by id), '')) from public.ops_events)
"@
    $Def = "(select pg_get_constraintdef(oid) from pg_constraint where conname = 'ops_events_event_type_check' and conrelid = 'public.ops_events'::regclass)"
    $Src = "(select prosrc from pg_proc where proname = 'finalize_print_job' and pronamespace = 'public'::regnamespace)"

    $prelude = ""
    if ($EnsaioNoTeste) {
        $prelude = [IO.File]::ReadAllText((Join-Path $Rb "20261009100000_finalize_depleted_spool.down.sql")) + "`n;`n" +
                   [IO.File]::ReadAllText((Join-Path $Rb "20261008100000_ops_printer_diagnostics.down.sql")) + "`n;`n"
    }

    # Teste de verdade da funcao (so no ENSAIO, sempre desfeito pelo ROLLBACK): um carretel
    # com peso confirmado e mais de 20 g recebe um job ficticio de 5 g marcado "depleted".
    $teste = @"
create temp table _o10_fx on commit drop as
select s.id as spool_id, s.user_id, p.id as printer_id, s.current_weight
  from public.spools s join public.printers p on p.user_id = s.user_id
 where s.archived_at is null and s.weight_confirmed_at is not null and s.current_weight > 20
 order by s.updated_at desc limit 1;
select set_config('request.jwt.claims', (select json_build_object('sub', user_id, 'role', 'authenticated')::text from _o10_fx), true);
select set_config('request.jwt.claim.sub', (select user_id::text from _o10_fx), true);
insert into public.ams_slots(printer_id, slot_index, spool_id, user_id)
select printer_id, 3, spool_id, user_id from _o10_fx
on conflict (printer_id, slot_index) do update set spool_id = excluded.spool_id;
create temp table _o10_res on commit drop as
select * from public.finalize_print_job(gen_random_uuid(), (select printer_id from _o10_fx), 'O10 ensaio', 1, 'COMPLETED',
  jsonb_build_array(jsonb_build_object('spool_id', (select spool_id from _o10_fx), 'slot_index', 3, 'grams', 5,
                                       'consumption_quality', 'exact', 'orphan_slot', false, 'depleted', true)));
create temp table _o10_fxchk on commit drop as select json_build_object(
 'teste_achou_carretel',  (select count(*) from _o10_fx) = 1,
 'teste_saldo_zerado',    (select current_weight from public.spools where id = (select spool_id from _o10_fx)) = 0,
 'teste_arquivado',       (select archived_at is not null from public.spools where id = (select spool_id from _o10_fx)),
 'teste_fora_impressora', (select bambu_in_printer is false and bambu_slot_id is null from public.spools where id = (select spool_id from _o10_fx)),
 'teste_slot_solto',      not exists (select 1 from public.ams_slots where spool_id = (select spool_id from _o10_fx)),
 'teste_log_esgotado',    (select bool_and(spool_depleted) from _o10_res),
 'teste_sobra_registrada',(select depleted_leftover_g from _o10_res) = (select current_weight - 5 from _o10_fx)
) as c;
DO `$t`$ DECLARE k text; BEGIN
  FOR k IN select key from json_each_text((select c from _o10_fxchk)) where value is distinct from 'true' LOOP
    RAISE EXCEPTION 'O10 teste da funcao falhou: %', k;
  END LOOP;
END `$t`$;
"@

    function New-O10Sql([string]$Fim) {
        $fx = if ($Fim -eq "ROLLBACK") { $teste } else { "" }
        $fxSel = if ($Fim -eq "ROLLBACK") { "(select c from _o10_fxchk)::text" } else { "null::text" }
        return @"
BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '15s';
$prelude
create temp table _o10_pre on commit drop as select $hashDados as h;
$($corpo.ToString())
NOTIFY pgrst, 'reload schema';
create temp table _o10_chk on commit drop as select json_build_object(
 'dados_iguais',           (select h from _o10_pre) = ($hashDados),
 'historico_versoes',      (select count(*) from supabase_migrations.schema_migrations where version in ($ListaSql)) = $($Versoes.Count),
 'check_unico',            (select count(*) from pg_constraint where conrelid = 'public.ops_events'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%event_type%') = 1,
 'aceita_printer_hms',     $Def like '%''PRINTER_HMS''%',
 'aceita_spool_runout',    $Def like '%''SPOOL_RUNOUT''%',
 'aceita_spool_depleted',  $Def like '%''SPOOL_DEPLETED''%',
 'mantem_tipos_antigos',   $Def like '%''AGENT_STARTED''%' and $Def like '%''SPOOL_AMBIGUOUS''%' and $Def like '%''SUPPORT_REQUEST''%',
 'coluna_spool_depleted',  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'print_logs' and column_name = 'spool_depleted'),
 'coluna_sobra',           exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'print_logs' and column_name = 'depleted_leftover_g'),
 'funcao_nova',            $Src like '%depleted%' and $Src like '%weight_confirmed_at IS NOT NULL%',
 'funcao_unica',           (select count(*) from pg_proc where proname = 'finalize_print_job' and pronamespace = 'public'::regnamespace) = 1
) as c;
DO `$o10`$ DECLARE k text; BEGIN
  FOR k IN select key from json_each_text((select c from _o10_chk)) where value is distinct from 'true' LOOP
    RAISE EXCEPTION 'O10 verificacao falhou: %', k;
  END LOOP;
END `$o10`$;
$fx
select (select c from _o10_chk)::text as c, $fxSel as t, (select count(*) from public.ops_events) as eventos, (select count(*) from public.print_logs) as logs;
$Fim;
"@
    }
    function Show-Result($r, [string]$Titulo) {
        Write-Host $Titulo
        foreach ($campo in @("c", "t")) {
            if (-not $r[0].$campo) { continue }
            $c = ConvertFrom-Json -InputObject ([string]$r[0].$campo)
            foreach ($p in $c.PSObject.Properties) { Write-Host ("    {0,-26} {1}" -f $p.Name, $(if ($p.Value -eq $true) { "OK" } else { "FALHOU" })) }
        }
        Write-Host "    ops_events=$($r[0].eventos)  print_logs=$($r[0].logs)"
    }

    # 3) ensaio
    $r = Invoke-Db (New-O10Sql "ROLLBACK")
    Show-Result $r "[3] ENSAIO (ROLLBACK, nada gravado):"
    if (-not $EnsaioNoTeste) {
        $hist2 = @(Invoke-Db "select version from supabase_migrations.schema_migrations where version in ($ListaSql)")
        if (@($hist2 | Where-Object { $_.version }).Count -ne 0) { throw "O ensaio deixou rastro no historico. Pare e me chame." }
        Write-Host "    Conferido: o ensaio nao gravou nada."
    }
    if ($EnsaioNoTeste -or $SoEnsaio) { Write-Host "ENSAIO_OK"; exit 0 }

    # 4) backup
    Write-Host "[4] Backup da producao..."
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Ops "backup-producao-json.ps1") -Projeto $Stg
    if ($LASTEXITCODE -ne 0) { throw "Backup falhou. Nada foi aplicado." }

    # 5) aplicar
    $resp = Read-Host "Digite APLICAR para gravar na producao (qualquer outra coisa cancela)"
    if ($resp -cne "APLICAR") { Write-Host "Cancelado. Nada foi aplicado."; exit 0 }
    $r = Invoke-Db (New-O10Sql "COMMIT")
    Show-Result $r "[5] APLICADO (COMMIT):"
    $hist3 = @(Invoke-Db "select count(*) as n from supabase_migrations.schema_migrations where version in ($ListaSql)")
    if ([int]$hist3[0].n -ne $Versoes.Count) { throw "Historico com $($hist3[0].n)/$($Versoes.Count) depois do COMMIT. Me chame." }
}
if ($SoEnsaio) { Write-Host "ENSAIO_OK (banco ja estava aplicado)"; exit 0 }
Write-Host ""
Write-Host "O10_CONCLUIDA: o banco zera e arquiva o carretel que acabar durante a impressao."
