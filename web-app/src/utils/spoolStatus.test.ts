import { describe, it, expect } from "vitest";
import type { Spool } from "../types";
import {
  needsWeighing,
  getSpoolOrigin,
  formatBambuLocation,
  sortSpoolsForSpoolScreen,
  buildWeighUpdate,
  suggestInitialWeightFromBambu,
  findConflictingSpool,
  buildNfcLinkUpdate,
} from "./spoolStatus";

function makeSpool(overrides: Partial<Spool> = {}): Spool {
  return {
    id: "spool-1",
    nfc_uid: "",
    brand: "Voolt3D",
    material: "PLA",
    color_name: "Vermelho",
    color_hex: "#F72323",
    current_weight: 1000,
    ...overrides,
  };
}

describe("needsWeighing", () => {
  it("é true para carretel vindo da Bambu sem peso confirmado", () => {
    const spool = makeSpool({ bambu_spool_id: "15582983", weight_confirmed_at: null });
    expect(needsWeighing(spool)).toBe(true);
  });

  it("é false para carretel vindo da Bambu já pesado pelo usuário", () => {
    const spool = makeSpool({
      bambu_spool_id: "15582983",
      weight_confirmed_at: "2026-09-22T22:41:30.762Z",
    });
    expect(needsWeighing(spool)).toBe(false);
  });

  it("é false para carretel manual (sem origem Bambu)", () => {
    const spool = makeSpool({ bambu_spool_id: null, weight_confirmed_at: null });
    expect(needsWeighing(spool)).toBe(false);
  });
});

describe("getSpoolOrigin", () => {
  it("identifica origem bambu_cloud quando bambu_spool_id existe", () => {
    expect(getSpoolOrigin(makeSpool({ bambu_spool_id: "15582983" }))).toBe("bambu_cloud");
  });

  it("identifica origem manual quando bambu_spool_id é nulo", () => {
    expect(getSpoolOrigin(makeSpool({ bambu_spool_id: null }))).toBe("manual");
  });
});

describe("formatBambuLocation", () => {
  it("formata AMS/slot 1-based a partir dos valores 0-based reais da Bambu (spool 15582983: AMS 0/slot 2)", () => {
    const spool = makeSpool({
      bambu_in_printer: true,
      bambu_device_name: "Prado_3D_001",
      bambu_ams_id: "0",
      bambu_slot_id: "2",
    });
    expect(formatBambuLocation(spool)).toBe("Prado_3D_001 • AMS 1 • Slot 3");
  });

  it("formata slot 1 a partir do valor real 0-based do spool 15589421 (slot_id=1)", () => {
    const spool = makeSpool({
      bambu_in_printer: true,
      bambu_device_name: "Prado_3D_001",
      bambu_ams_id: "0",
      bambu_slot_id: "1",
    });
    expect(formatBambuLocation(spool)).toBe("Prado_3D_001 • AMS 1 • Slot 2");
  });

  it("retorna null quando o carretel não está na impressora", () => {
    const spool = makeSpool({ bambu_in_printer: false, bambu_ams_id: "0", bambu_slot_id: "2" });
    expect(formatBambuLocation(spool)).toBeNull();
  });

  it("retorna null para carretel manual (nunca esteve na Bambu)", () => {
    expect(formatBambuLocation(makeSpool())).toBeNull();
  });

  it("cai para o nome do device quando AMS/slot não vieram no registro", () => {
    const spool = makeSpool({ bambu_in_printer: true, bambu_device_name: "Prado_3D_001" });
    expect(formatBambuLocation(spool)).toBe("Prado_3D_001");
  });
});

