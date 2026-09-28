import type { Spool } from "../types";
import { getSpoolDisplayName } from "./inventory";

export interface SlotPickerOption {
  spool: Spool;
  // Slot (0-based) onde o carretel já está, se for outro que não o alvo.
  inOtherSlot: number | null;
}

// Lista de carretéis para escolher o de um slot do AMS sem tag NFC. Busca
// por nome/marca/material/cor; carretéis livres primeiro, depois os que já
// estão em outro slot (escolher move); o que já está no slot alvo sai da lista.
export function buildSlotPickerOptions(
  inventory: Spool[],
  activeSlots: Record<number, Spool | null>,
  targetSlot: number,
  query: string
): SlotPickerOption[] {
  const slotBySpoolId = new Map<string, number>();
  for (const [idx, spool] of Object.entries(activeSlots)) {
    if (spool?.id) slotBySpoolId.set(spool.id, Number(idx));
  }

  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);

  return inventory
    .filter((s) => slotBySpoolId.get(s.id) !== targetSlot)
    .filter((s) => {
      if (terms.length === 0) return true;
      const haystack = [getSpoolDisplayName(s), s.brand, s.material, s.color_name].join(" ").toLowerCase();
      return terms.every((t) => haystack.includes(t));
    })
    .map((spool) => ({ spool, inOtherSlot: slotBySpoolId.get(spool.id) ?? null }))
    .sort((a, b) => {
      if ((a.inOtherSlot === null) !== (b.inOtherSlot === null)) return a.inOtherSlot === null ? -1 : 1;
      const byMaterial = (a.spool.material || "").localeCompare(b.spool.material || "");
      if (byMaterial !== 0) return byMaterial;
      return getSpoolDisplayName(a.spool).localeCompare(getSpoolDisplayName(b.spool), "pt-BR");
    });
}
