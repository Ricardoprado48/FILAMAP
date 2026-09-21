#define MyAppName "Filamap Agent"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "Filamap"
#define MyAppExeName "filamap-agent.exe"

[Setup]
AppId={{D63247D9-9678-42DE-A23D-BC79B50D76C4}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}

DefaultDirName={autopf}\Filamap Agent
DefaultGroupName=Filamap Agent

DisableProgramGroupPage=yes

PrivilegesRequired=admin

OutputDir=output
OutputBaseFilename=FilamapAgentSetup

Compression=lzma2
SolidCompression=yes

WizardStyle=modern

UninstallDisplayName=Filamap Agent

SetupLogging=yes

ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible


[Files]
Source: "payload\filamap-agent.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "payload\run-agent.vbs"; DestDir: "{app}"; Flags: ignoreversion
Source: "payload\install-autostart.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "payload\uninstall-autostart.ps1"; DestDir: "{app}"; Flags: ignoreversion


[Run]

; Registra o Filamap Agent para iniciar automaticamente no logon.
Filename: "powershell.exe"; \
    Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\install-autostart.ps1"""; \
    WorkingDir: "{app}"; \
    Flags: runhidden waituntilterminated

; Inicia o Agent imediatamente após instalar.
Filename: "powershell.exe"; \
    Parameters: "-NoProfile -WindowStyle Hidden -Command ""Start-ScheduledTask -TaskName 'FilamapAgentAutoStart'"""; \
    WorkingDir: "{app}"; \
    Flags: runhidden nowait


[UninstallRun]

; Remove a tarefa agendada antes dos arquivos serem apagados.
Filename: "powershell.exe"; \
    Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\uninstall-autostart.ps1"""; \
    WorkingDir: "{app}"; \
    Flags: runhidden waituntilterminated; \
    RunOnceId: "FilamapRemoveAutostart"



[Icons]

Name: "{group}\Desinstalar Filamap Agent"; \
    Filename: "{uninstallexe}"


[Code]

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
  begin
    Log('Filamap Agent instalado com sucesso.');
  end;
end;


