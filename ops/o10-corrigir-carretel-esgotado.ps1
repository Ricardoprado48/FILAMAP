# O10 - Corrige o caso de 08/10: Preto Velvet antigo acabou no meio da impressao e a AMS
# trocou sozinha para o Preto Velvet novo, mas o Agent nao viu a troca.
# Numa UNICA transacao (tudo ou nada):
#   - carretel antigo (7bf0de9e): saldo 0 g, arquivado (esgotado), fora da impressora
#   - carretel novo   (1c5c8555): saldo 995 g (balanca), peso confirmado, no slot 1 do AMS (indice 0)
#   - ams_slots indice 0 passa a apontar o carretel novo (assigned_by = user)
#   - aborta sozinha se os saldos/slot nao estiverem como no diagnostico de 09/10
# Os registros de impressao (print_logs) NAO sao alterados.
# Antes de gravar, salva as linhas atuais em backups\o10-*.json.
# Uso:      powershell -ExecutionPolicy Bypass -File D:\Projetos\ATIVOS\FILAMAP\ops\o10-corrigir-carretel-esgotado.ps1
# Desfazer: ... o10-corrigir-carretel-esgotado.ps1 -Rollback
param([switch]$Rollback, [decimal]$PesoNovo = 995)
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$ProdRef = "gqtlszffgvxsqcmefhyd"
$Raiz    = "D:\Projetos\ATIVOS\FILAMAP"
$Antigo  = "7bf0de9e-d6bd-4d18-937b-e3a0c4b3d886"
$Novo    = "1c5c8555-be5d-44df-805c-6e843e990403"
$BkpArq  = Join-Path $Raiz "backups\o10-carretel-esgotado.json"

Set-Location $Raiz
if ((Get-Content "$Raiz\supabase\.temp\project-ref" -Raw).Trim() -ne $ProdRef) { throw "Pasta nao ligada a producao. Nada foi feito." }

$TokArq = Join-Path $env:APPDATA "Filamap-dev\prod-access-token.dpapi"
if (-not (Test-Path $TokArq)) { throw "Token da producao nao encontrado. Rode ops\salvar-token-producao.ps1. Nada foi feito." }
$env:SUPABASE_ACCESS_TOKEN = [System.Net.NetworkCredential]::new("", ((Get-Content $TokArq -Raw).Trim() | ConvertTo-SecureString)).Password
trap { $env:SUPABASE_ACCESS_TOKEN = $null; break }

# A CLI responde [...] num terminal comum e {"rows":[...]} quando detecta agente de IA.
# Corta o JSON pelo primeiro '[' ou '{' (o que vier antes) e pelo fechamento correspondente.
function ConvertFrom-SbRows([string]$Raw) {
    $ia = $Raw.IndexOf('['); $io = $Raw.IndexOf('{')
    if ($ia -lt 0 -and $io -lt 0) { return ,@() }
    if ($ia -ge 0 -and ($io -lt 0 -or $ia -lt $io)) { $i = $ia; $j = $Raw.LastIndexOf(']') }
    else { $i = $io; $j = $Raw.LastIndexOf('}') }
    $p = ConvertFrom-Json -InputObject $Raw.Substring($i, $j - $i + 1)
    if ($null -ne $p -and -not ($p -is [array]) -and ($p.PSObject.Properties.Name -contains "rows")) { return ,@($p.rows) }
    return ,@($p)
}
function Invoke-Db([string]$Sql) {
    $ErrorActionPreference = "Continue"
    # stderr vai para arquivo: misturado ao stdout, o PowerShell 5.1 o embrulha em texto com "[]"
    $errArq = [IO.Path]::GetTempFileName()
    $raw = supabase db query --linked -o json $Sql 2>$errArq | Out-String
    $code = $LASTEXITCODE
    $err = Get-Content $errArq -Raw; Remove-Item $errArq -Force
    $ErrorActionPreference = "Stop"
    if ($code -ne 0) { throw "Falha no banco (exit $code): $err $raw" }
    return (ConvertFrom-SbRows $raw)
}

$SqlEstado = @"
select 'spool' as tipo, id::text, current_weight::text, weight_confirmed_at::text, archived_at::text,
       bambu_in_printer::text, bambu_slot_id, bambu_dev_id, null::text as slot_spool
  from public.spools where id in ('$Antigo','$Novo')
union all
select 'slot', id::text, slot_index::text, assigned_by, assigned_at::text, null, null, printer_id::text, spool_id::text
  from public.ams_slots where slot_index = 0
"@

