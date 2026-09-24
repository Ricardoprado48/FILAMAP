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

$Candidates = New-Object System.Collections.Generic.List[string]

$CommandPath = Get-Command ISCC.exe -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue

if ($CommandPath) {
    $Candidates.Add($CommandPath)
}

$KnownPaths = @(
    "C:\Program Files\Inno Setup 7\ISCC.exe",
    "C:\Program Files (x86)\Inno Setup 7\ISCC.exe",
    "C:\Program Files\Inno Setup 6\ISCC.exe",
    "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
    (Join-Path $env:LOCALAPPDATA "Programs\Inno Setup 7\ISCC.exe"),
    (Join-Path $env:LOCALAPPDATA "Programs\Inno Setup 6\ISCC.exe")
)

foreach ($Path in $KnownPaths) {
    if ($Path -and (Test-Path $Path)) {
        $Candidates.Add($Path)
    }
}

$RegistryRoots = @(
    "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*"
)

foreach ($RegistryRoot in $RegistryRoots) {
    try {
        Get-ItemProperty $RegistryRoot -ErrorAction SilentlyContinue |
            Where-Object { $_.DisplayName -like "Inno Setup*" } |
            ForEach-Object {
                if ($_.InstallLocation) {
                    $RegistryCandidate = Join-Path $_.InstallLocation "ISCC.exe"
                    if (Test-Path $RegistryCandidate) {
                        $Candidates.Add($RegistryCandidate)
                    }
                }
            }
    }
    catch {
        # Registro opcional; continuar com os outros metodos.
    }
}

$ISCC = $Candidates |
    Where-Object { $_ -and (Test-Path $_) } |
    Select-Object -Unique -First 1

if (-not $ISCC) {
    $SearchRoots = @(
        $env:LOCALAPPDATA,
        $env:ProgramFiles,
        ${env:ProgramFiles(x86)}
    ) | Where-Object { $_ -and (Test-Path $_) }

    foreach ($SearchRoot in $SearchRoots) {
        $Found = Get-ChildItem -Path $SearchRoot -Filter ISCC.exe -File -Recurse -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -match "Inno Setup" } |
            Select-Object -ExpandProperty FullName -First 1

        if ($Found) {
            $ISCC = $Found
            break
        }
    }
}

if (-not $ISCC) {
    throw @"
Inno Setup parece estar instalado, mas ISCC.exe nao foi localizado.

Execute:
where.exe /R "%LOCALAPPDATA%" ISCC.exe
where.exe /R "C:\Program Files" ISCC.exe
where.exe /R "C:\Program Files (x86)" ISCC.exe

e informe o caminho encontrado.
"@
}

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
