# O5 - Central de Observabilidade + pareamento de computador no banco da PRODUCAO.
# Aplica 2 migrations ADITIVAS numa UNICA transacao (tudo ou nada), torna o dono
# admin da Central e publica a Edge Function agent-pair.
#   1) confere os arquivos (SHA256, fim de linha normalizado) e o historico da producao
#   2) ENSAIO na propria producao com ROLLBACK (nada e gravado)
#   3) backup JSON de todas as tabelas
#   4) pede confirmacao (digitar APLICAR)
#   5) aplica; desfaz sozinho se qualquer verificacao falhar ou se algum dado de estoque mudar
#   6) publica a Edge Function agent-pair e confere que ela responde
# Nenhuma tabela existente e alterada. Agent 4.1 e Web atual continuam funcionando.
# Uso:  powershell -ExecutionPolicy Bypass -File C:\FILAMAP-staging\ops\o5-schema-producao.ps1 [-SoEnsaio]
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
    "20261001100000_ops_observability"     = "93C040B60893B45D3222170D675C88F0B6DC91844BBC3740F8AFAA684FF89949"
    "20261002100000_agent_device_pairing"  = "974EF46A6D019534E394542CD0169CBFA4D97A92F58655EC5D9710EBFC4D6D50"
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
    $arq = Join-Path $env:TEMP "o5-$id.sql"
    $err = Join-Path $env:TEMP "o5-$id.err"
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

Write-Host "=== O5: Central + pareamento no banco ($(if ($EnsaioNoTeste) { 'TESTE' } else { 'PRODUCAO' })) ==="

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
Write-Host "[1] 2 arquivos conferidos (SHA256)."

# 2) historico
if (-not $EnsaioNoTeste) {
    $hist = @(Invoke-Db "select version from supabase_migrations.schema_migrations" | ForEach-Object { [string]$_.version })
    $ja = @($Versoes | Where-Object { $hist -contains $_ })
    if ($ja.Count -eq $Versoes.Count) { Write-Host "O5 JA APLICADA no banco (as 2 estao no historico)."; $jaAplicada = $true }
    elseif ($ja.Count -gt 0) { throw "Historico parcial ($($ja -join ', ')). Pare e me chame. Nada foi feito." }
    else {
        $locais = Get-ChildItem $Mig -Filter *.sql | ForEach-Object { $_.BaseName.Split("_")[0] }
        $estranhas = @($locais | Where-Object { ($hist -notcontains $_) -and ($Versoes -notcontains $_) })
        if ($estranhas.Count -gt 0) { throw "Migrations inesperadas pendentes: $($estranhas -join ', '). Nada foi feito." }
        Write-Host "[2] Historico da producao: $($hist.Count) aplicadas; pendentes = exatamente as 2 esperadas."
    }
}

