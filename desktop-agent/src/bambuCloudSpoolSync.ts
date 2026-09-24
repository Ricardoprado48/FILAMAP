import path from "node:path";
import { spawn } from "node:child_process";
import type { SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Bridge: chamada do processo + extração do JSON do stdout
// ---------------------------------------------------------------------------

export const JSON_SECTION_MARKER = "=== JSON ===";

export interface BridgeRunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export interface RunBridgeOptions {
  executablePath?: string;
  timeoutMs?: number;
}

export function buildBridgeExecutablePath(
  envPath: string | undefined,
  isPackaged: boolean,
  execPath: string,
  moduleDir: string
): string {
  if (envPath) return envPath;

  const baseDir = isPackaged
    ? path.dirname(execPath)
    : path.join(moduleDir, "..");

  return path.join(baseDir, "bambu-bridge", "filamap-bambu-bridge.exe");
}

export function resolveBridgeExecutablePath(): string {
  return buildBridgeExecutablePath(
    process.env.FILAMAP_BAMBU_BRIDGE_PATH,
    Boolean((process as NodeJS.Process & { pkg?: unknown }).pkg),
    process.execPath,
    __dirname
  );
}

/**
 * Roda o executável da bridge Bambu e captura stdout/stderr/exit code.
 * Nunca rejeita: bridge ausente, crash ou timeout viram um resultado com
 * exitCode null/stderr preenchido, tratado depois por processBridgeOutput.
 */
export function runBambuBridge(
  options: RunBridgeOptions = {}
): Promise<BridgeRunResult> {
  const executablePath = options.executablePath || resolveBridgeExecutablePath();
  const timeoutMs = options.timeoutMs ?? 30000;

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;

    let child;
    try {
      child = spawn(executablePath, [], { windowsHide: true });
    } catch (error: any) {
      resolve({ stdout: "", stderr: error?.message || String(error), exitCode: null });
      return;
    }

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      resolve({
        stdout,
        stderr: stderr || "Timeout aguardando resposta da bridge Bambu.",
        exitCode: null,
      });
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr: error?.message || String(error), exitCode: null });
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code });
    });
  });
}

/** Extrai apenas o texto após o marcador "=== JSON ===" (regra 3). */
export function extractJsonSection(stdout: string): string | null {
  const idx = stdout.indexOf(JSON_SECTION_MARKER);
  if (idx === -1) return null;
  return stdout.slice(idx + JSON_SECTION_MARKER.length).trim();
}

function extractRecordsArray(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;

  if (parsed && typeof parsed === "object") {
    // A bridge repassa o corpo bruto da Bambu -- não documentado publicamente
    // se é array direto ou envelope {list:[...]}. Aceita as chaves plausíveis
    // em vez de assumir uma forma específica. "hits" é a forma real
    // confirmada por homologação contra bambu_network_get_filament_spools.
    for (const key of ["hits", "list", "spools", "items", "data", "result", "filament_spools", "filamentSpools"]) {
      const value = (parsed as Record<string, unknown>)[key];
      if (Array.isArray(value)) return value;
    }
  }

  return [];
}

// ---------------------------------------------------------------------------
// Parsing de cada registro de spool físico
// ---------------------------------------------------------------------------

export interface ParsedBambuCloudSpool {
  bambuSpoolId: string;
  filamentId: string;
  filamentVendor: string | null;
  filamentType: string;
  filamentName: string;
  rfid: string | null;
  color: string | null;
  colors: string[];
  netWeight: number | null;
  totalNetWeight: number | null;
  note: string | null;
  category: string | null;
  createType: string | null;
  inPrinter: boolean;
  devId: string | null;
  deviceName: string | null;
  amsSn: string | null;
  amsId: string | null;
  slotId: string | null;
  depleted: boolean;
  bambuCreatedAt: string | null;
  bambuUpdatedAt: string | null;
}

