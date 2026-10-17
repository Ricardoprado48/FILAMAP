# O11 - Desfaz o alarme falso de 16/10: o Agent 4.4.0 marcou o + PLA BRANCO ULTRA SILK como
# esgotado num erro de alimentacao da AMS (slot vazio por 8 s). Depois disso o slot 3 passou
# para o Branco MasterPrint, que levou 18,9 g de uma PLACA_DIRETRIZES impressa com o Ultra Silk.
# Numa UNICA transacao (tudo ou nada):
#   - Ultra Silk (14c477af): volta ao estoque, saldo = balanca - 150 g de tara, peso confirmado,
#     no slot 3 da AMS (indice 2, escolha do usuario)
#   - Branco MasterPrint (5f14df68): recebe de volta os 18,9 g (275,10 -> 294,00), fora do AMS
#   - historico: a impressao de 18,9 g passa para o Ultra Silk; o registro de 16/10 deixa de
#     dizer "esgotado"
#   - aborta sozinha se os saldos/slot nao estiverem como no diagnostico de 17/10
# Antes de gravar, salva as linhas atuais em backups\o11-ultra-silk.json.
# Uso: powershell -ExecutionPolicy Bypass -File D:\Projetos\ATIVOS\FILAMAP_WORKTREES\esgotado\ops\o11-restaurar-ultra-silk.ps1 -PesoBalanca 245,3
param([Parameter(Mandatory = $true)][string]$PesoBalanca)
if ($args.Count -gt 0) { throw "Parametro nao reconhecido: $($args -join ' '). Nada foi feito." }
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$ProdRef = "gqtlszffgvxsqcmefhyd"
$Raiz    = Split-Path $PSScriptRoot -Parent
$Ultra   = "14c477af-ffaa-4893-a808-d8fd955ee69a"
$Master  = "5f14df68-2113-4f31-9af4-195b7d77f96f"
$JobErrado = "0116bc9f-93b3-4e47-b0d1-b6ac4ec7565c"
$LogMaster = "PLACA_DIRETRIZES"
$BkpArq  = Join-Path $Raiz "backups\o11-ultra-silk.json"

$bruto = [decimal]::Parse($PesoBalanca.Replace(",", "."), [Globalization.CultureInfo]::InvariantCulture)
$liquido = $bruto - 150
if ($liquido -lt 0 -or $liquido -gt 1000) { throw "Peso da balanca $bruto g nao faz sentido para este carretel (tara 150 g). Nada foi feito." }
$liqSql = $liquido.ToString([Globalization.CultureInfo]::InvariantCulture)

Set-Location $Raiz
if ((Get-Content "$Raiz\supabase\.temp\project-ref" -Raw).Trim() -ne $ProdRef) { throw "Pasta nao ligada a producao. Nada foi feito." }
$TokArq = Join-Path $env:APPDATA "Filamap-dev\prod-access-token.dpapi"
if (-not (Test-Path $TokArq)) { throw "Token da producao nao encontrado. Nada foi feito." }
$env:SUPABASE_ACCESS_TOKEN = [System.Net.NetworkCredential]::new("", ((Get-Content $TokArq -Raw).Trim() | ConvertTo-SecureString)).Password
trap { $env:SUPABASE_ACCESS_TOKEN = $null; break }

function ConvertFrom-SbRows([string]$Raw) {
    $ia = $Raw.IndexOf('['); $io = $Raw.IndexOf('{')
    if ($ia -lt 0 -and $io -lt 0) { return ,@() }
    if ($ia -ge 0 -and ($io -lt 0 -or $ia -lt $io)) { $i = $ia; $j = $Raw.LastIndexOf(']') } else { $i = $io; $j = $Raw.LastIndexOf('}') }
    $p = ConvertFrom-Json -InputObject $Raw.Substring($i, $j - $i + 1)
    if ($null -ne $p -and -not ($p -is [array]) -and ($p.PSObject.Properties.Name -contains "rows")) { return ,@($p.rows) }
    return ,@($p)
}
function Invoke-Db([string]$Sql) {
    $errArq = [IO.Path]::GetTempFileName()
    $ErrorActionPreference = "Continue"
    $raw = supabase db query --linked -o json $Sql 2>$errArq | Out-String
    $code = $LASTEXITCODE
    $ErrorActionPreference = "Stop"
    $err = Get-Content $errArq -Raw; Remove-Item $errArq -Force
    if ($code -ne 0) { throw "Falha no banco (exit $code): $err $raw" }
    return (ConvertFrom-SbRows $raw)
}

