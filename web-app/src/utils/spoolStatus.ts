import type { Spool } from "../types";

/**
 * Um carretel "precisa de pesagem" quando veio do Cloud Spool Sync
 * (bambu_spool_id preenchido) e ainda não teve o peso real confirmado pelo
 * usuário -- current_weight/initial_weight/spool_tare_weight nesse caso são
 * só o default da coluna (buildSpoolInsertRow não os envia no INSERT).
 * Carretéis sem origem Bambu são considerados confirmados desde a criação
 * (fluxo de vínculo de NFC já abre a edição manual na hora).
 */
export function needsWeighing(spool: Spool): boolean {
  return Boolean(spool.bambu_spool_id) && !spool.weight_confirmed_at;
}

export type SpoolOrigin = "bambu_cloud" | "manual";

export function getSpoolOrigin(spool: Spool): SpoolOrigin {
  return spool.bambu_spool_id ? "bambu_cloud" : "manual";
}

/**
 * bambu_ams_id e bambu_slot_id vêm 0-based da API da Bambu (confirmado
 * contra dados reais na homologação: spool 15582983 tem bambu_ams_id="0",
 * bambu_slot_id="2" e está fisicamente na AMS 1, slot 3 da impressora).
 * Formata só para apresentação -- nunca reescreve o dado persistido.
 */
export function formatBambuLocation(spool: Spool): string | null {
  if (!spool.bambu_in_printer) return null;

  const device = spool.bambu_device_name || "Impressora";

  const amsRaw = spool.bambu_ams_id;
  const slotRaw = spool.bambu_slot_id;

  if (amsRaw == null || slotRaw == null) {
    return device;
  }

  const amsNum = Number(amsRaw);
  const slotNum = Number(slotRaw);

  if (!Number.isFinite(amsNum) || !Number.isFinite(slotNum)) {
    return `${device} • AMS ${amsRaw} • Slot ${slotRaw}`;
  }

  return `${device} • AMS ${amsNum + 1} • Slot ${slotNum + 1}`;
}

/**
 * Prioriza spools atualmente na impressora/AMS, depois os demais ativos
 * (ordem alfabética por cor, mesmo critério já usado em fetchInventory).
 */
export function sortSpoolsForSpoolScreen(spools: Spool[]): Spool[] {
  return [...spools].sort((a, b) => {
    const aInPrinter = a.bambu_in_printer ? 1 : 0;
    const bInPrinter = b.bambu_in_printer ? 1 : 0;

    if (aInPrinter !== bInPrinter) {
      return bInPrinter - aInPrinter;
    }

    return (a.color_name || "").localeCompare(b.color_name || "", "pt-BR", {
      sensitivity: "base",
    });
  });
}

export interface WeighFormInput {
  grossWeight: string;
  tareWeight: string;
  initialWeight?: string;
}

export interface WeighUpdatePayload {
  current_weight: number;
  spool_tare_weight: number;
  initial_weight?: number;
  weight_confirmed_at: string;
}

/**
 * Constrói o payload de UPDATE de uma pesagem. De propósito só contém
 * campos locais controlados pelo Filamap -- nunca inclui nenhuma coluna
 * bambu_* nem bambu_spool_id, preservando a origem/localização Bambu.
 */
export function buildWeighUpdate(
  input: WeighFormInput,
  now: string = new Date().toISOString()
): WeighUpdatePayload {
  const gross = parseFloat(input.grossWeight) || 0;
  const tare = parseFloat(input.tareWeight) || 0;
  const net = Math.max(0, gross - tare);

  const payload: WeighUpdatePayload = {
    current_weight: net,
    spool_tare_weight: tare,
    weight_confirmed_at: now,
  };

  if (input.initialWeight !== undefined && input.initialWeight !== "") {
    const initial = parseFloat(input.initialWeight);
    if (Number.isFinite(initial) && initial > 0) {
      payload.initial_weight = initial;
    }
  }

  return payload;
}

/**
 * Sugestão (não autoritativa) de peso inicial a partir do netWeight nominal
 * reportado pela Bambu -- guardado em bambu_source_metadata.net_weight pelo
 * Cloud Spool Sync. Nunca deve ser aplicado automaticamente ao carretel:
 * netWeight é a referência nominal do produto, não o saldo real atual.
 */
export function suggestInitialWeightFromBambu(spool: Spool): number | null {
  const metadata = (spool as any).bambu_source_metadata;
  const netWeight = metadata?.net_weight;
  return typeof netWeight === "number" && netWeight > 0 ? netWeight : null;
}

