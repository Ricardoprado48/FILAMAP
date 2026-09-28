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
  brand: string;
  material: string;
  color_name: string;
  color_hex: string;
  current_weight: number;
  spool_tare_weight: number;
  initial_weight?: number;
  price_paid?: number;
  location?: string | null;
  nfc_uid?: string | null;
  filament_profile_id?: string | null;
  weight_confirmed_at?: string;
}

export interface CreateSpoolResult {
  data: any;
  error: any;
  locationPendingMigration?: boolean;
}

/**
 * Cria um carretel físico no estoque com peso e tara confirmados pelo usuário.
 * Pode ser pré-preenchido por perfil do Bambu Studio ou entrada 100% manual.
 * Se a migration da coluna location ainda estiver pendente no Supabase remoto,
 * faz fallback gravando o carretel sem o spot e reporta a pendência.
 */
export async function createSpool(
  payload: CreateSpoolPayload
): Promise<CreateSpoolResult> {
  const row: Record<string, any> = {
    brand: payload.brand,
    material: payload.material,
    color_name: payload.color_name,
    color_hex: payload.color_hex,
    current_weight: payload.current_weight,
    spool_tare_weight: payload.spool_tare_weight,
    initial_weight: payload.initial_weight ?? payload.current_weight,
    price_paid: payload.price_paid ?? 85.0,
    weight_confirmed_at:
      payload.weight_confirmed_at ?? new Date().toISOString(),
  };

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

