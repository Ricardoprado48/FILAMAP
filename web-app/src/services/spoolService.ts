import { supabase } from "../lib/supabase";
import type { WeighUpdatePayload, NfcLinkUpdatePayload } from "../utils/spoolStatus";

export async function updateSpoolWeight(
  spoolId: string,
  payload: WeighUpdatePayload
) {
  return supabase.from("spools").update(payload).eq("id", spoolId).select();
}

/**
 * Vincula uma tag NFC já lida a um carretel existente. Nunca insere: quem
 * chama sempre passa um spoolId de um carretel já cadastrado.
 */
export async function linkSpoolNfc(
  spoolId: string,
  payload: NfcLinkUpdatePayload
) {
  return supabase.from("spools").update(payload).eq("id", spoolId).select();
}

/**
 * Checagem prévia (best-effort, antes do UPDATE) de qual outro carretel já
 * usa esta tag -- a fonte de verdade continua sendo a constraint
 * UNIQUE(nfc_uid) no banco, que barra a corrida mesmo se este SELECT ficar
 * desatualizado entre a checagem e o UPDATE.
 */
export async function findSpoolByNfcUid(nfcUid: string) {
  return supabase
    .from("spools")
    .select("id, color_name, brand")
    .eq("nfc_uid", nfcUid)
    .maybeSingle();
}

// Banco ainda sem a migration 20260929010000 (colunas assigned_by/assigned_at).
function isMissingAssignedByColumn(error: any): boolean {
  const text = `${error?.code ?? ""} ${error?.message ?? ""}`;
  return /42703|PGRST204/.test(text) && /assigned_(by|at)/.test(text);
}

/**
 * Coloca um carretel num slot do AMS por escolha do usuário (lista do
 * estoque ou tag NFC). Um carretel só ocupa um slot: se já estava em outro
 * slot desta impressora, sai de lá. Marca assigned_by = 'user' para o Agent
 * respeitar a escolha (ver amsProjection.reconcileAmsState).
 */
export async function assignSpoolToSlot(
  printerId: string,
  slotIndex: number,
  spoolId: string,
  nowIso: string = new Date().toISOString()
) {
  const cleared = await supabase
    .from("ams_slots")
    .update({ spool_id: null, updated_at: nowIso })
    .eq("printer_id", printerId)
    .eq("spool_id", spoolId);
  if (cleared.error) return cleared;

  const row = { printer_id: printerId, slot_index: slotIndex, spool_id: spoolId, updated_at: nowIso };
  const result = await supabase
    .from("ams_slots")
    .upsert({ ...row, assigned_by: "user", assigned_at: nowIso }, { onConflict: "printer_id,slot_index" });
  if (result.error && isMissingAssignedByColumn(result.error)) {
    return supabase.from("ams_slots").upsert(row, { onConflict: "printer_id,slot_index" });
  }
  return result;
}
