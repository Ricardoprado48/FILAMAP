# F6 - Organizar os carreteis de verdade (Filamap).
# Numa UNICA transacao (tudo ou nada):
#   - guarda a identidade atual de cada carretel (spools_identity_backup, rotulo F6)
#   - remove os 4 carreteis-fantasma sem dono (autorizado pelo usuario em 28/09; condicoes rigidas)
#   - cria 1 produto por carretel (29): 28 presets do Bambu Studio + PLA Lite (preset oficial GFA18)
#   - liga os 3 pares de presets iguais (Studio/Beta) ao mesmo produto (decisao D1)
#   - liga cada carretel ao seu produto e ao seu perfil do Studio (desfaz o que o Agent v2 regravou)
#   - grava o snapshot dos registros de impressao que tem carretel; os orfaos ficam como estao (R4)
#   - aborta sozinha se peso/tara/preco/tag/historico/slots mudarem ou se qualquer verificacao falhar
# Uso (producao): powershell -ExecutionPolicy Bypass -File C:\FILAMAP-staging\ops\f6-reconciliar.ps1 [-SoEnsaio]
#   Desfazer:     ... f6-reconciliar.ps1 -Rollback
# Desenvolvedor:  -Alvo teste [-Sim]  (banco de TESTE; -Sim dispensa a confirmacao, so no teste)
param([ValidateSet("producao","teste")][string]$Alvo = "producao", [switch]$SoEnsaio, [switch]$Rollback, [switch]$Sim)
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$ProdRef = "gqtlszffgvxsqcmefhyd"
$TestRef = "zllbzjwhdyxbryhbqrfg"
$Ops = Split-Path -Parent $MyInvocation.MyCommand.Path
if ($Sim -and $Alvo -ne "teste") { throw "-Sim so vale no teste." }

Set-Location C:\FILAMAP
if ((Get-Content C:\FILAMAP\supabase\.temp\project-ref -Raw).Trim() -ne $ProdRef) { throw "C:\FILAMAP nao esta ligado a producao. Nada foi feito." }

