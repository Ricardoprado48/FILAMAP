Option Explicit

Dim shell, fso
Dim baseDir, exePath
Dim runtimeDir, logPath
Dim command

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' ------------------------------------------------------------
' Arquivos do programa
' ------------------------------------------------------------

baseDir = fso.GetParentFolderName(WScript.ScriptFullName)
exePath = baseDir & "\filamap-agent.exe"

If Not fso.FileExists(exePath) Then
    WScript.Quit 1
End If

' ------------------------------------------------------------
' Area gravavel do usuario
' ------------------------------------------------------------

runtimeDir = shell.ExpandEnvironmentStrings("%APPDATA%") & "\Filamap"

If Not fso.FolderExists(runtimeDir) Then
    fso.CreateFolder(runtimeDir)
End If

logPath = runtimeDir & "\agent.log"

' O Agent usa APPDATA como diretorio de trabalho.
' Arquivos de runtime, configuracao e segredos ficam fora
' de Program Files.

shell.CurrentDirectory = runtimeDir

' ------------------------------------------------------------
' Executar invisivelmente
' ------------------------------------------------------------

command = "cmd.exe /d /c " & _
          Chr(34) & Chr(34) & exePath & Chr(34) & _
          " >> " & Chr(34) & logPath & Chr(34) & _
          " 2>&1" & Chr(34)

' ------------------------------------------------------------
' Relancamento apos crash
' ------------------------------------------------------------
'
' O RestartCount da tarefa agendada NAO relanca quando o processo sai
' com codigo <> 0 -- so cobre falha ao INICIAR a tarefa (comprovado em
' 2026-09-27 com tarefa de teste de mesmas configuracoes). Sem isto,
' qualquer crash deixava o Agent morto ate o proximo logon.
'
' Codigo 0  = encerramento intencional (Ctrl+C/SIGTERM, onboarding
'             cancelado) -> launcher termina.
' Codigo <> 0 = crash -> relanca com espera crescente (30s ate 10min);
'             a espera volta a 30s se o Agent rodou pelo menos 10min.
'
' Nunca duplica: antes de cada inicio, se ja existe filamap-agent.exe
' deste mesmo caminho rodando, o launcher sai sem iniciar outro. O lock
' de escrita do "cmd >> agent.log" continua como segunda barreira.

Function AgentAlreadyRunning()
    Dim wmi, procs, p
    AgentAlreadyRunning = False
    On Error Resume Next
    Set wmi = GetObject("winmgmts:\\.\root\cimv2")
    Set procs = wmi.ExecQuery("SELECT ExecutablePath FROM Win32_Process WHERE Name = 'filamap-agent.exe'")
    For Each p In procs
        If LCase(p.ExecutablePath) = LCase(exePath) Then AgentAlreadyRunning = True
    Next
    On Error GoTo 0
End Function

Dim rc, delaySec, startedAt

delaySec = 30
rc = 0

Do
    If AgentAlreadyRunning() Then
        WScript.Quit 0
    End If

    startedAt = Timer
    ' 0    = totalmente oculto
    ' True = mantem o launcher vivo enquanto o Agent roda
    rc = shell.Run(command, 0, True)

    If rc = 0 Then
        Exit Do
    End If

    ' Timer zera a meia-noite: duracao negativa conta como "rodou bastante".
    If (Timer - startedAt) >= 600 Or (Timer - startedAt) < 0 Then
        delaySec = 30
    End If

    WScript.Sleep delaySec * 1000

    delaySec = delaySec * 2
    If delaySec > 600 Then delaySec = 600
Loop

WScript.Quit rc
