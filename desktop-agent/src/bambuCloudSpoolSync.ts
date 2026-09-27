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

export interface ReconciliationCandidate {
  id: string;
  brand?: string | null;
  material?: string | null;
  color_name?: string | null;
  color_hex?: string | null;
  bambu_spool_id?: string | null;
  bambu_source_metadata?: Record<string, unknown> | null;
  filament_profile_id?: string | null;
}

function cleanText(str: string | null | undefined): string {
  if (!str) return "";
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function isStrongCandidateMatch(
  candidate: ReconciliationCandidate,
  spool: ParsedBambuCloudSpool,
  profileDisplayName?: string | null
): boolean {
  if (!candidate || !spool) return false;

  // Material deve ser estritamente compatível (PLA com PLA, PETG com PETG, etc.)
  const candMat = cleanText(candidate.material);
  const spoolMat = cleanText(spool.filamentType);
  if (!candMat || !spoolMat || candMat !== spoolMat) {
    return false;
  }

  // Se já tiver bambu_spool_id diferente do buscado, não é candidato desvinculado
  if (candidate.bambu_spool_id && candidate.bambu_spool_id !== spool.bambuSpoolId) {
    return false;
  }

  // Se houver RFID na nuvem e no carretel, checa igualdade
  if (spool.rfid && candidate.bambu_source_metadata && typeof candidate.bambu_source_metadata.rfid === "string") {
    if (candidate.bambu_source_metadata.rfid !== spool.rfid) {
      return false;
    }
  }

  // Nomes para comparação
  const candColor = cleanText(candidate.color_name);
  const candBrand = cleanText(candidate.brand);
  const candMatColor = candMat + candColor;
  const candFull = candBrand + candMatColor;

  const targetNames = [
    cleanText(spool.filamentName),
    cleanText(profileDisplayName),
  ].filter(Boolean);

  const targetColors = targetNames.map((t) => {
    if (t.startsWith(spoolMat)) {
      return t.slice(spoolMat.length);
    }
    return t;
  });

  for (const target of targetNames) {
    if (!target) continue;

    // 1. Igualdade exata
    if (
      target === candColor ||
      target === candMatColor ||
      target === candFull ||
      (candBrand && target === candBrand + candColor)
    ) {
      return true;
    }

    // 2. Contém a cor distinta
    if (candColor && candColor.length >= 4) {
      if (target.includes(candColor) || candColor.includes(target)) {
        return true;
      }
    }
  }

  for (const tColor of targetColors) {
    if (!tColor || tColor.length < 3) continue;

    if (
      candColor === tColor ||
      candColor.includes(tColor) ||
      tColor.includes(candColor)
    ) {
      return true;
    }
  }

  return false;
}

export function findStrongReconciliationCandidate<T extends ReconciliationCandidate>(
  spool: ParsedBambuCloudSpool,
  profileDisplayName: string | null | undefined,
  unlinkedCandidates: T[]
): T | null {
  const matches = unlinkedCandidates.filter((cand) =>
    isStrongCandidateMatch(cand, spool, profileDisplayName)
  );

  // Regra crítica: só reconcilia se houver correspondência ÚNICA.
  // Se houver ambiguidade (mais de 1) ou nenhuma, retorna null.
  if (matches.length === 1) {
    return matches[0];
  }

  return null;
}

export function resolveSpoolBrand(
  spool: ParsedBambuCloudSpool
): string {
  // Se possuir tag RFID física da Bambu Lab
  if (spool.rfid && spool.rfid.trim().length > 0) {
    return "Bambu Lab";
  }

  const nameUpper = (spool.filamentName || "").toUpperCase();
  if (nameUpper.includes("VOOLT3D") || nameUpper.includes("VOOLT")) return "Voolt3D";
  if (nameUpper.includes("EASY PRINT") || nameUpper.includes("EASYPRINT")) return "Easy Print";
  if (nameUpper.includes("MASTERPRINT") || nameUpper.includes("MASTER PRINT")) return "MasterPrint";
  if (nameUpper.includes("FUSION") || nameUpper.includes("FUSIONX")) return "Fusion";

  const vendor = spool.filamentVendor?.trim();
  if (
    vendor &&
    vendor !== "+" &&
    vendor !== "-" &&
    vendor.toUpperCase() !== "GENERIC" &&
    vendor.toUpperCase() !== spool.filamentType.toUpperCase()
  ) {
    return vendor;
  }

  return "Genérico";
}

export function buildSourceMetadata(
  spool: ParsedBambuCloudSpool,
  existingMetadata?: Record<string, unknown> | null
): Record<string, unknown> {
  return {
    ...(existingMetadata || {}),
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
 * Normaliza um valor de cor para formato hexadecimal padrão #RRGGBB.
 * Trata valores de 6 dígitos (#RRGGBB ou RRGGBB) e 8 dígitos (RRGGBBAA com alpha).
 */
export function normalizeColorHex(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== "string") return null;
  let cleaned = raw.trim();
  if (cleaned.startsWith("#")) {
    cleaned = cleaned.substring(1);
  }
  if (/^[0-9A-Fa-f]{6}$/.test(cleaned)) {
    return `#${cleaned.toUpperCase()}`;
  }
  if (/^[0-9A-Fa-f]{8}$/.test(cleaned)) {
    return `#${cleaned.substring(0, 6).toUpperCase()}`;
  }
  if (/^[0-9A-Fa-f]{3}$/.test(cleaned)) {
    const [r, g, b] = cleaned;
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return null;
}

/**
 * Determina um nome legível para o carretel, evitando que códigos hexadecimais
 * sejam utilizados como nome de exibição.
 */
export function resolveSpoolColorName(
  spool: ParsedBambuCloudSpool,
  profileDisplayName?: string | null
): string {
  if (profileDisplayName && !normalizeColorHex(profileDisplayName)) {
    return profileDisplayName;
  }

  if (spool.filamentName && !normalizeColorHex(spool.filamentName)) {
    return spool.filamentName;
  }

  const brand = spool.filamentVendor && spool.filamentVendor !== "+" && spool.filamentVendor !== "-"
    ? spool.filamentVendor.trim()
    : "";
  if (brand && brand !== spool.filamentType) {
    return `${brand} ${spool.filamentType}`;
  }

  return spool.filamentType || "Filamento";
}

/**
 * Payload de INSERT: só roda pra spool físico novo, então precisa
 * preencher as colunas NOT NULL (brand, material) -- não há dado local
 * anterior pra preservar ainda.
 */
export function buildSpoolInsertRow(
  spool: ParsedBambuCloudSpool,
  userId: string,
  filamentProfileId: string | null,
  profileDisplayName: string | null,
  now: string
) {
  return {
    user_id: userId,
    bambu_spool_id: spool.bambuSpoolId,
    filament_profile_id: filamentProfileId,
    brand: resolveSpoolBrand(spool),
    material: spool.filamentType,
    color_name: resolveSpoolColorName(spool, profileDisplayName),
    color_hex: normalizeColorHex(spool.color),
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
export function buildSpoolUpdateRow(
  spool: ParsedBambuCloudSpool,
  filamentProfileId: string | null,
  now: string,
  extraDisplayUpdates?: { color_name?: string; color_hex?: string | null }
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
    ...(extraDisplayUpdates?.color_name ? { color_name: extraDisplayUpdates.color_name } : {}),
    ...(extraDisplayUpdates?.color_hex ? { color_hex: extraDisplayUpdates.color_hex } : {}),
  };
}

export interface BambuCloudSpoolSyncCounts {
  profilesUpserted: number;
  spoolsInserted: number;
  spoolsUpdated: number;
}

/**
 * Recebe spools já validados (parseBambuCloudSpoolRecord) e faz o upsert
 * no Supabase com reconciliação inteligente por forte evidência física.
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

  // 1. Upsert perfis de filamento
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

  // 2. Buscar todos os carretéis do usuário para reconciliação inteligente
  const { data: allUserSpools, error: existingError } = await supabase
    .from("spools")
    .select("id, bambu_spool_id, brand, material, color_name, color_hex, bambu_source_metadata, filament_profile_id")
    .eq("user_id", userId);

  if (existingError) throw existingError;

  const spoolsList = allUserSpools || [];

  const spoolByPrimaryBambuId = new Map<string, any>();
  const spoolBySecondaryBambuId = new Map<string, any>();
  const unlinkedCandidates: any[] = [];

  for (const s of spoolsList) {
    if (s.bambu_spool_id) {
      spoolByPrimaryBambuId.set(String(s.bambu_spool_id), s);
    } else {
      unlinkedCandidates.push(s);
    }

    const meta = s.bambu_source_metadata as Record<string, unknown> | null;
    if (meta && Array.isArray(meta.secondary_bambu_spool_ids)) {
      for (const secId of meta.secondary_bambu_spool_ids) {
        spoolBySecondaryBambuId.set(String(secId), s);
      }
    }
  }

  const rowsToInsert: ReturnType<typeof buildSpoolInsertRow>[] = [];
  const rowsToUpdate: { id: string; payload: any }[] = [];

  for (const spool of spools) {
    const filamentProfileId = profileIdByFilamentId.get(spool.filamentId) ?? null;
    const profileRow = profileRowByFilamentId.get(spool.filamentId);

    // Caso A: Já existe com este bambu_spool_id primário
    const primaryExisting = spoolByPrimaryBambuId.get(spool.bambuSpoolId);
    if (primaryExisting) {
      const extraDisplayUpdates: { color_name?: string; color_hex?: string | null } = {};
      const isLegacyHexName = Boolean(normalizeColorHex(primaryExisting.color_name));
      if (!primaryExisting.color_name || isLegacyHexName) {
        extraDisplayUpdates.color_name = resolveSpoolColorName(spool, profileRow?.display_name);
      }
      if (!primaryExisting.color_hex) {
        extraDisplayUpdates.color_hex = normalizeColorHex(spool.color);
      }

      rowsToUpdate.push({
        id: primaryExisting.id,
        payload: {
          ...buildSpoolUpdateRow(spool, filamentProfileId, now, extraDisplayUpdates),
          bambu_source_metadata: buildSourceMetadata(spool, primaryExisting.bambu_source_metadata),
        },
      });
      continue;
    }

    // Caso B: Já existe como bambu_spool_id secundário registrado
    const secondaryExisting = spoolBySecondaryBambuId.get(spool.bambuSpoolId);
    if (secondaryExisting) {
      if (spool.inPrinter) {
        rowsToUpdate.push({
          id: secondaryExisting.id,
          payload: {
            bambu_in_printer: true,
            bambu_dev_id: spool.devId,
            bambu_device_name: spool.deviceName,
            bambu_ams_sn: spool.amsSn,
            bambu_ams_id: spool.amsId,
            bambu_slot_id: spool.slotId,
            bambu_synced_at: now,
            updated_at: now,
          },
        });
      }
      continue;
    }

    // Caso C: Reconciliar com candidato desvinculado por forte evidência
    const matchedCandidate = findStrongReconciliationCandidate(
      spool,
      profileRow?.display_name,
      unlinkedCandidates
    );

    if (matchedCandidate) {
      const idx = unlinkedCandidates.findIndex((c) => c.id === matchedCandidate.id);
      if (idx !== -1) unlinkedCandidates.splice(idx, 1);

      spoolByPrimaryBambuId.set(spool.bambuSpoolId, matchedCandidate);

      const extraDisplayUpdates: { color_name?: string; color_hex?: string | null } = {};
      const isLegacyHexName = Boolean(normalizeColorHex(matchedCandidate.color_name));
      if (!matchedCandidate.color_name || isLegacyHexName) {
        extraDisplayUpdates.color_name = resolveSpoolColorName(spool, profileRow?.display_name);
      }
      if (!matchedCandidate.color_hex) {
        extraDisplayUpdates.color_hex = normalizeColorHex(spool.color);
      }

      rowsToUpdate.push({
        id: matchedCandidate.id,
        payload: {
          ...buildSpoolUpdateRow(spool, filamentProfileId, now, extraDisplayUpdates),
          bambu_spool_id: spool.bambuSpoolId,
          filament_profile_id: matchedCandidate.filament_profile_id || filamentProfileId,
          bambu_source_metadata: buildSourceMetadata(spool, matchedCandidate.bambu_source_metadata),
        },
      });
      continue;
    }

    // Caso D: Spool físico novo real
    rowsToInsert.push(
      buildSpoolInsertRow(spool, userId, filamentProfileId, profileRow?.display_name ?? null, now)
    );
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
