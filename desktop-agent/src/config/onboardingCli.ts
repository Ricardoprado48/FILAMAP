import { stdin, stdout } from "node:process";
import { createInterface, Interface } from "node:readline/promises";
import type { MissingField, OnboardingPrompts } from "./onboarding";

// Implementação de terminal do OnboardingPrompts -- é a "UI" de hoje,
// trocável mais tarde por uma tela gráfica de configuração sem tocar em
// onboarding.ts (que não sabe nada sobre readline/stdin).
//
// Provisória por natureza: só existe porque ainda não há instalador
// gráfico (ver docs/11_AGENT_ONBOARDING_V2.md). Continua útil mesmo
// depois de uma UI gráfica existir, para desenvolvimento/depuração.

const MISSING_FIELD_LABEL: Record<MissingField, string> = {
  agentEmail: "e-mail da conta Filamap",
  agentAuth: "senha da conta Filamap (ou sessão salva)",
  printerSerial: "número de série da impressora",
  printerAccessCode: "Access Code da impressora",
};

let sharedInterface: Interface | null = null;

function getInterface(): Interface {
  if (!sharedInterface) {
    sharedInterface = createInterface({ input: stdin, output: stdout });
  }
  return sharedInterface;
}

// Fecha o readline aberto por createCliPrompts(), se algum prompt chegou
// a ser feito. index.ts chama isso logo depois de
// resolveAgentRuntimeConfig() terminar, independente de ter perguntado
// algo ou não -- sem isso, um readline aberto mantém stdin em modo que
// pode interferir com o resto do processo.
export function closeCliPrompts(): void {
  if (sharedInterface) {
    sharedInterface.close();
    sharedInterface = null;
  }
}

export function createCliPrompts(): OnboardingPrompts {
  async function ask(question: string): Promise<string> {
    const answer = await getInterface().question(question);
    return answer.trim();
  }

  async function askHidden(question: string): Promise<string> {
    // readline/promises não tem modo "senha" nativo; mascarar o eco de
    // stdin exigiria mexer em stdin.setRawMode (só existe quando isTTY é
    // true, o que já é garantido aqui) -- fora de escopo pro CLI
    // provisório de dev. Documentado como limitação conhecida, não como
    // solução final (ver docs/11_AGENT_ONBOARDING_V2.md).
    return ask(question);
  }

  return {
    notify(message: string) {
      console.log(message);
    },

    async askEmail() {
      return ask("E-mail da sua conta Filamap: ");
    },

    async askPassword() {
      return askHidden("Senha da sua conta Filamap (não fica salva em disco): ");
    },

    async askPrinterSerial() {
      console.log(
        "Não foi possível detectar o número de série da impressora automaticamente."
      );
      return ask("Número de série da impressora (etiqueta na Bambu Lab A1): ");
    },

    async askPrinterAccessCode() {
      return askHidden(
        "Access Code da impressora (tela da impressora > Configurações > Rede): "
      );
    },

    onCannotPrompt(missing: MissingField[]): never {
      const labels = missing.map((field) => MISSING_FIELD_LABEL[field]).join(", ");
      console.error(
        `❌ Configuração incompleta e o Agent está rodando sem terminal interativo (ex.: auto-start do Windows). ` +
          `Campos faltando: ${labels}. Rode o Agent manualmente uma vez, com um terminal visível, para completar o assistente de configuração.`
      );
      process.exit(1);
    },
  };
}
