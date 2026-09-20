import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Config NÃO SECRETA do Agent, persistida fora do projeto (sobrevive a
// reinstalação/atualização do próprio pacote/exe). Segredos (senha,
// Access Code, refresh token) NUNCA entram aqui -- ver secretStore.ts.

export const CONFIG_FORMAT_VERSION = 1;

export interface NonSecretAgentConfig {
  formatVersion: number;
  agentEmail: string;
  printerSerial: string;
  lastKnownPrinterIp: string;
  onboardingCompletedAt: string | null;
  updatedAt: string;
}

export const EMPTY_NON_SECRET_CONFIG: NonSecretAgentConfig = {
  formatVersion: CONFIG_FORMAT_VERSION,
  agentEmail: "",
  printerSerial: "",
  lastKnownPrinterIp: "",
  onboardingCompletedAt: null,
  updatedAt: "",
};

// path.win32.join / path.posix.join explícitos (em vez de path.join) para
// que o resultado seja determinístico independente do SO que roda o
// código -- importante pros testes, que rodam em Linux mas precisam
// validar o caminho que seria gerado no Windows do cliente final.
export function resolveConfigDir(
  platform: NodeJS.Platform,
  homedir: string,
  env: { APPDATA?: string; XDG_CONFIG_HOME?: string }
): string {
  if (platform === "win32") {
    const base = env.APPDATA || path.win32.join(homedir, "AppData", "Roaming");
    return path.win32.join(base, "Filamap");
  }

  if (platform === "darwin") {
    return path.posix.join(homedir, "Library", "Application Support", "Filamap");
  }

  const base = env.XDG_CONFIG_HOME || path.posix.join(homedir, ".config");
  return path.posix.join(base, "filamap");
}

export function getConfigDir(): string {
  return resolveConfigDir(process.platform, os.homedir(), process.env);
}

export function getConfigPath(): string {
  return path.join(getConfigDir(), "config.json");
}

export function loadNonSecretConfig(): NonSecretAgentConfig | null {
  try {
    const raw = fs.readFileSync(getConfigPath(), "utf-8");
    const parsed = JSON.parse(raw);
    return { ...EMPTY_NON_SECRET_CONFIG, ...parsed };
  } catch {
    return null;
  }
}

export function saveNonSecretConfig(config: NonSecretAgentConfig): void {
  const dir = getConfigDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), "utf-8");
}

// Aplica um patch parcial sobre o que já está salvo (ou sobre o default,
// se ainda não existe nada) e persiste o resultado. updatedAt é sempre
// recalculado; os demais campos só mudam se vierem em `patch`.
export function mergeNonSecretConfig(
  patch: Partial<Omit<NonSecretAgentConfig, "formatVersion" | "updatedAt">>
): NonSecretAgentConfig {
  const existing = loadNonSecretConfig() ?? EMPTY_NON_SECRET_CONFIG;

  const merged: NonSecretAgentConfig = {
    ...existing,
    ...patch,
    formatVersion: CONFIG_FORMAT_VERSION,
    updatedAt: new Date().toISOString(),
  };

  saveNonSecretConfig(merged);

  return merged;
}
