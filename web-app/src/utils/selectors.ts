import type { CatalogItem, PrintLog, Printer } from "../types";

export function filterAndSortCatalog(catalog: CatalogItem[], catalogSearch: string): CatalogItem[] {
  return catalog
    .filter((item) =>
      item.name.toLowerCase().includes(catalogSearch.toLowerCase()) ||
      item.material.toLowerCase().includes(catalogSearch.toLowerCase())
    )
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }));
}

export function pendingWeighingLogs(printLogs: PrintLog[]): PrintLog[] {
  return printLogs.filter((l) => l.needs_weighing);
}

export function isPrinterPrinting(printer?: Printer | null): boolean {
  return printer?.gcode_state === "RUNNING" || printer?.gcode_state === "PAUSE";
}
