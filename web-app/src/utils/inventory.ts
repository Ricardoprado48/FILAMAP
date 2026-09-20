import type { Spool } from "../types";

export function filterInventory(inventory: Spool[], searchQuery: string, filterMaterial: string): Spool[] {
  return inventory.filter((item) => {
    const matchesSearch = item.color_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          item.brand.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesMat = filterMaterial === "TODOS" || item.material === filterMaterial;
    return matchesSearch && matchesMat;
  });
}

export function groupByMaterial(inventory: Spool[]): Record<string, Spool[]> {
  return inventory.reduce((acc, spool) => {
    const mat = (spool.material || "OUTROS").toUpperCase();
    if (!acc[mat]) acc[mat] = [];
    acc[mat].push(spool);
    return acc;
  }, {} as Record<string, Spool[]>);
}

export function materialTotals(spools: Spool[]): { totalWeight: number; totalValue: number } {
  const totalWeight = spools.reduce((acc, s) => acc + (s.current_weight || 0), 0);
  const totalValue = spools.reduce((acc, s) => acc + ((s.current_weight || 0) * ((s.price_paid || 85) / 1000)), 0);
  return { totalWeight, totalValue };
}
