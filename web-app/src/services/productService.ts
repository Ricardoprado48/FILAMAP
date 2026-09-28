import { supabase } from "../lib/supabase";
import type { FilamentProduct, UserFilamentProfile } from "../types";
import { productFromProfile } from "../utils/products";

export async function fetchProducts(): Promise<FilamentProduct[]> {
  const { data, error } = await supabase
    .from("filament_products")
    .select("id, name, brand, material, color_name, color_hex, density, origin, archived_at")
    .is("archived_at", null)
    .order("name", { ascending: true });
  if (error) {
    console.warn("Falha ao buscar produtos:", error.message || error);
    return [];
  }
  return (data as FilamentProduct[]) || [];
}

export interface NewProductInput {
  name: string;
  brand?: string | null;
  material?: string | null;
  color_name?: string | null;
  color_hex?: string | null;
  origin: FilamentProduct["origin"];
}

export async function createProduct(input: NewProductInput) {
  return supabase
    .from("filament_products")
    .insert({
      name: input.name.trim(),
      brand: input.brand?.trim() || null,
      material: input.material?.trim() || null,
      color_name: input.color_name?.trim() || null,
      color_hex: input.color_hex || null,
      origin: input.origin,
    })
    .select("id, name, brand, material, color_name, color_hex, density, origin, archived_at")
    .single();
}

/**
 * Cria o produto a partir de um perfil do Bambu Studio e liga o perfil a ele
 * (ação explícita do usuário no Novo Carretel). O perfil em si continua sendo
 * do Bambu Studio: aqui só se grava o vínculo filament_product_id.
 */
export async function createProductFromProfile(profile: UserFilamentProfile, colorHex?: string | null) {
  const created = await createProduct({ ...productFromProfile(profile), color_hex: colorHex || null });
  if (created.error || !created.data) return created;
  const linked = await supabase
    .from("user_filament_profiles")
    .update({ filament_product_id: created.data.id })
    .eq("id", profile.id)
    .select("id");
  if (linked.error) return { data: null, error: linked.error };
  return created;
}

export async function updateProductBrand(productId: string, brand: string | null) {
  return supabase
    .from("filament_products")
    .update({ brand: brand?.trim() || null, updated_at: new Date().toISOString() })
    .eq("id", productId)
    .select("id");
}
