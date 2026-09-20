import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { AgentConfig, missingRequiredFields, saveStoredConfig, getConfigPath } from "./store";

async function prompt(rl: readline.Interface, question: string): Promise<string> {
  // readline/promises não tem suporte nativo a mascarar o texto digitado;
  // mascarar de verdade exigiria reescrever a linha de output em modo raw,
  // frágil entre terminais Windows/PowerShell/cmd/exe empacotado. O
  // ambiente é o próprio computador do cliente rodando o Agent localmente
  // (não um terminal compartilhado), então o eco visível foi aceito como
  // custo do onboarding funcionar sem dependência nativa extra -- fica
  // registrado como possível melhoria futura, não bloqueante.
  return (await rl.question(question)).trim();
}

// Roda o cadastro interativo apenas quando falta algo que o onboarding
// comercial precisa coletar (ver missingRequiredFields). Se já está tudo
// configurado (arquivo salvo de uma execução anterior, ou .env de
// desenvolvimento), retorna a config recebida sem perguntar nada -- é o
// que permite o Agent iniciar sozinho, sem terminal, nas próximas vezes.
export async function runSetupWizardIfNeeded(config: AgentConfig): Promise<AgentConfig> {
  const missing = missingRequiredFields(config);
  if (missing.length === 0) return config;

  if (!stdin.isTTY) {
    console.error(
      "❌ Configuração incompleta e o Agent está rodando sem terminal interativo " +
      "(ex.: iniciado automaticamente pelo Windows). Rode o Agent manualmente uma " +
      "única vez (duplo-clique no filamap-agent.exe, ou \"npm start\" em modo dev) " +
      `para completar o cadastro inicial. Campos faltando: ${missing.join(", ")}.`
    );
    process.exit(1);
  }

  console.log("\n🧵 Bem-vindo ao Filamap Agent! Vamos configurar sua conta e impressora (só precisa fazer isso uma vez).\n");

  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    const updated: AgentConfig = { ...config };
    if (!updated.agentEmail) {
      updated.agentEmail = await prompt(rl, "E-mail da sua conta Filamap: ");
    }
    if (!updated.agentPassword) {
      updated.agentPassword = await prompt(rl, "Senha da sua conta Filamap: ");
    }
    if (!updated.printerSerial) {
      updated.printerSerial = await prompt(rl, "Número de série da impressora (Bambu Lab A1): ");
    }
    if (!updated.printerAccessCode) {
      updated.printerAccessCode = await prompt(rl, "Access Code da impressora (tela da impressora > Configurações > Rede): ");
    }

    saveStoredConfig(updated);
    console.log(`\n✅ Configuração salva em ${getConfigPath()}. Da próxima vez o Agent inicia sozinho, sem perguntar de novo.\n`);
    return updated;
  } finally {
    rl.close();
  }
}
