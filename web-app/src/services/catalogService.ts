import { supabase } from "../lib/supabase";
import type { StoredQuotePlate } from "../types";

export interface CreateCatalogItemInput {
  name: string;
  material: string;
  weight_g: number;
  print_hours: number;
  accessories_cost: number;
  production_cost: number;
  sale_price: number;
  notes?: string | null;
  plates?: StoredQuotePlate[] | null;
}

// Banco sem a migration 20261025100000 (colunas notes/plates).
export function isMissingQuoteColumns(error: any): boolean {
  const text = `${error?.code ?? ""} ${error?.message ?? ""}`;
  return /42703|PGRST204/.test(text) && /notes|plates/.test(text);
}

// Grava o item; banco ainda sem notes/plates salva o resto e avisa (savedQuote=false).
export async function createCatalogItem(input: CreateCatalogItemInput) {
  const first = await supabase.from("catalog_items").insert(input);
  if (first.error && isMissingQuoteColumns(first.error)) {
    const { notes: _n, plates: _p, ...legacy } = input;
    const retry = await supabase.from("catalog_items").insert(legacy);
    return { ...retry, savedQuote: false };
  }
  return { ...first, savedQuote: true };
}

export async function deleteCatalogItem(
  id: string
) {
  return supabase
    .from("catalog_items")
    .delete()
    .eq("id", id);
}
