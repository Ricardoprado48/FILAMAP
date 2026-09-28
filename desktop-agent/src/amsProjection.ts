import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeColorHex } from "./bambuCloudSpoolSync";

export interface MqttAmsTray {
  slotIndex: number;
  occupied: boolean;
  trayType: string | null;
  trayColorHex: string | null;
  tagUid: string | null;
  trayInfoIdx: string | null;
  traySubBrands: string | null;
}

export interface ReconcileAmsInputSpool {
  id: string;
  brand: string | null;
  material: string | null;
  color_name: string | null;
  color_hex: string | null;
  nfc_uid: string | null;
  bambu_spool_id: string | null;
  bambu_dev_id: string | null;
  bambu_slot_id: string | null;
  bambu_in_printer: boolean | null;
  bambu_source_metadata?: Record<string, unknown> | null;
  // Produto de filamento (F1/F6). Ausente em bancos antigos.
  filament_product_id?: string | null;
}

export interface ReconcileAmsInputAmsSlot {
  slot_index: number;
  spool_id: string | null;
  // 'user' = escolhido na Web (tag NFC ou lista do estoque); 'agent' = esta
  // projeção. Ausente em bancos sem a migration 20260929010000.
  assigned_by?: string | null;
  // Quando a escolha foi feita (compara com uma troca feita depois na Bambu).
  assigned_at?: string | null;
}

export interface AmsReconciliationInput {
  printerSerial: string;
  mqttTrays: MqttAmsTray[];
  spools: ReconcileAmsInputSpool[];
  currentAmsSlots: ReconcileAmsInputAmsSlot[];
  // Perfil do slot (tray_info_idx = source_key do preset) -> produto de filamento.
  presetProducts?: Record<string, string>;
}

export interface SpoolLocationUpdate {
  id: string;
  bambu_in_printer: boolean;
  bambu_slot_id: string | null;
  bambu_dev_id: string | null;
  reason: string;
}

export interface AmsReconciliationConflict {
  slotIndex: number;
  description: string;
}

export interface AmsReconciliationResult {
  slotAssignments: Map<number, string | null>;
  spoolLocationUpdates: SpoolLocationUpdate[];
  conflicts: AmsReconciliationConflict[];
}

export interface AmsProjectionSyncCounts {
  slotsUpdated: number;
  spoolsUpdated: number;
  conflictsCount: number;
}

