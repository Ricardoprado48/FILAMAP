# Limpa os 22 codigos de tag "FILA-..." criados pela importacao de 17/09 e NUNCA gravados
# num chip (nfc_written_at vazio). Confirmado pelo usuario em 28/09: so 6 carreteis tem tag
# fisica, e esses nao sao tocados. So muda nfc_uid; peso/produto/historico/slots ficam iguais.
# Numa UNICA transacao, com ensaio (ROLLBACK), backup e confirmacao.
# Uso (producao): powershell -ExecutionPolicy Bypass -File C:\FILAMAP-staging\ops\limpar-tags-nao-gravadas.ps1 [-SoEnsaio]
#   Desfazer:     ... limpar-tags-nao-gravadas.ps1 -Rollback
# Desenvolvedor:  -Alvo teste [-Sim]
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
    $arq = Join-Path $env:TEMP "tags-$id.sql"
    $err = Join-Path $env:TEMP "tags-$id.err"
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

# Os 22 (carretel, codigo) exatos, lidos da producao em 28/09 (identicos no teste).
$Lista = @'
('18518cf5-2a49-4ae1-a7ea-38c671e85758'::uuid, 'FILA-PETG-AZUL-CLARO'),
('250ce079-d64f-48d6-b807-1f2820e60a71'::uuid, 'FILA-PLA-VERDE-SILK'),
('2a61d22c-9d61-4c75-941d-0ad992f6ec87'::uuid, 'FILA-PLA-DOURADO'),
('42824192-f5cc-41b0-b676-b7b8bb51a7b6'::uuid, 'FILA-PLA-AZUL-VELVET'),
('43327b13-1463-4a24-83a4-0d1fbcb2b0c9'::uuid, 'FILA-PLA-VERDE-VELVET'),
('5799f355-981b-4d83-afaf-7f6f95a9de4f'::uuid, 'FILA-PLA-AMARELO-VELVET'),
('68d59e64-ee75-4c8a-8dde-75e0c5a09c56'::uuid, 'FILA-PETG-AMARELO-LIMAO'),
('69494846-ca12-4ad1-a7bc-56121d9c20f6'::uuid, 'FILA-PLA-CAUCASIANO'),
('6bf1c8f9-c71a-4927-a072-9ca188297d7b'::uuid, 'FILA-PLA-LARANJA'),
('75cd202a-be99-4204-9683-2b1bd55ee437'::uuid, 'FILA-PETG-VERDE'),
('7861013a-0e0f-4e70-a1d8-583e4d39c7ac'::uuid, 'FILA-PLA-BRANCO-CREALITY'),
('7fba953b-db1c-4b89-8500-7ee648bd9404'::uuid, 'FILA-PETG-PRETO-MASTERPRINT'),
('807524a3-6ba1-4aed-9ef6-49bc8d1f4273'::uuid, 'FILA-TPU-PRETO'),
('8c7872b0-5983-4163-8a83-4feb701ed241'::uuid, 'FILA-PETG-PRATA'),
('99be0ac1-f96e-407a-bed7-dad4b36276da'::uuid, 'FILA-PETG-ROSA-ANYCUBIC'),
('a741c2a2-3730-4da7-9a5b-3856d359231d'::uuid, 'FILA-PETG-BEGE-CAUCASIANO'),
('c6d8460e-513c-4d44-8114-eccc44307a7f'::uuid, 'FILA-PETG-VERDE-MILITAR'),
('cc804544-496b-4cb5-91bb-59e963ebac21'::uuid, 'FILA-PLA-OFFWHITE-VELVET'),
('d6ed4533-9f8d-4ccd-b9a5-83ee533245e3'::uuid, 'FILA-PETG-BRANCO-DENTAL'),
('e132a495-07f6-417b-88e1-152062ca7e55'::uuid, 'FILA-PLA-ROSE-GOLD'),
('e71f46f7-2405-49df-817f-ea04c86524e0'::uuid, 'FILA-PETG-CHAMPAGNE'),
('f8f193f9-20e5-4310-9864-0681e80baea7'::uuid, 'FILA-PETG-CINZA-CLARO')
'@

# Tudo que NAO pode mudar: carreteis sem a coluna da tag + historico + slots.
$HashResto = @'
(select md5(coalesce(string_agg(concat_ws(':', id, user_id, filament_product_id, filament_profile_id, brand, material, color_name, color_hex, spool_tare_weight, initial_weight, current_weight, price_paid, bambu_spool_id, location, archived_at, nfc_written_at), '|' order by id), '')) from public.spools)
|| (select md5(coalesce(string_agg(concat_ws(':', id, spool_id, filament_used_g, status, job_id), '|' order by id), '')) from public.print_logs)
|| (select md5(coalesce(string_agg(concat_ws(':', id, printer_id, slot_index, spool_id), '|' order by id), '')) from public.ams_slots)
'@

$SqlAplicar = @'
BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '15s';
create temp table _t(id uuid primary key, code text) on commit drop;
insert into _t values __LISTA__;
DO $tg$ DECLARE n int; BEGIN
  select count(*) into n from public.spools s join _t on _t.id = s.id and s.nfc_uid = _t.code where s.nfc_written_at is null and s.archived_at is null;
  IF n <> 22 THEN RAISE EXCEPTION 'pre: % de 22 carreteis com o codigo esperado (ja aplicado?)', n; END IF;
END $tg$;
create temp table _pre on commit drop as select __HASH__ as h,
  (select count(*) from public.spools where nfc_uid is not null and nfc_written_at is not null) as gravadas;
