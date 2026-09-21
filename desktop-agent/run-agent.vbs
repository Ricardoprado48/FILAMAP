Option Explicit

Dim shell, fso, baseDir, exePath, logPath, command

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

baseDir = fso.GetParentFolderName(WScript.ScriptFullName)
exePath = baseDir & "\filamap-agent.exe"
logPath = baseDir & "\agent.log"

If Not fso.FileExists(exePath) Then
    WScript.Quit 1
End If

command = "cmd.exe /d /c " & _
          Chr(34) & Chr(34) & exePath & Chr(34) & _
          " >> " & Chr(34) & logPath & Chr(34) & _
          " 2>&1" & Chr(34)

' 0 = janela totalmente oculta
' True = manter o launcher vivo enquanto o Agent roda
shell.Run command, 0, True
