import type { Spool } from "../types";

export function isHexColor(val: string | null | undefined): boolean {
  if (!val) return false;
  return /^#?([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/.test(val.trim());
}

export function getSpoolBrandDisplay(
  brand: string | null | undefined,
  material?: string | null
): string {
  const cleanBrand = brand?.trim();
  const cleanMat = material?.trim();
  if (
    !cleanBrand ||
    cleanBrand === "+" ||
    cleanBrand === "-" ||
    cleanBrand.toLowerCase() === "generic"
  ) {
    return "Genérico";
  }
  if (cleanMat && cleanBrand.toUpperCase() === cleanMat.toUpperCase()) {
    return "Genérico";
  }
  return cleanBrand;
}

export function getSpoolDisplayName(spool: Partial<Spool> | null | undefined): string {
  if (!spool) return "Sem carretel";
  const colorName = spool.color_name?.trim();
  if (colorName && !isHexColor(colorName)) {
    return colorName;
  }
  const brand = spool.brand?.trim();
  const material = spool.material?.trim();
  if (brand && material) {
    return `${brand} ${material}`;
  }
  if (material) {
    return material;
  }
  if (colorName) {
    return colorName;
  }
  return "Carretel sem nome";
}

export function getSpoolSwatchColor(spool: Partial<Spool> | null | undefined): string {
  if (!spool) return "#334155";
  const hex = spool.color_hex?.trim();
  if (hex && isHexColor(hex)) {
    return hex.startsWith("#") ? hex.slice(0, 7) : `#${hex.slice(0, 6)}`;
  }
  const name = spool.color_name?.trim();
  if (name && isHexColor(name)) {
    return name.startsWith("#") ? name.slice(0, 7) : `#${name.slice(0, 6)}`;
  }
  return "#64748b";
}

export function filterInventory(
  inventory: Spool[],
  searchQuery: string,
  filterMaterial: string
): Spool[] {
  const normalizedSearch = searchQuery.toLowerCase();

  return inventory.filter((item) => {
    const displayName = getSpoolDisplayName(item).toLowerCase();
    const matchesSearch =
      item.color_name.toLowerCase().includes(normalizedSearch) ||
      displayName.includes(normalizedSearch) ||
      item.brand.toLowerCase().includes(normalizedSearch);

    const matchesMaterial =
      filterMaterial === "TODOS" ||
      item.material === filterMaterial;

    return matchesSearch && matchesMaterial;
  });
}

export function groupInventoryByMaterial(
  inventory: Spool[]
): Record<string, Spool[]> {
  return inventory.reduce<Record<string, Spool[]>>(
    (acc, spool) => {
      const material =
        (spool.material || "OUTROS").toUpperCase();

      if (!acc[material]) {
        acc[material] = [];
      }

      acc[material].push(spool);

      return acc;
    },
    {}
  );
}

export function getInPrinterCountDisplay(
  visibleCount: number,
  totalCount: number
): string {
  if (visibleCount === totalCount) {
    return `(${totalCount})`;
  }
  return `(${visibleCount} de ${totalCount})`;
}

export function formatActiveSlotDisplay(
  slotIndex: number | null | undefined,
  isPrinting: boolean
): string {
  if (!isPrinting) return "--";
  if (
    slotIndex === null ||
    slotIndex === undefined ||
    typeof slotIndex !== "number" ||
    !Number.isInteger(slotIndex) ||
    slotIndex < 0 ||
    slotIndex === 255
  ) {
    return "--";
  }
  return `Slot ${slotIndex + 1}`;
}

