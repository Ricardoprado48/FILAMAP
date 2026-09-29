import { spawn } from "node:child_process";

// Aviso simples na tela do Windows (caixa de mensagem com OK), por cima das
// outras janelas. Nunca lança: se não der para mostrar, só registra no log.
// Resolve quando a pessoa fecha o aviso.

function psQuote(value: string): string {
  return "'" + value.replace(/'/g, "''") + "'";
}

export function buildNoticeScript(title: string, lines: string[], kind: "info" | "warning"): string {
  const icon = kind === "warning" ? "Warning" : "Information";
  const text = lines.length ? lines.map(psQuote).join(",") : "''";
  return (
    "Add-Type -AssemblyName System.Windows.Forms; " +
    `$t = @(${text}) -join [Environment]::NewLine; ` +
    `[System.Windows.Forms.MessageBox]::Show($t, ${psQuote(title)}, 'OK', '${icon}', 'Button1', 'ServiceNotification') | Out-Null`
  );
}

export function showDesktopNotice(title: string, lines: string[], kind: "info" | "warning" = "info"): Promise<void> {
  if (process.platform !== "win32") {
    console.log(`[aviso] ${title}: ${lines.join(" ")}`);
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    try {
      const ps = spawn("powershell.exe", ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-Command", buildNoticeScript(title, lines, kind)], {
        windowsHide: true,
        stdio: "ignore",
      });
      ps.on("error", (e) => {
        console.warn("⚠️ Não foi possível mostrar o aviso na tela:", e.message);
        resolve();
      });
      ps.on("close", () => resolve());
    } catch (e: any) {
      console.warn("⚠️ Não foi possível mostrar o aviso na tela:", e?.message || e);
      resolve();
    }
  });
}
