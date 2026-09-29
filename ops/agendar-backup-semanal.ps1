param([switch]$Ensaio, [switch]$Remover)
# Parametro desconhecido NUNCA cai no modo padrao (incidente 2026-09-29: "-EnsaioNoTeste"
# repassado como texto fez o script rodar no modo producao).
if ($args.Count -gt 0) { throw "Parametro nao reconhecido: $($args -join ' '). Nada foi feito." }
# Agenda o backup SOMENTE LEITURA da producao toda semana (domingo 12:00; se o PC
# estiver desligado, roda assim que possivel). Mantem as 8 copias semanais (pastas semanal-*);
# backups manuais prod-* nunca sao apagados.
# O Supabase gratis nao tem backup: este e o backup do Filamap ate haver plano pago.
#
# Copia o script de backup para %APPDATA%\Filamap-dev\backup\ (local fixo, nao
# depende de pasta de trabalho) e registra a tarefa "FilamapBackupSemanal".
# Ao agendar, roda 1 backup imediatamente como prova.
#
#   -Ensaio   so confere, nao agenda nada
#   -Remover  remove a tarefa agendada (os backups ja feitos ficam)
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$TaskName = "FilamapBackupSemanal"
$Origem = Join-Path $PSScriptRoot "backup-producao-json.ps1"
$Pasta = Join-Path $env:APPDATA "Filamap-dev\backup"
$Script = Join-Path $Pasta "backup-producao-json.ps1"
$Log = Join-Path $Pasta "backup.log"
$Projeto = "C:\FILAMAP"

if ($Remover) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "Tarefa $TaskName removida (backups existentes mantidos)."
    return
}

$ok = $true
function Check([bool]$c, [string]$m) { if ($c) { Write-Host "OK        $m" } else { Write-Host "BLOQUEADO $m" -ForegroundColor Red; $script:ok = $false } }
Check (Test-Path $Origem) "script de backup encontrado"
Check ($null -ne (Get-Command supabase -ErrorAction SilentlyContinue)) "Supabase CLI instalada"
Check (Test-Path (Join-Path $env:APPDATA "Filamap-dev\prod-access-token.dpapi")) "token da producao salvo (ops\salvar-token-producao.ps1)"
$ref = ""
try { $ref = (Get-Content (Join-Path $Projeto "supabase\.temp\project-ref") -Raw).Trim() } catch {}
Check ($ref -eq "gqtlszffgvxsqcmefhyd") "C:\FILAMAP ligado ao projeto de producao ($ref)"
$existe = $null -ne (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue)
Write-Host ("INFO      tarefa ja existe: {0}" -f $existe)

if (-not $ok) { Write-Host "NAO PODE AGENDAR. Nada foi alterado." -ForegroundColor Red; return }
if ($Ensaio) { Write-Host "ENSAIO OK: nada foi agendado." -ForegroundColor Green; return }

$resp = Read-Host "Digite AGENDAR para criar o backup semanal"
if ($resp -cne "AGENDAR") { Write-Host "Cancelado. Nada foi alterado."; return }

New-Item -ItemType Directory -Force -Path $Pasta | Out-Null
Copy-Item $Origem $Script -Force

$arg = "-NoProfile -ExecutionPolicy Bypass -Command `"& '$Script' -Projeto '$Projeto' -Prefixo semanal -Manter 8 *>> '$Log'`""
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arg
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At "12:00"
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 1)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Write-Host "Tarefa $TaskName agendada (domingo 12:00, mantem 8 copias)." -ForegroundColor Green

Write-Host "Rodando o primeiro backup agora (somente leitura)..."
& $Script -Projeto $Projeto -Prefixo semanal -Manter 8
Write-Host ""
Write-Host "BACKUP_SEMANAL_AGENDADO" -ForegroundColor Green
