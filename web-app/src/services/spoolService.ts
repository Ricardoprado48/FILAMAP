import { supabase } from "../lib/supabase";
import type {
  WeighUpdatePayload,
  NfcLinkUpdatePayload,
} from "../utils/spoolStatus";
import {
  buildUnlinkNfcUpdate,
  buildLocationUpdate,
} from "../utils/spoolStatus";

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
 * Desvincula a tag NFC de um carretel existente sem alterar peso,
 * tara, localização ou integridade do histórico.
 */
export async function unlinkSpoolNfc(spoolId: string) {
  const payload = buildUnlinkNfcUpdate();
  return supabase.from("spools").update(payload).eq("id", spoolId).select();
}

export interface UpdateLocationResult {
  data: any;
  error: any;
  locationPendingMigration?: boolean;
}

/**
 * Atualiza o spot/localização física de um carretel fora da impressora.
 * Se o banco remoto ainda não tiver a coluna location aplicada, retorna flag
 * locationPendingMigration para feedback ao usuário sem quebrar o fluxo.
 */
export async function updateSpoolLocation(
  spoolId: string,
  location: string | null
): Promise<UpdateLocationResult> {
  const payload = buildLocationUpdate(location);
  const res = await supabase
    .from("spools")
    .update(payload)
    .eq("id", spoolId)
    .select();

  if (
    res.error &&
    (res.error.code === "PGRST204" || res.error.message?.includes("'location'"))
  ) {
    return {
      data: null,
      error: res.error,
      locationPendingMigration: true,
    };
  }
  return {
    data: res.data,
    error: res.error,
    locationPendingMigration: false,
  };
}

export interface CreateSpoolPayload {
  // Identidade: sempre um produto (R5/F7). brand/material/cor são a cópia
  // legada tirada do produto (identityFromProduct).
  filament_product_id: string;
  brand: string | null;
  material: string | null;
  color_name: string;
  color_hex: string | null;
  current_weight: number;
  spool_tare_weight: number;
  initial_weight?: number;
  // Opcional: sem preço grava NULL (nunca um valor padrão inventado).
  price_paid?: number | null;
  location?: string | null;
  nfc_uid?: string | null;
  filament_profile_id?: string | null;
  // Só quando o usuário cria o carretel a partir de um item da nuvem Bambu
  // na caixa de entrada (ação explícita).
  bambu_spool_id?: string | null;
  weight_confirmed_at?: string;
}

export interface CreateSpoolResult {
  data: any;
  error: any;
  locationPendingMigration?: boolean;
}

/**
 * Cria um carretel físico no estoque, sempre ligado a um produto, com peso e
 * tara confirmados pelo usuário.
 * Se a migration da coluna location ainda estiver pendente no Supabase remoto,
 * faz fallback gravando o carretel sem o spot e reporta a pendência.
 */
export async function createSpool(
  payload: CreateSpoolPayload
): Promise<CreateSpoolResult> {
  const row: Record<string, any> = {
    filament_product_id: payload.filament_product_id,
    brand: payload.brand,
    material: payload.material,
    color_name: payload.color_name,
    color_hex: payload.color_hex,
    current_weight: payload.current_weight,
    spool_tare_weight: payload.spool_tare_weight,
    initial_weight: payload.initial_weight ?? payload.current_weight,
    price_paid: payload.price_paid ?? null,
    weight_confirmed_at:
      payload.weight_confirmed_at ?? new Date().toISOString(),
  };
  if (payload.bambu_spool_id) {
    row.bambu_spool_id = payload.bambu_spool_id;
  }

  if (payload.nfc_uid && payload.nfc_uid.trim()) {
    row.nfc_uid = payload.nfc_uid.trim();
  }
  if (payload.filament_profile_id) {
    row.filament_profile_id = payload.filament_profile_id;
  }
  if (payload.location && payload.location.trim()) {
    row.location = payload.location.trim();
  }

  const res = await supabase.from("spools").insert(row).select().single();
  if (
    res.error &&
    (res.error.code === "PGRST204" || res.error.message?.includes("'location'"))
  ) {
    const { location, ...rowWithoutLocation } = row;
    const fallbackRes = await supabase
      .from("spools")
      .insert(rowWithoutLocation)
      .select()
      .single();
    return {
      data: fallbackRes.data,
      error: fallbackRes.error,
      locationPendingMigration: true,
    };
  }

  return {
    data: res.data,
    error: res.error,
    locationPendingMigration: false,
  };
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

/**
 * Arquiva o carretel (D4): sai do estoque, da lista de slots e do AMS, mas o
 * registro continua existindo para o histórico de impressões apontar para ele.
 */
export async function archiveSpool(spoolId: string, nowIso: string = new Date().toISOString()) {
  const cleared = await supabase
    .from("ams_slots")
    .update({ spool_id: null, updated_at: nowIso })
    .eq("spool_id", spoolId);
  if (cleared.error) return cleared;
  return supabase
    .from("spools")
    .update({ archived_at: nowIso })
    .eq("id", spoolId)
    .select("id");
}
