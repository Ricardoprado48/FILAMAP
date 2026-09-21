<#
Filamap Desktop Agent - Auto-start Windows

Registra a tarefa agendada "FilamapAgentAutoStart" para iniciar o
Filamap Agent automaticamente no logon do usuário atual.

O launcher utilizado é run-agent.vbs através do wscript.exe.

Motivo:
- não abre PowerShell;
- não abre CMD;
- não deixa janela de terminal visível;
- mantém filamap-agent.exe rodando em segundo plano.

O run-agent.vbs deve permanecer ao lado deste arquivo.

A tarefa usa MultipleInstances=IgnoreNew: se já estiver rodando, um
novo pedido de execução (schtasks /Run, o atalho start-agent.vbs, ou o
[Run] do instalador) é ignorado em vez de subir um segundo processo do
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

$RunnerVbs = Join-Path $AgentDir "run-agent.vbs"
$ExePath = Join-Path $AgentDir "filamap-agent.exe"
$WscriptPath = Join-Path $env:SystemRoot "System32\wscript.exe"

if (-not (Test-Path $RunnerVbs)) {
    throw "Não encontrei o launcher: $RunnerVbs"
}

if (-not (Test-Path $WscriptPath)) {
    throw "Não encontrei wscript.exe em: $WscriptPath"
}

if (-not (Test-Path $ExePath)) {
    Write-Warning "filamap-agent.exe ainda não existe."
    Write-Warning "Rode 'npm run package-exe' antes de usar o Agent."
}

$currentUser = "$env:USERDOMAIN\$env:USERNAME"

$action = New-ScheduledTaskAction `
    -Execute $WscriptPath `
    -Argument "`"$RunnerVbs`"" `
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
Write-Host "Launcher: $RunnerVbs"
Write-Host "Log: $(Join-Path $AgentDir 'agent.log')"
