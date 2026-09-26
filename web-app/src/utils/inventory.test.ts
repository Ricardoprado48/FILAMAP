import { describe, it, expect } from "vitest";
import {
  isHexColor,
  getSpoolDisplayName,
  getSpoolSwatchColor,
  filterInventory,
  groupInventoryByMaterial,
} from "./inventory";
import type { Spool } from "../types";

describe("inventory utils", () => {
  describe("isHexColor", () => {
    it("identifies 3, 6, and 8 character hex codes with and without hash", () => {
      expect(isHexColor("#161616")).toBe(true);
      expect(isHexColor("161616")).toBe(true);
      expect(isHexColor("#F72323")).toBe(true);
      expect(isHexColor("#FFB549")).toBe(true);
      expect(isHexColor("#00CC00")).toBe(true);
      expect(isHexColor("#FFF")).toBe(true);
      expect(isHexColor("FF0000FF")).toBe(true); // 8-char RGBA
      expect(isHexColor("#FF0000FF")).toBe(true);
    });

    it("returns false for non-hex names or empty values", () => {
      expect(isHexColor("Preto")).toBe(false);
      expect(isHexColor("PLA Basic Preto")).toBe(false);
      expect(isHexColor("Vermelho")).toBe(false);
      expect(isHexColor("")).toBe(false);
      expect(isHexColor(null)).toBe(false);
      expect(isHexColor(undefined)).toBe(false);
      expect(isHexColor("   ")).toBe(false);
      expect(isHexColor("GGGGGG")).toBe(false);
    });
  });

  describe("getSpoolDisplayName", () => {
    it("returns readable color_name when it is not a hex code", () => {
      const spool: Partial<Spool> = {
        color_name: "Preto",
        brand: "Bambu Lab",
        material: "PLA",
      };
      expect(getSpoolDisplayName(spool)).toBe("Preto");
    });

    it("falls back to 'Brand Material' when color_name is a hex code", () => {
      const spool: Partial<Spool> = {
        color_name: "#161616",
        brand: "Bambu Lab",
        material: "PLA Basic",
      };
      expect(getSpoolDisplayName(spool)).toBe("Bambu Lab PLA Basic");
    });

    it("falls back to material when brand is missing and color_name is hex", () => {
      const spool: Partial<Spool> = {
        color_name: "#F72323",
        material: "PETG",
      };
      expect(getSpoolDisplayName(spool)).toBe("PETG");
    });

    it("returns color_name if nothing else is available even if hex", () => {
      const spool: Partial<Spool> = {
        color_name: "#FFB549",
      };
      expect(getSpoolDisplayName(spool)).toBe("#FFB549");
    });

    it("handles null or undefined safely", () => {
      expect(getSpoolDisplayName(null)).toBe("Sem carretel");
      expect(getSpoolDisplayName(undefined)).toBe("Sem carretel");
      expect(getSpoolDisplayName({})).toBe("Carretel sem nome");
    });
  });

  describe("getSpoolSwatchColor", () => {
    it("returns color_hex when present and valid", () => {
      const spool: Partial<Spool> = {
        color_hex: "#161616",
        color_name: "Preto",
      };
      expect(getSpoolSwatchColor(spool)).toBe("#161616");
    });

    it("prefixes # if color_hex is without hash", () => {
      const spool: Partial<Spool> = {
        color_hex: "161616",
        color_name: "Preto",
      };
      expect(getSpoolSwatchColor(spool)).toBe("#161616");
    });

    it("extracts RGB from 8-char hex", () => {
      const spool: Partial<Spool> = {
        color_hex: "#161616FF",
      };
      expect(getSpoolSwatchColor(spool)).toBe("#161616");
    });

    it("falls back to color_name if color_name is a hex code", () => {
      const spool: Partial<Spool> = {
        color_hex: "",
        color_name: "#F72323",
      };
      expect(getSpoolSwatchColor(spool)).toBe("#F72323");
    });

    it("falls back to default slate color when no hex is available", () => {
      const spool: Partial<Spool> = {
        color_name: "Preto",
      };
      expect(getSpoolSwatchColor(spool)).toBe("#64748b");
      expect(getSpoolSwatchColor(null)).toBe("#334155");
    });
  });

  describe("filterInventory", () => {
    const inventory: Spool[] = [
      {
        id: "s1",
        nfc_uid: "uid-1",
        brand: "Bambu Lab",
        material: "PLA",
        color_name: "#161616",
        color_hex: "#161616",
        current_weight: 800,
      },
      {
        id: "s2",
        nfc_uid: "uid-2",
        brand: "eSun",
        material: "PETG",
        color_name: "Azul Claro",
        color_hex: "#38bdf8",
        current_weight: 950,
      },
    ];

    it("matches query against resolved display name", () => {
      // s1 has color_name "#161616", but display name is "Bambu Lab PLA"
      const result = filterInventory(inventory, "Bambu", "TODOS");
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("s1");
    });

    it("filters by material accurately", () => {
      const result = filterInventory(inventory, "", "PETG");
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("s2");
    });
  });

  describe("groupInventoryByMaterial", () => {
    it("groups spools by uppercase material", () => {
      const inventory: Spool[] = [
        {
          id: "1",
          nfc_uid: "",
          brand: "A",
          material: "pla",
          color_name: "Black",
          color_hex: "#000",
          current_weight: 100,
        },
        {
          id: "2",
          nfc_uid: "",
          brand: "B",
          material: "PLA",
          color_name: "White",
          color_hex: "#fff",
          current_weight: 200,
        },
      ];
      const grouped = groupInventoryByMaterial(inventory);
      expect(grouped["PLA"]).toHaveLength(2);
    });
  });
});
