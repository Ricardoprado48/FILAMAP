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
