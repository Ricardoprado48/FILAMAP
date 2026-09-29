import { spawn } from "node:child_process";
import type { OnboardingPrompts, MissingField } from "./onboarding";

export interface SetupGuiResult {
  pairingCode: string;
  accessCode: string;
}

let cachedResult: SetupGuiResult | null = null;
let needsFullForm = false;
let needsPairingField = true;
let setupShownThisRun = false;

// Pessoa fechou a janela de configuração sem concluir. Não é erro do Agent:
// ele encerra limpo (código 0) e volta pelo atalho "Filamap".
export class SetupCancelledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SetupCancelledError";
  }
}

// true se alguma janela de configuração apareceu nesta execução (primeira
// instalação, novo Access Code, novo código de pareamento).
export function wasSetupShownThisRun(): boolean {
  return setupShownThisRun;
}

// Site do Filamap (FILAMAP_WEB_URL só no teste, para abrir o site de staging).
export function filamapComputersUrl(): string {
  const base = (process.env.FILAMAP_WEB_URL || "https://filamap.pages.dev").trim().replace(/\/+$/, "");
  return /^https:\/\/[\w.-]+$/.test(base) ? `${base}/?computadores=1` : "https://filamap.pages.dev/?computadores=1";
}

function runWindowsSetupGui(needsPairing: boolean): Promise<SetupGuiResult> {
  setupShownThisRun = true;
  return new Promise((resolve, reject) => {
    const script = String.raw`
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

[System.Windows.Forms.Application]::EnableVisualStyles()

$needsPairing = __NEEDS_PAIRING__

$form = New-Object System.Windows.Forms.Form
$form.Text = "Filamap Agent"
$form.Size = New-Object System.Drawing.Size(520, 600)
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.MinimizeBox = $true
$form.BackColor = [System.Drawing.Color]::FromArgb(15,23,42)
$form.ShowInTaskbar = $true
# Canto direito da tela: o site do Filamap (onde está o código) fica visível ao lado.
$area = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$form.StartPosition = "Manual"
$form.Location = New-Object System.Drawing.Point([Math]::Max(0, $area.Right - 540), [Math]::Max(0, $area.Top + 40))

# Aparece na frente uma vez, mas NÃO fica presa na frente das outras janelas.
$form.Add_Shown({
    $form.WindowState = [System.Windows.Forms.FormWindowState]::Normal
    $form.TopMost = $true
    $form.Activate()
    $form.TopMost = $false
})

$title = New-Object System.Windows.Forms.Label
$title.Text = "FILAMAP AGENT"
$title.Font = New-Object System.Drawing.Font("Segoe UI", 22, [System.Drawing.FontStyle]::Bold)
$title.ForeColor = [System.Drawing.Color]::White
$title.AutoSize = $true
$title.Location = New-Object System.Drawing.Point(30,25)
$form.Controls.Add($title)

$subtitle = New-Object System.Windows.Forms.Label
$subtitle.Text = "Configuração inicial"
$subtitle.Font = New-Object System.Drawing.Font("Segoe UI", 11)
$subtitle.ForeColor = [System.Drawing.Color]::LightGray
$subtitle.AutoSize = $true
$subtitle.Location = New-Object System.Drawing.Point(33,68)
$form.Controls.Add($subtitle)

function Add-Label($text, $x, $y) {
    $label = New-Object System.Windows.Forms.Label
    $label.Text = $text
    $label.ForeColor = [System.Drawing.Color]::White
    $label.Font = New-Object System.Drawing.Font("Segoe UI", 10)
    $label.AutoSize = $true
    $label.Location = New-Object System.Drawing.Point($x,$y)
    $form.Controls.Add($label)
}

$pairingLabel = New-Object System.Windows.Forms.Label
$pairingLabel.Text = "1. Código de pareamento"
$pairingLabel.ForeColor = [System.Drawing.Color]::White
$pairingLabel.Font = New-Object System.Drawing.Font("Segoe UI", 10)
$pairingLabel.AutoSize = $true
$pairingLabel.Location = New-Object System.Drawing.Point(35,115)
$form.Controls.Add($pairingLabel)

$pairing = New-Object System.Windows.Forms.TextBox
$pairing.Location = New-Object System.Drawing.Point(35,140)
$pairing.Size = New-Object System.Drawing.Size(430,30)
$pairing.Font = New-Object System.Drawing.Font("Consolas",14)
$pairing.CharacterCasing = "Upper"
$pairing.MaxLength = 13
$form.Controls.Add($pairing)

$pairingHelp = New-Object System.Windows.Forms.Label
$pairingHelp.Text = "O código aparece no site do Filamap, em " + [char]0x201C + "Computadores" + [char]0x201D + " > " + [char]0x201C + "Conectar computador" + [char]0x201D + ". Vale por 10 minutos. Sua senha não é pedida aqui."
$pairingHelp.ForeColor = [System.Drawing.Color]::LightGray
$pairingHelp.Font = New-Object System.Drawing.Font("Segoe UI", 9)
$pairingHelp.Location = New-Object System.Drawing.Point(35,180)
$pairingHelp.Size = New-Object System.Drawing.Size(430,36)
$form.Controls.Add($pairingHelp)

$openWeb = New-Object System.Windows.Forms.Button
$openWeb.Text = "Abrir o Filamap para pegar o código"
$openWeb.Location = New-Object System.Drawing.Point(35,220)
$openWeb.Size = New-Object System.Drawing.Size(430,34)
$openWeb.Font = New-Object System.Drawing.Font("Segoe UI",10,[System.Drawing.FontStyle]::Bold)
$openWeb.BackColor = [System.Drawing.Color]::FromArgb(37,99,235)
$openWeb.ForeColor = [System.Drawing.Color]::White
$openWeb.FlatStyle = "Flat"
$openWeb.Add_Click({ Start-Process "__COMPUTERS_URL__" })
$form.Controls.Add($openWeb)

$printerGroup = New-Object System.Windows.Forms.GroupBox
$printerGroup.Text = "Impressora Bambu Lab"
$printerGroup.ForeColor = [System.Drawing.Color]::White
$printerGroup.Location = New-Object System.Drawing.Point(35,270)
$printerGroup.Size = New-Object System.Drawing.Size(430,85)
$form.Controls.Add($printerGroup)

$printerStatus = New-Object System.Windows.Forms.Label
$printerStatus.Text = "A impressora será localizada automaticamente."
$printerStatus.ForeColor = [System.Drawing.Color]::LightGray
$printerStatus.Location = New-Object System.Drawing.Point(15,30)
$printerStatus.Size = New-Object System.Drawing.Size(395,40)
$printerGroup.Controls.Add($printerStatus)

$accessLabel = New-Object System.Windows.Forms.Label
$accessLabel.Text = "2. Access Code da impressora"
$accessLabel.ForeColor = [System.Drawing.Color]::White
$accessLabel.Font = New-Object System.Drawing.Font("Segoe UI", 10)
$accessLabel.AutoSize = $true
$accessLabel.Location = New-Object System.Drawing.Point(35,375)
$form.Controls.Add($accessLabel)

$access = New-Object System.Windows.Forms.TextBox
$access.Location = New-Object System.Drawing.Point(35,400)
$access.Size = New-Object System.Drawing.Size(350,30)
$access.Font = New-Object System.Drawing.Font("Segoe UI",11)
$access.UseSystemPasswordChar = $true
$form.Controls.Add($access)

$accessHelp = New-Object System.Windows.Forms.Label
$accessHelp.Text = "Fica na tela da impressora, nas configurações de rede (WLAN/LAN). São 8 caracteres."
$accessHelp.ForeColor = [System.Drawing.Color]::LightGray
$accessHelp.Font = New-Object System.Drawing.Font("Segoe UI", 9)
$accessHelp.Location = New-Object System.Drawing.Point(35,432)
$accessHelp.Size = New-Object System.Drawing.Size(430,36)
$form.Controls.Add($accessHelp)

$showAccess = New-Object System.Windows.Forms.CheckBox
$showAccess.Text = "Mostrar"
$showAccess.ForeColor = [System.Drawing.Color]::White
$showAccess.Location = New-Object System.Drawing.Point(395,402)
$showAccess.AutoSize = $true
$showAccess.Add_CheckedChanged({
    $access.UseSystemPasswordChar = -not $showAccess.Checked
})
$form.Controls.Add($showAccess)

$button = New-Object System.Windows.Forms.Button
$button.Text = "CONECTAR E FINALIZAR"
$button.Location = New-Object System.Drawing.Point(35,485)
$button.Size = New-Object System.Drawing.Size(430,45)
$button.Font = New-Object System.Drawing.Font("Segoe UI",11,[System.Drawing.FontStyle]::Bold)
$button.BackColor = [System.Drawing.Color]::FromArgb(5,150,105)
$button.ForeColor = [System.Drawing.Color]::White
$button.FlatStyle = "Flat"

$button.Add_Click({

    if ($needsPairing -and [string]::IsNullOrWhiteSpace($pairing.Text)) {
        [System.Windows.Forms.MessageBox]::Show(
            "Informe o código de pareamento. Clique em " + [char]0x201C + "Abrir o Filamap para pegar o código" + [char]0x201D + ".",
            "Filamap"
        )
        return
    }

    if ([string]::IsNullOrWhiteSpace($access.Text)) {
        [System.Windows.Forms.MessageBox]::Show(
            "Informe o Access Code da impressora.",
            "Filamap"
        )
        return
    }

    $result = @{
        pairingCode = $pairing.Text.Trim()
        accessCode = $access.Text.Trim()
    }

    $json = $result | ConvertTo-Json -Compress

    [Console]::Out.WriteLine("FILAMAP_RESULT:" + $json)

    $form.DialogResult = [System.Windows.Forms.DialogResult]::OK
    $form.Close()
})

$form.Controls.Add($button)

# Só falta o Access Code (digitado errado ou trocado na impressora): esconde o
# pareamento e sobe o resto, sem buraco no meio.
if (-not $needsPairing) {
    $subtitle.Text = "A impressora pediu o Access Code de novo"
    $pairingLabel.Visible = $false
    $pairing.Visible = $false
    $pairingHelp.Visible = $false
    $openWeb.Visible = $false
    $up = 160
    foreach ($c in @($printerGroup, $accessLabel, $access, $showAccess, $accessHelp, $button)) {
        $c.Location = New-Object System.Drawing.Point($c.Location.X, ($c.Location.Y - $up))
    }
    $accessLabel.Text = "Access Code da impressora"
    $form.Size = New-Object System.Drawing.Size(520, (600 - $up))
}

$form.AcceptButton = $button

$result = $form.ShowDialog()

if ($result -ne [System.Windows.Forms.DialogResult]::OK) {
    [System.Windows.Forms.MessageBox]::Show(
        "A configuração não foi concluída." + [Environment]::NewLine + [Environment]::NewLine + "Para continuar depois, abra o atalho " + [char]0x201C + "Filamap" + [char]0x201D + " na Área de Trabalho.",
        "Filamap Agent"
    ) | Out-Null
    [Console]::Out.WriteLine("FILAMAP_CANCELLED")
}
`
      .replace("__NEEDS_PAIRING__", needsPairing ? "$true" : "$false")
      .replace("__COMPUTERS_URL__", filamapComputersUrl());

    const ps = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-STA",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        script,
      ],
      {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    let stdout = "";
    let stderr = "";

    ps.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    ps.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    ps.on("error", reject);

    ps.on("close", () => {
      const marker = "FILAMAP_RESULT:";
      const line = stdout
        .split(/\r?\n/)
        .find((item) => item.startsWith(marker));

      if (!line) {
        reject(
          stdout.includes("FILAMAP_CANCELLED") || !stderr.trim()
            ? new SetupCancelledError("Configuração do Filamap foi cancelada.")
            : new Error(stderr.trim())
        );
        return;
      }

      try {
        const result = JSON.parse(
          line.slice(marker.length)
        ) as SetupGuiResult;

        resolve(result);
      } catch {
        reject(
          new Error(
            "Não foi possível interpretar os dados da configuração."
          )
        );
      }
    });
  });
}

