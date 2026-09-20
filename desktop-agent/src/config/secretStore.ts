// Abstração de armazenamento de SEGREDOS (senha nunca entra aqui -- é
// usada uma vez para autenticar e descartada; o que persiste é o refresh
// token da sessão Supabase e o Access Code da impressora).
//
// Por quê isso é um módulo separado de configStore.ts: configStore.ts
// grava um JSON simples em disco, sem proteção nenhuma além de estar
// numa pasta de usuário -- ótimo pra dados não sensíveis (e-mail, serial,
// último IP), errado pra segredos. A implementação "de verdade" de um
// cofre de segredos no Windows depende de uma escolha de arquitetura
// (Windows Credential Manager via DPAPI, `keytar`, ou outra lib nativa)
// que muda o pipeline de build/empacotamento do `pkg` -- e essa escolha
// não foi pedida explicitamente, então NÃO foi feita aqui (ver
// docs/11_AGENT_ONBOARDING_V2.md). Esta interface existe pra que, quando
// a decisão for tomada, só seja preciso escrever uma nova classe que
// implemente SecretStore -- nada em onboarding.ts ou index.ts muda.

export interface AgentSecrets {
  supabaseRefreshToken: string | null;
  printerAccessCode: string | null;
}

export const EMPTY_SECRETS: AgentSecrets = {
  supabaseRefreshToken: null,
  printerAccessCode: null,
};

export interface SecretStore {
  readonly kind: string;
  // true = o que for salvo aqui volta a estar disponível na próxima
  // execução do processo. false = os segredos só valem para a sessão
  // atual (processo atual) e precisarão ser fornecidos de novo depois.
  readonly persists: boolean;
  load(): Promise<AgentSecrets>;
  save(secrets: AgentSecrets): Promise<void>;
  clear(): Promise<void>;
}

// Dev/CI: lê PRINTER_ACCESS_CODE e (opcionalmente) SUPABASE_REFRESH_TOKEN
// direto do .env/ambiente -- mesma fonte que o Agent já usava antes desta
// mudança. save()/clear() são no-op deliberados: quem usa .env edita o
// arquivo manualmente, o Agent nunca escreve segredo em disco nesse modo.
// `persists = true` porque o .env em si persiste entre execuções (só não
// é este código quem escreve nele).
export class EnvSecretStore implements SecretStore {
  readonly kind = "env";
  readonly persists = true;

  async load(): Promise<AgentSecrets> {
    return {
      supabaseRefreshToken: (process.env.SUPABASE_REFRESH_TOKEN || "").trim() || null,
      printerAccessCode: (process.env.PRINTER_ACCESS_CODE || "").trim() || null,
    };
  }

  async save(_secrets: AgentSecrets): Promise<void> {}

  async clear(): Promise<void> {}
}

// Placeholder explícito para quando a decisão de cofre comercial for
// tomada (Credential Manager/DPAPI no Windows, Keychain no macOS,
// libsecret no Linux, ou uma lib cross-platform como `keytar`). Enquanto
// isso não acontece, o Agent funciona sem persistir segredo nenhum: em
// cada execução sem .env e sem TTY, ele falha com uma mensagem clara em
// vez de travar esperando input que nunca chega (mesmo padrão já usado
// pra config incompleta). `persists = false` sinaliza isso pra quem
// orquestra o onboarding.
export class UnavailableSecretStore implements SecretStore {
  readonly kind = "unavailable";
  readonly persists = false;

  async load(): Promise<AgentSecrets> {
    return EMPTY_SECRETS;
  }

  async save(_secrets: AgentSecrets): Promise<void> {}

  async clear(): Promise<void> {}
}

// PRINTER_ACCESS_CODE ou SUPABASE_REFRESH_TOKEN no ambiente é o sinal de
// que estamos em modo dev/CI (mesmo critério usado no resto do Agent:
// .env tem prioridade sobre tudo). Fora isso, cai no placeholder -- ainda
// não há cofre comercial implementado.
export function resolveSecretStore(): SecretStore {
  const hasEnvSecrets = Boolean(
    (process.env.PRINTER_ACCESS_CODE || "").trim() ||
      (process.env.SUPABASE_REFRESH_TOKEN || "").trim()
  );

  return hasEnvSecrets ? new EnvSecretStore() : new UnavailableSecretStore();
}
