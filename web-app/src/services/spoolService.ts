import { supabase } from "../lib/supabase";
import type { Spool } from "../types";

export async function findSpoolByNfcUid(nfcUid: string): Promise<Spool | null> {
  const { data } = await supabase.from("spools").select("*").eq("nfc_uid", nfcUid).single();
  return data;
}

export async function createPlaceholderSpool(nfcUid: string): Promise<Spool | null> {
  const { data } = await supabase.from("spools").insert({
    nfc_uid: nfcUid, brand: "Voolt3D", material: "PETG", color_name: "Preto",
    color_hex: "#111827", initial_weight: 1000, current_weight: 1000,
    spool_tare_weight: 218, price_paid: 85.00,
  }).select().single();
  return data;
}

export async function assignSpoolToSlot(printerId: string, slotIndex: number, spoolId: string) {
  await supabase.from("ams_slots").upsert({
    printer_id: printerId, slot_index: slotIndex, spool_id: spoolId, updated_at: new Date().toISOString(),
  }, { onConflict: "printer_id,slot_index" });
}

export async function ejectSlot(printerId: string, slotIndex: number) {
  await supabase.from("ams_slots").update({ spool_id: null, updated_at: new Date().toISOString() }).eq("printer_id", printerId).eq("slot_index", slotIndex);
}

export async function updateSpoolWeight(spoolId: string, netWeight: number, tare: number) {
  await supabase.from("spools").update({ current_weight: netWeight, spool_tare_weight: tare }).eq("id", spoolId);
}

export interface SpoolEditFields {
  brand: string;
  material: string;
  color_name: string;
  color_hex: string;
  spool_tare_weight: number;
  current_weight: number;
  price_paid: number;
}

export async function updateSpoolFields(spoolId: string, fields: SpoolEditFields) {
  const { data, error } = await supabase.from("spools").update(fields).eq("id", spoolId).select();
  return { data, error };
}

export async function deleteSpool(spoolId: string) {
  await supabase.from("ams_slots").update({ spool_id: null }).eq("spool_id", spoolId);
  await supabase.from("spools").delete().eq("id", spoolId);
}

export interface WriteTagFields {
  nfc_uid: string;
  current_weight: number;
  spool_tare_weight: number;
  nfc_written_at: string;
}

export async function writeTagToSpool(spoolId: string, fields: WriteTagFields) {
  const { error } = await supabase.from("spools").update(fields).eq("id", spoolId);
  return { error };
}
