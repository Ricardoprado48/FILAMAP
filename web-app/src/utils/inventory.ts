import type { Spool } from "../types";

export function filterInventory(
  inventory: Spool[],
  searchQuery: string,
  filterMaterial: string
): Spool[] {
  const normalizedSearch = searchQuery.toLowerCase();

  return inventory.filter((item) => {
    const matchesSearch =
      item.color_name.toLowerCase().includes(normalizedSearch) ||
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
