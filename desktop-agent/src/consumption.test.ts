import { describe, it, expect } from "vitest";
import { computeConsumptionPerSlot, extractGramsFromName } from "./consumption";
import type { FilamentSliceInfo } from "./ftpsParser";

function slice(overrides: Partial<FilamentSliceInfo>): FilamentSliceInfo {
  return {
    trayId: 0,
    modelGrams: 0,
    supportGrams: 0,
    flushGrams: 0,
    totalGrams: 0,
    color: "unknown",
    weightDiscount: 0,
    ...overrides,
  };
}

describe("extractGramsFromName", () => {
  it("extrai peso com underscore antes do sufixo (ex: peca_15g.gcode)", () => {
    expect(extractGramsFromName("suporte_azeite_45g.gcode")).toBe(45);
  });

  it("extrai peso decimal sem underscore (ex: 12.5g)", () => {
    expect(extractGramsFromName("peca 12.5g final")).toBe(12.5);
  });

  it("retorna null quando não há peso no nome", () => {
    expect(extractGramsFromName("impressao_generica.gcode")).toBeNull();
  });
});

describe("computeConsumptionPerSlot", () => {
  it("nivel 1 (exact): usa slice_info.config real, granular por slot", () => {
    const result = computeConsumptionPerSlot(
      [0, 1],
      [slice({ trayId: 0, totalGrams: 10, weightDiscount: 1 }), slice({ trayId: 1, totalGrams: 20 })],
      0,
      0
    );
    expect(result.get(0)).toEqual({ grams: 10, quality: "exact", weightDiscount: 1 });
    expect(result.get(1)).toEqual({ grams: 20, quality: "exact", weightDiscount: 0 });
  });

  it("nivel 1: slot usado mas não descrito pelo slicer fica unknown (não inventa peso)", () => {
    const result = computeConsumptionPerSlot(
      [0, 2],
      [slice({ trayId: 0, totalGrams: 10 })],
      0,
      0
    );
    expect(result.get(0)?.quality).toBe("exact");
    expect(result.get(2)).toEqual({ grams: 0, quality: "unknown", weightDiscount: 0 });
  });

  it("nivel 2 (estimated_filename): divide peso do nome igualmente entre slots usados", () => {
    const result = computeConsumptionPerSlot([0, 1], undefined, 20, 0);
    expect(result.get(0)).toEqual({ grams: 10, quality: "estimated_filename", weightDiscount: 0 });
    expect(result.get(1)).toEqual({ grams: 10, quality: "estimated_filename", weightDiscount: 0 });
  });

  it("nivel 3 (estimated_duration): usa vazão de ~0.22g/min quando não há nome nem slice_info", () => {
    const result = computeConsumptionPerSlot([0], undefined, 0, 100);
    expect(result.get(0)).toEqual({ grams: 22, quality: "estimated_duration", weightDiscount: 0 });
  });

  it("nivel 4 (unknown): sem nenhum dado real, não inventa peso (0g)", () => {
    const result = computeConsumptionPerSlot([0], undefined, 0, 0);
    expect(result.get(0)).toEqual({ grams: 0, quality: "unknown", weightDiscount: 0 });
  });

  it("usa slot 0 como fallback quando usedSlots está vazio", () => {
    const result = computeConsumptionPerSlot([], undefined, 0, 0);
    expect(Array.from(result.keys())).toEqual([0]);
  });
});
