// Integração REAL (F7) contra o banco de TESTE: roda os serviços da Web com o
// usuário de teste e confere o que foi gravado. Não roda no `npm test`; use:
//   VITE_SUPABASE_URL=... VITE_SUPABASE_ANON_KEY=... F7_EMAIL=... F7_PASSWORD=...
//   npx vitest run --config vitest.integration.config.ts
// Recusa a produção. Não apaga nada: o que cria é arquivado/desvinculado no fim.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { supabase } from "../lib/supabase";
import { fetchInventory, fetchUserFilamentProfiles } from "./dataService";
import { fetchProducts, createProduct, createProductFromProfile, updateProductBrand } from "./productService";
import { createSpool, archiveSpool } from "./spoolService";
import { fetchPendingInbox, queueUnknownNfcTag, linkInboxItemToSpool, resolveInboxItem, applyPresetRename } from "./inboxService";
import { identityFromProduct, profilesWithoutProduct } from "../utils/products";
import type { FilamentProduct, SpoolInboxItem, UserFilamentProfile } from "../types";

const url = String(import.meta.env.VITE_SUPABASE_URL || "");
const stamp = Date.now().toString(36).toUpperCase();
const created = { products: [] as string[], profiles: [] as string[], spools: [] as string[] };

beforeAll(async () => {
  if (!url || url.includes("gqtlszffgvxsqcmefhyd")) throw new Error("Recusado: só roda no banco de TESTE.");
  const env = (globalThis as any).process.env;
  const { error } = await supabase.auth.signInWithPassword({ email: env.F7_EMAIL, password: env.F7_PASSWORD });
  if (error) throw error;
});

afterAll(async () => {
  const now = new Date().toISOString();
  for (const id of created.spools) await supabase.from("spools").update({ archived_at: now }).eq("id", id);
  for (const id of created.profiles) await supabase.from("user_filament_profiles").update({ filament_product_id: null }).eq("id", id);
  for (const id of created.products) await supabase.from("filament_products").update({ archived_at: now }).eq("id", id);
  await supabase.auth.signOut({ scope: "local" });
});

