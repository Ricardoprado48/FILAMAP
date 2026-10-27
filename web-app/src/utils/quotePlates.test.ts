import { describe, expect, it } from "vitest";
import { checkStock, formatDuration, hoursFromSeconds, loadStoredPlates, matchSpoolForFilament, printsOf, storablePlates, summarizeQuote, type QuotePlate } from "./quotePlates";

describe("checkStock", () => {
  const need = (color: string, grams: number) => ({ key: color, type: "PLA", color, grams });

  it("soma todos os carretéis da mesma cor e material; folga de 35 g ou mais = tem", () => {
    const spools = [
      { id: "p1", material: "PLA", color_hex: "#000000", current_weight: 300 },
      { id: "p2", material: "PLA Velvet", color_hex: "#000000ff", current_weight: 810 },
      { id: "p-petg", material: "PETG", color_hex: "#000000", current_weight: 900 },
      { id: "p-arq", material: "PLA", color_hex: "#000000", current_weight: 900, archived_at: "2026-10-01" },
    ];
    const [l] = checkStock([need("#000000", 946.5)], spools);
    expect(l).toMatchObject({ haveG: 1110, spoolIds: ["p1", "p2"], status: "ok", diffG: 163.5 });
  });

  it("sobra menos de 35 g = repesar; falta = comprar com quanto falta", () => {
    const spools = [
      { id: "v", material: "PLA", color_hex: "#F72323", current_weight: 250 },
      { id: "b", material: "PLA", color_hex: "#FFFFFF", current_weight: 5 },
    ];
    const [vermelho, branco, azul] = checkStock([need("#F72323", 223.8), need("#FFFFFF", 15), need("#0000FF", 10)], spools);
    expect(vermelho).toMatchObject({ status: "tight", diffG: 26.2 });
    expect(branco).toMatchObject({ status: "buy", diffG: 10 });
    expect(azul).toMatchObject({ status: "buy", haveG: 0, diffG: 10, spoolIds: [] });
  });
});

const plate = (over: Partial<QuotePlate>): QuotePlate => ({
  id: "p",
  name: "placa",
  seconds: 3600,
  filaments: [],
  prints: 1,
  notes: "",
  ...over,
});

const PRETO = { id: 1, type: "PLA", color: "#000000", grams: 0, trayInfoIdx: "Pef7a165" };
const VERMELHO = { id: 2, type: "PLA", color: "#F72323", grams: 0, trayInfoIdx: "P790d873" };

describe("summarizeQuote", () => {
  it("soma cada placa × vezes: tempo total e gramas de cada cor (troféu: base 3×, corpo 6×, plaquinha 3×)", () => {
    const s = summarizeQuote([
      plate({ id: "base", seconds: 5 * 3600 + 42 * 60, prints: 3, filaments: [{ ...PRETO, grams: 155.5 }] }),
      plate({ id: "corpo", seconds: 4 * 3600 + 13 * 60, prints: 6, filaments: [{ ...PRETO, grams: 80 }, { ...VERMELHO, grams: 21.9 }] }),
      plate({ id: "plaquinha", seconds: 79 * 60, prints: 3, filaments: [{ ...VERMELHO, grams: 30.8 }] }),
    ]);
    expect(s.prints).toBe(12);
    expect(s.seconds).toBe(46 * 3600 + 21 * 60);
    expect(s.filaments).toEqual([
      { key: "Pef7a165|PLA|#000000", type: "PLA", color: "#000000", trayInfoIdx: "Pef7a165", grams: 946.5 },
      { key: "P790d873|PLA|#F72323", type: "PLA", color: "#F72323", trayInfoIdx: "P790d873", grams: 223.8 },
    ]);
    expect(s.grams).toBe(1170.3);
  });

  it("vezes vazias ou zeradas contam como 1", () => {
    expect(summarizeQuote([plate({ prints: 0, filaments: [{ ...PRETO, grams: 10 }] })]).grams).toBe(10);
    expect(printsOf({})).toBe(1);
  });

  it("sem placas, tudo zero", () => {
    expect(summarizeQuote([])).toEqual({ prints: 0, seconds: 0, grams: 0, filaments: [] });
  });

  it("placas salvas antes (campo units) voltam com o mesmo número em vezes", () => {
    const [old] = loadStoredPlates([{ id: "a", name: "x", seconds: 60, filaments: [], notes: "", units: 6 }]);
    expect(old.prints).toBe(6);
    expect(old).not.toHaveProperty("units");
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
