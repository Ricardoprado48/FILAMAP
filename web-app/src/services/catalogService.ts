import { supabase } from "../lib/supabase";

export interface CreateCatalogItemInput {
  name: string;
  material: string;
  weight_g: number;
  print_hours: number;
  accessories_cost: number;
  production_cost: number;
  sale_price: number;
}

export async function createCatalogItem(
  input: CreateCatalogItemInput
) {
  return supabase
    .from("catalog_items")
    .insert(input);
}

export async function deleteCatalogItem(
  id: string
) {
  return supabase
    .from("catalog_items")
    .delete()
    .eq("id", id);
}
