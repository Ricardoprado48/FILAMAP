# O6 - Impressora unica POR CONTA (antes: unica no sistema inteiro) no banco da PRODUCAO.
# Sem isso, a mesma impressora nao entra numa segunda conta (instalacao limpa de teste,
# revenda, troca de dono): o Agent da segunda conta falha ao registrar a impressora.
#   1) confere o arquivo (SHA256) e o historico da producao
#   2) ENSAIO na propria producao com ROLLBACK (nada e gravado)
#   3) backup JSON de todas as tabelas
#   4) pede confirmacao (digitar APLICAR)
#   5) aplica; desfaz sozinho se qualquer verificacao falhar ou se algum dado mudar
# So troca uma regra da tabela printers; nenhum dado e alterado. Agent 4.2 e Web continuam iguais.
# Uso:  powershell -ExecutionPolicy Bypass -File C:\FILAMAP-staging\ops\o6-impressora-por-conta.ps1 [-SoEnsaio]
# -EnsaioNoTeste: uso do desenvolvedor; mesmo ensaio no banco de TESTE (sempre ROLLBACK).
param([switch]$SoEnsaio, [switch]$EnsaioNoTeste)
# Parametro desconhecido NUNCA cai no modo padrao (incidente 2026-09-29: "-EnsaioNoTeste"
# repassado como texto fez o script rodar no modo producao).
if ($args.Count -gt 0) { throw "Parametro nao reconhecido: $($args -join ' '). Nada foi feito." }
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$ProdRef = "gqtlszffgvxsqcmefhyd"
$TestRef = "zllbzjwhdyxbryhbqrfg"
$Stg = "C:\FILAMAP-staging"
$Mig = "$Stg\supabase\migrations"
$Rb = "$Stg\supabase\rollbacks"
$Ops = Split-Path -Parent $MyInvocation.MyCommand.Path
$Esperadas = [ordered]@{
    "20261003100000_printer_serial_per_user" = "522B761F083EAC13CCCD6A4B0694E72B1A2EE9FDC4F1ECB4BEF2044961D0A5DF"
}
$Versoes = @($Esperadas.Keys | ForEach-Object { $_.Split("_")[0] })
$ListaSql = ($Versoes | ForEach-Object { "'$_'" }) -join ","

Set-Location C:\FILAMAP
if ((Get-Content C:\FILAMAP\supabase\.temp\project-ref -Raw).Trim() -ne $ProdRef) { throw "C:\FILAMAP nao esta ligado a producao. Nada foi feito." }
$DonoEmail = [string]((Get-Content (Join-Path $env:APPDATA "Filamap\config.json") -Raw | ConvertFrom-Json).agentEmail)
if ($DonoEmail -notmatch "^[^@\s']+@[^@\s']+$") { throw "E-mail do dono nao encontrado em config.json. Nada foi feito." }
if ($EnsaioNoTeste) {
    $k = [System.Net.NetworkCredential]::new("", ((Get-Content "$env:APPDATA\Filamap-dev\staging-keys.dpapi" -Raw).Trim() | ConvertTo-SecureString)).Password | ConvertFrom-Json
    $DonoEmail = [string]$k.email
}

function ConvertFrom-SbRows([string]$Raw) {
    $p = ConvertFrom-Json -InputObject $Raw
    if ($null -ne $p -and -not ($p -is [array]) -and ($p.PSObject.Properties.Name -contains "rows")) { return ,@($p.rows) }
    return ,@($p)
}
function Invoke-Db([string]$Sql) {
    $id = [guid]::NewGuid().ToString("N")
    $arq = Join-Path $env:TEMP "o6-$id.sql"
    $err = Join-Path $env:TEMP "o6-$id.err"
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
function Get-NormHash([string]$Path) {
    $t = [IO.File]::ReadAllText($Path).Replace("`r`n", "`n")
    $sha = [Security.Cryptography.SHA256]::Create()
    return (($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($t)) | ForEach-Object { $_.ToString("X2") }) -join "")
}

