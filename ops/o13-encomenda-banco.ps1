# O13 - Orcamento por encomenda no banco da PRODUCAO: coluna order_qty em catalog_items.
#   1) confere o arquivo (SHA256) e o historico da producao
#   2) ENSAIO na propria producao com ROLLBACK (nada e gravado), incluindo gravar e ler um
#      item de catalogo com quantidade da encomenda -- desfeito no fim
#   3) backup JSON de todas as tabelas
#   4) pede confirmacao (digitar APLICAR)
#   5) aplica; desfaz sozinho se qualquer verificacao falhar ou se algum dado mudar
# Aditiva: nenhum dado existente muda. A Web atual continua funcionando igual.
# Uso:  powershell -ExecutionPolicy Bypass -File <repo>\ops\o13-encomenda-banco.ps1 [-SoEnsaio]
# Desfazer: supabase/rollbacks/20261027100000_catalog_order_qty.down.sql
param([switch]$SoEnsaio)
if ($args.Count -gt 0) { throw "Parametro nao reconhecido: $($args -join ' '). Nada foi feito." }
$ErrorActionPreference = "Stop"
$TokArq = Join-Path $env:APPDATA "Filamap-dev\prod-access-token.dpapi"
if (-not (Test-Path $TokArq)) { throw "Token da producao nao encontrado. Rode uma vez: ops\salvar-token-producao.ps1. Nada foi feito." }
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$ProdRef = "gqtlszffgvxsqcmefhyd"
$Stg = "$(Split-Path $PSScriptRoot -Parent)"
$Mig = "$Stg\supabase\migrations"
$Ops = Split-Path -Parent $MyInvocation.MyCommand.Path
$Nome = "20261027100000_catalog_order_qty"
$Hash = "865B3B61C696304B418D4E77AAC680F5CF274C46E47F5282D48A6E7CC12A4657"
$Versao = $Nome.Split("_")[0]

