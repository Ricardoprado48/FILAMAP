import { describe, it, expect } from "vitest";
import type { FilamentProduct, Spool, SpoolInboxItem, UserFilamentProfile } from "../types";
import {
  resolveSpoolTitle,
  identityFromProduct,
  productFromProfile,
  profilesWithoutProduct,
  parseGrams,
  parseOptionalPrice,
  describeInboxItem,
} from "./products";
import { buildSlotPickerOptions } from "./slotPicker";
import { groupPrintLogsByJob } from "./history";

const spool = (over: Partial<Spool> = {}): Spool => ({
  id: "s1",
  nfc_uid: "",
  brand: "Voolt3D",
  material: "PLA",
  color_name: "Vermelho Ultra Silk",
  color_hex: "#F72323",
  current_weight: 500,
  ...over,
});

const product = (over: Partial<FilamentProduct> = {}): FilamentProduct => ({
  id: "p1",
  name: "+ PLA VERMELHO ULTRA SILK VIDAS BUENAS",
  brand: "Vidas Buenas",
  material: "PLA",
  color_name: "Vermelho Ultra Silk",
  color_hex: "#F72323",
  origin: "bambu_studio",
  ...over,
});

const profile = (over: Partial<UserFilamentProfile> = {}): UserFilamentProfile => ({
  id: "prof1",
  user_id: "u1",
  source: "bambu_studio",
  source_key: "P86318ba",
  source_profile_name: "x",
  display_name: "+ PLA VERMELHO ULTRA SILK VIDAS BUENAS",
  material: "PLA",
  brand: "BUENAS",
  is_listed: true,
  ...over,
});

describe("resolveSpoolTitle", () => {
  it("usa o nome do produto, mesmo com marca antiga errada no carretel", () => {
    expect(resolveSpoolTitle(spool(), product(), profile({ display_name: "outro" }))).toBe("+ PLA VERMELHO ULTRA SILK VIDAS BUENAS");
  });

  it("sem produto, cai no perfil do Bambu Studio e depois em MATERIAL COR MARCA", () => {
    expect(resolveSpoolTitle(spool(), null, profile({ display_name: "+ PLA PERFIL" }))).toBe("+ PLA PERFIL");
    expect(resolveSpoolTitle(spool(), null, null)).toBe("+ PLA VERMELHO ULTRA SILK VOOLT3D");
  });
});

describe("identityFromProduct", () => {
  it("copia marca/material/cor do produto e nunca inventa marca", () => {
    expect(identityFromProduct(product({ brand: null, color_name: null }), "#000000")).toEqual({
      brand: null,
      material: "PLA",
      color_name: "+ PLA VERMELHO ULTRA SILK VIDAS BUENAS",
      color_hex: "#000000",
    });
  });
});

describe("productFromProfile", () => {
  it("nome = nome do perfil no Bambu Studio; origem segue a fonte", () => {
    expect(productFromProfile(profile())).toMatchObject({ name: "+ PLA VERMELHO ULTRA SILK VIDAS BUENAS", origin: "bambu_studio", material: "PLA" });
    expect(productFromProfile(profile({ source: "bambu_official" })).origin).toBe("bambu_official");
  });
});

describe("profilesWithoutProduct", () => {
  it("só perfis do Studio listados, sem produto e sem produto de mesmo nome", () => {
    const list = [
      profile({ id: "a", display_name: "- PETG NOVO" }),
      profile({ id: "b", filament_product_id: "p9", display_name: "- PETG LIGADO" }),
      profile({ id: "c", is_listed: false, display_name: "- PETG ANTIGO" }),
      profile({ id: "d", source: "bambu_cloud", display_name: "PLA" }),
      profile({ id: "e", display_name: "+ pla vermelho ultra silk vidas buenas" }),
    ];
    expect(profilesWithoutProduct(list, [product()]).map((p) => p.id)).toEqual(["a"]);
  });
});

describe("parseGrams / parseOptionalPrice", () => {
  it("vazio ou inválido = null (sem valor padrão); aceita vírgula", () => {
    expect(parseGrams("")).toBeNull();
    expect(parseGrams("abc")).toBeNull();
    expect(parseGrams("-5")).toBeNull();
    expect(parseGrams("742,5")).toBe(742.5);
    expect(parseOptionalPrice(" ")).toBeNull();
    expect(parseOptionalPrice("89.9")).toBe(89.9);
  });
});

describe("describeInboxItem", () => {
  const base = { id: "i1", status: "pending" as const, payload: {} };
  it("tag NFC desconhecida cita o slot", () => {
    const t = describeInboxItem({ ...base, source: "nfc", external_id: "PLA-1", payload: { slot_index: 2 } } as SpoolInboxItem);
    expect(t.title).toContain("PLA-1");
    expect(t.subtitle).toContain("slot 3");
  });
  it("preset renomeado cita o nome antigo", () => {
    const t = describeInboxItem({ ...base, source: "preset_renamed", external_id: "Pold", payload: { old_display_name: "- PETG VELHO" } } as SpoolInboxItem);
    expect(t.title).toContain("- PETG VELHO");
  });
});

describe("lista do slot usa o nome do produto", () => {
  it("produto vence o perfil ligado ao carretel", () => {
    const options = buildSlotPickerOptions(
      [spool({ filament_product_id: "p1", filament_profile_id: "prof1" })],
      { 0: null, 1: null, 2: null, 3: null },
      0,
      "",
      [profile({ display_name: "NOME DO PERFIL" })],
      [product()]
    );
    expect(options[0].title).toBe("+ PLA VERMELHO ULTRA SILK VIDAS BUENAS");
  });
});

describe("histórico usa a foto do produto", () => {
  it("nome da época vence o carretel atual; sem carretel mas com foto não é órfão", () => {
    const jobs = groupPrintLogsByJob([
      {
        id: "l1",
        subtask_name: "peça",
        print_duration_minutes: 10,
        slot_index: 0,
        completed_at: "2026-09-28T20:00:00Z",
        status: "FINISH",
        filament_used_g: 12.3,
        spool: spool({ color_name: "Nome Novo" }),
        product_name_snapshot: "+ PLA NOME ANTIGO",
        material_snapshot: "PLA",
        color_snapshot: "Vermelho",
      },
      {
        id: "l2",
        subtask_name: "peça 2",
        print_duration_minutes: 10,
        slot_index: 1,
        completed_at: "2026-09-28T19:00:00Z",
        status: "FINISH",
        filament_used_g: 1,
        product_name_snapshot: "- PETG ARQUIVADO",
      },
    ]);
    expect(jobs[0].items[0].product_name).toBe("+ PLA NOME ANTIGO");
    expect(jobs[0].items[0].color_name).toBe("Vermelho");
    expect(jobs[1].items[0].orphan_slot).toBe(false);
    expect(jobs[1].items[0].spool_name).toBe("- PETG ARQUIVADO");
  });
});