describe("F7 contra o banco de teste", () => {
  let product: FilamentProduct;
  let spoolId: string;

  it("lista os 29 produtos da F6", async () => {
    const products = await fetchProducts();
    expect(products.length).toBeGreaterThanOrEqual(29);
    expect(products.some((p) => p.name === "PLA Lite Amarelo")).toBe(true);
  });

  it("cria produto manual e carretel sem preço (NULL) ligado a ele", async () => {
    const p = await createProduct({ name: `TESTE F7 ${stamp}`, brand: "Marca Teste", material: "PLA", color_name: "Azul", color_hex: "#0000FF", origin: "manual" });
    expect(p.error).toBeNull();
    product = p.data as FilamentProduct;
    created.products.push(product.id);

    const s = await createSpool({ ...identityFromProduct(product), filament_product_id: product.id, current_weight: 742, spool_tare_weight: 190 });
    expect(s.error).toBeNull();
    spoolId = s.data.id;
    created.spools.push(spoolId);

    const { data: row } = await supabase.from("spools").select("filament_product_id, price_paid, initial_weight, brand, bambu_spool_id").eq("id", spoolId).single();
    expect(row).toMatchObject({ filament_product_id: product.id, price_paid: null, brand: "Marca Teste", bambu_spool_id: null });
    expect(Number(row!.initial_weight)).toBe(742);
  });

  it("tag desconhecida vai para a caixa de entrada; ligar grava só a tag; ler de novo reabre", async () => {
    const tag = `F7-TAG-${stamp}`;
    const q = await queueUnknownNfcTag(tag, null, 1);
    expect(q.error).toBeNull();
    const item = q.data as SpoolInboxItem;
    expect((await fetchPendingInbox()).some((i) => i.id === item.id)).toBe(true);

    const before = await supabase.from("spools").select("current_weight, spool_tare_weight, filament_product_id").eq("id", spoolId).single();
    const link = await linkInboxItemToSpool(item, { id: spoolId } as any);
    expect(link.error).toBeNull();
    const after = await supabase.from("spools").select("nfc_uid, current_weight, spool_tare_weight, filament_product_id").eq("id", spoolId).single();
    expect(after.data!.nfc_uid).toBe(tag);
    expect({ ...after.data, nfc_uid: undefined }).toEqual({ ...before.data, nfc_uid: undefined });
    const { data: resolved } = await supabase.from("spool_inbox").select("status, resolved_spool_id").eq("id", item.id).single();
    expect(resolved).toEqual({ status: "linked", resolved_spool_id: spoolId });

    const again = await queueUnknownNfcTag(tag, null, 1);
    expect(again.error).toBeNull();
    expect((again.data as SpoolInboxItem).id).toBe(item.id);
    expect((again.data as SpoolInboxItem).status).toBe("pending");
    const ign = await resolveInboxItem(item.id, "ignored", null);
    expect(ign.error).toBeNull();
  });

  it("marca do produto é editável", async () => {
    const r = await updateProductBrand(product.id, "Marca Corrigida");
    expect(r.error).toBeNull();
    const { data } = await supabase.from("filament_products").select("brand").eq("id", product.id).single();
    expect(data!.brand).toBe("Marca Corrigida");
  });

  it("produto a partir de perfil do Studio + preset renomeado (D6) mantém o ID", async () => {
    const all = await fetchProducts();
    const { data: archived } = await supabase.from("filament_products").select("id, name, origin").not("archived_at", "is", null);
    const everyProduct = [...all, ...((archived as FilamentProduct[]) || [])];
    const profiles = await fetchUserFilamentProfiles();
    // A e B: perfis do Studio sem produto e com nome livre (A de preferência um listado,
    // a opção real do Novo Carretel; o banco de teste vai consumindo os listados).
    const taken = new Set(everyProduct.map((p) => p.name.trim().toLowerCase()));
    const free = profiles.filter(
      (p: UserFilamentProfile) => p.source === "bambu_studio" && !p.filament_product_id && !taken.has(p.display_name.trim().toLowerCase())
    );
    const profA = profilesWithoutProduct(profiles, everyProduct)[0] ?? free[0];
    const profB = free.find((p) => p.id !== profA?.id && p.display_name.trim().toLowerCase() !== profA?.display_name.trim().toLowerCase())!;
    expect(profA).toBeTruthy();
    expect(profB).toBeTruthy();

    const fromProfile = await createProductFromProfile(profA, "#123456");
    expect(fromProfile.error).toBeNull();
    const pA = fromProfile.data as FilamentProduct;
    created.products.push(pA.id);
    created.profiles.push(profA.id);
    expect(pA.name).toBe(profA.display_name.trim());
    const { data: linkedA } = await supabase.from("user_filament_profiles").select("filament_product_id").eq("id", profA.id).single();
    expect(linkedA!.filament_product_id).toBe(pA.id);

    const ins = await supabase
      .from("spool_inbox")
      .insert({ source: "preset_renamed", external_id: `F7-OLD-${stamp}`, suggested_product_id: pA.id, payload: { old_display_name: profA.display_name } })
      .select("id, source, external_id, payload, suggested_spool_id, suggested_product_id, status, resolved_spool_id, created_at")
      .single();
    expect(ins.error).toBeNull();
    const ren = await applyPresetRename(ins.data as SpoolInboxItem, profB);
    created.profiles.push(profB.id);
    expect(ren.error).toBeNull();
    const { data: renamed } = await supabase.from("filament_products").select("id, name").eq("id", pA.id).single();
    expect(renamed).toEqual({ id: pA.id, name: profB.display_name.trim() });
  });

  it("nuvem Bambu: trocar vínculo recriado exige confirmação e grava só bambu_spool_id", async () => {
    const s = await createSpool({ ...identityFromProduct(product), filament_product_id: product.id, current_weight: 500, spool_tare_weight: 190, bambu_spool_id: `OLD${stamp}` });
    expect(s.error).toBeNull();
    created.spools.push(s.data.id);
    const ins = await supabase
      .from("spool_inbox")
      .insert({ source: "bambu_cloud", external_id: `NEW${stamp}`, payload: { filament_id: "X" } })
      .select("id, source, external_id, payload, suggested_spool_id, suggested_product_id, status, resolved_spool_id, created_at")
      .single();
    expect(ins.error).toBeNull();
    const item = ins.data as SpoolInboxItem;
    const spoolRow = { id: s.data.id, bambu_spool_id: `OLD${stamp}` } as any;

    const refused = await linkInboxItemToSpool(item, spoolRow);
    expect(refused.error).toBeTruthy();
    const replaced = await linkInboxItemToSpool(item, spoolRow, { replaceCloudLink: true });
    expect(replaced.error).toBeNull();
    const { data } = await supabase.from("spools").select("bambu_spool_id, current_weight, filament_product_id").eq("id", s.data.id).single();
    expect(data).toMatchObject({ bambu_spool_id: `NEW${stamp}`, filament_product_id: product.id });
    expect(Number(data!.current_weight)).toBe(500);
  });

  it("arquivar tira do estoque sem apagar", async () => {
    const r = await archiveSpool(spoolId);
    expect(r.error).toBeNull();
    expect((await fetchInventory())!.some((s) => s.id === spoolId)).toBe(false);
    const { data } = await supabase.from("spools").select("id, archived_at").eq("id", spoolId).single();
    expect(data!.archived_at).toBeTruthy();
  });
});
