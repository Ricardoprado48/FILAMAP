import { supabase } from "../lib/supabase";
import type {
  CatalogItem,
  Printer,
  PrintLog,
  Spool,
} from "../types";

export async function fetchPrinters(): Promise<Printer[] | null> {
  const { data } = await supabase
    .from("printers")
    .select("*");

  return data as Printer[] | null;
}

export async function fetchActiveSlots(
  printerId: string
): Promise<Record<number, Spool | null> | null> {
  const { data } = await supabase
    .from("ams_slots")
    .select("slot_index, spool:spools(*)")
    .eq("printer_id", printerId);

  if (!data) {
    return null;
  }

  const slotsMap: Record<number, Spool | null> = {
    0: null,
    1: null,
    2: null,
    3: null,
  };

  data.forEach((slot: any) => {
    slotsMap[slot.slot_index] = slot.spool;
  });

  return slotsMap;
}

export async function fetchInventory(): Promise<Spool[] | null> {
  const { data } = await supabase
    .from("spools")
    .select("*")
    .order("color_name", { ascending: true });

  return data as Spool[] | null;
}

export async function fetchCatalog(): Promise<CatalogItem[] | null> {
  const { data } = await supabase
    .from("catalog_items")
    .select("*");

  return data as CatalogItem[] | null;
}

export async function fetchPrintLogs(): Promise<PrintLog[] | null> {
  const { data } = await supabase
    .from("print_logs")
    .select("*, spool:spools(*)")
    .order("completed_at", { ascending: false })
    .limit(10);

  return data as PrintLog[] | null;
}