$SqlEstado = @"
select 'spool' as tipo, id::text, color_name, current_weight::text as saldo, archived_at::text as arquivado,
       bambu_in_printer::text as na_ams, bambu_slot_id as slot
  from public.spools where id in ('$Ultra', '$Master')
union all
select 'ams_slot', spool_id::text, null, null, assigned_at::text, assigned_by, slot_index::text
  from public.ams_slots where slot_index = 2
"@

$estado = Invoke-Db $SqlEstado
$estado | Format-Table -AutoSize
New-Item -ItemType Directory -Force -Path (Split-Path $BkpArq) | Out-Null
$estado | ConvertTo-Json | Set-Content -Encoding utf8 $BkpArq
Write-Host "Backup salvo em $BkpArq"
Write-Host ""
Write-Host "Vai aplicar:"
Write-Host "  - + PLA BRANCO ULTRA SILK: volta ao estoque com $liquido g ($bruto g na balanca - 150 g de tara), no slot 3 da AMS"
Write-Host "  - Branco MasterPrint: recebe de volta 18,9 g (fica com 294,00 g), fora da AMS"
Write-Host "  - historico: a PLACA_DIRETRIZES de 16/10 (18,9 g) passa para o Ultra Silk"
$ok = Read-Host "Digite SIM para aplicar"
if ($ok -ne "SIM") { Write-Host "Cancelado. Nada foi alterado."; $env:SUPABASE_ACCESS_TOKEN = $null; return }

$sql = @"
do `$`$
declare v_slot uuid; v_dev text; v_log uuid;
begin
  if not exists (select 1 from public.spools where id = '$Ultra' and current_weight = 0 and archived_at is not null) then
    raise exception 'Ultra Silk nao esta zerado/arquivado como no diagnostico. Nada foi feito.';
  end if;
  if not exists (select 1 from public.spools where id = '$Master' and current_weight = 275.10 and archived_at is null) then
    raise exception 'Branco MasterPrint nao esta com 275,10 g. Nada foi feito.';
  end if;
  select id into v_slot from public.ams_slots where slot_index = 2 and spool_id = '$Master';
  if v_slot is null then raise exception 'Slot 3 da AMS nao aponta o Branco MasterPrint. Nada foi feito.'; end if;
  select id into v_log from public.print_logs
   where spool_id = '$Master' and subtask_name = '$LogMaster' and filament_used_g = 18.9 and status = 'COMPLETED';
  if v_log is null then raise exception 'Registro de 18,9 g no Branco MasterPrint nao encontrado. Nada foi feito.'; end if;
  select bambu_dev_id into v_dev from public.spools where id = '$Master';

  update public.spools set archived_at = null, current_weight = $liqSql, weight_confirmed_at = now(),
         bambu_in_printer = true, bambu_slot_id = '2', bambu_dev_id = v_dev, updated_at = now()
   where id = '$Ultra';
  update public.spools set current_weight = 294.00, bambu_in_printer = false,
         bambu_slot_id = null, bambu_dev_id = null, updated_at = now()
   where id = '$Master';
  update public.ams_slots set spool_id = '$Ultra', assigned_by = 'user', assigned_at = now(), updated_at = now()
   where id = v_slot;
  update public.print_logs set spool_id = '$Ultra' where id = v_log;
  update public.print_logs set spool_depleted = false, depleted_leftover_g = null
   where job_id = '$JobErrado' and spool_id = '$Ultra';
end
`$`$;
"@
Invoke-Db $sql | Out-Null

Write-Host ""
Write-Host "Aplicado. Estado agora:"
Invoke-Db $SqlEstado | Format-Table -AutoSize
$env:SUPABASE_ACCESS_TOKEN = $null
