// Cofre de segredos persistente para Windows usando DPAPI
// (CryptProtectData/CryptUnprotectData, escopo CurrentUser) -- ver análise
// em docs/11_AGENT_ONBOARDING_V2.md seção 10.
//
// Por quê `child_process` + `powershell.exe` em vez de uma lib nativa
// (`keytar`, N-API, etc.): DPAPI só é alcançável via Win32 API. Uma lib
// nativa exigiria compilar/empacotar um `.node` por arquitetura e mudar o
// pipeline do `pkg` (risco que o pedido original marcou como "PARE e
// documente antes de implementar"). `powershell.exe` já vem em qualquer
// Windows suportado e expõe DPAPI via
// `System.Security.Cryptography.ProtectedData` (.NET, parte do runtime do
// próprio Windows) -- então isso não adiciona dependência nova nem toca o
// empacotamento: é a mesma categoria de solução que `install-autostart.ps1`
// já usa (invocar uma ferramenta do SO via processo filho).
//
// O segredo nunca trafega como argumento de linha de comando (apareceria
// na lista de processos do SO) -- só via stdin/stdout, sempre em base64
// pra evitar problema de encoding entre Node e o `powershell.exe`.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { AgentSecrets, EMPTY_SECRETS, SecretStore } from "./secretStore";
import { getConfigDir } from "./configStore";

export const SECRETS_FILE_NAME = "secrets.dat";

export function getSecretsFilePath(): string {
  return path.join(getConfigDir(), SECRETS_FILE_NAME);
}

// PowerShell só precisa ler tudo de stdin, (des)proteger e escrever base64
// em stdout -- sem tocar em arquivo, sem imprimir nada além do resultado.
const PROTECT_SCRIPT = `
Add-Type -AssemblyName System.Security
$b64 = [Console]::In.ReadToEnd()
$bytes = [Convert]::FromBase64String($b64)
$protected = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[Console]::Out.Write([Convert]::ToBase64String($protected))
`.trim();

const UNPROTECT_SCRIPT = `
Add-Type -AssemblyName System.Security
$b64 = [Console]::In.ReadToEnd()
$bytes = [Convert]::FromBase64String($b64)
$unprotected = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[Console]::Out.Write([Convert]::ToBase64String($unprotected))
`.trim();

function runPowerShell(script: string, inputBase64: string): string {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    input: inputBase64,
    encoding: "utf-8",
    windowsHide: true,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`powershell.exe saiu com código ${result.status}: ${result.stderr}`);
  }

  return result.stdout.trim();
}

// Chama DPAPI (CurrentUser) de verdade via powershell.exe. Só funciona no
// Windows -- é o default de produção; testes injetam um par
// protect/unprotect fake (ver dpapiSecretStore.test.ts) porque não há
// `powershell.exe` no ambiente de CI (Linux).
export function dpapiProtect(plaintext: Buffer): Buffer {
  const outputBase64 = runPowerShell(PROTECT_SCRIPT, plaintext.toString("base64"));
  return Buffer.from(outputBase64, "base64");
}

export function dpapiUnprotect(ciphertext: Buffer): Buffer {
  const outputBase64 = runPowerShell(UNPROTECT_SCRIPT, ciphertext.toString("base64"));
  return Buffer.from(outputBase64, "base64");
}

export interface WindowsDpapiSecretStoreOptions {
  filePath?: string;
  protect?: (plaintext: Buffer) => Buffer;
  unprotect?: (ciphertext: Buffer) => Buffer;
}

// O arquivo em disco (`secrets.dat`, por padrão em
// `%APPDATA%\Filamap\secrets.dat`) contém *só* o blob binário que sai do
// DPAPI -- nunca o JSON em texto puro. `load()` trata qualquer falha
// (arquivo ausente, base64/JSON inválido, DPAPI recusando descriptografar)
// como "sem segredos salvos" em vez de derrubar o Agent, mesmo padrão já
// usado por `configStore.loadNonSecretConfig`.
export class WindowsDpapiSecretStore implements SecretStore {
  readonly kind = "windows-dpapi";
  readonly persists = true;

  private readonly filePath: string;
  private readonly protectFn: (plaintext: Buffer) => Buffer;
  private readonly unprotectFn: (ciphertext: Buffer) => Buffer;

  constructor(options: WindowsDpapiSecretStoreOptions = {}) {
    this.filePath = options.filePath ?? getSecretsFilePath();
    this.protectFn = options.protect ?? dpapiProtect;
    this.unprotectFn = options.unprotect ?? dpapiUnprotect;
  }

  async load(): Promise<AgentSecrets> {
    let ciphertext: Buffer;
    try {
      ciphertext = fs.readFileSync(this.filePath);
    } catch {
      return EMPTY_SECRETS;
    }

    try {
      const plaintext = this.unprotectFn(ciphertext);
      const parsed = JSON.parse(plaintext.toString("utf-8"));
      return {
        supabaseRefreshToken: parsed.supabaseRefreshToken ?? null,
        printerAccessCode: parsed.printerAccessCode ?? null,
      };
    } catch {
      return EMPTY_SECRETS;
    }
  }

  async save(secrets: AgentSecrets): Promise<void> {
    const plaintext = Buffer.from(JSON.stringify(secrets), "utf-8");
    const ciphertext = this.protectFn(plaintext);

    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, ciphertext);
  }

  async clear(): Promise<void> {
    try {
      fs.rmSync(this.filePath, { force: true });
    } catch {
      // arquivo já não existe ou não pôde ser removido -- não há segredo
      // pendente pra vazar por causa disso, então não é um erro fatal.
    }
  }
}
