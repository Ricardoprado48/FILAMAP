import type { FilamentSliceInfo } from "./ftpsParser";

export type ConsumptionQuality =
  | "exact"
  | "estimated_filename"
  | "estimated_duration"
  | "unknown";

export interface JobConsumptionItem {
  spool_id: string | null;
  slot_index: number;
  grams: number;
  consumption_quality: ConsumptionQuality;
  orphan_slot: boolean;
}

export interface SlotConsumption {
  grams: number;
  quality: ConsumptionQuality;
  weightDiscount: number;
}

// Cascata de 4 níveis:
// 1. exact              -> slice_info.config real, granular por slot.
// 2. estimated_filename -> peso no nome do arquivo, dividido entre slots usados.
// 3. estimated_duration -> duração x 0.22g/min, dividido entre slots usados.
// 4. unknown            -> sem dado confiável; não desconta peso.
export function computeConsumptionPerSlot(
  usedSlots: number[],
  filamentSliceInfo: FilamentSliceInfo[] | undefined,
  filenameGrams: number,
  durationMinutes: number
): Map<number, SlotConsumption> {
  const perSlot = new Map<number, SlotConsumption>();

  const exactSlices = (filamentSliceInfo || []).filter(
    (f) => f.totalGrams > 0
  );

  if (exactSlices.length > 0) {
    for (const f of exactSlices) {
      perSlot.set(f.trayId, {
        grams: f.totalGrams,
        quality: "exact",
        weightDiscount: f.weightDiscount || 0,
      });
    }

    // Slot reportado pela AMS mas ausente no slicer:
    // não inventamos consumo.
    for (const slot of usedSlots) {
      if (!perSlot.has(slot)) {
        perSlot.set(slot, {
          grams: 0,
          quality: "unknown",
          weightDiscount: 0,
        });
      }
    }

    return perSlot;
  }

  let totalGrams = 0;
  let quality: ConsumptionQuality = "unknown";

  if (filenameGrams > 0) {
    totalGrams = filenameGrams;
    quality = "estimated_filename";
  } else if (durationMinutes > 0) {
    totalGrams = Math.round(durationMinutes * 0.22 * 10) / 10;
    quality = "estimated_duration";
  }

  const slots = usedSlots.length > 0 ? usedSlots : [0];

  if (quality === "unknown" || totalGrams <= 0) {
    for (const slot of slots) {
      perSlot.set(slot, {
        grams: 0,
        quality: "unknown",
        weightDiscount: 0,
      });
    }

    return perSlot;
  }

  const perSlotGrams =
    Math.round((totalGrams / slots.length) * 10) / 10;

  for (const slot of slots) {
    perSlot.set(slot, {
      grams: perSlotGrams,
      quality,
      weightDiscount: 0,
    });
  }

  return perSlot;
}

export function computeFinalGrams(
  grams: number,
  weightDiscount: number,
  percentExecuted: number,
  quality: ConsumptionQuality
): number {
  if (quality === "unknown") {
    return 0;
  }

  const safePercent = Math.max(0, Math.min(100, percentExecuted));

  const scaledGrams =
    Math.round(grams * (safePercent / 100) * 10) / 10;

  const scaledDiscount =
    weightDiscount > 0
      ? Math.round(weightDiscount * (safePercent / 100) * 10) / 10
      : 0;

  return Math.max(
    0,
    Math.round((scaledGrams - scaledDiscount) * 10) / 10
  );
}

// ---------------------------------------------------------------------------
// Cross-check de identidade física: ams_slots.spool_id (vínculo por toque de
// NFC, feito pelo usuário na Web -- ver handleAssignSlot em web-app/src/App.tsx)
// já É uma associação por identidade física, não por material/cor/nome. O
// que falta é comparar esse vínculo contra o que a própria Bambu Cloud
// reporta como localização atual do spool (bambu_dev_id/bambu_slot_id/
// bambu_in_printer, sincronizados por bambuCloudSpoolSync.ts) para detectar
// o caso em que o carretel físico foi trocado no slot sem o usuário reler a
// tag NFC -- sem isso, ams_slots ficaria "preso" no carretel antigo
// indefinidamente.
//
// Deliberadamente NÃO troca o spool_id sozinho quando encontra divergência:
// o vínculo por NFC continua sendo o sinal mais forte (o usuário tocou a tag
// no momento em que carregou o carretel), e o snapshot da Bambu Cloud só é
// atualizado a cada sync (ver setInterval de 300000ms em index.ts) -- pode
// estar desatualizado por até 5 minutos. Só reporta a divergência para
// quem chama decidir (hoje, um log de auditoria) -- ver regra 6 do escopo
// desta fase ("não invente comportamento silencioso").
export interface SpoolPhysicalInfo {
  bambuSpoolId: string | null;
  bambuDevId: string | null;
  bambuInPrinter: boolean | null;
  bambuSlotId: string | null;
}

