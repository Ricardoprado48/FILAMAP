import { supabase } from "../lib/supabase";
import type { Printer, Spool, CatalogItem, PrintLog } from "../types";

export async function fetchPrinters(): Promise<Printer[] | null> {
  const { data } = await supabase.from("printers").select("*");
  return data;
}

export async function fetchAmsSlots(printerId: string): Promise<{ slot_index: number; spool: Spool | null }[] | null> {
  const { data } = await supabase.from("ams_slots").select("slot_index, spool:spools(*)").eq("printer_id", printerId);
  return data as unknown as { slot_index: number; spool: Spool | null }[] | null;
}

export async function fetchInventory(): Promise<Spool[] | null> {
  const { data } = await supabase.from("spools").select("*").order("color_name", { ascending: true });
  return data;
}

export async function fetchCatalog(): Promise<CatalogItem[] | null> {
  const { data } = await supabase.from("catalog_items").select("*");
  return data;
}

export async function fetchPrintLogs(): Promise<PrintLog[] | null> {
  const { data } = await supabase.from("print_logs").select("*, spool:spools(*)").order("completed_at", { ascending: false }).limit(10);
  return data;
}
