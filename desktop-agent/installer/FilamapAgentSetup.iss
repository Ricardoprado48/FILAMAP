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
SetupIconFile=filamap.ico
Compression=lzma2
SolidCompression=yes

WizardStyle=modern

UninstallDisplayName=Filamap Agent

SetupLogging=yes

ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible



[Languages]
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"
[Files]
Source: "filamap.ico"; DestDir: "{app}"; Flags: ignoreversion
Source: "payload\filamap-agent.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "payload\bambu-bridge\filamap-bambu-bridge.exe"; DestDir: "{app}\bambu-bridge"; Flags: ignoreversion
Source: "payload\run-agent.vbs"; DestDir: "{app}"; Flags: ignoreversion
Source: "payload\start-agent.vbs"; DestDir: "{app}"; Flags: ignoreversion
Source: "payload\install-autostart.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "payload\uninstall-autostart.ps1"; DestDir: "{app}"; Flags: ignoreversion



[InstallDelete]

; Remove atalhos antigos antes de recriar os atalhos do Filamap.
Type: files; Name: "{group}\Filamap Agent.lnk"
Type: files; Name: "{group}\Filamap.lnk"
Type: files; Name: "{autodesktop}\Filamap Agent.lnk"
Type: files; Name: "{autodesktop}\Filamap.lnk"

[Run]

; Registra o Filamap Agent para iniciar automaticamente no logon.
Filename: "powershell.exe"; \
    Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\install-autostart.ps1"""; \
    WorkingDir: "{app}"; \
    Flags: runhidden waituntilterminated

; Inicia o Agent silenciosamente em segundo plano apos instalar.
Filename: "{sys}\wscript.exe"; \
    Parameters: """{app}\start-agent.vbs"""; \
    WorkingDir: "{app}"; \
    Flags: runhidden nowait

; Na tela final, oferece abrir o Filamap Web.
Filename: "https://filamap.pages.dev"; \
    Description: "Abrir o Filamap"; \
    Flags: shellexec postinstall nowait skipifsilent

[UninstallRun]

; Remove a tarefa agendada antes dos arquivos serem apagados.
Filename: "powershell.exe"; \
    Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\uninstall-autostart.ps1"""; \
    WorkingDir: "{app}"; \
    Flags: runhidden waituntilterminated; \
    RunOnceId: "FilamapRemoveAutostart"



[Icons]

; Atalho principal. Aponta para start-agent.vbs (via wscript.exe, sem
; janela preta) em vez do .exe diretamente -- start-agent.vbs só pede
; ao Task Scheduler para rodar a Tarefa Agendada já registrada por
; install-autostart.ps1, então clicar aqui nunca cria um segundo
; processo do Agent: se já estiver rodando, MultipleInstances=IgnoreNew
; faz o Windows ignorar o pedido.
Name: "{group}\Filamap"; \
    Filename: "https://filamap.pages.dev"; \
    IconFilename: "{app}\filamap.ico"; \
    Comment: "Abrir o Filamap"

Name: "{group}\Desinstalar Filamap Agent"; \
    Filename: "{uninstallexe}"

Name: "{autodesktop}\Filamap"; \
    Filename: "https://filamap.pages.dev"; \
    IconFilename: "{app}\filamap.ico"; \
    Comment: "Abrir o Filamap"


[Code]

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
  begin
    Log('Filamap Agent instalado com sucesso.');
  end;
end;



