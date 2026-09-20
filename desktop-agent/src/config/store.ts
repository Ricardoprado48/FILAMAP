import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Mesmo backend/projeto Supabase usado pelo Web App (web-app/src/lib/supabase.ts).
// A anon key é segura para embutir no cliente -- é o próprio modelo do
// Supabase (autorização real fica por conta do RLS no banco, não do sigilo
// desta chave); o Web App já a distribui do mesmo jeito, embutida no bundle
// publicado. Isso evita que o cliente comercial precise descobrir/colar
// essa chave só para logar com o e-mail e senha da própria conta Filamap.
export const DEFAULT_SUPABASE_URL = "https://gqtlszffgvxsqcmefhyd.supabase.co";
export const DEFAULT_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdxdGxzemZmZ3Z4c3FjbWVmaHlkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk2NTA3OTQsImV4cCI6MjEwNTIyNjc5NH0.YH6OHOF2lV1uIjQ3A9kLFhIGlovgZc2ywdXmRykxkkM";

export interface AgentConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  agentEmail: string;
  agentPassword: string;
  printerIp: string;
  printerSerial: string;
  printerAccessCode: string;
}

const APP_DIR_NAME_WIN_MAC = "Filamap";
const APP_DIR_NAME_LINUX = "filamap";
const CONFIG_FILE_NAME = "config.json";

// Pura -- recebe o que dependeria de estado global (plataforma, home,
// variáveis de ambiente) como parâmetro em vez de ler process.* direto, só
// para poder testar as três ramificações sem precisar simular o SO. Usa
// path.win32/path.posix explicitamente (em vez do path "genérico", que
// segue o SO onde o teste roda) para o separador ficar determinístico
// mesmo rodando os testes num Linux/CI enquanto o Agent é distribuído
// para Windows.
export function resolveConfigDir(
  platform: NodeJS.Platform,
  homedir: string,
  env: { APPDATA?: string; XDG_CONFIG_HOME?: string }
): string {
  if (platform === "win32") {
    return path.win32.join(env.APPDATA || path.win32.join(homedir, "AppData", "Roaming"), APP_DIR_NAME_WIN_MAC);
  }
  if (platform === "darwin") {
    return path.posix.join(homedir, "Library", "Application Support", APP_DIR_NAME_WIN_MAC);
  }
  return path.posix.join(env.XDG_CONFIG_HOME || path.posix.join(homedir, ".config"), APP_DIR_NAME_LINUX);
}

export function getConfigDir(): string {
  return resolveConfigDir(process.platform, os.homedir(), process.env);
}

export function getConfigPath(): string {
  return path.join(getConfigDir(), CONFIG_FILE_NAME);
}

export function loadStoredConfig(): Partial<AgentConfig> | null {
  try {
    const raw = fs.readFileSync(getConfigPath(), "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveStoredConfig(config: AgentConfig): void {
  const dir = getConfigDir();
  fs.mkdirSync(dir, { recursive: true });
  const configPath = getConfigPath();
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
  try {
    // Melhor esforço: restringe leitura ao dono no POSIX. No Windows/NTFS
    // não há um equivalente direto sem uma dependência nativa extra (ex.:
    // DPAPI via addon) -- migrar para o cofre de credenciais do SO é uma
    // decisão de produto em aberto, registrada em docs/08_BACKLOG.md (P2.2).
    fs.chmodSync(configPath, 0o600);
  } catch {
    // Best-effort -- não bloqueia o Agent se o SO não suportar chmod (ex.: Windows).
  }
}

function cleanEnvValue(v: string | undefined): string {
  return (v || "").trim().replace(/['"]/g, "");
}

// Prioridade: variáveis de ambiente / .env (compat com uso atual em
// desenvolvimento) > arquivo de configuração persistido (onboarding
// comercial) > defaults do Supabase (URL/anon key, iguais ao Web App).
export function resolveConfig(): AgentConfig {
  const stored = loadStoredConfig() || {};

  const envSupabaseUrl = cleanEnvValue(process.env.SUPABASE_URL).replace(/\/$/, "");
  const envSupabaseAnonKey = cleanEnvValue(process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_KEY);
  const envAgentEmail = cleanEnvValue(process.env.AGENT_EMAIL);
  const envAgentPassword = cleanEnvValue(process.env.AGENT_PASSWORD);
  const envPrinterIp = cleanEnvValue(process.env.PRINTER_IP);
  const envPrinterSerial = cleanEnvValue(process.env.PRINTER_SERIAL);
  const envPrinterAccessCode = cleanEnvValue(process.env.PRINTER_ACCESS_CODE);

  return {
    supabaseUrl: envSupabaseUrl || stored.supabaseUrl || DEFAULT_SUPABASE_URL,
    supabaseAnonKey: envSupabaseAnonKey || stored.supabaseAnonKey || DEFAULT_SUPABASE_ANON_KEY,
    agentEmail: envAgentEmail || stored.agentEmail || "",
    agentPassword: envAgentPassword || stored.agentPassword || "",
    printerIp: envPrinterIp || stored.printerIp || "",
    printerSerial: envPrinterSerial || stored.printerSerial || "",
    printerAccessCode: envPrinterAccessCode || stored.printerAccessCode || "",
  };
}

// Campos que o onboarding precisa coletar do cliente pelo menos uma vez;
// printerIp fica de fora de propósito -- é a descoberta automática
// (findPrinter) que resolve, não algo que se pede no onboarding.
export function missingRequiredFields(config: AgentConfig): Array<keyof AgentConfig> {
  const missing: Array<keyof AgentConfig> = [];
  if (!config.agentEmail) missing.push("agentEmail");
  if (!config.agentPassword) missing.push("agentPassword");
  if (!config.printerSerial) missing.push("printerSerial");
  if (!config.printerAccessCode) missing.push("printerAccessCode");
  return missing;
}
