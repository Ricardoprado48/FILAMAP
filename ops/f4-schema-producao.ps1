# F4 - Estrutura nova no banco da PRODUCAO (Filamap).
# Aplica as 7 migrations pendentes numa UNICA transacao (tudo ou nada).
#   1) confere os arquivos (SHA256) e o historico da producao
#   2) ENSAIO na propria producao com ROLLBACK (nada e gravado)
#   3) backup JSON de todas as tabelas
#   4) pede confirmacao (digitar APLICAR)
#   5) aplica; a transacao se desfaz sozinha se qualquer verificacao falhar ou se algum dado mudar
# Uso:  powershell -ExecutionPolicy Bypass -File C:\FILAMAP-staging\ops\f4-schema-producao.ps1 [-SoEnsaio]
# -EnsaioNoTeste: uso do desenvolvedor; mesmo ensaio no banco de TESTE (sempre ROLLBACK).
param([switch]$SoEnsaio, [switch]$EnsaioNoTeste)
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$ProdRef = "gqtlszffgvxsqcmefhyd"
$TestRef = "zllbzjwhdyxbryhbqrfg"
$Mig = "C:\FILAMAP-staging\supabase\migrations"
$Rb = "C:\FILAMAP-staging\supabase\rollbacks"
$Ops = Split-Path -Parent $MyInvocation.MyCommand.Path
$Esperadas = [ordered]@{
    "20260927200000_add_spools_location"              = "97C2A0FAF401D3D6203565A73E5543D1D83238CCE744B35B3CE5D1E08ABA4A6E"
    "20260928100000_align_schema_with_production"     = "5BE5D45355B1E4649199936D22DA4C397E166378EF5AAC1FC2A48D905739DC4D"
    "20260928110000_user_filament_profiles_is_listed" = "3BF0E57989DD0905CB8A49B01CD5A496BB2F7941254A3DE8C1663A20BACF4FB3"
    "20260928180000_spools_tray_info_idx"             = "BFAF4540C0A436B656663EEA8F2F5FDF375D3EEBEA6B2969848FCD77A71DB90D"
    "20260929010000_ams_slots_assigned_by"            = "4E4B09E631147F939AD19E9F51A7A11A557F2CFEE90D0BAA8E5CC08C6422B57F"
    "20260930100000_filament_products_inbox"          = "BB03D4251F49BBFEACE8F32CEA272D78A134E1E0C12EA02FE962415A3B7EAFBB"
    "20260930110000_finalize_print_job_snapshot"      = "8165DC3F2D8DEB649C37B9342DABC244E4C9B293AB6667033B5C20C5217D7B70"
}
$Versoes = @($Esperadas.Keys | ForEach-Object { $_.Split("_")[0] })
$ListaSql = ($Versoes | ForEach-Object { "'$_'" }) -join ","

Set-Location C:\FILAMAP
if ((Get-Content C:\FILAMAP\supabase\.temp\project-ref -Raw).Trim() -ne $ProdRef) { throw "C:\FILAMAP nao esta ligado a producao. Nada foi feito." }