function toText(value: unknown): string {
  if (Array.isArray(value)) {
    return value.length > 0 ? toText(value[0]) : "";
  }
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function toTextOrNull(value: unknown): string | null {
  const text = toText(value);
  return text.length > 0 ? text : null;
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toBooleanOrDefault(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "true" || v === "1") return true;
    if (v === "false" || v === "0") return false;
  }
  return fallback;
}

/**
 * Valida e normaliza um registro bruto retornado pela bridge.
 * Retorna null para registros vazios/inválidos (regra 5): sem id do spool,
 * sem filamentId, ou sem os dados mínimos pra criar um perfil (material,
 * nome) -- ex.: registros de spool vazio como o id=15589351 citado no
 * escopo desta tarefa.
 */
export function parseBambuCloudSpoolRecord(raw: unknown): ParsedBambuCloudSpool | null {
  if (!raw || typeof raw !== "object") return null;

  const rec = raw as Record<string, unknown>;

  const bambuSpoolId = toText(rec.id);
  const filamentId = toText(rec.filamentId);
  const filamentType = toText(rec.filamentType).toUpperCase();
  const filamentName = toText(rec.filamentName);

  if (!bambuSpoolId || !filamentId || !filamentType || !filamentName) {
    return null;
  }

  const colorsRaw = rec.colors;
  const colors = Array.isArray(colorsRaw)
    ? colorsRaw.map((c) => toText(c)).filter(Boolean)
    : [];

  return {
    bambuSpoolId,
    filamentId,
    filamentVendor: toTextOrNull(rec.filamentVendor),
    filamentType,
    filamentName,
    rfid: toTextOrNull(rec.RFID),
    color: toTextOrNull(rec.color),
    colors,
    netWeight: toNumberOrNull(rec.netWeight),
    totalNetWeight: toNumberOrNull(rec.totalNetWeight),
    note: toTextOrNull(rec.note),
    category: toTextOrNull(rec.category),
    createType: toTextOrNull(rec.createType),
    inPrinter: toBooleanOrDefault(rec.inPrinter, false),
    devId: toTextOrNull(rec.devId),
    deviceName: toTextOrNull(rec.deviceName),
    amsSn: toTextOrNull(rec.amsSn),
    amsId: toTextOrNull(rec.amsId),
    slotId: toTextOrNull(rec.slotId),
    depleted: toBooleanOrDefault(rec.depleted, false),
    bambuCreatedAt: toTextOrNull(rec.createdAt),
    bambuUpdatedAt: toTextOrNull(rec.updatedAt),
  };
}

export interface BridgeSpoolsParseResult {
  spools: ParsedBambuCloudSpool[];
  skippedCount: number;
  totalRecords: number;
}

/**
 * Pipeline completo de interpretação do resultado da bridge: exit code,
 * marcador "=== JSON ===", JSON válido e, por fim, cada registro.
 * Lança erro descritivo em qualquer etapa que falhe -- quem chama decide
 * como tolerar (index.ts loga e segue, nunca mata o Agent).
 */
