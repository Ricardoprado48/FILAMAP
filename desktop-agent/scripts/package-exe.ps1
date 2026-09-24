$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

$BridgeSource = Join-Path $Root "bambu-bridge\filamap-bambu-bridge.exe"
$PayloadDir = Join-Path $Root "installer\payload"
$PayloadBridgeDir = Join-Path $PayloadDir "bambu-bridge"

if (-not (Test-Path $BridgeSource)) {
    throw "Bridge Bambu ausente: $BridgeSource"
}

Write-Host "=== BUILD TYPESCRIPT ==="
& npx tsc
if ($LASTEXITCODE -ne 0) {
    throw "tsc falhou com exit code $LASTEXITCODE"
}

Write-Host ""
Write-Host "=== EMPACOTANDO AGENT ==="
& npx pkg dist/index.js --targets node22-win-x64 --output filamap-agent.exe
if ($LASTEXITCODE -ne 0) {
    throw "pkg falhou com exit code $LASTEXITCODE"
}

New-Item -ItemType Directory -Force -Path $PayloadDir | Out-Null
New-Item -ItemType Directory -Force -Path $PayloadBridgeDir | Out-Null

$Copies = @(
    @{ Source = (Join-Path $Root "filamap-agent.exe");            Dest = (Join-Path $PayloadDir "filamap-agent.exe") },
    @{ Source = (Join-Path $Root "run-agent.vbs");                Dest = (Join-Path $PayloadDir "run-agent.vbs") },
    @{ Source = (Join-Path $Root "start-agent.vbs");              Dest = (Join-Path $PayloadDir "start-agent.vbs") },
    @{ Source = (Join-Path $Root "install-autostart.ps1");        Dest = (Join-Path $PayloadDir "install-autostart.ps1") },
    @{ Source = (Join-Path $Root "uninstall-autostart.ps1");      Dest = (Join-Path $PayloadDir "uninstall-autostart.ps1") },
    @{ Source = $BridgeSource;                                    Dest = (Join-Path $PayloadBridgeDir "filamap-bambu-bridge.exe") }
)

foreach ($Item in $Copies) {
    if (-not (Test-Path $Item.Source)) {
        throw "Arquivo obrigatorio ausente: $($Item.Source)"
    }

    Copy-Item -LiteralPath $Item.Source -Destination $Item.Dest -Force

    if (-not (Test-Path $Item.Dest)) {
        throw "Falha ao copiar para payload: $($Item.Dest)"
    }

    Write-Host "OK: $($Item.Dest)"
}

$AgentHash = (Get-FileHash (Join-Path $Root "filamap-agent.exe") -Algorithm SHA256).Hash
$PayloadAgentHash = (Get-FileHash (Join-Path $PayloadDir "filamap-agent.exe") -Algorithm SHA256).Hash

if ($AgentHash -ne $PayloadAgentHash) {
    throw "Hash do Agent diverge entre build e payload."
}

$BridgeHash = (Get-FileHash $BridgeSource -Algorithm SHA256).Hash
$PayloadBridgeHash = (Get-FileHash (Join-Path $PayloadBridgeDir "filamap-bambu-bridge.exe") -Algorithm SHA256).Hash

if ($BridgeHash -ne $PayloadBridgeHash) {
    throw "Hash da bridge diverge entre origem e payload."
}

Write-Host ""
Write-Host "PACKAGE_EXE=OK"
Write-Host "AGENT_SHA256=$AgentHash"
Write-Host "BRIDGE_SHA256=$BridgeHash"