Set-Location $Stg
if ((Get-Content "$Stg\supabase\.temp\project-ref" -Raw).Trim() -ne $ProdRef) { throw "$Stg nao esta ligado a producao. Nada foi feito." }
function ConvertFrom-SbRows([string]$Raw) {
    $p = ConvertFrom-Json -InputObject $Raw
    if ($null -ne $p -and -not ($p -is [array]) -and ($p.PSObject.Properties.Name -contains "rows")) { return ,@($p.rows) }
    return ,@($p)
}
function Invoke-Db([string]$Sql) {
    $id = [guid]::NewGuid().ToString("N")
    $arq = Join-Path $env:TEMP "o13-$id.sql"
    $err = Join-Path $env:TEMP "o13-$id.err"
    [IO.File]::WriteAllText($arq, $Sql, (New-Object Text.UTF8Encoding($false)))
    $env:SUPABASE_ACCESS_TOKEN = [System.Net.NetworkCredential]::new("", ((Get-Content $TokArq -Raw).Trim() | ConvertTo-SecureString)).Password
    $ErrorActionPreference = "Continue"
    $out = & supabase db query --linked --agent no -o json -f $arq 2> $err | Out-String
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

Write-Host "=== O13: orcamento por encomenda no banco (PRODUCAO) ==="
$p = Join-Path $Mig "$Nome.sql"
if (-not (Test-Path $p)) { throw "Arquivo ausente: $p" }
if ((Get-NormHash $p) -ne $Hash) { throw "Arquivo diferente do conferido: $Nome. Nada foi feito." }
Write-Host "[1] Arquivo conferido (SHA256)."

$hist = @(Invoke-Db "select version from supabase_migrations.schema_migrations" | ForEach-Object { [string]$_.version })
if ($hist -contains $Versao) { Write-Host "O13 JA APLICADA no banco."; exit 0 }
$locais = Get-ChildItem $Mig -Filter *.sql | ForEach-Object { $_.BaseName.Split("_")[0] }
$estranhas = @($locais | Where-Object { ($hist -notcontains $_) -and ($_ -ne $Versao) })
if ($estranhas.Count -gt 0) { throw "Migrations inesperadas pendentes: $($estranhas -join ', '). Nada foi feito." }
Write-Host "[2] Historico da producao: $($hist.Count) aplicadas; pendente = exatamente a esperada."

$corpo = [IO.File]::ReadAllText($p) + "`n;`ninsert into supabase_migrations.schema_migrations(version, name) values ('$Versao', '$($Nome.Substring($Versao.Length + 1))');`n"
$hashDados = @"
(select md5(coalesce(string_agg(concat_ws(':', id, user_id, name, material, weight_g, print_hours, accessories_cost, production_cost, sale_price), '|' order by id), '')) from public.catalog_items)
|| (select md5(coalesce(string_agg(concat_ws(':', id, current_weight, archived_at), '|' order by id), '')) from public.spools)
|| (select md5(coalesce(string_agg(concat_ws(':', id, spool_id, filament_used_g), '|' order by id), '')) from public.print_logs)
"@
$teste = @"
create temp table _o13_fx on commit drop as select user_id from public.printers limit 1;
select set_config('request.jwt.claims', (select json_build_object('sub', user_id, 'role', 'authenticated')::text from _o13_fx), true);
insert into public.catalog_items(user_id, name, order_qty)
select user_id, 'O13 ENSAIO', 12 from _o13_fx;
update public.catalog_items set order_qty = 6 where name = 'O13 ENSAIO';
create temp table _o13_t on commit drop as select json_build_object(
 'teste_grava_quantidade', (select order_qty = 6 from public.catalog_items where name = 'O13 ENSAIO')
) as c;
"@
function New-O13Sql([string]$Fim) {
    $fx = if ($Fim -eq "ROLLBACK") { $teste } else { "" }
    $fxSel = if ($Fim -eq "ROLLBACK") { "(select c from _o13_t)::text" } else { "null::text" }
    return @"
BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '15s';
create temp table _o13_pre on commit drop as select $hashDados as h;
$corpo
create temp table _o13_chk on commit drop as select json_build_object(
 'dados_iguais',      (select h from _o13_pre) = ($hashDados),
 'historico',         (select count(*) from supabase_migrations.schema_migrations where version = '$Versao') = 1,
 'coluna_order_qty',  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'catalog_items' and column_name = 'order_qty' and data_type = 'numeric'),
 'checagem_positiva', exists (select 1 from pg_constraint where conname = 'catalog_items_order_qty_positive')
) as c;
DO `$o13`$ DECLARE k text; BEGIN
  FOR k IN select key from json_each_text((select c from _o13_chk)) where value is distinct from 'true' LOOP
    RAISE EXCEPTION 'O13 verificacao falhou: %', k;
  END LOOP;
END `$o13`$;
$fx
select (select c from _o13_chk)::text as c, $fxSel as t, (select count(*) from public.catalog_items) as itens;
$Fim;
"@
}
function Show-Result($r, [string]$Titulo) {
    Write-Host $Titulo
    foreach ($campo in @("c", "t")) {
        if (-not $r[0].$campo) { continue }
        $c = ConvertFrom-Json -InputObject ([string]$r[0].$campo)
        foreach ($q in $c.PSObject.Properties) { Write-Host ("    {0,-24} {1}" -f $q.Name, $(if ($q.Value -eq $true) { "OK" } else { "FALHOU" })) }
    }
    Write-Host "    itens no catalogo=$($r[0].itens)"
}

$r = Invoke-Db (New-O13Sql "ROLLBACK")
Show-Result $r "[3] ENSAIO (ROLLBACK, nada gravado):"
$hist2 = @(Invoke-Db "select version from supabase_migrations.schema_migrations where version = '$Versao'")
if (@($hist2 | Where-Object { $_.version }).Count -ne 0) { throw "O ensaio deixou rastro no historico. Pare e me chame." }
Write-Host "    Conferido: o ensaio nao gravou nada."
if ($SoEnsaio) { Write-Host "ENSAIO_OK"; exit 0 }

Write-Host "[4] Backup da producao..."
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Ops "backup-producao-json.ps1") -Projeto $Stg
if ($LASTEXITCODE -ne 0) { throw "Backup falhou. Nada foi aplicado." }

$resp = Read-Host "Digite APLICAR para gravar na producao (qualquer outra coisa cancela)"
if ($resp -cne "APLICAR") { Write-Host "Cancelado. Nada foi aplicado."; exit 0 }
$r = Invoke-Db (New-O13Sql "COMMIT")
Show-Result $r "[5] APLICADO (COMMIT):"
Write-Host ""
Write-Host "O13_CONCLUIDA: o catalogo guarda a quantidade da encomenda."
