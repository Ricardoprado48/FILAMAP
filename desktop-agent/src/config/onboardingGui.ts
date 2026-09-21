import { spawn } from "node:child_process";
import type { OnboardingPrompts, MissingField } from "./onboarding";

export interface SetupGuiResult {
  email: string;
  password: string;
  accessCode: string;
}

let cachedResult: SetupGuiResult | null = null;

function runWindowsSetupGui(): Promise<SetupGuiResult> {
  return new Promise((resolve, reject) => {
    const script = String.raw`
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

[System.Windows.Forms.Application]::EnableVisualStyles()

$form = New-Object System.Windows.Forms.Form
$form.Text = "Filamap Agent"
$form.Size = New-Object System.Drawing.Size(520, 560)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.BackColor = [System.Drawing.Color]::FromArgb(15,23,42)

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

Add-Label "E-mail da conta Filamap" 35 115

$email = New-Object System.Windows.Forms.TextBox
$email.Location = New-Object System.Drawing.Point(35,140)
$email.Size = New-Object System.Drawing.Size(430,30)
$email.Font = New-Object System.Drawing.Font("Segoe UI",11)
$form.Controls.Add($email)

Add-Label "Senha" 35 185

$password = New-Object System.Windows.Forms.TextBox
$password.Location = New-Object System.Drawing.Point(35,210)
$password.Size = New-Object System.Drawing.Size(350,30)
$password.Font = New-Object System.Drawing.Font("Segoe UI",11)
$password.UseSystemPasswordChar = $true
$form.Controls.Add($password)

$showPassword = New-Object System.Windows.Forms.CheckBox
$showPassword.Text = "Mostrar"
$showPassword.ForeColor = [System.Drawing.Color]::White
$showPassword.Location = New-Object System.Drawing.Point(395,212)
$showPassword.AutoSize = $true
$showPassword.Add_CheckedChanged({
    $password.UseSystemPasswordChar = -not $showPassword.Checked
})
$form.Controls.Add($showPassword)

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

Add-Label "Access Code da impressora" 35 375

$access = New-Object System.Windows.Forms.TextBox
$access.Location = New-Object System.Drawing.Point(35,400)
$access.Size = New-Object System.Drawing.Size(350,30)
$access.Font = New-Object System.Drawing.Font("Segoe UI",11)
$access.UseSystemPasswordChar = $true
$form.Controls.Add($access)

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
$button.Location = New-Object System.Drawing.Point(35,465)
$button.Size = New-Object System.Drawing.Size(430,45)
$button.Font = New-Object System.Drawing.Font("Segoe UI",11,[System.Drawing.FontStyle]::Bold)
$button.BackColor = [System.Drawing.Color]::FromArgb(5,150,105)
$button.ForeColor = [System.Drawing.Color]::White
$button.FlatStyle = "Flat"

$button.Add_Click({

    if ([string]::IsNullOrWhiteSpace($email.Text)) {
        [System.Windows.Forms.MessageBox]::Show(
            "Informe o e-mail da sua conta Filamap.",
            "Filamap"
        )
        return
    }

    if ([string]::IsNullOrWhiteSpace($password.Text)) {
        [System.Windows.Forms.MessageBox]::Show(
            "Informe a senha da sua conta Filamap.",
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
        email = $email.Text.Trim()
        password = $password.Text
        accessCode = $access.Text.Trim()
    }

    $json = $result | ConvertTo-Json -Compress

    [Console]::Out.WriteLine("FILAMAP_RESULT:" + $json)

    $form.DialogResult = [System.Windows.Forms.DialogResult]::OK
    $form.Close()
})

$form.Controls.Add($button)

$form.AcceptButton = $button

$result = $form.ShowDialog()

if ($result -ne [System.Windows.Forms.DialogResult]::OK) {
    [Console]::Out.WriteLine("FILAMAP_CANCELLED")
}
`;

    const ps = spawn(
      "powershell.exe",
      [
        "-NoProfile",
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
          new Error(
            stderr.trim() ||
              "Configuração do Filamap foi cancelada."
          )
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

async function ensureGuiResult(): Promise<SetupGuiResult> {
  if (cachedResult) {
    return cachedResult;
  }

  cachedResult = await runWindowsSetupGui();
  return cachedResult;
}

export function createGuiPrompts(): OnboardingPrompts {
  return {
    notify(message: string) {
      console.log(message);
    },

    async askEmail() {
      const result = await ensureGuiResult();
      return result.email;
    },

    async askPassword() {
      const result = await ensureGuiResult();
      return result.password;
    },

    async askPrinterSerial() {
      return "";
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
}