function ConvertFrom-SbRows([string]$Raw) {
    $p = ConvertFrom-Json -InputObject $Raw
    if ($null -ne $p -and -not ($p -is [array]) -and ($p.PSObject.Properties.Name -contains "rows")) { return ,@($p.rows) }
    return ,@($p)
}
# Queda de rede ("Transport error") e intermitente: repete ate 3 vezes. Numa gravacao, antes de
# repetir, pergunta ao banco ($Probe) se ja gravou; se sim, devolve $null em vez de gravar de novo.
function Invoke-Db([string]$Sql, [string]$Probe) {
    for ($t = 1; $t -le 3; $t++) {
        try { return (Invoke-DbOnce $Sql) }
        catch {
            if ($_.Exception.Message -notmatch "Transport error" -or $t -eq 3) { throw }
            Write-Host "    (conexao caiu; tentativa $t de 3, aguardando 5s...)"
            Start-Sleep -Seconds 5
            if ($Probe) {
                $g = Invoke-Db $Probe
                if ([string]$g[0].g -eq "True") { return $null }
            }
        }
    }
}
function Invoke-DbOnce([string]$Sql) {
    $id = [guid]::NewGuid().ToString("N")
    $arq = Join-Path $env:TEMP "f6-$id.sql"
    $err = Join-Path $env:TEMP "f6-$id.err"
    [IO.File]::WriteAllText($arq, $Sql, (New-Object Text.UTF8Encoding($false)))
    if ($Alvo -eq "teste") {
        $alvoCli = @("--linked", "--project-ref", $TestRef)
        $sec = (Get-Content "$env:APPDATA\Filamap-dev\staging-access-token.dpapi" -Raw).Trim() | ConvertTo-SecureString
        $env:SUPABASE_ACCESS_TOKEN = [System.Net.NetworkCredential]::new("", $sec).Password
    } else { $alvoCli = @("--linked") }
    $ErrorActionPreference = "Continue"
    $out = & supabase db query @alvoCli --agent no -o json -f $arq 2> $err | Out-String
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

# Mapa aprovado: carretel -> preset (source_key e igual na producao e no teste).
$Mapa = @'
('68d59e64-ee75-4c8a-8dde-75e0c5a09c56'::uuid, 'bambu_studio', 'Pdd66270', null::text, null::text),
('18518cf5-2a49-4ae1-a7ea-38c671e85758', 'bambu_studio',   'Pa257ced', null, null),
('a741c2a2-3730-4da7-9a5b-3856d359231d', 'bambu_studio',   'P2a85ed7', null, null),
('5f14df68-2113-4f31-9af4-195b7d77f96f', 'bambu_studio',   'P915cab1', null, null),
('d6ed4533-9f8d-4ccd-b9a5-83ee533245e3', 'bambu_studio',   'Pfdab47d', null, null),
('e71f46f7-2405-49df-817f-ea04c86524e0', 'bambu_studio',   'P4c9a158', null, null),
('f8f193f9-20e5-4310-9864-0681e80baea7', 'bambu_studio',   'P3c735d3', null, null),
('8c7872b0-5983-4163-8a83-4feb701ed241', 'bambu_studio',   'Ped1239b', null, null),
('7fba953b-db1c-4b89-8500-7ee648bd9404', 'bambu_studio',   'P1916156', null, null),
('99be0ac1-f96e-407a-bed7-dad4b36276da', 'bambu_studio',   'P7f15dcd', null, null),
('75cd202a-be99-4204-9683-2b1bd55ee437', 'bambu_studio',   'P8017402', null, null),
('c6d8460e-513c-4d44-8114-eccc44307a7f', 'bambu_studio',   'P253d58f', null, null),
('5799f355-981b-4d83-afaf-7f6f95a9de4f', 'bambu_studio',   'P8137471', null, null),
('42824192-f5cc-41b0-b676-b7b8bb51a7b6', 'bambu_studio',   'P83e3058', null, null),
('7861013a-0e0f-4e70-a1d8-583e4d39c7ac', 'bambu_studio',   'Pa334684', null, null),
('cc804544-496b-4cb5-91bb-59e963ebac21', 'bambu_studio',   'P2322b03', null, null),
('45fa7b18-2b63-43fc-a1dd-b338a10da064', 'bambu_studio',   'P0a22169', null, null),
('69494846-ca12-4ad1-a7bc-56121d9c20f6', 'bambu_studio',   'Pd32260d', null, null),
('2a61d22c-9d61-4c75-941d-0ad992f6ec87', 'bambu_studio',   'P879a594', null, null),
('6bf1c8f9-c71a-4927-a072-9ca188297d7b', 'bambu_studio',   'P621737e', null, null),
('7bf0de9e-d6bd-4d18-937b-e3a0c4b3d886', 'bambu_studio',   'Pef7a165', null, null),
('2ee89b5c-1f3c-4983-91e5-f18800373ab5', 'bambu_studio',   'Pc11e481', null, null),
('e132a495-07f6-417b-88e1-152062ca7e55', 'bambu_studio',   'Pfbb8d27', null, null),
('250ce079-d64f-48d6-b807-1f2820e60a71', 'bambu_studio',   'P3bcfc57', null, null),
('43327b13-1463-4a24-83a4-0d1fbcb2b0c9', 'bambu_studio',   'Pdcd6fea', null, null),
('ceff1f7e-649b-4a7c-8d51-4615f51630ea', 'bambu_studio',   'P4b9e340', null, null),
('d2863713-e98c-4cba-92a5-b0fe48756d8c', 'bambu_studio',   'P86318ba', null, 'Vidas Buenas'),
('807524a3-6ba1-4aed-9ef6-49bc8d1f4273', 'bambu_studio',   'P1dd51d1', null, null),
('0f56b104-2afa-41fb-a3ca-43f3c8ae4d55', 'bambu_official', 'GFA18',    'PLA Lite Amarelo', 'Bambu Lab')
'@
# D1: parceiro do par -> preset principal (mesmo produto; evidencia nos JSON dos presets)
$Pares = "('P5881e45','P915cab1'),('Pc5a93aa','P1916156'),('Pe5d5f07','Pdd66270')"
$Fantasmas = "'1c4004c2-4ad3-47d0-a9a8-6ef150399211','07ed9ab3-3de8-4cee-84dc-1123c328d011','b02b5557-a864-4229-b581-31a4f1bc028a','0ce7ea78-ceae-4daf-9f09-f1db7360a87f'"

# Dados que a F6 NAO pode alterar (fisico + historico + slots), dos carreteis com dono.
$HashFisico = @'
(select md5(coalesce(string_agg(concat_ws(':', id, user_id, nfc_uid, spool_tare_weight, initial_weight, current_weight, price_paid, bambu_spool_id, location, archived_at), '|' order by id), '')) from public.spools where user_id is not null)
|| (select md5(coalesce(string_agg(concat_ws(':', id, spool_id, filament_used_g, status, job_id), '|' order by id), '')) from public.print_logs)
|| (select md5(coalesce(string_agg(concat_ws(':', id, printer_id, slot_index, spool_id), '|' order by id), '')) from public.ams_slots)
'@

$SqlAplicar = @'
BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '15s';
create temp table _mapa(spool_id uuid primary key, source text, source_key text, prod_name text, prod_brand text) on commit drop;
insert into _mapa values __MAPA__;
create temp table _pares(parceiro text, principal text) on commit drop;
insert into _pares values __PARES__;
create temp table _u on commit drop as select distinct s.user_id from public.spools s join _mapa m on m.spool_id = s.id;

DO $f6$ DECLARE n int; falta text; BEGIN
  IF (select count(*) from _u) <> 1 THEN RAISE EXCEPTION 'F6 pre: os carreteis do mapa nao tem um unico dono'; END IF;
  select count(*) into n from _mapa m join public.spools s on s.id = m.spool_id;
  IF n <> 29 THEN RAISE EXCEPTION 'F6 pre: % de 29 carreteis do mapa encontrados', n; END IF;
  select string_agg(m.source_key, ', ') into falta from _mapa m
   where not exists (select 1 from public.user_filament_profiles p
                      where p.user_id = (select user_id from _u) and p.source = m.source and p.source_key = m.source_key);
  IF falta IS NOT NULL THEN RAISE EXCEPTION 'F6 pre: perfis ausentes: % (o Agent v4 ja sincronizou?)', falta; END IF;
  select string_agg(s.id::text, ', ') into falta from public.spools s
   where s.user_id = (select user_id from _u) and s.id not in (select spool_id from _mapa);
  IF falta IS NOT NULL THEN RAISE EXCEPTION 'F6 pre: carretel fora do mapa: %', falta; END IF;
  IF exists (select 1 from public.filament_products where user_id = (select user_id from _u)) THEN RAISE EXCEPTION 'F6 pre: ja existem produtos (F6 ja aplicada?)'; END IF;
  IF exists (select 1 from public.spools_identity_backup where backup_label = 'F6') THEN RAISE EXCEPTION 'F6 pre: backup F6 ja existe (F6 ja aplicada?)'; END IF;
END $f6$;

create temp table _pre on commit drop as select __HASH__ as h,
  (select count(*) from public.print_logs where spool_id is null) as orfaos;

insert into public.spools_identity_backup (spool_id, user_id, filament_profile_id, filament_product_id, brand, material, color_name, color_hex, backup_label)
select s.id, s.user_id, s.filament_profile_id, s.filament_product_id, s.brand, s.material, s.color_name, s.color_hex, 'F6'
  from public.spools s where s.user_id = (select user_id from _u);

create temp table _fantasmas on commit drop as
with d as (
  delete from public.spools s
   where s.id in (__FANTASMAS__)
     and s.user_id is null and s.brand = 'Bambu Lab'
     and s.nfc_uid is null and s.bambu_spool_id is null
     and not exists (select 1 from public.ams_slots a where a.spool_id = s.id)
     and not exists (select 1 from public.print_logs l where l.spool_id = s.id)
  returning s.id)
select count(*) as n from d;

create temp table _alvo on commit drop as
select m.spool_id, s.user_id, p.id as profile_id,
       coalesce(m.prod_name, p.display_name) as name,
       coalesce(m.prod_brand, p.brand) as brand,
       coalesce(p.material, s.material) as material,
       s.color_name, s.color_hex,
       case when p.source = 'bambu_official' then 'bambu_official' else 'bambu_studio' end as origin
  from _mapa m
  join public.spools s on s.id = m.spool_id
  join public.user_filament_profiles p on p.user_id = s.user_id and p.source = m.source and p.source_key = m.source_key;

insert into public.filament_products (user_id, name, brand, material, color_name, color_hex, origin)
select user_id, name, brand, material, color_name, color_hex, origin from _alvo;

update public.user_filament_profiles p set filament_product_id = fp.id
  from _alvo a join public.filament_products fp on fp.user_id = a.user_id and lower(fp.name) = lower(a.name)
 where p.id = a.profile_id;

update public.user_filament_profiles p set filament_product_id = pr.filament_product_id
  from _pares x join public.user_filament_profiles pr on pr.source = 'bambu_studio' and pr.source_key = x.principal
 where p.user_id = (select user_id from _u) and pr.user_id = p.user_id
   and p.source = 'bambu_studio' and p.source_key = x.parceiro;

update public.spools s set filament_product_id = fp.id, filament_profile_id = a.profile_id
  from _alvo a join public.filament_products fp on fp.user_id = a.user_id and lower(fp.name) = lower(a.name)
 where s.id = a.spool_id;

update public.spools set brand = 'Vidas Buenas'
 where id = 'd2863713-e98c-4cba-92a5-b0fe48756d8c' and brand = 'Voolt3D';

update public.print_logs l
   set filament_product_id = fp.id, product_name_snapshot = fp.name, brand_snapshot = fp.brand,
       material_snapshot = fp.material, color_snapshot = fp.color_name, snapshot_backfilled = true
  from public.spools s join public.filament_products fp on fp.id = s.filament_product_id
 where l.spool_id = s.id and l.product_name_snapshot is null;

create temp table _chk on commit drop as select json_build_object(
 'fisico_historico_slots_iguais', (select h from _pre) = (__HASH__),
 'carreteis_29_com_produto',      (select count(*) from public.spools where user_id = (select user_id from _u) and filament_product_id is not null) = 29,
 'produtos_29',                   (select count(*) from public.filament_products where user_id = (select user_id from _u)) = 29,
 'perfis_ligados_32',             (select count(*) from public.user_filament_profiles where user_id = (select user_id from _u) and filament_product_id is not null) = 32,
 'perfil_e_produto_coerentes',    not exists (select 1 from public.spools s join public.user_filament_profiles p on p.id = s.filament_profile_id
                                               where s.user_id = (select user_id from _u) and p.filament_product_id is distinct from s.filament_product_id),
 'logs_com_carretel_com_snapshot',not exists (select 1 from public.print_logs where spool_id is not null and product_name_snapshot is null),
 'orfaos_intactos',               (select count(*) from public.print_logs where spool_id is null and product_name_snapshot is null and filament_product_id is null) = (select orfaos from _pre),
 'backup_29',                     (select count(*) from public.spools_identity_backup where backup_label = 'F6') = 29,
 'fantasmas_0_ou_4',              (select n from _fantasmas) in (0, 4)
) as c;

DO $f6$ DECLARE k text; BEGIN
  FOR k IN select key from json_each_text((select c from _chk)) where value is distinct from 'true' LOOP
    RAISE EXCEPTION 'F6 verificacao falhou: %', k;
  END LOOP;
END $f6$;

NOTIFY pgrst, 'reload schema';
select (select c from _chk)::text as c,
       (select n from _fantasmas) as fantasmas,
       (select count(*) from public.print_logs where snapshot_backfilled) as logs_snapshot,
       (select count(*) from public.print_logs where spool_id is null) as orfaos,
       (select string_agg(name || '  [' || coalesce(brand, '-') || ']', ' | ' order by lower(name)) from public.filament_products where user_id = (select user_id from _u)) as produtos;
__FIM__;
'@

$SqlRollback = @'
BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '15s';
DO $f6$ BEGIN
  IF (select count(*) from public.spools_identity_backup where backup_label = 'F6') = 0 THEN RAISE EXCEPTION 'Rollback: backup F6 nao existe'; END IF;
END $f6$;
create temp table _b on commit drop as select * from public.spools_identity_backup where backup_label = 'F6';
create temp table _pre on commit drop as select __HASH__ as h;

update public.print_logs
   set filament_product_id = null, product_name_snapshot = null, brand_snapshot = null,
       material_snapshot = null, color_snapshot = null, snapshot_backfilled = false
 where snapshot_backfilled;

update public.spools s
   set filament_profile_id = b.filament_profile_id, filament_product_id = b.filament_product_id,
       brand = b.brand, material = b.material, color_name = b.color_name, color_hex = b.color_hex
  from _b b where b.spool_id = s.id;

update public.user_filament_profiles p set filament_product_id = null
  from public.filament_products fp
 where fp.id = p.filament_product_id and fp.user_id in (select distinct user_id from _b)
   and fp.created_at = (select max(backed_up_at) from _b);

delete from public.filament_products
 where user_id in (select distinct user_id from _b) and created_at = (select max(backed_up_at) from _b);

create temp table _chk on commit drop as select json_build_object(
 'fisico_historico_slots_iguais', (select h from _pre) = (__HASH__),
 'identidade_restaurada',         not exists (select 1 from _b b join public.spools s on s.id = b.spool_id
                                               where (s.filament_profile_id, s.filament_product_id, s.brand, s.material, s.color_name, s.color_hex)
                                                     is distinct from (b.filament_profile_id, b.filament_product_id, b.brand, b.material, b.color_name, b.color_hex)),
 'sem_produtos_da_f6',            not exists (select 1 from public.filament_products where created_at = (select max(backed_up_at) from _b)),
 'sem_snapshot_retroativo',       not exists (select 1 from public.print_logs where snapshot_backfilled)
) as c;
DO $f6$ DECLARE k text; BEGIN
  FOR k IN select key from json_each_text((select c from _chk)) where value is distinct from 'true' LOOP
    RAISE EXCEPTION 'Rollback verificacao falhou: %', k;
  END LOOP;
END $f6$;
delete from public.spools_identity_backup where backup_label = 'F6';
NOTIFY pgrst, 'reload schema';
select (select c from _chk)::text as c, (select count(*) from _b) as restaurados;
__FIM__;
'@

function New-Sql([string]$Base, [string]$Fim) {
    return $Base.Replace("__MAPA__", $Mapa).Replace("__PARES__", $Pares).Replace("__FANTASMAS__", $Fantasmas).Replace("__HASH__", $HashFisico).Replace("__FIM__", $Fim)
}
function Show-Result($r, [string]$Titulo) {
    $c = ConvertFrom-Json -InputObject ([string]$r[0].c)
    Write-Host $Titulo
    foreach ($p in $c.PSObject.Properties) { Write-Host ("    {0,-32} {1}" -f $p.Name, $(if ($p.Value -eq $true) { "OK" } else { "FALHOU" })) }
    foreach ($n in @("restaurados", "fantasmas", "logs_snapshot", "orfaos")) {
        if ($r[0].PSObject.Properties.Name -contains $n) { Write-Host ("    {0,-32} {1}" -f $n, $r[0].$n) }
    }
    if ($r[0].PSObject.Properties.Name -contains "produtos") {
        Write-Host "    Produtos:"
        foreach ($x in ([string]$r[0].produtos).Split("|")) { Write-Host "      $($x.Trim())" }
    }
}
function Confirmar([string]$Palavra) {
    if ($Sim) { return $true }
    $resp = Read-Host "Digite $Palavra para gravar (qualquer outra coisa cancela)"
    return ($resp -ceq $Palavra)
}

$Base = $SqlAplicar
$Nome = "RECONCILIAR"
if ($Rollback) { $Base = $SqlRollback; $Nome = "DESFAZER" }
Write-Host "=== F6: $Nome ($($Alvo.ToUpper())) ==="

$imp = Invoke-Db "select coalesce(string_agg(coalesce(gcode_state,'?'), ','), '') as s from public.printers"
$estado = [string]$imp[0].s
if ($estado -match "RUNNING|PREPARE|PAUSE") { throw "Impressora ativa ($estado). Rode com a impressora parada. Nada foi feito." }
Write-Host "Impressora: $estado"

$r = Invoke-Db (New-Sql $Base "ROLLBACK")
Show-Result $r "[1] ENSAIO (ROLLBACK, nada gravado):"
if ($SoEnsaio) { Write-Host "ENSAIO_OK"; exit 0 }

if ($Alvo -eq "producao") {
    Write-Host "[2] Backup da producao..."
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Ops "backup-producao-json.ps1")
    if ($LASTEXITCODE -ne 0) { throw "Backup falhou. Nada foi gravado." }
}
if (-not (Confirmar $Nome)) { Write-Host "Cancelado. Nada foi gravado. (Digite exatamente $Nome, em maiusculas.)"; exit 0 }
if ($Rollback) { $Probe = "select not exists (select 1 from public.spools_identity_backup where backup_label = 'F6') as g" }
else { $Probe = "select exists (select 1 from public.spools_identity_backup where backup_label = 'F6') as g" }
$r = Invoke-Db (New-Sql $Base "COMMIT") $Probe
if ($null -eq $r) { Write-Host "[3] GRAVADO (a conexao caiu depois da gravacao; confirmado no banco)." }
else { Show-Result $r "[3] GRAVADO (COMMIT):" }

