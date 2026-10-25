import { describe, expect, it } from "vitest";
import { formatDuration, hoursFromSeconds, matchSpoolForFilament, storablePlates, summarizeQuote, type QuotePlate } from "./quotePlates";

const plate = (over: Partial<QuotePlate>): QuotePlate => ({
  id: "p",
  name: "placa",
  seconds: 3600,
  filaments: [],
  units: 1,
  notes: "",
  ...over,
});

const PRETO = { id: 1, type: "PLA", color: "#000000", grams: 0, trayInfoIdx: "Pef7a165" };
const VERMELHO = { id: 2, type: "PLA", color: "#F72323", grams: 0, trayInfoIdx: "P790d873" };

describe("summarizeQuote", () => {
  it("divide cada placa pelas unidades que ela atende e soma por cor", () => {
    const s = summarizeQuote([
      // 4 corpos de caneca numa placa
      plate({ seconds: 4 * 3600, units: 4, filaments: [{ ...PRETO, grams: 160 }, { ...VERMELHO, grams: 40 }] }),
      // tampas de 6 produtos numa placa
      plate({ seconds: 1800, units: 6, filaments: [{ ...PRETO, grams: 30 }] }),
    ]);
    expect(s.secondsPerUnit).toBe(3600 + 300);
    expect(s.filaments).toEqual([
      { key: "Pef7a165|PLA|#000000", type: "PLA", color: "#000000", trayInfoIdx: "Pef7a165", gramsPerUnit: 45 },
      { key: "P790d873|PLA|#F72323", type: "PLA", color: "#F72323", trayInfoIdx: "P790d873", gramsPerUnit: 10 },
    ]);
    expect(s.gramsPerUnit).toBe(55);
  });

  it("placa original com todas as peças (atende 1) = custo de uma unidade", () => {
    const s = summarizeQuote([plate({ seconds: 2256, units: 1, filaments: [{ ...PRETO, grams: 3.61 }] })]);
    expect(s).toEqual({ secondsPerUnit: 2256, gramsPerUnit: 3.61, filaments: [expect.objectContaining({ gramsPerUnit: 3.61 })] });
  });

  it("unidades zeradas ou vazias contam como 1 (não divide por zero)", () => {
    expect(summarizeQuote([plate({ units: 0, filaments: [{ ...PRETO, grams: 10 }] })]).gramsPerUnit).toBe(10);
  });

  it("sem placas, tudo zero", () => {
    expect(summarizeQuote([])).toEqual({ secondsPerUnit: 0, gramsPerUnit: 0, filaments: [] });
  });
});

describe("matchSpoolForFilament", () => {
  const profiles = [{ source_key: "Pef7a165", filament_product_id: "prod-preto" }];

  it("acha o carretel pelo perfil do Bambu Studio -> produto, preferindo o que tem preço", () => {
    const spools = [
      { id: "preto-sem-preco", filament_product_id: "prod-preto", current_weight: 900 },
      { id: "preto-com-preco", filament_product_id: "prod-preto", price_paid: 95, current_weight: 300 },
      { id: "preto-arquivado", filament_product_id: "prod-preto", price_paid: 80, archived_at: "2026-10-16" },
    ];
    expect(matchSpoolForFilament(PRETO, spools, profiles)).toBe("preto-com-preco");
  });

  it("sem perfil, usa material + cor", () => {
    const spools = [
      { id: "verm-petg", material: "PETG", color_hex: "#F72323", price_paid: 90 },
      { id: "verm-pla", material: "PLA", color_hex: "#f72323", price_paid: 85 },
    ];
    expect(matchSpoolForFilament(VERMELHO, spools, [])).toBe("verm-pla");
  });

  it("nenhum parecido: vazio (fica o preço manual)", () => {
    expect(matchSpoolForFilament(VERMELHO, [{ id: "azul", material: "PLA", color_hex: "#0000FF" }], [])).toBe("");
  });
});

describe("formatação e armazenamento", () => {
  it("horas para a calculadora e duração legível", () => {
    expect(hoursFromSeconds(2256)).toBe("0.63");
    expect(formatDuration(2256)).toBe("38 min");
    expect(formatDuration(3 * 3600 + 20 * 60)).toBe("3h20");
  });

  it("miniatura não vai para o banco", () => {
    expect(storablePlates([plate({ thumbnail: "data:image/png;base64,AAA" })])[0]).not.toHaveProperty("thumbnail");
  });
});
