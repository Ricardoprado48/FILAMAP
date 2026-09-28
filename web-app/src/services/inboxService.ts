import { supabase } from "../lib/supabase";
import type { Spool, SpoolInboxItem, UserFilamentProfile } from "../types";
import { buildNfcLinkUpdate } from "../utils/spoolStatus";

export async function fetchPendingInbox(): Promise<SpoolInboxItem[]> {
  const { data, error } = await supabase
    .from("spool_inbox")
    .select("id, source, external_id, payload, suggested_spool_id, suggested_product_id, status, resolved_spool_id, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  if (error) {
    console.warn("Falha ao buscar a caixa de entrada:", error.message || error);
    return [];
  }
  return (data as SpoolInboxItem[]) || [];
}

/**
 * Tag NFC lida que não pertence a nenhum carretel: vai para a caixa de
 * entrada (nunca cria carretel). Ler a mesma tag de novo reabre o item.
 */
export async function queueUnknownNfcTag(uid: string, printerId: string | null, slotIndex: number | null, nowIso = new Date().toISOString()) {
  return supabase
    .from("spool_inbox")
    .upsert(
      {
        source: "nfc",
        external_id: uid,
        payload: { nfc_uid: uid, printer_id: printerId, slot_index: slotIndex },
        status: "pending",
        resolved_spool_id: null,
        resolved_at: null,
        updated_at: nowIso,
      },
      { onConflict: "user_id,source,external_id" }
    )
    .select("id, source, external_id, payload, suggested_spool_id, suggested_product_id, status, resolved_spool_id, created_at")
    .single();
}

export async function resolveInboxItem(
  itemId: string,
  status: "linked" | "created" | "ignored",
  spoolId: string | null,
  nowIso = new Date().toISOString()
) {
  return supabase
    .from("spool_inbox")
    .update({ status, resolved_spool_id: spoolId, resolved_at: nowIso, updated_at: nowIso })
    .eq("id", itemId)
    .select("id");
}

// Só estes tipos podem ser ligados a um carretel existente.
export function canLinkInboxItem(item: SpoolInboxItem): boolean {
  return item.source === "nfc" || item.source === "bambu_cloud";
}

/**
 * Liga a evidência a um carretel escolhido pelo usuário: a tag NFC vira o
 * nfc_uid do carretel; o registro da nuvem vira o bambu_spool_id (só se o
 * carretel ainda não tiver outro). Nada de identidade/peso é alterado.
 */
export async function linkInboxItemToSpool(item: SpoolInboxItem, spool: Spool) {
  let payload: Record<string, string>;
  if (item.source === "nfc") {
    payload = { ...buildNfcLinkUpdate(item.external_id) };
  } else if (item.source === "bambu_cloud") {
    if (spool.bambu_spool_id && spool.bambu_spool_id !== item.external_id) {
      return { data: null, error: { message: "Este carretel já está ligado a outro registro da nuvem Bambu." } };
    }
    payload = { bambu_spool_id: item.external_id };
  } else {
    return { data: null, error: { message: "Este tipo de item não pode ser ligado a um carretel." } };
  }
  const updated = await supabase.from("spools").update(payload).eq("id", spool.id).select("id");
  if (updated.error) return updated;
  if (!updated.data || updated.data.length === 0) {
    return { data: null, error: { message: "Carretel não encontrado ou sem permissão para editá-lo." } };
  }
  return resolveInboxItem(item.id, "linked", spool.id);
}

/**
 * Preset renomeado (D6): o usuário confirma qual perfil novo é o mesmo
 * produto. O produto mantém o ID e passa a usar o nome novo; o histórico
 * guarda o nome antigo no snapshot.
 */
export async function applyPresetRename(item: SpoolInboxItem, newProfile: UserFilamentProfile) {
  const productId = item.suggested_product_id;
  if (!productId) return { data: null, error: { message: "Item sem produto associado." } };
  const linked = await supabase
    .from("user_filament_profiles")
    .update({ filament_product_id: productId })
    .eq("id", newProfile.id)
    .select("id");
  if (linked.error) return linked;
  const renamed = await supabase
    .from("filament_products")
    .update({ name: newProfile.display_name.trim(), updated_at: new Date().toISOString() })
    .eq("id", productId)
    .select("id");
  if (renamed.error) return renamed;
  return resolveInboxItem(item.id, "linked", null);
}