# Conferencia independente, so leitura.
$v = Invoke-Db @'
select (select count(*) from public.spools_identity_backup where backup_label = 'F6') as backup_f6,
       (select count(*) from public.filament_products) as produtos,
       (select count(*) from public.spools where user_id is not null and filament_product_id is not null) as carreteis_com_produto,
       (select count(*) from public.spools where user_id is null) as sem_dono,
       (select count(*) from public.user_filament_profiles where filament_product_id is not null) as perfis_ligados,
       (select count(*) from public.print_logs where snapshot_backfilled) as logs_snapshot
'@
Write-Host "[4] Conferencia (so leitura):"
foreach ($p in $v[0].PSObject.Properties) { Write-Host ("    {0,-32} {1}" -f $p.Name, $p.Value) }
if ($Rollback) { $ok = ([int]$v[0].backup_f6 -eq 0 -and [int]$v[0].carreteis_com_produto -eq 0 -and [int]$v[0].logs_snapshot -eq 0) }
else { $ok = ([int]$v[0].backup_f6 -eq 29 -and [int]$v[0].produtos -eq 29 -and [int]$v[0].carreteis_com_produto -eq 29 -and [int]$v[0].sem_dono -eq 0 -and [int]$v[0].perfis_ligados -eq 32) }
if (-not $ok) { throw "Conferencia final nao bateu. Me chame (nao rode de novo)." }
Write-Host ""
Write-Host "F6_${Nome}_CONCLUIDO"
