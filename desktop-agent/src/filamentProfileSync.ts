import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface BambuFilamentProfile {
  source: "bambu_studio";
  source_key: string;
  source_profile_name: string;
  display_name: string;
  material: string;
  color_name: string | null;
  model_name: string | null;
  brand: string | null;
  source_metadata: Record<string, unknown>;
  // true = aparece na lista do "Novo Carretel" (veio da pasta do fatiador
  // em uso). Perfis de pastas antigas ficam guardados, fora da lista.
  listed: boolean;
}

function firstString(value: unknown): string {
  if (Array.isArray(value)) {
    const first = value[0];
    return first == null ? "" : String(first).trim();
  }

  if (value == null) return "";

  return String(value).trim();
}

export function cleanDisplayName(name: string): string {
  return name
    .replace(/\s*@Bambu Lab A1 0\.4 nozzle\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseBambuFilamentPreset(
  raw: Record<string, unknown>,
  fileName: string
): BambuFilamentProfile | null {
  const filamentId = firstString(raw.filament_id);

  // Presets calibrados/derivados normalmente não possuem filament_id.
  // Eles não representam um novo produto físico no Filamap.
  if (!filamentId) {
    return null;
  }

  const sourceProfileName = firstString(raw.name);

  if (!sourceProfileName) {
    return null;
  }

  const material = firstString(raw.filament_type).toUpperCase();

  if (!material) {
    return null;
  }

  const vendor = firstString(raw.filament_vendor);
  const defaultColour = firstString(raw.default_filament_colour);
  const displayName = cleanDisplayName(sourceProfileName);
  const displayTokens = displayName.split(/\s+/).filter(Boolean);
  const parsedBrand =
    displayTokens.length > 0
      ? displayTokens[displayTokens.length - 1]
      : "";

  return {
    listed: true,
    source: "bambu_studio",
    source_key: filamentId,
    source_profile_name: sourceProfileName,
    display_name: displayName,
    material,
    color_name: null,
    model_name: null,
    brand: parsedBrand || null,
    source_metadata: {
      filament_id: filamentId,
      filament_settings_id: firstString(raw.filament_settings_id),
      filament_vendor: vendor,
      default_filament_colour: defaultColour,
      filament_density: firstString(raw.filament_density),
      filament_diameter: firstString(raw.filament_diameter),
      filament_cost: firstString(raw.filament_cost),
      filament_flow_ratio: firstString(raw.filament_flow_ratio),
      version: firstString(raw.version),
      file_name: fileName,
    },
  };
}

export const SUPPORTED_SLICER_DIRS = [
  "BambuStudio",
  "BambuStudioBeta",
  "OrcaSlicer",
] as const;

export function getBambuStudioBaseDirectories(
  appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming")
): string[] {
  const baseDirs: string[] = [];

  for (const slicerDir of SUPPORTED_SLICER_DIRS) {
    const usersRoot = path.join(appData, slicerDir, "user");

    if (!fs.existsSync(usersRoot)) {
      continue;
    }

    try {
      const userBases = fs
        .readdirSync(usersRoot, { withFileTypes: true })
        .filter(
          (entry) =>
            entry.isDirectory() && entry.name.toLowerCase() !== "default"
        )
        .map((entry) => path.join(usersRoot, entry.name, "filament", "base"))
        .filter((dir) => fs.existsSync(dir));

      baseDirs.push(...userBases);
    } catch {
      // Ignora erro de acesso a diretório
    }
  }

  return baseDirs;
}

// Pasta do fatiador (BambuStudio, BambuStudioBeta, OrcaSlicer) de um
// diretório .../<slicer>/user/<id>/filament/base.
function slicerDirOf(baseDir: string): string {
  return path.basename(path.resolve(baseDir, "..", "..", "..", ".."));
}

/**
 * Lê os presets de filamento de todas as pastas de fatiador conhecidas.
 *
 * Só UM fatiador está em uso de fato: quando o Bambu Studio muda de canal
 * (estável -> beta), os dados passam para outra pasta e a antiga fica
 * parada, com cópias dos mesmos produtos sob outros filament_id (renomear
 * um preset também gera filament_id novo). Mostrar tudo duplicaria a lista.
 *
 * Regra (sem comparar nomes): a pasta com o preset alterado mais
 * recentemente é a "em uso"; só os perfis dela ficam listed=true. Os das
 * outras pastas continuam sendo retornados (listed=false) porque carretéis,
 * AMS e nuvem Bambu ainda podem referenciar esses filament_id.
 */
export function readBambuStudioFilamentProfiles(
  appData?: string
): BambuFilamentProfile[] {
  const bySlicer = new Map<string, { newestMtimeMs: number; profiles: BambuFilamentProfile[] }>();

  for (const baseDir of getBambuStudioBaseDirectories(appData)) {
    const slicerDir = slicerDirOf(baseDir);
    const bucket = bySlicer.get(slicerDir) ?? { newestMtimeMs: 0, profiles: [] };
    bySlicer.set(slicerDir, bucket);

    const files = fs
      .readdirSync(baseDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"));

    for (const file of files) {
      const fullPath = path.join(baseDir, file.name);

      try {
        const raw = JSON.parse(
          fs.readFileSync(fullPath, "utf8")
        ) as Record<string, unknown>;

        const profile = parseBambuFilamentPreset(raw, file.name);

        if (!profile) continue;

        profile.source_metadata.slicer_dir = slicerDir;
        bucket.profiles.push(profile);
        bucket.newestMtimeMs = Math.max(bucket.newestMtimeMs, fs.statSync(fullPath).mtimeMs);
      } catch (error: any) {
        console.warn(
          `⚠️ Não foi possível ler preset Bambu Studio "${file.name}":`,
          error?.message || error
        );
      }
    }
  }

  let activeSlicer: string | null = null;
  let activeMtime = -1;
  for (const [slicerDir, bucket] of bySlicer) {
    if (bucket.profiles.length > 0 && bucket.newestMtimeMs > activeMtime) {
      activeSlicer = slicerDir;
      activeMtime = bucket.newestMtimeMs;
    }
  }

  // filament_id é a identidade do preset. Se o mesmo ID aparece em mais de
  // uma pasta, fica uma entrada só -- a da pasta em uso, quando existir.
  const profiles = new Map<string, BambuFilamentProfile>();
  const ordered = [...bySlicer.entries()].sort(([a], [b]) =>
    a === activeSlicer ? 1 : b === activeSlicer ? -1 : 0
  );
  for (const [slicerDir, bucket] of ordered) {
    for (const profile of bucket.profiles) {
      profile.listed = slicerDir === activeSlicer;
      profiles.set(profile.source_key, profile);
    }
  }

  return [...profiles.values()];
}

// Banco sem a migration 20260928110000 (coluna is_listed).
function isMissingIsListedColumn(error: any): boolean {
  const text = `${error?.code ?? ""} ${error?.message ?? ""}`;
  return /42703|PGRST204/.test(text) && /is_listed/.test(text);
}

export async function syncBambuStudioFilamentProfiles(
  supabase: SupabaseClient,
  userId: string,
  appData?: string
): Promise<number> {
  const profiles = readBambuStudioFilamentProfiles(appData);

  if (profiles.length === 0) {
    return 0;
  }

  const now = new Date().toISOString();

  const rows = profiles.map((profile) => ({
    is_listed: profile.listed,
    user_id: userId,
    source: profile.source,
    source_key: profile.source_key,
    source_profile_name: profile.source_profile_name,
    display_name: profile.display_name,
    material: profile.material,
    color_name: profile.color_name,
    model_name: profile.model_name,
    brand: profile.brand,
    source_metadata: profile.source_metadata,
    last_seen_at: now,
    updated_at: now,
  }));

  let { error } = await supabase
    .from("user_filament_profiles")
    .upsert(rows, {
      onConflict: "user_id,source,source_key",
    });

  if (error && isMissingIsListedColumn(error)) {
    const legacyRows = rows.map(({ is_listed: _ignored, ...rest }) => rest);
    ({ error } = await supabase
      .from("user_filament_profiles")
      .upsert(legacyRows, { onConflict: "user_id,source,source_key" }));
    if (error) throw error;
    return rows.length;
  }

  if (error) {
    throw error;
  }

  // Preset apagado no fatiador sai da lista (a linha fica: carretéis podem
  // apontar para ela).
  const presentKeys = rows.map((r) => `"${r.source_key.replace(/"/g, '\\"')}"`).join(",");
  const { error: unlistError } = await supabase
    .from("user_filament_profiles")
    .update({ is_listed: false })
    .eq("user_id", userId)
    .eq("source", "bambu_studio")
    .not("source_key", "in", `(${presentKeys})`);
  if (unlistError && !isMissingIsListedColumn(unlistError)) {
    throw unlistError;
  }

  await queueMissingProductPresets(supabase, userId, presentKeys);

  return rows.length;
}

/**
 * Preset que sumiu do fatiador (rename gera filament_id novo) mas ja representa um
 * FILAMENT_PRODUCT (decisao D6): vira pendencia 'preset_renamed' na caixa de entrada para
 * o usuario confirmar qual preset novo e o mesmo produto. Nunca religa nada sozinho e
 * nunca derruba o sync (banco sem as tabelas/colunas novas -> nao faz nada).
 */
export async function queueMissingProductPresets(
  supabase: SupabaseClient,
  userId: string,
  presentKeys: string
): Promise<number> {
  try {
    const { data, error } = await supabase
      .from("user_filament_profiles")
      .select("source_key, display_name, filament_product_id")
      .eq("user_id", userId)
      .eq("source", "bambu_studio")
      .not("source_key", "in", `(${presentKeys})`)
      .not("filament_product_id", "is", null);
    if (error || !data || data.length === 0) return 0;

    const inbox = data.map((p: any) => ({
      user_id: userId,
      source: "preset_renamed",
      external_id: p.source_key,
      suggested_product_id: p.filament_product_id,
      payload: { old_source_key: p.source_key, old_display_name: p.display_name },
    }));
    const { error: inboxError } = await supabase
      .from("spool_inbox")
      .upsert(inbox, { onConflict: "user_id,source,external_id", ignoreDuplicates: true });
    return inboxError ? 0 : inbox.length;
  } catch {
    return 0;
  }
}