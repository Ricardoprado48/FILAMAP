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

export function getBambuStudioBaseDirectories(
  appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming")
): string[] {
  const usersRoot = path.join(appData, "BambuStudio", "user");

  if (!fs.existsSync(usersRoot)) {
    return [];
  }

  return fs
    .readdirSync(usersRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.toLowerCase() !== "default")
    .map((entry) => path.join(usersRoot, entry.name, "filament", "base"))
    .filter((dir) => fs.existsSync(dir));
}

export function readBambuStudioFilamentProfiles(
  appData?: string
): BambuFilamentProfile[] {
  const profiles = new Map<string, BambuFilamentProfile>();

  for (const baseDir of getBambuStudioBaseDirectories(appData)) {
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

        // filament_id é a identidade do produto.
        // Se o mesmo ID aparecer em mais de uma pasta de usuário local,
        // mantém apenas uma entrada para o UPSERT.
        profiles.set(profile.source_key, profile);
      } catch (error: any) {
        console.warn(
          `⚠️ Não foi possível ler preset Bambu Studio "${file.name}":`,
          error?.message || error
        );
      }
    }
  }

  return [...profiles.values()];
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

  const { error } = await supabase
    .from("user_filament_profiles")
    .upsert(rows, {
      onConflict: "user_id,source,source_key",
    });

  if (error) {
    throw error;
  }

  return rows.length;
}