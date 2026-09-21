# Executado pela Tarefa Agendada "FilamapAgentAutoStart".
#
# Inicia o Desktop Agent sem janela visível e grava stdout + stderr
# diretamente em agent.log.
#
# IMPORTANTE:
# O redirecionamento do processo nativo é feito pelo cmd.exe, e não pelo
# operador *>> do Windows PowerShell. Isso evita que mensagens escritas
# em stderr sejam convertidas em NativeCommandError.
#
# O arquivo agent.log é criado em UTF-8 para preservar corretamente
# acentos, emojis e mensagens do Agent.

$ErrorActionPreference = "Stop"

Set-Location -Path $PSScriptRoot

$logFile = Join-Path $PSScriptRoot "agent.log"
$exePath = Join-Path $PSScriptRoot "filamap-agent.exe"
$distIndex = Join-Path $PSScriptRoot "dist\index.js"

$utf8 = New-Object System.Text.UTF8Encoding($false)

$header = "=== Filamap Agent iniciado em $(Get-Date -Format o) ===`r`n"
[System.IO.File]::WriteAllText($logFile, $header, $utf8)

function Add-LogLine {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Text
    )

    [System.IO.File]::AppendAllText(
        $logFile,
        $Text + "`r`n",
        $utf8
    )
}

function Invoke-FilamapProcess {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Executable,

        [string]$Arguments = ""
    )

    # cmd.exe faz o redirecionamento nativo diretamente para o arquivo.
    # Assim o PowerShell não interpreta stderr como NativeCommandError.
    if ([string]::IsNullOrWhiteSpace($Arguments)) {
        $command = "`"$Executable`" >> `"$logFile`" 2>&1"
    }
    else {
        $command = "`"$Executable`" $Arguments >> `"$logFile`" 2>&1"
    }

    & cmd.exe /d /c $command

    return $LASTEXITCODE
}

if (Test-Path $exePath) {

    Add-LogLine "Executando via .exe empacotado: $exePath"

    $exitCode = Invoke-FilamapProcess `
        -Executable $exePath

    Add-LogLine "Filamap Agent encerrado com código: $exitCode"

    exit $exitCode
}

if (Test-Path $distIndex) {

    $nodeCommand = Get-Command node.exe -ErrorAction Stop
    $nodePath = $nodeCommand.Source

    Add-LogLine "Executando via node: $distIndex"

    $exitCode = Invoke-FilamapProcess `
        -Executable $nodePath `
        -Arguments "`"$distIndex`""

    Add-LogLine "Filamap Agent encerrado com código: $exitCode"

    exit $exitCode
}

Add-LogLine "ERRO: nem '$exePath' nem '$distIndex' foram encontrados."
Add-LogLine "Rode 'npm run build' dentro de desktop-agent."

exit 1
