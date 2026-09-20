import {
  loadNonSecretConfig,
  mergeNonSecretConfig,
  NonSecretAgentConfig,
} from "./configStore";
import { AgentSecrets, SecretStore } from "./secretStore";
import { DEFAULT_SUPABASE_URL, DEFAULT_SUPABASE_ANON_KEY } from "./supabaseDefaults";
import { discoverPrinter } from "../printerDiscovery";

// Onboarding comercial do Agent: decide o que falta configurar, tenta
// descoberta automática (impressora), pergunta só o que não dá pra saber
// sozinho, e devolve tudo que startAgent() precisa pra funcionar --
// index.ts continua dono da autenticação Supabase e da conexão MQTT em
// si, esta função só resolve config + segredos antes disso.
//
// Separação deliberada de responsabilidades (pra permitir trocar CLI por
// tela gráfica sem tocar aqui): esta função nunca lê stdin/stdout
// diretamente -- tudo isso passa pela interface OnboardingPrompts,
// injetada por quem chama (hoje: onboardingCli.ts).

export interface EnvOverrides {
  supabaseUrl: string;
  supabaseAnonKey: string;
  agentEmail: string;
  agentPassword: string;
  printerIp: string;
  printerSerial: string;
  printerAccessCode: string;
}

export function readEnvOverrides(env: NodeJS.ProcessEnv): EnvOverrides {
  const clean = (v: string | undefined) => (v || "").trim().replace(/['"]/g, "");

  return {
    supabaseUrl: clean(env.SUPABASE_URL).replace(/\/$/, ""),
    supabaseAnonKey: clean(env.SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_KEY),
    agentEmail: clean(env.AGENT_EMAIL),
    agentPassword: clean(env.AGENT_PASSWORD),
    printerIp: clean(env.PRINTER_IP),
    printerSerial: clean(env.PRINTER_SERIAL),
    printerAccessCode: clean(env.PRINTER_ACCESS_CODE),
  };
}

// Modo dev/CI 100% preservado: se as 5 variáveis que o Agent sempre exigiu
// estão todas no ambiente, nada do onboarding roda -- mesmo comportamento
// de antes desta mudança, sem tocar em disco.
export function hasCompleteEnvConfig(env: EnvOverrides): boolean {
  return Boolean(
    env.supabaseUrl &&
      env.supabaseAnonKey &&
      env.agentEmail &&
      env.agentPassword &&
      env.printerSerial
  );
}

export type AuthStrategy =
  | { type: "password"; password: string }
  | { type: "refresh_token"; refreshToken: string };

export interface ResolvedRuntimeConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  agentEmail: string;
  printerIp: string;
  printerSerial: string;
  printerAccessCode: string;
  auth: AuthStrategy;
}

export type MissingField = "agentEmail" | "agentAuth" | "printerSerial" | "printerAccessCode";

export interface KnownState {
  env: EnvOverrides;
  nonSecret: NonSecretAgentConfig;
  secrets: AgentSecrets;
}

// Pura: dado o que já se sabe (env + config salva + segredos carregados),
// diz o que ainda falta perguntar. Não decide COMO perguntar.
export function computeMissingFields(state: KnownState): MissingField[] {
  const missing: MissingField[] = [];

  const email = state.env.agentEmail || state.nonSecret.agentEmail;
  if (!email) missing.push("agentEmail");

  const hasPassword = Boolean(state.env.agentPassword);
  const hasRefreshToken = Boolean(state.secrets.supabaseRefreshToken);
  if (!hasPassword && !hasRefreshToken) missing.push("agentAuth");

  const serial = state.env.printerSerial || state.nonSecret.printerSerial;
  if (!serial) missing.push("printerSerial");

  const accessCode = state.env.printerAccessCode || state.secrets.printerAccessCode;
  if (!accessCode) missing.push("printerAccessCode");

  return missing;
}

export interface OnboardingPrompts {
  notify(message: string): void;
  askEmail(): Promise<string>;
  askPassword(): Promise<string>;
  askPrinterSerial(): Promise<string>;
  askPrinterAccessCode(): Promise<string>;
  // Chamado quando não há terminal interativo e falta configuração --
  // implementação decide como reportar (log + process.exit, por ex.).
  onCannotPrompt(missing: MissingField[]): never;
}

export interface DiscoveryPort {
  // Mesma assinatura de discoverPrinter em printerDiscovery.ts --
  // parametrizado aqui só pra permitir injeção de um fake nos testes,
  // sem reimplementar nada da lógica SSDP real.
  discoverPrinter(serialHint: string, timeoutMs?: number): Promise<{ ip: string; serial: string }>;
}

export const realDiscoveryPort: DiscoveryPort = { discoverPrinter };

export interface ResolveOptions {
  env?: NodeJS.ProcessEnv;
  isTTY?: boolean;
  discovery?: DiscoveryPort;
  // Timeout menor é usado nos testes; produção usa o default do módulo
  // de descoberta (12s), mesmo valor já homologado em index.ts.
  discoveryTimeoutMs?: number;
}

export async function resolveAgentRuntimeConfig(
  secretStore: SecretStore,
  prompts: OnboardingPrompts,
  options: ResolveOptions = {}
): Promise<ResolvedRuntimeConfig> {
  const env = readEnvOverrides(options.env ?? process.env);
  const discovery = options.discovery ?? realDiscoveryPort;

  const supabaseUrl = env.supabaseUrl || DEFAULT_SUPABASE_URL;
  const supabaseAnonKey = env.supabaseAnonKey || DEFAULT_SUPABASE_ANON_KEY;

  // Caminho 100% preservado: .env completo (as 5 variáveis de sempre)
  // continua funcionando exatamente como antes, sem tocar em
  // configStore/secretStore, sem tentar descoberta de serial.
  if (hasCompleteEnvConfig(env)) {
    return {
      supabaseUrl,
      supabaseAnonKey,
      agentEmail: env.agentEmail,
      printerIp: env.printerIp,
      printerSerial: env.printerSerial,
      printerAccessCode: env.printerAccessCode,
      auth: { type: "password", password: env.agentPassword },
    };
  }

  const nonSecret = loadNonSecretConfig() ?? {
    formatVersion: 1,
    agentEmail: "",
    printerSerial: "",
    lastKnownPrinterIp: "",
    onboardingCompletedAt: null,
    updatedAt: "",
  };
  const secrets = await secretStore.load();

  let printerSerial = env.printerSerial || nonSecret.printerSerial;
  let discoveredIp = "";

  // Só tenta descoberta automática se o serial ainda não é conhecido --
  // é justamente o caso em que ela é mais útil (primeira execução).
  // Reutiliza o mesmo listener SSDP que index.ts usa em produção; não
  // reimplementa nada.
  if (!printerSerial) {
    prompts.notify(
      "🔍 Procurando impressora Bambu Lab na rede para detectar o número de série automaticamente..."
    );

    try {
      const found = await discovery.discoverPrinter("", options.discoveryTimeoutMs);

      if (found.serial) {
        printerSerial = found.serial;
        discoveredIp = found.ip;
        prompts.notify(`✅ Impressora encontrada automaticamente (serial ${printerSerial}).`);
      } else if (found.ip) {
        // Impressora respondeu ao SSDP mas sem campo USN reconhecível --
        // limitação documentada (docs/11_AGENT_ONBOARDING_V2.md), não é
        // um caso que a arquitetura atual resolve às cegas.
        discoveredIp = found.ip;
        prompts.notify(
          "⚠️ Impressora respondeu na rede, mas não foi possível confirmar o número de série automaticamente."
        );
      } else {
        prompts.notify(
          "⚠️ Não foi possível localizar a impressora automaticamente (rede pode bloquear SSDP/multicast)."
        );
      }
    } catch (error: any) {
      prompts.notify(
        `⚠️ Falha ao tentar descoberta automática: ${error?.message ?? error}`
      );
    }
  }

  const state: KnownState = {
    env,
    nonSecret: { ...nonSecret, printerSerial },
    secrets,
  };

  const missing = computeMissingFields(state);
  const isTTY = options.isTTY ?? Boolean(process.stdin.isTTY);

  if (missing.length > 0 && !isTTY) {
    prompts.onCannotPrompt(missing);
  }

  let agentEmail = env.agentEmail || nonSecret.agentEmail;
  if (missing.includes("agentEmail")) {
    agentEmail = await prompts.askEmail();
  }

  let password = env.agentPassword;
  const hasRefreshToken = Boolean(secrets.supabaseRefreshToken);
  if (missing.includes("agentAuth") && !hasRefreshToken) {
    password = await prompts.askPassword();
  }

  if (missing.includes("printerSerial")) {
    printerSerial = await prompts.askPrinterSerial();
  }

  let printerAccessCode = env.printerAccessCode || secrets.printerAccessCode || "";
  if (missing.includes("printerAccessCode")) {
    printerAccessCode = await prompts.askPrinterAccessCode();
  }

  mergeNonSecretConfig({
    agentEmail,
    printerSerial,
    lastKnownPrinterIp: discoveredIp || nonSecret.lastKnownPrinterIp,
    onboardingCompletedAt: nonSecret.onboardingCompletedAt ?? new Date().toISOString(),
  });

  if (secretStore.persists) {
    await secretStore.save({
      supabaseRefreshToken: secrets.supabaseRefreshToken,
      printerAccessCode,
    });
  } else {
    prompts.notify(
      "⚠️ Este Access Code não será lembrado na próxima inicialização (armazenamento seguro de segredos ainda não implementado -- ver docs/11_AGENT_ONBOARDING_V2.md). Use .env para persistência em desenvolvimento."
    );
  }

  const auth: AuthStrategy = hasRefreshToken
    ? { type: "refresh_token", refreshToken: secrets.supabaseRefreshToken as string }
    : { type: "password", password: password || "" };

  return {
    supabaseUrl,
    supabaseAnonKey,
    agentEmail,
    printerIp: env.printerIp || discoveredIp,
    printerSerial,
    printerAccessCode,
    auth,
  };
}

// Chamada por index.ts depois de um login/refresh bem-sucedido, pra
// atualizar o refresh token guardado (o token muda a cada refresh). Se o
// SecretStore ativo não persiste (ver secretStore.ts), é um no-op --
// o aviso já foi mostrado durante o onboarding.
export async function persistSessionSecrets(
  secretStore: SecretStore,
  refreshToken: string | null,
  printerAccessCode: string
): Promise<void> {
  if (!secretStore.persists) return;

  await secretStore.save({
    supabaseRefreshToken: refreshToken,
    printerAccessCode,
  });
}
