<#
Filamap Desktop Agent - Auto-start Windows

Registra a tarefa agendada "FilamapAgentAutoStart" para iniciar o
Filamap Agent automaticamente no logon do usuário atual.

O launcher utilizado é filamap-launcher.exe (launcher/FilamapLauncher.cs):
executável sem janela que substituiu run-agent.vbs + wscript.exe.

Motivo:
- não abre PowerShell, CMD nem janela de terminal;
- relança o Agent após crash (espera crescente 30s -> 10min);
- nunca duplica o Agent (mutex nomeado + checagem de processo).

O filamap-launcher.exe deve permanecer ao lado deste arquivo.

A tarefa usa MultipleInstances=IgnoreNew: se já estiver rodando, um
novo pedido de execução (schtasks /Run ou o [Run] do instalador) é ignorado em vez de subir um segundo processo do
Agent.

O Agent empacotado esperado é:

    filamap-agent.exe

gerado por:

    npm run package-exe

O Agent grava sua saída em:

    agent.log
#>

$ErrorActionPreference = "Stop"

$TaskName = "FilamapAgentAutoStart"
$AgentDir = $PSScriptRoot

$Launcher = Join-Path $AgentDir "filamap-launcher.exe"
$ExePath = Join-Path $AgentDir "filamap-agent.exe"

if (-not (Test-Path $Launcher)) {
    throw "Não encontrei o launcher: $Launcher"
}

if (-not (Test-Path $ExePath)) {
    Write-Warning "filamap-agent.exe ainda não existe."
    Write-Warning "Rode 'npm run package-exe' antes de usar o Agent."
}

$currentUser = "$env:USERDOMAIN\$env:USERNAME"

$action = New-ScheduledTaskAction `
    -Execute $Launcher `
    -WorkingDirectory $AgentDir

$trigger = New-ScheduledTaskTrigger `
    -AtLogOn `
    -User $currentUser

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew

$principal = New-ScheduledTaskPrincipal `
    -UserId $currentUser `
    -LogonType Interactive `
    -RunLevel Limited

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description "Filamap Agent - inicia automaticamente e de forma invisível no logon do Windows." `
    -Force |
    Out-Null

Write-Host ""
Write-Host "Tarefa '$TaskName' instalada com sucesso."
Write-Host "Usuário: $currentUser"
Write-Host "Launcher: $Launcher"
Write-Host "Log: $(Join-Path $AgentDir 'agent.log')"