create temp table _upd on commit drop as
with u as (update public.spools s set nfc_uid = null from _t where s.id = _t.id and s.nfc_uid = _t.code and s.nfc_written_at is null returning s.id)
select count(*) as n from u;
create temp table _chk on commit drop as select json_build_object(
 'limpos_22',                     (select n from _upd) = 22,
 'resto_igual',                   (select h from _pre) = (__HASH__),
 'tags_gravadas_intactas',        (select count(*) from public.spools where nfc_uid is not null and nfc_written_at is not null) = (select gravadas from _pre),
 'nenhum_codigo_nao_gravado',     not exists (select 1 from public.spools where archived_at is null and nfc_uid is not null and nfc_written_at is null)
) as c;
DO $tg$ DECLARE k text; BEGIN
  FOR k IN select key from json_each_text((select c from _chk)) where value is distinct from 'true' LOOP
    RAISE EXCEPTION 'verificacao falhou: %', k;
  END LOOP;
END $tg$;
select (select c from _chk)::text as c,
       (select count(*) from public.spools where archived_at is null and nfc_uid is not null) as com_tag,
       (select count(*) from public.spools where archived_at is null and nfc_uid is null) as sem_tag;
__FIM__;
'@

$SqlRollback = @'
BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '15s';
create temp table _t(id uuid primary key, code text) on commit drop;
insert into _t values __LISTA__;
DO $tg$ DECLARE n int; BEGIN
  select count(*) into n from public.spools s join _t on _t.id = s.id where s.nfc_uid is null;
  IF n <> 22 THEN RAISE EXCEPTION 'rollback: % de 22 carreteis sem tag (nada a desfazer?)', n; END IF;
  IF exists (select 1 from public.spools s join _t on s.nfc_uid = _t.code) THEN RAISE EXCEPTION 'rollback: algum codigo ja esta em uso'; END IF;
END $tg$;
create temp table _pre on commit drop as select __HASH__ as h;
create temp table _upd on commit drop as
with u as (update public.spools s set nfc_uid = _t.code from _t where s.id = _t.id and s.nfc_uid is null returning s.id)
select count(*) as n from u;
create temp table _chk on commit drop as select json_build_object(
 'restaurados_22', (select n from _upd) = 22,
 'resto_igual',    (select h from _pre) = (__HASH__)
) as c;
DO $tg$ DECLARE k text; BEGIN
  FOR k IN select key from json_each_text((select c from _chk)) where value is distinct from 'true' LOOP
    RAISE EXCEPTION 'verificacao falhou: %', k;
  END LOOP;
END $tg$;
select (select c from _chk)::text as c,
       (select count(*) from public.spools where archived_at is null and nfc_uid is not null) as com_tag,
       (select count(*) from public.spools where archived_at is null and nfc_uid is null) as sem_tag;
__FIM__;
'@

function New-Sql([string]$Base, [string]$Fim) {
    return $Base.Replace("__LISTA__", $Lista).Replace("__HASH__", $HashResto).Replace("__FIM__", $Fim)
}
function Show-Result($r, [string]$Titulo) {
    $c = ConvertFrom-Json -InputObject ([string]$r[0].c)
    Write-Host $Titulo
    foreach ($p in $c.PSObject.Properties) { Write-Host ("    {0,-28} {1}" -f $p.Name, $(if ($p.Value -eq $true) { "OK" } else { "FALHOU" })) }
    Write-Host ("    {0,-28} {1}" -f "com tag", $r[0].com_tag)
    Write-Host ("    {0,-28} {1}" -f "sem tag", $r[0].sem_tag)
}
function Confirmar([string]$Palavra) {
    if ($Sim) { return $true }
    $resp = Read-Host "Digite $Palavra para gravar (qualquer outra coisa cancela)"
    return ($resp -ceq $Palavra)
}

$Base = $SqlAplicar
$Nome = "LIMPAR"
if ($Rollback) { $Base = $SqlRollback; $Nome = "DESFAZER" }
Write-Host "=== Tags nao gravadas: $Nome ($($Alvo.ToUpper())) ==="

$r = Invoke-Db (New-Sql $Base "ROLLBACK")
Show-Result $r "[1] ENSAIO (ROLLBACK, nada gravado):"
if ($SoEnsaio) { Write-Host "ENSAIO_OK"; exit 0 }

if ($Alvo -eq "producao") {
    Write-Host "[2] Backup da producao..."
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Ops "backup-producao-json.ps1")
    if ($LASTEXITCODE -ne 0) { throw "Backup falhou. Nada foi gravado." }
}
if (-not (Confirmar $Nome)) { Write-Host "Cancelado. Nada foi gravado. (Digite exatamente $Nome, em maiusculas.)"; exit 0 }

$ProbeLista = (New-Sql "__LISTA__" "")
if ($Rollback) { $Probe = "select (select count(*) from public.spools s join (values $ProbeLista) t(id, code) on t.id = s.id and s.nfc_uid = t.code) = 22 as g" }
else { $Probe = "select (select count(*) from public.spools s join (values $ProbeLista) t(id, code) on t.id = s.id where s.nfc_uid is null) = 22 as g" }
$r = Invoke-Db (New-Sql $Base "COMMIT") $Probe
if ($null -eq $r) { Write-Host "[3] GRAVADO (a conexao caiu depois da gravacao; confirmado no banco)." }
else { Show-Result $r "[3] GRAVADO (COMMIT):" }
Write-Host ""
Write-Host "TAGS_${Nome}_CONCLUIDO"