export interface PhysicalIdentityMismatch {
  slotIndex: number;
  spoolId: string;
  reason: string;
}

/**
 * Só relata divergência quando há dado suficiente da Bambu Cloud para
 * afirmar algo (bambuSpoolId, bambuDevId e bambuSlotId presentes). Spool
 * nunca sincronizado da nuvem (bambuSpoolId null) ou ainda sem localização
 * conhecida não gera nenhum aviso -- inconclusivo não é o mesmo que
 * divergente.
 */
export function detectPhysicalIdentityMismatches(
  items: JobConsumptionItem[],
  physicalInfoBySlot: Map<number, SpoolPhysicalInfo | null>,
  printerSerial: string
): PhysicalIdentityMismatch[] {
  const mismatches: PhysicalIdentityMismatch[] = [];

  for (const item of items) {
    if (!item.spool_id) continue;

    const info = physicalInfoBySlot.get(item.slot_index);
    if (!info || !info.bambuSpoolId) continue;

    if (info.bambuInPrinter === false) {
      mismatches.push({
        slotIndex: item.slot_index,
        spoolId: item.spool_id,
        reason:
          "carretel vinculado por NFC a este slot não está mais reportado como 'em impressora' pela Bambu Cloud",
      });
      continue;
    }

    if (!info.bambuDevId || !info.bambuSlotId) continue;

    if (info.bambuDevId !== printerSerial) {
      mismatches.push({
        slotIndex: item.slot_index,
        spoolId: item.spool_id,
        reason: `Bambu Cloud reporta este carretel em outra impressora (dev_id ${info.bambuDevId})`,
      });
      continue;
    }

    if (Number(info.bambuSlotId) !== item.slot_index) {
      mismatches.push({
        slotIndex: item.slot_index,
        spoolId: item.spool_id,
        reason: `Bambu Cloud reporta este carretel no slot ${info.bambuSlotId}, não no slot ${item.slot_index}`,
      });
    }
  }

  return mismatches;
}

// ---------------------------------------------------------------------------
// Resolução de identidade física: Bambu Cloud como fonte preferencial.
//
// Prioridade 1 -- Bambu Cloud: dentre os spools do usuário sincronizados da
// nuvem, procura os que reportam bambu_in_printer=true, bambu_dev_id igual
// ao serial desta impressora e bambu_slot_id igual ao slot em questão. Só
// resolve por essa via quando há exatamente 1 candidato -- 0 (sem dado) ou
// >1 (ambíguo, ex.: futuro suporte a múltiplas unidades AMS na mesma
// impressora) nunca são tratados como resposta, só como "sem evidência
// suficiente" (regra 6 do escopo desta fase).
//
// Prioridade 2 -- ams_slots.spool_id: vínculo por toque de NFC, usado
// sempre que a Prioridade 1 não resolver. Continua sendo obrigatório para
// spools nunca sincronizados da Bambu Cloud (cadastro manual) e para o caso
// em que o usuário tem múltiplas unidades AMS (ambíguo para a Prioridade 1).
//
// bambu_ams_id (unidade física do AMS) deliberadamente não entra no filtro:
// a arquitetura atual só suporta 1 unidade AMS por impressora
// (ams_slots.slot_index BETWEEN 0 AND 3, MQTT só lê ams.ams[0] em index.ts)
// e o job não carrega hoje qual unidade AMS foi usada para comparar. Uma
// eventual segunda unidade cairia no caso >1 candidatos acima e voltaria
// com segurança para a Prioridade 2, em vez de resolver errado.
export type SlotResolutionSource = "bambu_cloud" | "ams_slots" | "none";

export interface SlotResolution {
  slotIndex: number;
  spoolId: string | null;
  source: SlotResolutionSource;
  /** Valor anterior em ams_slots.spool_id, para decidir se é preciso corrigi-lo. */
  amsSlotSpoolId: string | null;
  /** true quando a Bambu Cloud resolveu, sem ambiguidade, um spool diferente do vínculo NFC atual. */
  conflict: boolean;
}

