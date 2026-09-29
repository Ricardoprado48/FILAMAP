// "Primeiros passos": o que falta para o Filamap começar a descontar sozinho.
// Cada passo se marca a partir dos dados que a Web já carrega.

export type FirstStepId = "agent" | "printer" | "spools" | "slots" | "print";

export interface FirstStepsInput {
  agentOnline: boolean;
  hasPrinter: boolean;
  spoolCount: number;
  inboxCount: number;
  slotsWithSpool: number;
  printCount: number;
}

export interface FirstStep {
  id: FirstStepId;
  title: string;
  done: boolean;
  hint: string;
}

export function computeFirstSteps(i: FirstStepsInput): FirstStep[] {
  return [
    {
      id: "agent",
      title: "Instalar o Filamap Agent e conectar este computador",
      done: i.agentOnline || i.hasPrinter,
      hint: "Toque em Computadores, baixe o Agent, instale e digite o código que aparece ali.",
    },
    {
      id: "printer",
      title: "Impressora encontrada",
      done: i.hasPrinter,
      hint: "O Agent acha a impressora sozinho na rede. Você só digita o Access Code dela.",
    },
    {
      id: "spools",
      title: "Cadastrar os carretéis",
      done: i.spoolCount > 0,
      hint:
        i.inboxCount > 0
          ? `Há ${i.inboxCount} carretel(is) da sua conta Bambu na caixa de entrada: toque nela para aceitar.`
          : "Toque em Novo Carretel e informe marca, material, cor, peso e preço.",
    },
    {
      id: "slots",
      title: "Dizer qual carretel está em cada slot do AMS",
      done: i.slotsWithSpool > 0,
      hint: "Em cada slot, toque em Escolher do estoque (ou aproxime a tag NFC pelo celular).",
    },
    {
      id: "print",
      title: "Primeira impressão descontada",
      done: i.printCount > 0,
      hint: "Imprima uma peça pequena. Ao terminar, o peso do carretel baixa sozinho.",
    },
  ];
}

export function firstStepsComplete(steps: FirstStep[]): boolean {
  return steps.every((s) => s.done);
}

export function wantsComputersPanel(search: string): boolean {
  return new URLSearchParams(search).get("computadores") === "1";
}
