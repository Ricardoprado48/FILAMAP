import { supabase } from "../lib/supabase";

export interface NewCatalogItemPayload {
  name: string;
  material: string;
  weight_g: number;
  print_hours: number;
  accessories_cost: number;
  production_cost: number;
  sale_price: number;
}

export async function insertCatalogItem(payload: NewCatalogItemPayload) {
  const { error } = await supabase.from("catalog_items").insert(payload);
  return { error };
}

export async function deleteCatalogItem(id: string) {
  await supabase.from("catalog_items").delete().eq("id", id);
}
