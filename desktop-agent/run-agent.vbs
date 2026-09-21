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

' 0    = totalmente oculto
' True = mantem o launcher vivo enquanto o Agent roda
shell.Run command, 0, True
