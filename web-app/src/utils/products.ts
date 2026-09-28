import type { FilamentProduct, Spool, SpoolInboxItem, UserFilamentProfile } from "../types";
import { buildSpoolTitle } from "./slotPicker";

// Nome do carretel: o nome do produto (identidade estável). Sem produto,
// cai no nome do perfil do Bambu Studio e, por fim, em MATERIAL COR MARCA.
export function resolveSpoolTitle(
  spool: Spool,
  product?: FilamentProduct | null,
  profile?: UserFilamentProfile | null
): string {
  if (product?.name?.trim()) return product.name.trim();
  return buildSpoolTitle(spool, profile);
}

// Cópia legada da identidade no carretel (brand/material/cor), sempre tirada
// do produto -- nunca de um valor padrão inventado.
export function identityFromProduct(product: FilamentProduct, colorHex?: string | null) {
  return {
    brand: product.brand?.trim() || null,
    material: product.material?.trim() || null,
    color_name: product.color_name?.trim() || product.name.trim(),
    color_hex: colorHex || product.color_hex || null,
  };
}

// Produto novo a partir de um perfil do fatiador: o nome é o que o usuário
// deu no Bambu Studio; a marca vem do próprio perfil (pode ser corrigida depois).
export function productFromProfile(profile: UserFilamentProfile) {
  return {
    name: profile.display_name.trim(),
    brand: profile.brand?.trim() || null,
    material: profile.material?.trim() || null,
    color_name: profile.color_name?.trim() || null,
    origin: (profile.source === "bambu_official" ? "bambu_official" : "bambu_studio") as FilamentProduct["origin"],
  };
}

// Perfis do Bambu Studio em uso que ainda não viraram produto (opções para
// "criar produto a partir do perfil" no Novo Carretel).
export function profilesWithoutProduct(profiles: UserFilamentProfile[], products: FilamentProduct[]): UserFilamentProfile[] {
  const productNames = new Set(products.map((p) => p.name.trim().toLowerCase()));
  return profiles.filter(
    (p) =>
      p.source === "bambu_studio" &&
      p.is_listed !== false &&
      !p.filament_product_id &&
      !productNames.has(p.display_name.trim().toLowerCase())
  );
}

// Número obrigatório digitado pelo usuário (peso, tara). Vazio ou inválido = null.
export function parseGrams(value: string): number | null {
  const trimmed = value.trim().replace(",", ".");
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// Preço é opcional: vazio grava NULL (nunca o antigo padrão de R$ 85).
export function parseOptionalPrice(value: string): number | null {
  return parseGrams(value);
}

export interface InboxItemText {
  title: string;
  subtitle: string;
}

export function describeInboxItem(item: SpoolInboxItem): InboxItemText {
  const p = item.payload || {};
  switch (item.source) {
    case "nfc":
      return {
        title: `Tag NFC desconhecida: ${item.external_id}`,
        subtitle:
          typeof p.slot_index === "number"
            ? `Lida no slot ${p.slot_index + 1} do AMS. Diga a qual carretel ela pertence.`
            : "Diga a qual carretel ela pertence.",
      };
    case "bambu_cloud": {
      const name = [p.filament_type, p.suggested_color_name || p.filament_name, p.suggested_brand].filter(Boolean).join(" ");
      const where = p.in_printer ? " • está no AMS" : "";
      return {
        title: `Carretel da nuvem Bambu: ${name || item.external_id}`,
        subtitle: `${p.net_weight ? `${p.net_weight}g nominal` : "peso desconhecido"}${where}. Não está ligado a nenhum carretel do estoque.`,
      };
    }
    case "rfid":
      return { title: `Carretel RFID Bambu: ${item.external_id}`, subtitle: "Lido pelo AMS e não reconhecido." };
    case "preset_renamed":
      return {
        title: `Perfil renomeado no Bambu Studio: ${p.old_display_name || item.external_id}`,
        subtitle: "O perfil antigo sumiu do fatiador. Escolha qual perfil novo é o mesmo produto.",
      };
    default:
      return { title: item.external_id, subtitle: "" };
  }
}