if ($Rollback) {
    if (-not (Test-Path $BkpArq)) { throw "Backup $BkpArq nao existe. Nada foi feito." }
    $b = Get-Content $BkpArq -Raw | ConvertFrom-Json
    $a = $b | Where-Object { $_.tipo -eq 'spool' -and $_.id -eq $Antigo }
    $n = $b | Where-Object { $_.tipo -eq 'spool' -and $_.id -eq $Novo }
    $s = $b | Where-Object { $_.tipo -eq 'slot' }
    function L($v) { if ($null -eq $v -or $v -eq '') { 'null' } else { "'" + ($v -replace "'", "''") + "'" } }
    $sql = @"
begin;
update public.spools set current_weight = $($a.current_weight), weight_confirmed_at = $(L $a.weight_confirmed_at), archived_at = $(L $a.archived_at),
       bambu_in_printer = $(L $a.bambu_in_printer)::boolean, bambu_slot_id = $(L $a.bambu_slot_id), bambu_dev_id = $(L $a.bambu_dev_id), updated_at = now()
 where id = '$Antigo';
update public.spools set current_weight = $($n.current_weight), weight_confirmed_at = $(L $n.weight_confirmed_at), archived_at = $(L $n.archived_at),
       bambu_in_printer = $(L $n.bambu_in_printer)::boolean, bambu_slot_id = $(L $n.bambu_slot_id), bambu_dev_id = $(L $n.bambu_dev_id), updated_at = now()
 where id = '$Novo';
update public.ams_slots set spool_id = $(L $s.slot_spool)::uuid, assigned_by = $(L $s.weight_confirmed_at), updated_at = now() where id = '$($s.id)';
commit;
"@
    Invoke-Db $sql | Out-Null
    Write-Host "Desfeito. Estado restaurado de $BkpArq"
    Invoke-Db $SqlEstado | Format-Table -AutoSize
    $env:SUPABASE_ACCESS_TOKEN = $null
    return
}

# 1) Estado atual + backup
$estado = Invoke-Db $SqlEstado
$estado | Format-Table -AutoSize
New-Item -ItemType Directory -Force -Path (Split-Path $BkpArq) | Out-Null
$estado | ConvertTo-Json | Set-Content -Encoding utf8 $BkpArq
Write-Host "Backup salvo em $BkpArq"

Write-Host ""
Write-Host "Vai aplicar:"
Write-Host "  - Preto Velvet ANTIGO: saldo 0 g, esgotado (arquivado), fora do AMS"
Write-Host "  - Preto Velvet NOVO:   saldo $PesoNovo g (balanca), no slot 1 do AMS"
$ok = Read-Host "Digite SIM para aplicar"
if ($ok -ne "SIM") { Write-Host "Cancelado. Nada foi alterado."; $env:SUPABASE_ACCESS_TOKEN = $null; return }

# 2) Transacao com travas: so grava se o estado for o do diagnostico
$sql = @"
do `$`$
declare v_slot uuid; v_dev text;
begin
  if not exists (select 1 from public.spools where id = '$Antigo' and current_weight = 44.70 and archived_at is null) then
    raise exception 'Carretel antigo nao esta com 44,70 g / ativo. Nada foi feito.';
  end if;
  if not exists (select 1 from public.spools where id = '$Novo' and current_weight = 1000 and archived_at is null) then
    raise exception 'Carretel novo nao esta com 1000 g / ativo. Nada foi feito.';
  end if;
  select id into v_slot from public.ams_slots where slot_index = 0 and spool_id = '$Antigo';
  if v_slot is null then raise exception 'Slot 1 do AMS nao aponta o carretel antigo. Nada foi feito.'; end if;
  select bambu_dev_id into v_dev from public.spools where id = '$Antigo';

  update public.spools set current_weight = 0, archived_at = now(), bambu_in_printer = false,
         bambu_slot_id = null, bambu_dev_id = null, updated_at = now()
   where id = '$Antigo';
  update public.spools set current_weight = $PesoNovo, weight_confirmed_at = now(), bambu_in_printer = true,
         bambu_slot_id = '0', bambu_dev_id = v_dev, updated_at = now()
   where id = '$Novo';
  update public.ams_slots set spool_id = '$Novo', assigned_by = 'user', assigned_at = now(), updated_at = now()
   where id = v_slot;
end
`$`$;
"@
Invoke-Db $sql | Out-Null

# 3) Conferencia
Write-Host ""
Write-Host "Aplicado. Estado agora:"
Invoke-Db $SqlEstado | Format-Table -AutoSize
$env:SUPABASE_ACCESS_TOKEN = $null
