import { describe, expect, it } from "vitest";
import { computeFirstSteps, firstStepsComplete, wantsComputersPanel } from "./firstSteps";

const zero = { agentOnline: false, hasPrinter: false, spoolCount: 0, inboxCount: 0, slotsWithSpool: 0, printCount: 0 };

describe("computeFirstSteps", () => {
  it("conta nova: nada feito", () => {
    const steps = computeFirstSteps(zero);
    expect(steps.map((s) => s.done)).toEqual([false, false, false, false, false]);
    expect(firstStepsComplete(steps)).toBe(false);
  });

  it("impressora registrada implica Agent já conectado alguma vez", () => {
    const steps = computeFirstSteps({ ...zero, hasPrinter: true });
    expect(steps.find((s) => s.id === "agent")?.done).toBe(true);
    expect(steps.find((s) => s.id === "printer")?.done).toBe(true);
  });

  it("caixa de entrada com itens muda a dica dos carretéis", () => {
    const steps = computeFirstSteps({ ...zero, inboxCount: 3 });
    expect(steps.find((s) => s.id === "spools")?.hint).toMatch(/3 carretel/);
  });

  it("tudo feito", () => {
    const steps = computeFirstSteps({ agentOnline: true, hasPrinter: true, spoolCount: 5, inboxCount: 0, slotsWithSpool: 4, printCount: 1 });
    expect(firstStepsComplete(steps)).toBe(true);
  });
});

describe("wantsComputersPanel", () => {
  it("abre o painel pelo link do Agent", () => {
    expect(wantsComputersPanel("?computadores=1")).toBe(true);
    expect(wantsComputersPanel("?convite=AB")).toBe(false);
  });
});
