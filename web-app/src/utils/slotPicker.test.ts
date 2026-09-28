import { describe, it, expect } from "vitest";
import type { Spool } from "../types";
import { buildSlotPickerOptions } from "./slotPicker";

function spool(id: string, material: string, color_name: string, brand = "Voolt3D"): Spool {
  return { id, nfc_uid: "", brand, material, color_name, color_hex: "#000000", current_weight: 1000 };
}

const inventory = [
  spool("a", "PLA", "Preto Velvet"),
  spool("b", "PETG", "Branco", "MasterPrint"),
  spool("c", "PETG", "Azul Claro", "Xiaozhuzi"),
  spool("d", "PLA", "Amarelo Velvet"),
];

describe("buildSlotPickerOptions", () => {
  it("livres primeiro (por material), depois os que estão em outro slot; o do próprio slot some", () => {
    const opts = buildSlotPickerOptions(inventory, { 0: inventory[1], 1: inventory[0], 2: null, 3: null }, 0, "");
    expect(opts.map((o) => o.spool.id)).toEqual(["c", "d", "a"]); // PETG antes de PLA
    expect(opts.find((o) => o.spool.id === "a")?.inOtherSlot).toBe(1);
    expect(opts.find((o) => o.spool.id === "d")?.inOtherSlot).toBeNull();
  });

  it("busca por várias palavras em nome, marca, material e cor, sem diferenciar maiúsculas", () => {
    expect(buildSlotPickerOptions(inventory, {}, 0, "petg azul").map((o) => o.spool.id)).toEqual(["c"]);
    expect(buildSlotPickerOptions(inventory, {}, 0, "VELVET").map((o) => o.spool.id).sort()).toEqual(["a", "d"]);
    expect(buildSlotPickerOptions(inventory, {}, 0, "masterprint")).toHaveLength(1);
    expect(buildSlotPickerOptions(inventory, {}, 0, "nylon")).toHaveLength(0);
  });

  it("título no padrão do usuário: nome do perfil Bambu Studio, senão +/- MATERIAL COR MARCA", () => {
    const linked = { ...spool("e", "PLA", "Vermelho Ultra Silk", "Vidas Buenas"), filament_profile_id: "p1" };
    const profiles = [{ id: "p1", user_id: "u", source: "bambu_studio", source_key: "P1", source_profile_name: "x", display_name: "+ PLA VERMELHO ULTRA SILK VIDAS BUENAS", material: "PLA" }];
    const opts = buildSlotPickerOptions([...inventory, linked], {}, 0, "", profiles);
    const title = (id: string) => opts.find((o) => o.spool.id === id)?.title;
    expect(title("e")).toBe("+ PLA VERMELHO ULTRA SILK VIDAS BUENAS");
    expect(title("b")).toBe("- PETG BRANCO MASTERPRINT");
    expect(title("a")).toBe("+ PLA PRETO VELVET VOOLT3D");
  });

  it("detalhes separam carretéis iguais: local, peso e tag; busca acha pelo local", () => {
    const p1 = { ...spool("x", "PETG", "Preto"), location: "SPOT 2", nfc_uid: "04AA" };
    const p2 = { ...spool("y", "PETG", "Preto"), location: null, current_weight: 338.4 };
    const opts = buildSlotPickerOptions([p2, p1], {}, 0, "");
    expect(opts.map((o) => o.spool.id)).toEqual(["y", "x"]); // "" antes de "SPOT 2"
    expect(opts[1].details).toEqual(["📍 SPOT 2", "1000g", "🏷️ com tag"]);
    expect(opts[0].details).toEqual(["📍 sem local", "338g", "sem tag"]);
    expect(buildSlotPickerOptions([p1, p2], {}, 0, "spot 2").map((o) => o.spool.id)).toEqual(["x"]);
  });
});