export function processBridgeOutput(result: BridgeRunResult): BridgeSpoolsParseResult {
  if (result.exitCode !== 0) {
    throw new Error(
      `Bridge Bambu encerrou com código ${result.exitCode ?? "desconhecido"}: ${
        result.stderr.trim() || result.stdout.trim() || "sem detalhes"
      }`
    );
  }

  const jsonText = extractJsonSection(result.stdout);

  if (jsonText === null || jsonText.length === 0) {
    throw new Error(`Saída da bridge Bambu não contém a seção "${JSON_SECTION_MARKER}".`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error: any) {
    throw new Error(`JSON inválido retornado pela bridge Bambu: ${error?.message || error}`);
  }

  const rawRecords = extractRecordsArray(parsed);
  const spools: ParsedBambuCloudSpool[] = [];

  for (const rawRecord of rawRecords) {
    const parsedRecord = parseBambuCloudSpoolRecord(rawRecord);
    if (parsedRecord) spools.push(parsedRecord);
  }

  return {
    spools,
    skippedCount: rawRecords.length - spools.length,
    totalRecords: rawRecords.length,
  };
}

export async function fetchBambuCloudSpools(
  options: RunBridgeOptions = {}
): Promise<BridgeSpoolsParseResult> {
  const result = await runBambuBridge(options);
  return processBridgeOutput(result);
}

// ---------------------------------------------------------------------------
// Upsert em Supabase: perfil lógico (bambu_cloud) + spool físico
// ---------------------------------------------------------------------------

interface BambuCloudProfileRow {
  user_id: string;
  source: "bambu_cloud";
  source_key: string;
  source_profile_name: string;
  display_name: string;
  material: string;
  color_name: string | null;
  model_name: string | null;
  brand: string | null;
  source_metadata: Record<string, unknown>;
  last_seen_at: string;
  updated_at: string;
}

function buildProfileRow(
  spool: ParsedBambuCloudSpool,
  userId: string,
  now: string
): BambuCloudProfileRow {
  return {
    user_id: userId,
    source: "bambu_cloud",
    source_key: spool.filamentId,
    source_profile_name: spool.filamentName,
    display_name: spool.filamentName,
    material: spool.filamentType,
    color_name: spool.color,
    model_name: null,
    brand: spool.filamentVendor,
    source_metadata: {
      filament_id: spool.filamentId,
      filament_vendor: spool.filamentVendor,
      filament_type: spool.filamentType,
      filament_name: spool.filamentName,
    },
    last_seen_at: now,
    updated_at: now,
  };
}

function buildSourceMetadata(spool: ParsedBambuCloudSpool): Record<string, unknown> {
  return {
    create_type: spool.createType,
    rfid: spool.rfid,
    color: spool.color,
    colors: spool.colors,
    net_weight: spool.netWeight,
    total_net_weight: spool.totalNetWeight,
    note: spool.note,
    category: spool.category,
    depleted: spool.depleted,
    bambu_created_at: spool.bambuCreatedAt,
    bambu_updated_at: spool.bambuUpdatedAt,
  };
}

/**
 * Payload de INSERT: só roda pra spool físico novo, então precisa
 * preencher as colunas NOT NULL (brand, material) -- não há dado local
 * anterior pra preservar ainda.
 */
function buildSpoolInsertRow(
  spool: ParsedBambuCloudSpool,
  userId: string,
  filamentProfileId: string | null,
  now: string
) {
  return {
    user_id: userId,
    bambu_spool_id: spool.bambuSpoolId,
    filament_profile_id: filamentProfileId,
    brand: spool.filamentVendor || spool.filamentType,
    material: spool.filamentType,
    color_name: spool.color,
    bambu_in_printer: spool.inPrinter,
    bambu_dev_id: spool.devId,
    bambu_device_name: spool.deviceName,
    bambu_ams_sn: spool.amsSn,
    bambu_ams_id: spool.amsId,
    bambu_slot_id: spool.slotId,
    bambu_source_metadata: buildSourceMetadata(spool),
    bambu_synced_at: now,
  };
}

/**
 * Payload de UPDATE: de propósito só contém localização + vínculo de
 * perfil (regra 9). NFC, peso real, consumo acumulado e qualquer outro
 * campo controlado pelo Filamap (regra 10) nunca aparecem aqui -- por não
 * estarem na chave do UPDATE, o Supabase/Postgres não os toca.
 */
function buildSpoolUpdateRow(
  spool: ParsedBambuCloudSpool,
  filamentProfileId: string | null,
  now: string
) {
  return {
    filament_profile_id: filamentProfileId,
    bambu_in_printer: spool.inPrinter,
    bambu_dev_id: spool.devId,
    bambu_device_name: spool.deviceName,
    bambu_ams_sn: spool.amsSn,
    bambu_ams_id: spool.amsId,
    bambu_slot_id: spool.slotId,
    bambu_source_metadata: buildSourceMetadata(spool),
    bambu_synced_at: now,
    updated_at: now,
  };
}

export interface BambuCloudSpoolSyncCounts {
  profilesUpserted: number;
  spoolsInserted: number;
  spoolsUpdated: number;
}

/**
 * Recebe spools já validados (parseBambuCloudSpoolRecord) e faz o upsert
 * no Supabase. Separado de fetchBambuCloudSpools para que a lógica de
 * banco seja testável sem precisar rodar a bridge de verdade.
 */
export async function syncBambuCloudSpoolsFromParsed(
  supabase: SupabaseClient,
  userId: string,
  spools: ParsedBambuCloudSpool[]
): Promise<BambuCloudSpoolSyncCounts> {
  if (spools.length === 0) {
    return { profilesUpserted: 0, spoolsInserted: 0, spoolsUpdated: 0 };
  }

  const now = new Date().toISOString();

  // filamentId identifica o perfil lógico -- vários spools físicos podem
  // compartilhar o mesmo filamentId, então dedup antes do upsert evita
  // linhas conflitantes na mesma chamada.
  const profileRowByFilamentId = new Map<string, BambuCloudProfileRow>();
  for (const spool of spools) {
    profileRowByFilamentId.set(spool.filamentId, buildProfileRow(spool, userId, now));
  }

  const { data: upsertedProfiles, error: profileError } = await supabase
    .from("user_filament_profiles")
    .upsert([...profileRowByFilamentId.values()], {
      onConflict: "user_id,source,source_key",
    })
    .select("id, source_key");

  if (profileError) throw profileError;

  const profileIdByFilamentId = new Map<string, string>(
    (upsertedProfiles || []).map((row: any) => [row.source_key as string, row.id as string])
  );

  const bambuSpoolIds = spools.map((s) => s.bambuSpoolId);

  const { data: existingSpools, error: existingError } = await supabase
    .from("spools")
    .select("id, bambu_spool_id")
    .eq("user_id", userId)
    .in("bambu_spool_id", bambuSpoolIds);

  if (existingError) throw existingError;

  const existingIdByBambuSpoolId = new Map<string, string>(
    (existingSpools || []).map((row: any) => [row.bambu_spool_id as string, row.id as string])
  );

  const rowsToInsert: ReturnType<typeof buildSpoolInsertRow>[] = [];
  const rowsToUpdate: { id: string; payload: ReturnType<typeof buildSpoolUpdateRow> }[] = [];

  for (const spool of spools) {
    const filamentProfileId = profileIdByFilamentId.get(spool.filamentId) ?? null;
    const existingId = existingIdByBambuSpoolId.get(spool.bambuSpoolId);

    if (existingId) {
      rowsToUpdate.push({
        id: existingId,
        payload: buildSpoolUpdateRow(spool, filamentProfileId, now),
      });
    } else {
      rowsToInsert.push(buildSpoolInsertRow(spool, userId, filamentProfileId, now));
    }
  }

  if (rowsToInsert.length > 0) {
    const { error: insertError } = await supabase.from("spools").insert(rowsToInsert);
    if (insertError) throw insertError;
  }

  for (const update of rowsToUpdate) {
    const { error: updateError } = await supabase
      .from("spools")
      .update(update.payload)
      .eq("id", update.id);

    if (updateError) throw updateError;
  }

  return {
    profilesUpserted: profileRowByFilamentId.size,
    spoolsInserted: rowsToInsert.length,
    spoolsUpdated: rowsToUpdate.length,
  };
}

export interface BambuCloudSpoolSyncResult extends BambuCloudSpoolSyncCounts {
  totalRecords: number;
  skippedRecords: number;
}

/** Ponto de entrada usado pelo Agent: roda a bridge e sincroniza o resultado. */
export async function syncBambuCloudSpools(
  supabase: SupabaseClient,
  userId: string,
  options: RunBridgeOptions = {}
): Promise<BambuCloudSpoolSyncResult> {
  const { spools, skippedCount, totalRecords } = await fetchBambuCloudSpools(options);

  const counts = await syncBambuCloudSpoolsFromParsed(supabase, userId, spools);

  return {
    totalRecords,
    skippedRecords: skippedCount,
    ...counts,
  };
}
