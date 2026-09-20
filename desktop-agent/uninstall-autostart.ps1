<#
Remove a Tarefa Agendada criada por install-autostart.ps1
("FilamapAgentAutoStart"). Não mexe num processo do Agent que já esteja
rodando nem apaga desktop-agent\agent.log -- só cancela o início
automático nos próximos logons.

Verificar que foi removida: schtasks /query /tn "FilamapAgentAutoStart"
(deve retornar erro "não encontrado" depois de rodar este script).
#>

$ErrorActionPreference = "Stop"
$TaskName = "FilamapAgentAutoStart"

$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($null -eq $existing) {
    Write-Host "Tarefa '$TaskName' não existe (nada a remover)."
} else {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Tarefa '$TaskName' removida. O auto-start não vai mais rodar nos próximos logons."
}
