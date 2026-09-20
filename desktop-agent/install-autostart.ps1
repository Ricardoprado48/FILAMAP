<#
Registra uma Tarefa Agendada do Windows pra iniciar o Desktop Agent do
Filamap automaticamente no logon do usuário atual -- sem precisar abrir
manualmente um terminal ou o .exe toda vez que liga o PC.

MÉTODO DE EXECUÇÃO -- não presumido, apurado no repositório antes de
escrever este script: `desktop-agent/package.json` só tem os scripts
"build" (tsc), "start" (tsc && node dist/index.js) e "package-exe" (gera
filamap-agent.exe via pkg). NÃO existe script "dev" em
desktop-agent/package.json (só existe em web-app/package.json). Só que o
único script de inicialização encontrado no repo, `start-agent.bat` (na
raiz), chama `npm run dev` dentro de desktop-agent -- ou seja, como está
hoje, start-agent.bat não funciona pra iniciar o Agent (ia falhar com
"Missing script: dev"). `docs/03_FEATURES.md` também cita que "Há .exe,
start-agent.bat e script pkg" sem esclarecer qual dos dois (.exe ou
node) é o que roda de fato hoje. Não deu pra confirmar com certeza qual
método é o real em produção -- por isso este script NÃO escolhe um dos
dois: quem decide é run-agent.ps1, em tempo de execução, preferindo
filamap-agent.exe se ele existir e caindo para node + dist\index.js caso
contrário. Rode 'npm run build' e/ou 'npm run package-exe' em
desktop-agent antes de instalar, conforme qual você efetivamente usa (os
dois podem coexistir sem problema).

COMO VERIFICAR SE FUNCIONOU:
  schtasks /query /tn "FilamapAgentAutoStart" /v /fo list

  ou no PowerShell:
  Get-ScheduledTask -TaskName "FilamapAgentAutoStart" | Get-ScheduledTaskInfo

  pra testar sem esperar o próximo logon:
  schtasks /run /tn "FilamapAgentAutoStart"

ONDE FICA O LOG:
  desktop-agent\agent.log (sobrescrito a cada novo início do Agent).

Se `Register-ScheduledTask` falhar com erro de permissão, rode o
PowerShell "Como Administrador" e tente de novo.
#>

$ErrorActionPreference = "Stop"

$TaskName = "FilamapAgentAutoStart"
$AgentDir = $PSScriptRoot
$RunnerScript = Join-Path $AgentDir "run-agent.ps1"

if (-not (Test-Path $RunnerScript)) {
    throw "Não encontrei $RunnerScript -- rode este script de dentro de desktop-agent\ (mantenha run-agent.ps1 ao lado dele)."
}

$exePath = Join-Path $AgentDir "filamap-agent.exe"
$distIndex = Join-Path $AgentDir "dist\index.js"
if (-not (Test-Path $exePath) -and -not (Test-Path $distIndex)) {
    Write-Warning "Nem '$exePath' nem '$distIndex' existem ainda. A tarefa vai ser criada, mas vai falhar até você rodar 'npm run build' ou 'npm run package-exe' em desktop-agent."
}

$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$RunnerScript`"" `
    -WorkingDirectory $AgentDir

$currentUser = "$env:USERDOMAIN\$env:USERNAME"
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser

# -AllowStartIfOnBatteries + -DontStopIfGoingOnBatteries: é notebook, não
# pode parar de reportar telemetria só porque desconectou da tomada.
# -ExecutionTimeLimit Zero: desliga o limite padrão de 72h do Task
# Scheduler -- sem isso, o Windows mataria o Agent sozinho depois de 3
# dias rodando, mesmo sem erro nenhum.
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -StartWhenAvailable

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
    -Description "Inicia o Desktop Agent do Filamap (Bambu Lab) automaticamente no logon, sem janela visível. Log em desktop-agent\agent.log." `
    -Force | Out-Null

Write-Host "Tarefa '$TaskName' registrada. Vai iniciar o Agent no próximo logon de $currentUser."
Write-Host "Pra testar agora sem esperar: schtasks /run /tn `"$TaskName`""
Write-Host "Log em: $(Join-Path $AgentDir 'agent.log')"
