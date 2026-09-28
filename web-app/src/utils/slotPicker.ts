import type { FilamentProduct, Spool, UserFilamentProfile } from "../types";
import { getSpoolDisplayName } from "./inventory";

export interface SlotPickerOption {
  spool: Spool;
  // Slot (0-based) onde o carretel já está, se for outro que não o alvo.
  inOtherSlot: number | null;
  // Nome completo no padrão do usuário ("+ PLA VERMELHO ULTRA SILK VIDAS BUENAS").
  title: string;
  // O que diferencia carretéis iguais: local, peso, tag, origem.
  details: string[];
}

// Nome do carretel no padrão dos perfis do usuário: PLA com "+", PETG com
// "-", depois MATERIAL COR MARCA. Se o carretel está ligado a um perfil do
// Bambu Studio, usa o nome do perfil (é o nome que o usuário escolheu).
export function buildSpoolTitle(spool: Spool, profile?: UserFilamentProfile | null): string {
  if (profile?.source === "bambu_studio" && profile.display_name?.trim()) {
    return profile.display_name.trim();
  }
  const material = (spool.material || "").trim().toUpperCase();
  let color = getSpoolDisplayName(spool).trim().toUpperCase();
  if (material && color.startsWith(material + " ")) color = color.slice(material.length + 1);
  const brand = (spool.brand || "").trim().toUpperCase();
  const parts = [material, color];
  if (brand && !color.includes(brand)) parts.push(brand);
  const prefix = material === "PLA" ? "+ " : material === "PETG" ? "- " : "";
  return prefix + parts.filter(Boolean).join(" ");
}

export function buildSpoolDetails(spool: Spool): string[] {
  const details = [spool.location?.trim() ? `📍 ${spool.location.trim()}` : "📍 sem local"];
  details.push(`${Math.round(Number(spool.current_weight) || 0)}g`);
  details.push(spool.nfc_uid ? "🏷️ com tag" : "sem tag");
  if (spool.bambu_spool_id) details.push("☁️ Bambu");
  return details;
}

// Lista de carretéis para escolher o de um slot do AMS sem tag NFC. Busca
// por nome/marca/material/cor/local; carretéis livres primeiro, depois os que
// já estão em outro slot (escolher move); o que já está no slot alvo sai da lista.
// O nome é o do produto; sem produto, o do perfil do Bambu Studio.
export function buildSlotPickerOptions(
  inventory: Spool[],
  activeSlots: Record<number, Spool | null>,
  targetSlot: number,
  query: string,
  profiles: UserFilamentProfile[] = [],
  products: FilamentProduct[] = []
): SlotPickerOption[] {
  const slotBySpoolId = new Map<string, number>();
  for (const [idx, spool] of Object.entries(activeSlots)) {
    if (spool?.id) slotBySpoolId.set(spool.id, Number(idx));
  }
  const profileById = new Map(profiles.map((p) => [p.id, p]));
  const productById = new Map(products.map((p) => [p.id, p]));

  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);

  return inventory
    .filter((s) => slotBySpoolId.get(s.id) !== targetSlot)
    .map((spool) => ({
      spool,
      inOtherSlot: slotBySpoolId.get(spool.id) ?? null,
      title:
        (spool.filament_product_id && productById.get(spool.filament_product_id)?.name?.trim()) ||
        buildSpoolTitle(spool, spool.filament_profile_id ? profileById.get(spool.filament_profile_id) : null),
      details: buildSpoolDetails(spool),
    }))
    .filter((o) => {
      if (terms.length === 0) return true;
      const s = o.spool;
      const haystack = [o.title, getSpoolDisplayName(s), s.brand, s.material, s.color_name, s.location].join(" ").toLowerCase();
      return terms.every((t) => haystack.includes(t));
    })
    .sort((a, b) => {
      if ((a.inOtherSlot === null) !== (b.inOtherSlot === null)) return a.inOtherSlot === null ? -1 : 1;
      const byMaterial = (a.spool.material || "").localeCompare(b.spool.material || "");
      if (byMaterial !== 0) return byMaterial;
      const byTitle = a.title.replace(/^[+-]\s*/, "").localeCompare(b.title.replace(/^[+-]\s*/, ""), "pt-BR");
      if (byTitle !== 0) return byTitle;
      return (a.spool.location || "").localeCompare(b.spool.location || "", "pt-BR", { numeric: true });
    });
}