if (-not $jaAplicada) {
    $hashDados = @"
(select md5(coalesce(string_agg(concat_ws(':', id, user_id, nfc_uid, brand, material, color_name, color_hex, spool_tare_weight, initial_weight, current_weight, price_paid, filament_profile_id, filament_product_id, bambu_spool_id, archived_at), '|' order by id), '')) from public.spools)
|| (select md5(coalesce(string_agg(concat_ws(':', id, spool_id, filament_used_g, status, job_id), '|' order by id), '')) from public.print_logs)
|| (select md5(coalesce(string_agg(concat_ws(':', id, printer_id, slot_index, spool_id), '|' order by id), '')) from public.ams_slots)
|| (select md5(coalesce(string_agg(concat_ws(':', id, name, brand, material), '|' order by id), '')) from public.filament_products)
"@
    function Tab([string]$t) { return "(to_regclass('public.$t') is not null)" }
    function Rls([string]$t) { return "coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.$t')), false)" }
    function Fn([string]$f) { return "exists(select 1 from pg_proc where proname = '$f' and pronamespace = 'public'::regnamespace)" }

    $prelude = ""
    if ($EnsaioNoTeste) {
        $prelude = [IO.File]::ReadAllText((Join-Path $Rb "20261002100000_agent_device_pairing.down.sql")) + "`n;`n" +
                   [IO.File]::ReadAllText((Join-Path $Rb "20261001100000_ops_observability.down.sql")) + "`n;`n"
    }
    $emailSql = $DonoEmail.Replace("'", "''")

    function New-O5Sql([string]$Fim) {
        return @"
BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '15s';
$prelude
create temp table _o5_pre on commit drop as select $hashDados as h;
$($corpo.ToString())
insert into public.ops_admins (user_id) select id from auth.users where lower(email) = lower('$emailSql') on conflict do nothing;
NOTIFY pgrst, 'reload schema';
create temp table _o5_chk on commit drop as select json_build_object(
 'dados_de_estoque_iguais',  (select h from _o5_pre) = ($hashDados),
 'historico_2_versoes',      (select count(*) from supabase_migrations.schema_migrations where version in ($ListaSql)) = 2,
 'tabelas_central',          $(Tab 'ops_events') and $(Tab 'ops_installations') and $(Tab 'ops_admins'),
 'tabelas_pareamento',       $(Tab 'agent_devices') and $(Tab 'agent_pairing_codes'),
 'rls_todas',                $(Rls 'ops_events') and $(Rls 'ops_installations') and $(Rls 'ops_admins') and $(Rls 'agent_devices') and $(Rls 'agent_pairing_codes'),
 'funcoes',                  $(Fn 'ingest_ops_events') and $(Fn 'ops_health') and $(Fn 'keepalive') and $(Fn 'create_agent_pairing_code') and $(Fn 'consume_agent_pairing_code') and $(Fn 'revoke_agent_device') and $(Fn 'touch_agent_device'),
 'anon_sem_ingestao',        not has_function_privilege('anon', 'public.ingest_ops_events(jsonb,jsonb)', 'EXECUTE'),
 'anon_keepalive',           has_function_privilege('anon', 'public.keepalive()', 'EXECUTE'),
 'sem_insert_direto',        not has_table_privilege('authenticated', 'public.ops_events', 'INSERT'),
 'anon_sem_consumir_codigo', not has_function_privilege('anon', 'public.consume_agent_pairing_code(text)', 'EXECUTE'),
 'dono_e_admin',             (select count(*) from public.ops_admins a join auth.users u on u.id = a.user_id where lower(u.email) = lower('$emailSql')) = 1
) as c;
DO `$o5`$ DECLARE k text; BEGIN
  FOR k IN select key from json_each_text((select c from _o5_chk)) where value is distinct from 'true' LOOP
    RAISE EXCEPTION 'O5 verificacao falhou: %', k;
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
    if ([int]$hist3[0].n -ne 2) { throw "Historico com $($hist3[0].n)/2 depois do COMMIT. Me chame." }
}
if ($SoEnsaio) { Write-Host "ENSAIO_OK (banco ja estava aplicado)"; exit 0 }

# 6) Edge Function agent-pair (sem verificacao de JWT: o Agent ainda nao tem sessao)
Write-Host "[6] Publicando a funcao agent-pair na producao..."
Set-Location $Stg
if ((Get-Content "$Stg\supabase\.temp\project-ref" -Raw).Trim() -ne $ProdRef) { throw "$Stg nao esta ligado a producao." }
$ErrorActionPreference = "Continue"
$dep = & supabase functions deploy agent-pair --no-verify-jwt --use-api --project-ref $ProdRef 2>&1 | Out-String
$ErrorActionPreference = "Stop"
if ($dep -notmatch "Deployed Functions") { throw "Falha ao publicar agent-pair:`n$dep" }
$anon = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdxdGxzemZmZ3Z4c3FjbWVmaHlkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk2NTA3OTQsImV4cCI6MjEwNTIyNjc5NH0.YH6OHOF2lV1uIjQ3A9kLFhIGlovgZc2ywdXmRykxkkM"
$status = 0
try {
    Invoke-RestMethod -Method Post -Uri "https://$ProdRef.supabase.co/functions/v1/agent-pair" -Headers @{ apikey = $anon } -ContentType "application/json" -Body '{"code":"XXXXX-XXXXX","device_name":"teste-o5"}' | Out-Null
} catch { $status = [int]$_.Exception.Response.StatusCode }
if ($status -ne 400) { throw "agent-pair respondeu $status (esperado 400 para codigo invalido)." }
Write-Host "    agent-pair no ar (codigo invalido recusado com 400)."
$ka = Invoke-RestMethod -Method Post -Uri "https://$ProdRef.supabase.co/rest/v1/rpc/keepalive" -Headers @{ apikey = $anon; Authorization = "Bearer $anon" } -ContentType "application/json" -Body "{}"
Write-Host "    keepalive() responde: $ka"
Write-Host ""
Write-Host "O5_BANCO_CONCLUIDA: Central + pareamento na producao; voce e admin da Central."