export function cleanText(str: string | null | undefined): string {
  if (!str) return "";
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function isMaterialCompatible(
  spoolMaterial: string | null | undefined,
  trayType: string | null | undefined
): boolean {
  if (!trayType || !trayType.trim()) return true;
  if (!spoolMaterial || !spoolMaterial.trim()) return false;
  const m1 = cleanText(spoolMaterial);
  const m2 = cleanText(trayType);
  if (!m1 || !m2) return false;
  return m1 === m2 || m1.includes(m2) || m2.includes(m1);
}

export function isColorCompatible(
  spoolColorHex: string | null | undefined,
  trayColorHex: string | null | undefined
): boolean {
  if (!trayColorHex) return true;
  if (!spoolColorHex) return true;
  const c1 = normalizeColorHex(spoolColorHex);
  const c2 = normalizeColorHex(trayColorHex);
  if (!c1 || !c2) return true;
  return c1.toUpperCase() === c2.toUpperCase();
}

/**
 * Converte payload MQTT da Bambu Lab para representação estruturada das bandejas da AMS.
 * Lida com deltas, ausência de campos, formatos de 4 slots e tray_exist_bits.
 */
export function parseMqttAmsStatus(printPayload: any): MqttAmsTray[] {
  if (!printPayload || typeof printPayload !== "object") {
    return [];
  }

  const print = printPayload.print || printPayload;
  if (!print || typeof print !== "object" || !print.ams) {
    return [];
  }

  const amsObj = print.ams;
  const amsUnits = Array.isArray(amsObj.ams) ? amsObj.ams : [];
  const primaryAms = amsUnits[0] || (Array.isArray(amsObj.tray) ? amsObj : null);
  const rawTrays: any[] = primaryAms && Array.isArray(primaryAms.tray) ? primaryAms.tray : [];

  let existMask = NaN;
  if (amsObj.tray_exist_bits !== undefined && amsObj.tray_exist_bits !== null) {
    existMask = typeof amsObj.tray_exist_bits === "number"
      ? amsObj.tray_exist_bits
      : parseInt(String(amsObj.tray_exist_bits).trim(), 16);
  }

  const result: MqttAmsTray[] = [];

  for (let slotIdx = 0; slotIdx < 4; slotIdx++) {
    const rawTray = rawTrays.find((t) => Number(t?.id) === slotIdx) || rawTrays[slotIdx];

    let occupied = false;
    if (!isNaN(existMask)) {
      const bitSet = (existMask & (1 << slotIdx)) !== 0;
      const hasContent = Boolean(
        rawTray &&
          ((rawTray.tray_type && String(rawTray.tray_type).trim().length > 0) ||
            rawTray.tray_info_idx ||
            rawTray.tray_color ||
            (Array.isArray(rawTray.cols) && rawTray.cols.length > 0))
      );
      occupied = bitSet && hasContent;
    } else if (rawTray) {
      occupied = Boolean(rawTray.tray_type && String(rawTray.tray_type).trim().length > 0);
    }

    const trayType = rawTray?.tray_type ? String(rawTray.tray_type).trim().toUpperCase() : null;
    const rawColor = rawTray?.tray_color || (Array.isArray(rawTray?.cols) && rawTray.cols[0]) || null;
    const trayColorHex = normalizeColorHex(rawColor);
    const tagUid = rawTray?.tag_uid ? String(rawTray.tag_uid).trim() : null;
    const trayInfoIdx = rawTray?.tray_info_idx ? String(rawTray.tray_info_idx).trim() : null;
    const traySubBrands = rawTray?.tray_sub_brands ? String(rawTray.tray_sub_brands).trim() : null;

    result.push({
      slotIndex: slotIdx,
      occupied,
      trayType: occupied ? trayType : null,
      trayColorHex: occupied ? trayColorHex : null,
      tagUid: occupied ? tagUid : null,
      trayInfoIdx: occupied ? trayInfoIdx : null,
      traySubBrands: occupied ? traySubBrands : null,
    });
  }

  return result;
}

// A nuvem Bambu aponta este carretel para este slot? Usa a visão da PRÓPRIA nuvem
// guardada pelo sync (metadata.cloud_position, v4.1); dados antigos sem ela caem em
// bambu_* como antes.
export function cloudPointsToSlot(s: ReconcileAmsInputSpool, printerSerial: string, slotIdx: number): boolean {
  const meta = s.bambu_source_metadata as Record<string, unknown> | null | undefined;
  if (meta && Object.prototype.hasOwnProperty.call(meta, "cloud_position")) {
    return meta.cloud_position === `${printerSerial}|${slotIdx}`;
  }
  return s.bambu_dev_id === printerSerial && s.bambu_slot_id === String(slotIdx) && s.bambu_in_printer === true;
}

// Quando a nuvem passou a apontar este carretel para a posição atual (null = desconhecido/antigo).
function cloudChangedAt(s: ReconcileAmsInputSpool): number | null {
  const raw = (s.bambu_source_metadata as Record<string, unknown> | null | undefined)?.cloud_position_changed_at;
  const t = typeof raw === "string" ? Date.parse(raw) : NaN;
  return Number.isNaN(t) ? null : t;
}

// O carretel contradiz o perfil que o AMS informa para o slot? Só quando os dois lados são conhecidos.
function contradictsPreset(s: ReconcileAmsInputSpool, presetProductId: string | null): boolean {
  return Boolean(presetProductId && s.filament_product_id && s.filament_product_id !== presetProductId);
}

/**
 * Reconcilia o estado físico da AMS comparando o MQTT autoritativo com o banco (Bambu Cloud + ams_slots + estoque).
 * Prioridade (slot ocupado no MQTT local; material sempre validado):
 * 1. RFID real da Bambu Lab
 * 2. Escolha do usuário no Filamap -- exceto se, DEPOIS dela, o usuário trocou o carretel
 *    do slot em Dispositivos na Bambu (a escolha mais recente vale)
 * 3. Carretel que a nuvem Bambu aponta para o slot (descartado se contradiz o perfil do slot)
 * 4. Perfil do slot (tray_info_idx) -> produto -> único carretel desse produto no estoque
 * 5. ams_slots anterior (se não contradiz o perfil do slot)
 * 6. Material + cor único no inventário (sem carretéis de outro produto que o do perfil)
 */
export function reconcileAmsState(input: AmsReconciliationInput): AmsReconciliationResult {
  const { printerSerial, mqttTrays, spools, currentAmsSlots } = input;

  const slotAssignments = new Map<number, string | null>();
  const spoolLocationUpdates: SpoolLocationUpdate[] = [];
  const conflicts: AmsReconciliationConflict[] = [];

  const assignedSpoolIds = new Set<string>();

  const currentAmsMap = new Map<number, string | null>();
  const userChosenSlots = new Set<number>();
  const userChosenAt = new Map<number, number>();
  for (const s of currentAmsSlots) {
    currentAmsMap.set(s.slot_index, s.spool_id);
    if (s.assigned_by === "user" && s.spool_id) {
      userChosenSlots.add(s.slot_index);
      const t = s.assigned_at ? Date.parse(s.assigned_at) : NaN;
      userChosenAt.set(s.slot_index, Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t);
    }
  }

  for (let slotIdx = 0; slotIdx < 4; slotIdx++) {
    const tray = mqttTrays.find((t) => t.slotIndex === slotIdx);

    if (!tray || !tray.occupied) {
      slotAssignments.set(slotIdx, null);
      continue;
    }

    // O slot está fisicamente ocupado pelo MQTT
    let matchedSpool: ReconcileAmsInputSpool | null = null;
    const presetProductId = (tray.trayInfoIdx && input.presetProducts?.[tray.trayInfoIdx]) || null;

    // Carretéis que a nuvem aponta para este slot, separados em válidos e desatualizados.
    const cloudPointed = spools.filter((s) => !assignedSpoolIds.has(s.id) && cloudPointsToSlot(s, printerSerial, slotIdx));
    const cloudValid = cloudPointed.filter((s) => isMaterialCompatible(s.material, tray.trayType) && !contradictsPreset(s, presetProductId));

    // Prioridade 1: RFID físico da Bambu Lab (se tagUid não for zeros nem vazio)
    if (tray.tagUid && tray.tagUid !== "0000000000000000" && tray.tagUid.length >= 8) {
      const rfidCandidate = spools.find((s) => {
        if (assignedSpoolIds.has(s.id)) return false;
        if (!isMaterialCompatible(s.material, tray.trayType)) return false;
        const metaRfid = (s.bambu_source_metadata as any)?.rfid;
        return (metaRfid && metaRfid === tray.tagUid) || s.nfc_uid === tray.tagUid;
      });
      if (rfidCandidate) {
        matchedSpool = rfidCandidate;
      }
    }

    // Prioridade 1b: escolha explícita do usuário na Web (tag ou lista do
    // estoque). Vale mais que a nuvem Bambu (que costuma ficar desatualizada);
    // só cai se o material no AMS mudou -- aí o carretel foi trocado.
    if (!matchedSpool && userChosenSlots.has(slotIdx)) {
      const chosenId = currentAmsMap.get(slotIdx);
      const chosen = spools.find((s) => s.id === chosenId && !assignedSpoolIds.has(s.id));
      if (chosen && isMaterialCompatible(chosen.material, tray.trayType)) {
        // Troca feita na Bambu (Dispositivos) DEPOIS da escolha no Filamap: a mais recente vale.
        const chosenAt = userChosenAt.get(slotIdx) ?? Number.NEGATIVE_INFINITY;
        const newerCloud = cloudValid.find((c) => {
          const t = cloudChangedAt(c);
          return c.id !== chosen.id && t !== null && t > chosenAt;
        });
        matchedSpool = newerCloud || chosen;
      } else if (chosen) {
        conflicts.push({
          slotIndex: slotIdx,
          description: `Carretel escolhido na Web ("${chosen.color_name}", ${chosen.material}) não bate com o material que o AMS reporta (${tray.trayType}). Escolha descartada: o carretel foi trocado.`,
        });
      }
    }

    // Prioridade 2: Candidato apontado pela Bambu Cloud para este slot
    if (!matchedSpool) {
      for (const cand of cloudPointed) {
        if (cloudValid.includes(cand)) {
          if (!matchedSpool) {
            matchedSpool = cand;
          }
        } else if (matchedSpool?.id !== cand.id) {
          // Conflito crítico detectado: a nuvem Bambu tem cache stale no slot!
          const motivo = isMaterialCompatible(cand.material, tray.trayType)
            ? `o perfil do slot no AMS (${tray.trayInfoIdx}) é de outro produto`
            : `o hardware MQTT reporta ${tray.trayType}`;
          conflicts.push({
            slotIndex: slotIdx,
            description: `Bambu Cloud apontava carretel "${cand.color_name}" (${cand.material}) no slot ${slotIdx + 1}, mas ${motivo}. Vínculo stale da nuvem rejeitado.`,
          });
          spoolLocationUpdates.push({
            id: cand.id,
            bambu_in_printer: false,
            bambu_slot_id: null,
            bambu_dev_id: null,
            reason: `cloud_stale_material_mismatch_slot_${slotIdx}`,
          });
        }
      }
    }

    // Prioridade 3: perfil do slot aponta um produto com um único carretel livre no estoque.
    // Com dois ou mais carretéis iguais não há como saber qual rolo é: vale o que já estava
    // no slot (se for desse produto); senão fica sem vínculo (tag ou escolha do usuário).
    if (!matchedSpool && presetProductId) {
      const sameProduct = spools.filter(
        (s) => !assignedSpoolIds.has(s.id) && s.filament_product_id === presetProductId && isMaterialCompatible(s.material, tray.trayType)
      );
      if (sameProduct.length === 1) {
        matchedSpool = sameProduct[0];
      } else if (sameProduct.length > 1) {
        const previousSpoolId = currentAmsMap.get(slotIdx);
        matchedSpool = sameProduct.find((s) => s.id === previousSpoolId) || null;
      }
    }

    // Prioridade 4: ams_slots anterior (vínculo NFC anterior ou persistido)
    if (!matchedSpool) {
      const previousSpoolId = currentAmsMap.get(slotIdx);
      if (previousSpoolId && !assignedSpoolIds.has(previousSpoolId)) {
        const prevSpool = spools.find((s) => s.id === previousSpoolId);
        if (prevSpool && isMaterialCompatible(prevSpool.material, tray.trayType) && !contradictsPreset(prevSpool, presetProductId)) {
          matchedSpool = prevSpool;
        }
      }
    }

    // Prioridade 5: Unassigned inventory match por Material + Cor
    if (!matchedSpool) {
      const materialCandidates = spools.filter((s) => {
        if (assignedSpoolIds.has(s.id)) return false;
        if (contradictsPreset(s, presetProductId)) return false;
        return isMaterialCompatible(s.material, tray.trayType);
      });

      if (materialCandidates.length === 1) {
        matchedSpool = materialCandidates[0];
      } else if (materialCandidates.length > 1) {
        // Tenta filtrar por cor compatível
        const colorMatches = materialCandidates.filter((s) =>
          isColorCompatible(s.color_hex, tray.trayColorHex)
        );
        if (colorMatches.length === 1) {
          matchedSpool = colorMatches[0];
        } else if (tray.trayColorHex) {
          // Se o nome da cor do spool menciona a cor do MQTT
          const nameMatches = materialCandidates.filter((s) => {
            const cName = cleanText(s.color_name);
            if (tray.trayColorHex === "#FFFFFF" && cName.includes("branco")) return true;
            if (tray.trayColorHex === "#161616" && (cName.includes("preto") || cName.includes("black"))) return true;
            if (tray.trayColorHex === "#F72323" && (cName.includes("vermelho") || cName.includes("red"))) return true;
            return false;
          });
          if (nameMatches.length === 1) {
            matchedSpool = nameMatches[0];
          }
        }
      }
    }

    if (matchedSpool) {
      assignedSpoolIds.add(matchedSpool.id);
      slotAssignments.set(slotIdx, matchedSpool.id);

      if (
        matchedSpool.bambu_in_printer !== true ||
        matchedSpool.bambu_slot_id !== String(slotIdx) ||
        matchedSpool.bambu_dev_id !== printerSerial
      ) {
        spoolLocationUpdates.push({
          id: matchedSpool.id,
          bambu_in_printer: true,
          bambu_slot_id: String(slotIdx),
          bambu_dev_id: printerSerial,
          reason: `assigned_to_slot_${slotIdx}`,
        });
      }
    } else {
      slotAssignments.set(slotIdx, null);
      conflicts.push({
        slotIndex: slotIdx,
        description: `Slot ${slotIdx + 1} ocupado no hardware (${tray.trayType || "desconhecido"}, cor: ${tray.trayColorHex || "desconhecida"}), mas nenhum carretel compatível pôde ser identificado unicamente.`,
      });
    }
  }

  // Desvincula carretéis que constavam como instalados nesta impressora mas não estão em nenhum slot
  for (const spool of spools) {
    if (
      spool.bambu_dev_id === printerSerial &&
      spool.bambu_in_printer === true &&
      !assignedSpoolIds.has(spool.id)
    ) {
      const alreadyPending = spoolLocationUpdates.some((u) => u.id === spool.id);
      if (!alreadyPending) {
        spoolLocationUpdates.push({
          id: spool.id,
          bambu_in_printer: false,
          bambu_slot_id: null,
          bambu_dev_id: null,
          reason: "not_in_any_slot",
        });
      }
    }
  }

  return {
    slotAssignments,
    spoolLocationUpdates,
    conflicts,
  };
}

// Banco ainda sem a migration 20260929010000 (colunas assigned_by/assigned_at).
export function isMissingAssignedByColumn(error: any): boolean {
  const text = `${error?.code ?? ""} ${error?.message ?? ""}`;
  return /42703|PGRST204/.test(text) && /assigned_(by|at)/.test(text);
}

// Banco sem a migration 20260930100000 (coluna spools.archived_at).
export function isMissingArchivedColumn(error: any): boolean {
  const text = `${error?.code ?? ""} ${error?.message ?? ""}`;
  return /42703|PGRST204/.test(text) && /archived_at/.test(text);
}

/**
 * Executa a projeção AMS contra o Supabase de forma totalmente idempotente.
 */
export async function syncAmsProjection(
  supabase: SupabaseClient,
  printerId: string,
  printerSerial: string,
  mqttPrintPayload: any
): Promise<AmsProjectionSyncCounts> {
  const mqttTrays = parseMqttAmsStatus(mqttPrintPayload);
  if (!mqttTrays || mqttTrays.length === 0) {
    return { slotsUpdated: 0, spoolsUpdated: 0, conflictsCount: 0 };
  }

  // 1. Busca ams_slots atuais (com quem decidiu o vínculo, se o banco já
  //    tiver a coluna -- senão segue como antes).
  let currentSlotsData: any[] | null = null;
  {
    const withSource = await supabase
      .from("ams_slots")
      .select("slot_index, spool_id, assigned_by, assigned_at")
      .eq("printer_id", printerId);
    if (withSource.error && isMissingAssignedByColumn(withSource.error)) {
      const legacy = await supabase.from("ams_slots").select("slot_index, spool_id").eq("printer_id", printerId);
      if (legacy.error) throw legacy.error;
      currentSlotsData = legacy.data;
    } else if (withSource.error) {
      throw withSource.error;
    } else {
      currentSlotsData = withSource.data;
    }
  }

  // 2. Busca os carretéis do usuário; arquivados (decisão D4) ficam fora do AMS.
  //    Banco sem a coluna archived_at (antes da migration 20260930100000) -> todos.
  //    Colunas por extenso (sem template) para o R-CONTRATO validar as duas consultas.
  let spoolsData: any[] | null = null;
  {
    const withArchive = await supabase
      .from("spools")
      .select("id, brand, material, color_name, color_hex, nfc_uid, bambu_spool_id, bambu_dev_id, bambu_slot_id, bambu_in_printer, bambu_source_metadata, filament_product_id, archived_at");
    if (withArchive.error && isMissingArchivedColumn(withArchive.error)) {
      const legacy = await supabase
        .from("spools")
        .select("id, brand, material, color_name, color_hex, nfc_uid, bambu_spool_id, bambu_dev_id, bambu_slot_id, bambu_in_printer, bambu_source_metadata");
      if (legacy.error) throw legacy.error;
      spoolsData = legacy.data;
    } else if (withArchive.error) {
      throw withArchive.error;
    } else {
      spoolsData = (withArchive.data || []).filter((s: any) => !s.archived_at);
    }
  }

  // 3. Perfil do slot -> produto (F6). Banco sem a coluna ou falha: segue sem (como antes).
  const presetProducts: Record<string, string> = {};
  try {
    const { data: profileRows, error: profileErr } = await supabase
      .from("user_filament_profiles")
      .select("source_key, filament_product_id")
      .not("filament_product_id", "is", null);
    if (!profileErr) {
      for (const row of profileRows || []) {
        if (row.source_key && row.filament_product_id) presetProducts[String(row.source_key)] = String(row.filament_product_id);
      }
    }
  } catch {
    // sem mapa: identificação por perfil desligada neste ciclo
  }

  // 4. Executa reconciliação pura
  const reconciliation = reconcileAmsState({
    printerSerial,
    mqttTrays,
    spools: (spoolsData || []) as ReconcileAmsInputSpool[],
    currentAmsSlots: (currentSlotsData || []) as ReconcileAmsInputAmsSlot[],
    presetProducts,
  });

  // 5. Aplica atualizações idempotentes em ams_slots
  let slotsUpdated = 0;
  const existingSlotMap = new Map<number, string | null>(
    (currentSlotsData || []).map((s: any) => [s.slot_index, s.spool_id])
  );

  for (let slotIdx = 0; slotIdx < 4; slotIdx++) {
    const targetSpoolId = reconciliation.slotAssignments.get(slotIdx) ?? null;
    const currentSpoolId = existingSlotMap.get(slotIdx) ?? null;

    if (targetSpoolId !== currentSpoolId || !existingSlotMap.has(slotIdx)) {
      const nowIso = new Date().toISOString();
      const row = { printer_id: printerId, slot_index: slotIdx, spool_id: targetSpoolId, updated_at: nowIso };
      let { error: upsertErr } = await supabase
        .from("ams_slots")
        .upsert({ ...row, assigned_by: "agent", assigned_at: nowIso }, { onConflict: "printer_id,slot_index" });
      if (upsertErr && isMissingAssignedByColumn(upsertErr)) {
        ({ error: upsertErr } = await supabase.from("ams_slots").upsert(row, { onConflict: "printer_id,slot_index" }));
      }
      if (upsertErr) throw upsertErr;
      slotsUpdated++;
    }
  }

  // 6. Aplica atualizações idempotentes em spools
  let spoolsUpdated = 0;
  const updatesBySpoolId = new Map<string, SpoolLocationUpdate>();
  for (const update of reconciliation.spoolLocationUpdates) {
    updatesBySpoolId.set(update.id, update);
  }

  const existingSpoolMap = new Map<string, any>(
    (spoolsData || []).map((s: any) => [s.id, s])
  );

  for (const [spoolId, update] of updatesBySpoolId.entries()) {
    const existing = existingSpoolMap.get(spoolId);
    const needsUpdate =
      !existing ||
      existing.bambu_in_printer !== update.bambu_in_printer ||
      existing.bambu_slot_id !== update.bambu_slot_id ||
      existing.bambu_dev_id !== update.bambu_dev_id;

    if (needsUpdate) {
      const { error: updErr } = await supabase
        .from("spools")
        .update({
          bambu_in_printer: update.bambu_in_printer,
          bambu_slot_id: update.bambu_slot_id,
          bambu_dev_id: update.bambu_dev_id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", spoolId);
      if (updErr) throw updErr;
      spoolsUpdated++;
    }
  }

  if (reconciliation.conflicts.length > 0) {
    for (const c of reconciliation.conflicts) {
      console.warn(`🔀 [AMS Projection] Slot ${c.slotIndex + 1}: ${c.description}`);
    }
  }

  return {
    slotsUpdated,
    spoolsUpdated,
    conflictsCount: reconciliation.conflicts.length,
  };
}