export function resolvePhysicalSpoolForSlot(
  slotIndex: number,
  bambuCandidates: string[],
  amsSlotSpoolId: string | null
): SlotResolution {
  if (bambuCandidates.length === 1) {
    const spoolId = bambuCandidates[0];
    return {
      slotIndex,
      spoolId,
      source: "bambu_cloud",
      amsSlotSpoolId,
      conflict: amsSlotSpoolId !== null && amsSlotSpoolId !== spoolId,
    };
  }

  if (amsSlotSpoolId) {
    return {
      slotIndex,
      spoolId: amsSlotSpoolId,
      source: "ams_slots",
      amsSlotSpoolId,
      conflict: false,
    };
  }

  return {
    slotIndex,
    spoolId: null,
    source: "none",
    amsSlotSpoolId: null,
    conflict: false,
  };
}

export function resolvePhysicalSpoolsForJob(
  slotIndexes: number[],
  amsSlotBySlot: Map<number, string | null>,
  bambuCandidatesBySlot: Map<number, string[]>
): Map<number, SlotResolution> {
  const result = new Map<number, SlotResolution>();

  for (const slotIndex of slotIndexes) {
    result.set(
      slotIndex,
      resolvePhysicalSpoolForSlot(
        slotIndex,
        bambuCandidatesBySlot.get(slotIndex) ?? [],
        amsSlotBySlot.get(slotIndex) ?? null
      )
    );
  }

  return result;
}

/** Linha de spools filtrada por bambu_in_printer=true, já com os campos usados no matching. */
export interface BambuSyncedSpoolRow {
  id: string;
  bambuDevId: string | null;
  bambuSlotId: string | null;
  bambuInPrinter: boolean | null;
}

/**
 * Agrupa candidatos por slot a partir das linhas de spools sincronizados da
 * Bambu Cloud. Repete em JS os mesmos critérios já aplicados na query SQL
 * (dev_id da impressora + in_printer=true) como segunda camada de
 * segurança/isolamento -- nunca confia apenas no filtro do banco.
 */
export function groupBambuCandidatesBySlot(
  rows: BambuSyncedSpoolRow[],
  printerSerial: string
): Map<number, string[]> {
  const result = new Map<number, string[]>();

  for (const row of rows) {
    if (row.bambuInPrinter !== true) continue;
    if (!row.bambuDevId || row.bambuDevId !== printerSerial) continue;
    if (row.bambuSlotId === null) continue;

    const slotIndex = Number(row.bambuSlotId);
    if (!Number.isInteger(slotIndex)) continue;

    const list = result.get(slotIndex) ?? [];
    list.push(row.id);
    result.set(slotIndex, list);
  }

  return result;
}

export interface AmsSlotSelfHeal {
  slotIndex: number;
  spoolId: string;
}

/**
 * ams_slots como projeção/cache da localização física: quando a Prioridade
 * 1 (Bambu Cloud) resolve com segurança um spool diferente do que está
 * gravado em ams_slots (ou quando ainda não havia nada gravado), corrige o
 * vínculo automaticamente. Idempotente -- reprocessar o mesmo job depois do
 * vínculo já corrigido não gera nenhum heal (amsSlotSpoolId já bate com
 * spoolId), então rodar de novo não escreve nada.
 *
 * Nunca soa o vínculo ams_slots quando a resolução caiu por fallback
 * (source "ams_slots") ou ficou "none": nesses casos não há evidência nova
 * o bastante da Bambu Cloud para justificar sobrescrever o que já existe.
 */
export function computeAmsSlotSelfHeals(
  resolutions: Map<number, SlotResolution>
): AmsSlotSelfHeal[] {
  const heals: AmsSlotSelfHeal[] = [];

  for (const r of resolutions.values()) {
    if (r.source !== "bambu_cloud" || !r.spoolId) continue;
    if (r.amsSlotSpoolId === r.spoolId) continue;

    heals.push({ slotIndex: r.slotIndex, spoolId: r.spoolId });
  }

  return heals;
}

export function buildJobConsumptionItems(
  perSlot: Map<number, SlotConsumption>,
  spoolBySlot: Map<number, string | null>,
  percentExecuted: number
): JobConsumptionItem[] {
  const items: JobConsumptionItem[] = [];

  for (const [slotIdx, { grams, quality, weightDiscount }] of perSlot) {
    const spoolId = spoolBySlot.get(slotIdx) ?? null;

    const finalGrams = computeFinalGrams(
      grams,
      weightDiscount,
      percentExecuted,
      quality
    );

    items.push({
      spool_id: spoolId,
      slot_index: slotIdx,
      grams: finalGrams,
      consumption_quality: quality,
      orphan_slot: !spoolId,
    });
  }

  return items;
}