/**
 * Guarantee: uma tag NFC não pode ficar vinculada a dois carretéis. Além da
 * constraint UNIQUE(nfc_uid) no banco (rede de segurança contra corrida),
 * checa localmente para dar uma mensagem clara antes de tentar o UPDATE.
 */
export function findConflictingSpool(
  spools: Spool[],
  nfcUid: string,
  excludeSpoolId: string
): Spool | null {
  return (
    spools.find(
      (s) => s.id !== excludeSpoolId && s.nfc_uid && s.nfc_uid === nfcUid
    ) || null
  );
}

export interface NfcLinkUpdatePayload {
  nfc_uid: string;
}

/**
 * Payload de vínculo de NFC: de propósito só contém nfc_uid -- nunca toca
 * bambu_spool_id nem qualquer outra coluna bambu_*, e nunca cria um
 * carretel novo (quem chama sempre já tem um spool existente selecionado).
 */
export function buildNfcLinkUpdate(nfcUid: string): NfcLinkUpdatePayload {
  return { nfc_uid: nfcUid };
}

export interface SpotValidationResult {
  isOccupied: boolean;
  occupyingSpool?: Spool;
}

/**
 * Valida se um spot físico já está ocupado por outro carretel no estoque.
 * Case-insensitive e ignora espaços em branco nas extremidades.
 * targetSpoolId é o carretel sendo editado (ou null para criação).
 */
export function validateSpotAssignment(
  spools: Spool[],
  targetSpoolId: string | null,
  spot: string | null | undefined
): SpotValidationResult {
  if (!spot || !spot.trim()) {
    return { isOccupied: false };
  }

  const normalized = spot.trim().toLowerCase();
  const occupying = spools.find(
    (s) =>
      s.id !== targetSpoolId &&
      s.location &&
      s.location.trim().toLowerCase() === normalized
  );

  if (occupying) {
    return { isOccupied: true, occupyingSpool: occupying };
  }

  return { isOccupied: false };
}

export interface LocationUpdatePayload {
  location: string | null;
}

/**
 * Constrói payload de atualização de localização (spot).
 * Converte string vazia ou apenas espaços em null.
 */
export function buildLocationUpdate(
  location: string | null | undefined
): LocationUpdatePayload {
  if (!location || !location.trim()) {
    return { location: null };
  }
  return { location: location.trim() };
}

export interface UnlinkNfcUpdatePayload {
  nfc_uid: null;
  nfc_written_at: null;
}

/**
 * Constrói payload de desvinculação de NFC.
 * Preserva estritamente saldo líquido, tara, histórico de impressões,
 * localização e identidade do perfil/Bambu.
 */
export function buildUnlinkNfcUpdate(): UnlinkNfcUpdatePayload {
  return {
    nfc_uid: null,
    nfc_written_at: null,
  };
}

export interface ParsedProfileForm {
  brand: string;
  material: string;
  color_name: string;
  color_hex: string;
  density?: number;
  filament_profile_id: string;
  suggestedTare: number;
}

/**
 * Extrai campos de formulário para criação assistida de carretel a partir
 * de um perfil de fatiador (Bambu Studio / Orca Slicer).
 * Não cria carretel físico sozinho — serve apenas para pré-preenchimento
 * da interface com confirmação obrigatória pelo usuário.
 */
export function parseProfileToSpoolForm(
  profile: import("../types").UserFilamentProfile
): ParsedProfileForm {
  const metadata = profile.source_metadata as Record<string, unknown> | null;

  // Marca
  let brand = profile.brand?.trim() || "";
  if (!brand && metadata?.filament_vendor) {
    brand = String(metadata.filament_vendor).trim();
  }
  if (!brand) {
    brand = "Genérico";
  }

  // Material
  const material = profile.material?.trim() || "PLA";

  // Cor Hex
  let colorHex = "#FFFFFF";
  const rawColor = metadata?.default_filament_colour;
  if (typeof rawColor === "string" && rawColor.startsWith("#")) {
    colorHex = rawColor;
  } else if (
    Array.isArray(rawColor) &&
    typeof rawColor[0] === "string" &&
    rawColor[0].startsWith("#")
  ) {
    colorHex = rawColor[0];
  }

  // Nome da Cor
  let colorName = profile.color_name?.trim() || "";
  if (!colorName) {
    colorName = profile.display_name?.trim() || "Personalizado";
  }

  // Densidade
  let density: number | undefined;
  if (metadata?.filament_density) {
    const parsed = parseFloat(String(metadata.filament_density));
    if (Number.isFinite(parsed) && parsed > 0) {
      density = parsed;
    }
  }

  return {
    brand,
    material,
    color_name: colorName,
    color_hex: colorHex,
    density,
    filament_profile_id: profile.source_key || profile.id,
    suggestedTare: 200,
  };
}

