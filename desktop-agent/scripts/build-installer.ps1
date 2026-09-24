$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$InstallerDir = Join-Path $Root "installer"
$IssFile = Join-Path $InstallerDir "FilamapAgentSetup.iss"
$PayloadDir = Join-Path $InstallerDir "payload"
$OutputDir = Join-Path $InstallerDir "output"

$RequiredPayload = @(
    (Join-Path $PayloadDir "filamap-agent.exe"),
    (Join-Path $PayloadDir "run-agent.vbs"),
    (Join-Path $PayloadDir "start-agent.vbs"),
    (Join-Path $PayloadDir "install-autostart.ps1"),
    (Join-Path $PayloadDir "uninstall-autostart.ps1"),
    (Join-Path $PayloadDir "bambu-bridge\filamap-bambu-bridge.exe")
)

foreach ($File in $RequiredPayload) {
    if (-not (Test-Path $File)) {
        throw "Payload incompleto. Arquivo ausente: $File. Rode npm run package-exe primeiro."
    }
}

$Candidates = @(
    (Get-Command ISCC.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue),
    "C:\Program Files\Inno Setup 7\ISCC.exe",
    "C:\Program Files (x86)\Inno Setup 7\ISCC.exe",
    "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
    "C:\Program Files\Inno Setup 6\ISCC.exe"
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -Unique

if (-not $Candidates) {
    throw @"
Inno Setup nao encontrado.

Instale a versao atual recomendada com:

winget install --id JRSoftware.InnoSetup.7 -e -s winget --accept-source-agreements --accept-package-agreements

Depois rode novamente:
npm run build-installer
"@
}

$ISCC = $Candidates[0]

Write-Host "ISCC=$ISCC"
Write-Host "ISS=$IssFile"

if (Test-Path $OutputDir) {
    Remove-Item -LiteralPath $OutputDir -Recurse -Force
}

& $ISCC $IssFile
if ($LASTEXITCODE -ne 0) {
    throw "Inno Setup falhou com exit code $LASTEXITCODE"
}

$Setup = Join-Path $OutputDir "FilamapAgentSetup.exe"
if (-not (Test-Path $Setup)) {
    throw "Instalador nao foi gerado no caminho esperado: $Setup"
}

$Hash = (Get-FileHash $Setup -Algorithm SHA256).Hash
$Size = (Get-Item $Setup).Length

Write-Host ""
Write-Host "INSTALLER_BUILD=OK"
Write-Host "INSTALLER=$Setup"
Write-Host "SIZE=$Size"
Write-Host "SHA256=$Hash"
