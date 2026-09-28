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
});
