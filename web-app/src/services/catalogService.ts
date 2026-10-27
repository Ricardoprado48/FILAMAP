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

// Grava o item: com id atualiza o mesmo orçamento, sem id cria outro. Banco ainda sem
// as colunas do orçamento salva o resto e avisa (savedQuote=false).
export async function saveCatalogItem(input: CreateCatalogItemInput, id?: string | null) {
  const write = (row: Partial<CreateCatalogItemInput>) =>
    id ? supabase.from("catalog_items").update(row).eq("id", id) : supabase.from("catalog_items").insert(row);
  const first = await write(input);
  if (first.error && isMissingQuoteColumns(first.error)) {
    const { notes: _n, plates: _p, ...legacy } = input;
    const retry = await write(legacy);
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
