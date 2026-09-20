import { FilamentSliceInfo } from "./ftpsParser";

export interface JobConsumptionItem {
  spool_id: string | null;
  slot_index: number;
  grams: number;
  consumption_quality: "exact" | "estimated_filename" | "estimated_duration" | "unknown";
  orphan_slot: boolean;
}

// Extrai gramatura estimada do nome do arquivo ou metadados se o fatiador incluir (ex: "peca_15g.gcode")
export function extractGramsFromName(taskName: string): number | null {
  const match = taskName.match(/_(\d+(?:\.\d+)?)g/i) || taskName.match(/(\d+(?:\.\d+)?)g\b/i);
  if (match && match[1]) {
    return parseFloat(match[1]);
  }
  return null;
}

// Cascata de 4 níveis (nunca é escolha, é sempre tentativa em ordem):
// 1. exact          -- totalGrams por slot/tray, direto do slice_info.config real via FTPS.
// 2. estimated_filename -- peso único no nome do arquivo/subtask_name, dividido
//    igualmente entre os slots detectados como usados (decisão de produto
//    reportada na investigação (b) -- não há granularidade por cor nesse nível).
// 3. estimated_duration -- duração x vazão genérica (~0.22g/min), mesma divisão.
// 4. unknown        -- nenhum dado real -- NÃO desconta nada (grams=0), só loga.
export function computeConsumptionPerSlot(
  usedSlots: number[],
  filamentSliceInfo: FilamentSliceInfo[] | undefined,
  filenameGrams: number,
  durationMinutes: number
): Map<number, { grams: number; quality: JobConsumptionItem["consumption_quality"]; weightDiscount: number }> {
  const perSlot = new Map<number, { grams: number; quality: JobConsumptionItem["consumption_quality"]; weightDiscount: number }>();
  const exactSlices = (filamentSliceInfo || []).filter((f) => f.totalGrams > 0);

  if (exactSlices.length > 0) {
    // Nível 1: exato, já granular por slot -- não precisa dividir nada.
    for (const f of exactSlices) {
      perSlot.set(f.trayId, { grams: f.totalGrams, quality: "exact", weightDiscount: f.weightDiscount || 0 });
    }
    // Slot que a AMS reportou como usado mas o slicer não descreveu --
    // não inventa peso pra ele, fica unknown mesmo estando no meio de um job "exact".
    for (const slot of usedSlots) {
      if (!perSlot.has(slot)) perSlot.set(slot, { grams: 0, quality: "unknown", weightDiscount: 0 });
    }
    return perSlot;
  }

  let totalGrams = 0;
  let quality: JobConsumptionItem["consumption_quality"] = "unknown";
  if (filenameGrams > 0) {
    totalGrams = filenameGrams;
    quality = "estimated_filename";
  } else if (durationMinutes > 0) {
    // Média de vazão típica de FDM na A1 (aprox 12g a 15g por hora = ~0.22g por minuto)
    totalGrams = Math.round(durationMinutes * 0.22 * 10) / 10;
    quality = "estimated_duration";
  }

  const slots = usedSlots.length > 0 ? usedSlots : [0];
  if (quality === "unknown" || totalGrams <= 0) {
    for (const slot of slots) perSlot.set(slot, { grams: 0, quality: "unknown", weightDiscount: 0 });
    return perSlot;
  }

  const perSlotGrams = Math.round((totalGrams / slots.length) * 10) / 10;
  for (const slot of slots) perSlot.set(slot, { grams: perSlotGrams, quality, weightDiscount: 0 });
  return perSlot;
}
