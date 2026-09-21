Option Explicit

' ------------------------------------------------------------
' Launcher dos atalhos (Menu Iniciar / Area de Trabalho)
' ------------------------------------------------------------
'
' Este script NAO inicia o Agent diretamente. Ele so pede ao Windows
' Task Scheduler para rodar a Tarefa Agendada "FilamapAgentAutoStart",
' que ja e' a unica dona do processo do Agent (via run-agent.vbs).
'
' Isso evita instancia duplicada: se o Agent ja estiver rodando (por
' exemplo, iniciado no logon), a propria tarefa agendada -- configurada
' com MultipleInstances=IgnoreNew em install-autostart.ps1 -- ignora
' este pedido em vez de subir um segundo processo.
'
' Sem janela visivel: schtasks.exe roda oculto (janela 0) e o script
' nao espera o Agent terminar (o Agent fica rodando em segundo plano,
' gerenciado pela tarefa agendada).

Dim shell
Set shell = CreateObject("WScript.Shell")

shell.Run "schtasks.exe /Run /TN ""FilamapAgentAutoStart""", 0, False
