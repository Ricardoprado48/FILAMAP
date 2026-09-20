# Executado pela Tarefa Agendada "FilamapAgentAutoStart" (ver
# install-autostart.ps1). Não decide sozinho entre o .exe empacotado
# (`npm run package-exe`, gera filamap-agent.exe) e `node dist\index.js`
# (`npm run build`) -- checa em tempo de execução qual dos dois existe em
# desktop-agent\ e usa esse. Isso existe porque o repositório não deixa
# claro qual dos dois é usado de fato em produção hoje (ver comentário no
# topo de install-autostart.ps1).
#
# Como a tarefa roda sem janela visível, tudo que o Agent escreveria no
# terminal (stdout + stderr) é redirecionado pra agent.log, sobrescrito a
# cada novo início -- sem isso, perderíamos toda a visibilidade que hoje
# vem do terminal aberto.

Set-Location -Path $PSScriptRoot

$logFile = Join-Path $PSScriptRoot "agent.log"
$exePath = Join-Path $PSScriptRoot "filamap-agent.exe"
$distIndex = Join-Path $PSScriptRoot "dist\index.js"

"=== Filamap Agent iniciado em $(Get-Date -Format o) ===" | Out-File -FilePath $logFile -Encoding utf8

if (Test-Path $exePath) {
    "Executando via .exe empacotado: $exePath" | Out-File -FilePath $logFile -Append -Encoding utf8
    & $exePath *>> $logFile
} elseif (Test-Path $distIndex) {
    "Executando via node: $distIndex" | Out-File -FilePath $logFile -Append -Encoding utf8
    & node $distIndex *>> $logFile
} else {
    $msg = "ERRO: nem '$exePath' nem '$distIndex' foram encontrados. " +
           "Rode 'npm run build' (gera dist\index.js) ou 'npm run package-exe' " +
           "(gera filamap-agent.exe) dentro de desktop-agent antes de reinstalar o auto-start."
    $msg | Out-File -FilePath $logFile -Append -Encoding utf8
    exit 1
}