Write-Host "=== O6: impressora por conta no banco ($(if ($EnsaioNoTeste) { 'TESTE' } else { 'PRODUCAO' })) ==="

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
    if ($ja.Count -eq $Versoes.Count) { Write-Host "O6 JA APLICADA no banco."; $jaAplicada = $true }
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
|| (select md5(coalesce(string_agg(concat_ws(':', id, name, brand, material), '|' order by id), '')) from public.filament_products)
|| (select md5(coalesce(string_agg(concat_ws(':', id, user_id, serial, model, name), '|' order by id), '')) from public.printers)
"@
    function Tab([string]$t) { return "(to_regclass('public.$t') is not null)" }
    function Rls([string]$t) { return "coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.$t')), false)" }
    function Fn([string]$f) { return "exists(select 1 from pg_proc where proname = '$f' and pronamespace = 'public'::regnamespace)" }

    $prelude = ""
    if ($EnsaioNoTeste) {
        $prelude = [IO.File]::ReadAllText((Join-Path $Rb "20261003100000_printer_serial_per_user.down.sql")) + "`n;`n"
    }
    $emailSql = $DonoEmail.Replace("'", "''")

    function New-O5Sql([string]$Fim) {
        return @"
BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '15s';
$prelude
create temp table _o5_pre on commit drop as select $hashDados as h;
$($corpo.ToString())
NOTIFY pgrst, 'reload schema';
create temp table _o5_chk on commit drop as select json_build_object(
 'dados_iguais',             (select h from _o5_pre) = ($hashDados),
 'historico_1_versao',       (select count(*) from supabase_migrations.schema_migrations where version in ($ListaSql)) = 1,
 'regra_por_conta',          exists(select 1 from pg_constraint where conname = 'printers_user_serial_key' and conrelid = 'public.printers'::regclass and pg_get_constraintdef(oid) = 'UNIQUE (user_id, serial)'),
 'regra_antiga_removida',    not exists(select 1 from pg_constraint where conname = 'printers_serial_key' and conrelid = 'public.printers'::regclass),
 'dono_obrigatorio',         (select attnotnull from pg_attribute where attrelid = 'public.printers'::regclass and attname = 'user_id'),
 'rls_printers',             $(Rls 'printers')
) as c;
DO `$o5`$ DECLARE k text; BEGIN
  FOR k IN select key from json_each_text((select c from _o5_chk)) where value is distinct from 'true' LOOP
    RAISE EXCEPTION 'O6 verificacao falhou: %', k;
  END LOOP;
END `$o5`$;
select (select c from _o5_chk)::text as c, (select count(*) from public.spools) as spools, (select count(*) from public.print_logs) as logs;
$Fim;
"@
    }
    function Show-Result($r, [string]$Titulo) {
        $c = ConvertFrom-Json -InputObject ([string]$r[0].c)
        Write-Host $Titulo
        foreach ($p in $c.PSObject.Properties) { Write-Host ("    {0,-26} {1}" -f $p.Name, $(if ($p.Value -eq $true) { "OK" } else { "FALHOU" })) }
        Write-Host "    spools=$($r[0].spools)  print_logs=$($r[0].logs)"
    }

    # 3) ensaio
    $r = Invoke-Db (New-O5Sql "ROLLBACK")
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
    $r = Invoke-Db (New-O5Sql "COMMIT")
    Show-Result $r "[5] APLICADO (COMMIT):"
    $hist3 = @(Invoke-Db "select count(*) as n from supabase_migrations.schema_migrations where version in ($ListaSql)")
    if ([int]$hist3[0].n -ne 1) { throw "Historico com $($hist3[0].n)/1 depois do COMMIT. Me chame." }
}
if ($SoEnsaio) { Write-Host "ENSAIO_OK (banco ja estava aplicado)"; exit 0 }
Write-Host ""
Write-Host "O6_BANCO_CONCLUIDA: a mesma impressora pode ficar em contas diferentes (unica dentro de cada conta)."
