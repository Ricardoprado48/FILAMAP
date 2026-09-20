import type { FilamentSliceInfo } from "./ftpsParser";

export type ConsumptionQuality =
  | "exact"
  | "estimated_filename"
  | "estimated_duration"
  | "unknown";

export interface JobConsumptionItem {
  spool_id: string | null;
  slot_index: number;
  grams: number;
  consumption_quality: ConsumptionQuality;
  orphan_slot: boolean;
}

export interface SlotConsumption {
  grams: number;
  quality: ConsumptionQuality;
  weightDiscount: number;
}

// Cascata de 4 níveis:
// 1. exact              -> slice_info.config real, granular por slot.
// 2. estimated_filename -> peso no nome do arquivo, dividido entre slots usados.
// 3. estimated_duration -> duração x 0.22g/min, dividido entre slots usados.
// 4. unknown            -> sem dado confiável; não desconta peso.
export function computeConsumptionPerSlot(
  usedSlots: number[],
  filamentSliceInfo: FilamentSliceInfo[] | undefined,
  filenameGrams: number,
  durationMinutes: number
): Map<number, SlotConsumption> {
  const perSlot = new Map<number, SlotConsumption>();

  const exactSlices = (filamentSliceInfo || []).filter(
    (f) => f.totalGrams > 0
  );

  if (exactSlices.length > 0) {
    for (const f of exactSlices) {
      perSlot.set(f.trayId, {
        grams: f.totalGrams,
        quality: "exact",
        weightDiscount: f.weightDiscount || 0,
      });
    }

    // Slot reportado pela AMS mas ausente no slicer:
    // não inventamos consumo.
    for (const slot of usedSlots) {
      if (!perSlot.has(slot)) {
        perSlot.set(slot, {
          grams: 0,
          quality: "unknown",
          weightDiscount: 0,
        });
      }
    }

    return perSlot;
  }

  let totalGrams = 0;
  let quality: ConsumptionQuality = "unknown";

  if (filenameGrams > 0) {
    totalGrams = filenameGrams;
    quality = "estimated_filename";
  } else if (durationMinutes > 0) {
    totalGrams = Math.round(durationMinutes * 0.22 * 10) / 10;
    quality = "estimated_duration";
  }

  const slots = usedSlots.length > 0 ? usedSlots : [0];

  if (quality === "unknown" || totalGrams <= 0) {
    for (const slot of slots) {
      perSlot.set(slot, {
        grams: 0,
        quality: "unknown",
        weightDiscount: 0,
      });
    }

    return perSlot;
  }

  const perSlotGrams =
    Math.round((totalGrams / slots.length) * 10) / 10;

  for (const slot of slots) {
    perSlot.set(slot, {
      grams: perSlotGrams,
      quality,
      weightDiscount: 0,
    });
  }

  return perSlot;
}

export function computeFinalGrams(
  grams: number,
  weightDiscount: number,
  percentExecuted: number,
  quality: ConsumptionQuality
): number {
  if (quality === "unknown") {
    return 0;
  }

  const safePercent = Math.max(0, Math.min(100, percentExecuted));

  const scaledGrams =
    Math.round(grams * (safePercent / 100) * 10) / 10;

  const scaledDiscount =
    weightDiscount > 0
      ? Math.round(weightDiscount * (safePercent / 100) * 10) / 10
      : 0;

  return Math.max(
    0,
    Math.round((scaledGrams - scaledDiscount) * 10) / 10
  );
}