function runWindowsPrinterSerialGui(): Promise<string> {
  setupShownThisRun = true;
  return new Promise((resolve, reject) => {
    const script = String.raw`
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

[System.Windows.Forms.Application]::EnableVisualStyles()

$form = New-Object System.Windows.Forms.Form
$form.Text = "Filamap Agent"
$form.Size = New-Object System.Drawing.Size(520, 300)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.BackColor = [System.Drawing.Color]::FromArgb(15,23,42)
$form.ShowInTaskbar = $true
$form.TopMost = $true

$title = New-Object System.Windows.Forms.Label
$title.Text = "Número de série da impressora"
$title.Font = New-Object System.Drawing.Font("Segoe UI",16,[System.Drawing.FontStyle]::Bold)
$title.ForeColor = [System.Drawing.Color]::White
$title.AutoSize = $true
$title.Location = New-Object System.Drawing.Point(30,25)
$form.Controls.Add($title)

$info = New-Object System.Windows.Forms.Label
$info.Text = "Não foi possível detectar o número de série automaticamente." + [Environment]::NewLine + "Informe o serial exibido na sua impressora Bambu Lab."
$info.Font = New-Object System.Drawing.Font("Segoe UI",10)
$info.ForeColor = [System.Drawing.Color]::LightGray
$info.Location = New-Object System.Drawing.Point(33,70)
$info.Size = New-Object System.Drawing.Size(435,50)
$form.Controls.Add($info)

$label = New-Object System.Windows.Forms.Label
$label.Text = "Número de série"
$label.Font = New-Object System.Drawing.Font("Segoe UI",10)
$label.ForeColor = [System.Drawing.Color]::White
$label.AutoSize = $true
$label.Location = New-Object System.Drawing.Point(35,130)
$form.Controls.Add($label)

$serial = New-Object System.Windows.Forms.TextBox
$serial.Location = New-Object System.Drawing.Point(35,155)
$serial.Size = New-Object System.Drawing.Size(430,30)
$serial.Font = New-Object System.Drawing.Font("Segoe UI",11)
$form.Controls.Add($serial)

$button = New-Object System.Windows.Forms.Button
$button.Text = "CONTINUAR"
$button.Location = New-Object System.Drawing.Point(35,205)
$button.Size = New-Object System.Drawing.Size(430,42)
$button.Font = New-Object System.Drawing.Font("Segoe UI",11,[System.Drawing.FontStyle]::Bold)
$button.BackColor = [System.Drawing.Color]::FromArgb(5,150,105)
$button.ForeColor = [System.Drawing.Color]::White
$button.FlatStyle = "Flat"

$button.Add_Click({
    if ([string]::IsNullOrWhiteSpace($serial.Text)) {
        [System.Windows.Forms.MessageBox]::Show(
            "Informe o número de série da impressora.",
            "Filamap"
        )
        $serial.Focus()
        return
    }

    $json = $serial.Text.Trim() | ConvertTo-Json -Compress
    [Console]::Out.WriteLine("FILAMAP_SERIAL:" + $json)

    $form.DialogResult = [System.Windows.Forms.DialogResult]::OK
    $form.Close()
})

$form.Controls.Add($button)
$form.AcceptButton = $button

$form.Add_Shown({
    $form.Activate()
    $form.BringToFront()
    $serial.Focus()
})

$result = $form.ShowDialog()

if ($result -ne [System.Windows.Forms.DialogResult]::OK) {
    [Console]::Out.WriteLine("FILAMAP_CANCELLED")
}
`;

    const ps = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-STA",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        script,
      ],
      {
        windowsHide: false,
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    let stdout = "";
    let stderr = "";

    ps.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    ps.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    ps.on("error", reject);

    ps.on("close", () => {
      const marker = "FILAMAP_SERIAL:";

      const line = stdout
        .split(/\r?\n/)
        .find((item) => item.startsWith(marker));

      if (!line) {
        reject(
          stdout.includes("FILAMAP_CANCELLED") || !stderr.trim()
            ? new SetupCancelledError("Configuração do número de série foi cancelada.")
            : new Error(stderr.trim())
        );
        return;
      }

      try {
        const serial = JSON.parse(line.slice(marker.length)) as string;

        if (!serial.trim()) {
          reject(new Error("Número de série da impressora é obrigatório."));
          return;
        }

        resolve(serial.trim());
      } catch {
        reject(
          new Error(
            "Não foi possível interpretar o número de série informado."
          )
        );
      }
    });
  });
}
function runWindowsPairingCodeGui(): Promise<string> {
  setupShownThisRun = true;
  return new Promise((resolve, reject) => {
    const script = String.raw`
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

[System.Windows.Forms.Application]::EnableVisualStyles()

$form = New-Object System.Windows.Forms.Form
$form.Text = "Filamap"
$form.Size = New-Object System.Drawing.Size(500, 300)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.BackColor = [System.Drawing.Color]::FromArgb(15,23,42)
$form.ShowInTaskbar = $true
$form.TopMost = $true

$title = New-Object System.Windows.Forms.Label
$title.Text = "Conecte este computador"
$title.Font = New-Object System.Drawing.Font("Segoe UI",16,[System.Drawing.FontStyle]::Bold)
$title.ForeColor = [System.Drawing.Color]::White
$title.AutoSize = $true
$title.Location = New-Object System.Drawing.Point(30,25)
$form.Controls.Add($title)

$info = New-Object System.Windows.Forms.Label
$info.Text = "O acesso deste computador expirou ou foi desconectado." + [Environment]::NewLine + "Gere um código em 'Computadores conectados' na Web do Filamap."
$info.Font = New-Object System.Drawing.Font("Segoe UI",10)
$info.ForeColor = [System.Drawing.Color]::LightGray
$info.AutoSize = $true
$info.Location = New-Object System.Drawing.Point(33,70)
$form.Controls.Add($info)

$label = New-Object System.Windows.Forms.Label
$label.Text = "Código de pareamento"
$label.Font = New-Object System.Drawing.Font("Segoe UI",10)
$label.ForeColor = [System.Drawing.Color]::White
$label.AutoSize = $true
$label.Location = New-Object System.Drawing.Point(35,115)
$form.Controls.Add($label)

$password = New-Object System.Windows.Forms.TextBox
$password.Location = New-Object System.Drawing.Point(35,140)
$password.Size = New-Object System.Drawing.Size(410,30)
$password.Font = New-Object System.Drawing.Font("Consolas",14)
$password.CharacterCasing = "Upper"
$password.MaxLength = 13
$form.Controls.Add($password)

$button = New-Object System.Windows.Forms.Button
$button.Text = "CONTINUAR"
$button.Location = New-Object System.Drawing.Point(35,195)
$button.Size = New-Object System.Drawing.Size(410,42)
$button.Font = New-Object System.Drawing.Font("Segoe UI",11,[System.Drawing.FontStyle]::Bold)
$button.BackColor = [System.Drawing.Color]::FromArgb(5,150,105)
$button.ForeColor = [System.Drawing.Color]::White
$button.FlatStyle = "Flat"

$button.Add_Click({
    if ([string]::IsNullOrWhiteSpace($password.Text)) {
        [System.Windows.Forms.MessageBox]::Show(
            "Informe o código de pareamento.",
            "Filamap"
        )
        $password.Focus()
        return
    }

    $json = $password.Text | ConvertTo-Json -Compress
    [Console]::Out.WriteLine("FILAMAP_PAIRING:" + $json)

    $form.DialogResult = [System.Windows.Forms.DialogResult]::OK
    $form.Close()
})

$form.Controls.Add($button)
$form.AcceptButton = $button

$form.Add_Shown({
    $form.Activate()
    $form.BringToFront()
    $password.Focus()
})

$result = $form.ShowDialog()

if ($result -ne [System.Windows.Forms.DialogResult]::OK) {
    [Console]::Out.WriteLine("FILAMAP_CANCELLED")
}
`;

    const ps = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-STA",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        script,
      ],
      {
        windowsHide: false,
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    let stdout = "";
    let stderr = "";

    ps.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    ps.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    ps.on("error", reject);

    ps.on("close", () => {
      const marker = "FILAMAP_PAIRING:";

      const line = stdout
        .split(/\r?\n/)
        .find((item) => item.startsWith(marker));

      if (!line) {
        reject(
          stdout.includes("FILAMAP_CANCELLED") || !stderr.trim()
            ? new SetupCancelledError("Pareamento do Filamap foi cancelado.")
            : new Error(stderr.trim())
        );
        return;
      }

      try {
        const code = JSON.parse(
          line.slice(marker.length)
        ) as string;

        if (!code) {
          reject(new Error("Código de pareamento é obrigatório."));
          return;
        }

        resolve(code);
      } catch {
        reject(
          new Error(
            "Não foi possível interpretar o código informado."
          )
        );
      }
    });
  });
}
async function ensureGuiResult(): Promise<SetupGuiResult> {
  if (cachedResult) {
    return cachedResult;
  }

  cachedResult = await runWindowsSetupGui(needsPairingField);
  return cachedResult;
}

export function createGuiPrompts(): OnboardingPrompts {
  return {
    notify(message: string) {
      console.log(message);
    },

    prepare(missing: MissingField[]) {
      needsFullForm = missing.includes("printerAccessCode");
      needsPairingField = missing.includes("agentAuth");
    },

    // E-mail não é mais perguntado na tela (o pareamento identifica a
    // conta); só existe para o modo dev com senha no .env.
    async askEmail() {
      return "";
    },

    // Primeira execução: vem do formulário completo. Sessão perdida depois
    // (computador desconectado na Web): diálogo só com o código.
    async askPairingCode() {
      if (cachedResult || needsFullForm) {
        return (await ensureGuiResult()).pairingCode;
      }

      return runWindowsPairingCodeGui();
    },

    async askPrinterSerial() {
      return runWindowsPrinterSerialGui();
    },

    async askPrinterAccessCode() {
      const result = await ensureGuiResult();
      return result.accessCode;
    },

    onCannotPrompt(missing: MissingField[]): never {
      throw new Error(
        `Configuração incompleta: ${missing.join(", ")}`
      );
    },
  };
}

export function resetGuiPrompts(): void {
  cachedResult = null;
  needsFullForm = false;
  needsPairingField = true;
}