# A CLI responde {"rows":[...]} ou [...] conforme o ambiente; aceita os dois.
function ConvertFrom-SbRows([string]$Raw) {
    $p = ConvertFrom-Json -InputObject $Raw
    if ($null -ne $p -and -not ($p -is [array]) -and ($p.PSObject.Properties.Name -contains "rows")) { return ,@($p.rows) }
    return ,@($p)
}
function Invoke-Db([string]$Sql) {
    $id = [guid]::NewGuid().ToString("N")
    $arq = Join-Path $env:TEMP "f4-$id.sql"
    $err = Join-Path $env:TEMP "f4-$id.err"
    [IO.File]::WriteAllText($arq, $Sql, (New-Object Text.UTF8Encoding($false)))
    if ($EnsaioNoTeste) {
        $alvo = @("--linked", "--project-ref", $TestRef)
        $sec = (Get-Content "$env:APPDATA\Filamap-dev\staging-access-token.dpapi" -Raw).Trim() | ConvertTo-SecureString
        $env:SUPABASE_ACCESS_TOKEN = [System.Net.NetworkCredential]::new("", $sec).Password
    } else { $alvo = @("--linked") }
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

Write-Host "=== F4: estrutura nova no banco ($(if ($EnsaioNoTeste) { 'TESTE' } else { 'PRODUCAO' })) ==="

# 1) arquivos
$corpo = New-Object Text.StringBuilder
foreach ($k in $Esperadas.Keys) {
    $p = Join-Path $Mig "$k.sql"
    if (-not (Test-Path $p)) { throw "Arquivo ausente: $p" }
    if ((Get-FileHash $p -Algorithm SHA256).Hash -ne $Esperadas[$k]) { throw "Arquivo diferente do conferido: $k. Nada foi feito." }
    $v = $k.Split("_")[0]
    $n = $k.Substring($v.Length + 1)
    [void]$corpo.AppendLine("-- ==== $k")
    [void]$corpo.AppendLine([IO.File]::ReadAllText($p))
    [void]$corpo.AppendLine(";")
    [void]$corpo.AppendLine("insert into supabase_migrations.schema_migrations(version, name) values ('$v', '$n');")
}
Write-Host "[1] 7 arquivos conferidos (SHA256)."

# 2) historico + impressora
if (-not $EnsaioNoTeste) {
    $hist = @(Invoke-Db "select version from supabase_migrations.schema_migrations" | ForEach-Object { [string]$_.version })
    $ja = @($Versoes | Where-Object { $hist -contains $_ })
    if ($ja.Count -eq $Versoes.Count) { Write-Host "F4 JA APLICADA (as 7 estao no historico). Nada a fazer."; exit 0 }
    if ($ja.Count -gt 0) { throw "Historico parcial ($($ja -join ', ')). Pare e me chame. Nada foi feito." }
    $locais = Get-ChildItem $Mig -Filter *.sql | ForEach-Object { $_.BaseName.Split("_")[0] }
    $estranhas = @($locais | Where-Object { ($hist -notcontains $_) -and ($Versoes -notcontains $_) })
    if ($estranhas.Count -gt 0) { throw "Migrations inesperadas pendentes: $($estranhas -join ', '). Nada foi feito." }
    Write-Host "[2] Historico da producao: $($hist.Count) aplicadas; pendentes = exatamente as 7 esperadas."
}
$imp = Invoke-Db "select coalesce(string_agg(coalesce(gcode_state,'?'), ','), '') as s from public.printers"
$estado = [string]$imp[0].s
if ($estado -match "RUNNING|PREPARE|PAUSE") { throw "Impressora ativa ($estado). Rode com a impressora parada. Nada foi feito." }
Write-Host "    Impressora: $estado"

# hash dos dados que as migrations NAO podem alterar (identidade + fisico + historico + slots)
$hashDados = @"
(select md5(coalesce(string_agg(concat_ws(':', id, user_id, nfc_uid, brand, material, color_name, color_hex, spool_tare_weight, initial_weight, current_weight, price_paid, filament_profile_id, bambu_spool_id), '|' order by id), '')) from public.spools)
|| (select md5(coalesce(string_agg(concat_ws(':', id, spool_id, filament_used_g, status, job_id), '|' order by id), '')) from public.print_logs)
|| (select md5(coalesce(string_agg(concat_ws(':', id, printer_id, slot_index, spool_id), '|' order by id), '')) from public.ams_slots)
"@
function Col([string]$t, [string]$c) { return "exists(select 1 from information_schema.columns where table_schema='public' and table_name='$t' and column_name='$c')" }
function Rls([string]$t) { return "coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.$t')), false)" }

$prelude = ""
if ($EnsaioNoTeste) {
    # volta o TESTE ao estado da producao dentro da transacao (desfeito no ROLLBACK)
    $m1down = ([IO.File]::ReadAllText((Join-Path $Rb "20260930100000_filament_products_inbox.down.sql"))) -replace "(?m)^\s*(BEGIN|COMMIT);\s*$", ""
    $prelude = [IO.File]::ReadAllText((Join-Path $Rb "20260930110000_finalize_print_job_snapshot.down.sql")) + "`n;`n" + $m1down + "`n;`n" +
        [IO.File]::ReadAllText((Join-Path $Rb "20260929010000_ams_slots_assigned_by.down.sql")) + "`n;`n" +
        [IO.File]::ReadAllText((Join-Path $Rb "20260928110000_user_filament_profiles_is_listed.down.sql")) + "`n;`n" +
        "delete from supabase_migrations.schema_migrations where version in ($ListaSql);`n"
}

function New-F4Sql([string]$Fim) {
    return @"
BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '15s';
$prelude
create temp table _f4_pre on commit drop as select $hashDados as h;
$($corpo.ToString())
NOTIFY pgrst, 'reload schema';
create temp table _f4_chk on commit drop as select json_build_object(
 'dados_iguais',              (select h from _f4_pre) = ($hashDados),
 'historico_7_versoes',       (select count(*) from supabase_migrations.schema_migrations where version in ($ListaSql)) = 7,
 'spools_location',           $(Col 'spools' 'location'),
 'spools_tray_info_idx',      $(Col 'spools' 'tray_info_idx'),
 'spools_filament_product_id',$(Col 'spools' 'filament_product_id'),
 'spools_archived_at',        $(Col 'spools' 'archived_at'),
 'perfis_is_listed',          $(Col 'user_filament_profiles' 'is_listed'),
 'perfis_filament_product_id',$(Col 'user_filament_profiles' 'filament_product_id'),
 'ams_slots_assigned_by',     $(Col 'ams_slots' 'assigned_by'),
 'print_logs_snapshot',       $(Col 'print_logs' 'product_name_snapshot'),
 'rls_filament_products',     $(Rls 'filament_products'),
 'rls_spool_inbox',           $(Rls 'spool_inbox'),
 'rls_spools_identity_backup',$(Rls 'spools_identity_backup'),
 'finalize_com_snapshot',     coalesce((select bool_and(prosrc like '%product_name_snapshot%') from pg_proc where proname = 'finalize_print_job' and pronamespace = 'public'::regnamespace), false)
) as c;
DO `$f4`$ DECLARE k text; BEGIN
  FOR k IN select key from json_each_text((select c from _f4_chk)) where value is distinct from 'true' LOOP
    RAISE EXCEPTION 'F4 verificacao falhou: %', k;
  END LOOP;
END `$f4`$;
select (select c from _f4_chk)::text as c, (select count(*) from public.spools) as spools, (select count(*) from public.print_logs) as logs;
$Fim;
"@
}
function Show-Result($r, [string]$Titulo) {
    $c = ConvertFrom-Json -InputObject ([string]$r[0].c)
    Write-Host $Titulo
    foreach ($p in $c.PSObject.Properties) { Write-Host ("    {0,-28} {1}" -f $p.Name, $(if ($p.Value -eq $true) { "OK" } else { "FALHOU" })) }
    Write-Host "    spools=$($r[0].spools)  print_logs=$($r[0].logs)"
}

# 3) ensaio (ROLLBACK)
$r = Invoke-Db (New-F4Sql "ROLLBACK")
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
$r = Invoke-Db (New-F4Sql "COMMIT")
Show-Result $r "[5] APLICADO (COMMIT):"
$hist3 = @(Invoke-Db "select count(*) as n from supabase_migrations.schema_migrations where version in ($ListaSql)")
if ([int]$hist3[0].n -ne 7) { throw "Historico com $($hist3[0].n)/7 depois do COMMIT. Me chame." }
Write-Host ""
Write-Host "F4_CONCLUIDA: 7/7 no historico, dados iguais, estrutura nova presente."
