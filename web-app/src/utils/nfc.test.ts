import { describe, it, expect } from "vitest";
import type { Spool } from "../types";
import { getNfcStatus } from "./nfc";

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

describe("getNfcStatus", () => {
  it("retorna none para spool sem nfc_uid", () => {
    expect(getNfcStatus(makeSpool({ nfc_uid: "" }))).toBe("none");
  });

  it("retorna pending para spool com nfc_uid mas sem escrita física confirmada", () => {
    expect(getNfcStatus(makeSpool({ nfc_uid: "TAG-1", nfc_written_at: null }))).toBe("pending");
  });

  it("retorna written para spool com nfc_written_at confirmado", () => {
    expect(
      getNfcStatus(makeSpool({ nfc_uid: "TAG-1", nfc_written_at: "2026-09-22T23:00:00.000Z" }))
    ).toBe("written");
  });
});
