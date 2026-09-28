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
  validateSpotAssignment,
  buildLocationUpdate,
  buildUnlinkNfcUpdate,
  parseProfileToSpoolForm,
} from "./spoolStatus";
import type { UserFilamentProfile } from "../types";

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

describe("validateSpotAssignment", () => {
  it("retorna isOccupied: false para spot vazio, nulo ou indefinido", () => {
    const spools = [makeSpool({ id: "s1", location: "Prateleira A1" })];
    expect(validateSpotAssignment(spools, null, "")).toEqual({ isOccupied: false });
    expect(validateSpotAssignment(spools, null, "   ")).toEqual({ isOccupied: false });
    expect(validateSpotAssignment(spools, null, null)).toEqual({ isOccupied: false });
    expect(validateSpotAssignment(spools, null, undefined)).toEqual({ isOccupied: false });
  });

  it("retorna isOccupied: false quando o spot está livre", () => {
    const spools = [makeSpool({ id: "s1", location: "Prateleira A1" })];
    expect(validateSpotAssignment(spools, null, "Prateleira A2")).toEqual({ isOccupied: false });
  });

  it("retorna isOccupied: true e o spool ocupante quando outro carretel já usa o spot (case-insensitive)", () => {
    const s1 = makeSpool({ id: "s1", location: "Prateleira A1", color_name: "Preto" });
    const spools = [s1];
    const res = validateSpotAssignment(spools, null, "prateleira a1");
    expect(res.isOccupied).toBe(true);
    expect(res.occupyingSpool?.id).toBe("s1");
  });

  it("não considera conflito se o carretel que já ocupa o spot for o próprio sendo editado", () => {
    const s1 = makeSpool({ id: "s1", location: "Prateleira A1" });
    const spools = [s1];
    expect(validateSpotAssignment(spools, "s1", "Prateleira A1")).toEqual({ isOccupied: false });
  });
});

describe("buildLocationUpdate", () => {
  it("retorna o spot com trim quando preenchido", () => {
    expect(buildLocationUpdate("  Gaveta 2  ")).toEqual({ location: "Gaveta 2" });
  });

  it("retorna null para string vazia, whitespace ou null", () => {
    expect(buildLocationUpdate("")).toEqual({ location: null });
    expect(buildLocationUpdate("   ")).toEqual({ location: null });
    expect(buildLocationUpdate(null)).toEqual({ location: null });
    expect(buildLocationUpdate(undefined)).toEqual({ location: null });
  });
});

describe("buildUnlinkNfcUpdate", () => {
  it("define nfc_uid e nfc_written_at como null preservando todo o resto", () => {
    const payload = buildUnlinkNfcUpdate();
    expect(payload).toEqual({
      nfc_uid: null,
      nfc_written_at: null,
    });
    // Garante que não inclui peso, localização nem campos bambu
    const keys = Object.keys(payload);
    expect(keys).not.toContain("current_weight");
    expect(keys).not.toContain("location");
    expect(keys).not.toContain("bambu_spool_id");
  });
});

describe("parseProfileToSpoolForm", () => {
  it("extrai dados de formulário a partir de um UserFilamentProfile", () => {
    const profile: UserFilamentProfile = {
      id: "prof-1",
      user_id: "user-1",
      source: "bambu_studio",
      source_key: "P6337f36",
      source_profile_name: "My Custom PLA",
      display_name: "PLA BRANCO ULTRA SILK VIDA BUENAS",
      material: "PLA",
      brand: "VIDA BUENAS",
      source_metadata: {
        filament_vendor: "VIDA BUENAS",
        default_filament_colour: "#F5F5F5",
        filament_density: "1.24",
      },
    };

    const form = parseProfileToSpoolForm(profile);
    expect(form).toEqual({
      brand: "VIDA BUENAS",
      material: "PLA",
      color_name: "PLA BRANCO ULTRA SILK VIDA BUENAS",
      color_hex: "#F5F5F5",
      density: 1.24,
      filament_profile_id: "P6337f36",
      suggestedTare: 200,
    });
  });

  it("trata defaults com robustez quando metadata é parcial", () => {
    const profile: UserFilamentProfile = {
      id: "prof-2",
      user_id: "user-1",
      source: "bambu_studio",
      source_key: "P12345",
      source_profile_name: "Generic PLA",
      display_name: "Generic PLA",
      material: "PETG",
      source_metadata: {},
    };

    const form = parseProfileToSpoolForm(profile);
    expect(form.brand).toBe("Genérico");
    expect(form.material).toBe("PETG");
    expect(form.color_name).toBe("Generic PLA");
    expect(form.color_hex).toBe("#FFFFFF");
    expect(form.density).toBeUndefined();
    expect(form.filament_profile_id).toBe("P12345");
  });
});