describe("sortSpoolsForSpoolScreen", () => {
  it("prioriza spools com bambu_in_printer=true no topo", () => {
    const a = makeSpool({ id: "a", color_name: "Azul", bambu_in_printer: false });
    const b = makeSpool({ id: "b", color_name: "Verde", bambu_in_printer: true });
    const c = makeSpool({ id: "c", color_name: "Amarelo", bambu_in_printer: null });

    const sorted = sortSpoolsForSpoolScreen([a, b, c]);

    expect(sorted[0].id).toBe("b");
    expect(sorted.map((s) => s.id)).toEqual(["b", "c", "a"]);
  });

  it("ordena o restante alfabeticamente por cor quando bambu_in_printer é igual", () => {
    const a = makeSpool({ id: "a", color_name: "Zebra" });
    const b = makeSpool({ id: "b", color_name: "Azul" });
    const sorted = sortSpoolsForSpoolScreen([a, b]);
    expect(sorted.map((s) => s.id)).toEqual(["b", "a"]);
  });

  it("não muta o array original", () => {
    const original = [makeSpool({ id: "a", color_name: "Zebra" })];
    const sorted = sortSpoolsForSpoolScreen(original);
    expect(sorted).not.toBe(original);
  });
});

describe("buildWeighUpdate", () => {
  it("calcula peso líquido (bruto - tara) e marca weight_confirmed_at", () => {
    const now = "2026-09-22T23:00:00.000Z";
    const payload = buildWeighUpdate({ grossWeight: "1200", tareWeight: "200" }, now);
    expect(payload).toEqual({
      current_weight: 1000,
      spool_tare_weight: 200,
      weight_confirmed_at: now,
    });
  });

  it("nunca deixa o peso líquido negativo", () => {
    const payload = buildWeighUpdate({ grossWeight: "50", tareWeight: "200" });
    expect(payload.current_weight).toBe(0);
  });

  it("inclui initial_weight apenas quando informado e válido", () => {
    const payload = buildWeighUpdate({ grossWeight: "1200", tareWeight: "200", initialWeight: "1000" });
    expect(payload.initial_weight).toBe(1000);
  });

  it("ignora initial_weight vazio ou inválido", () => {
    const payload = buildWeighUpdate({ grossWeight: "1200", tareWeight: "200", initialWeight: "" });
    expect(payload.initial_weight).toBeUndefined();

    const invalid = buildWeighUpdate({ grossWeight: "1200", tareWeight: "200", initialWeight: "abc" });
    expect(invalid.initial_weight).toBeUndefined();
  });

  it("nunca inclui nenhum campo bambu_* no payload", () => {
    const payload = buildWeighUpdate({ grossWeight: "1200", tareWeight: "200", initialWeight: "1000" });
    const bambuKeys = Object.keys(payload).filter((k) => k.startsWith("bambu_"));
    expect(bambuKeys).toEqual([]);
  });
});

describe("suggestInitialWeightFromBambu", () => {
  it("lê o netWeight nominal de bambu_source_metadata quando presente", () => {
    const spool = makeSpool({ bambu_source_metadata: { net_weight: 1000 } } as any);
    expect(suggestInitialWeightFromBambu(spool)).toBe(1000);
  });

  it("retorna null quando não há netWeight", () => {
    expect(suggestInitialWeightFromBambu(makeSpool())).toBeNull();
  });
});

describe("findConflictingSpool", () => {
  it("encontra outro spool já vinculado à mesma tag", () => {
    const spools = [
      makeSpool({ id: "a", nfc_uid: "TAG-1" }),
      makeSpool({ id: "b", nfc_uid: "TAG-2" }),
    ];
    const conflict = findConflictingSpool(spools, "TAG-1", "b");
    expect(conflict?.id).toBe("a");
  });

  it("não considera o próprio spool como conflito", () => {
    const spools = [makeSpool({ id: "a", nfc_uid: "TAG-1" })];
    expect(findConflictingSpool(spools, "TAG-1", "a")).toBeNull();
  });

  it("retorna null quando nenhum outro spool usa a tag", () => {
    const spools = [makeSpool({ id: "a", nfc_uid: "TAG-1" })];
    expect(findConflictingSpool(spools, "TAG-9", "a")).toBeNull();
  });
});

describe("buildNfcLinkUpdate", () => {
  it("gera um payload contendo apenas nfc_uid", () => {
    expect(buildNfcLinkUpdate("TAG-1")).toEqual({ nfc_uid: "TAG-1" });
  });
});
