// Carretel que acaba no meio da impressão (4.4.0).
//
// Caso real de 08/10: o Preto Velvet acabou no meio da peça, a AMS trocou sozinha
// para o carretel reserva do mesmo filamento, e o Agent debitou tudo do carretel
// que acabou -- que continuou "no AMS" com saldo fantasma.
//
// Aqui só se registra o que a impressora mostrou durante o job (dado bruto):
//   - trocas de slot (tray_now), com o percentual do momento;
//   - carretel acabado, por dois sinais independentes:
//       hms        -> alerta 0700_2S00_0002_0001/0002 ("AMS1 SlotS+1 filament has run out");
//       tray_empty -> o slot que estava alimentando a impressão ficou vazio (tray_exist_bits).
// No fim do job, applyRunoutSplit divide o consumo do slot que acabou com o slot
// reserva e marca o carretel como esgotado; quem zera/arquiva é o finalize_print_job.

import type { SlotConsumption } from "./consumption";

export interface SlotSwitch {
  from: number | null;
  to: number;
  percent: number;
  at: string;
}

export type RunoutSource = "hms" | "tray_empty";

export interface RunoutEvent {
  slot: number;
  percent: number;
  at: string;
  sources: RunoutSource[];
  hms?: string;
}

export interface JobAmsEvents {
  switches: SlotSwitch[];
  runouts: RunoutEvent[];
}

export function emptyAmsEvents(): JobAmsEvents {
  return { switches: [], runouts: [] };
}

// Alerta HMS de filamento acabado num slot da AMS. attr 0x07AA2S00: módulo 07 (AMS),
// AA = unidade AMS, 2S = slot S. code 0x0002000N, N = 1 (acabou) ou 2 (acabou, trocando).
export function parseRunoutHms(attr: number, code: number): number | null {
  if (((attr >>> 24) & 0xff) !== 0x07) return null;
  const unit = (attr >>> 16) & 0xff;
  const slotByte = (attr >>> 8) & 0xff;
  if (slotByte < 0x20 || slotByte > 0x23) return null;
  if (((code >>> 16) & 0xffff) !== 0x0002) return null;
  const detail = code & 0xffff;
  if (detail !== 0x0001 && detail !== 0x0002) return null;
  // Só uma unidade AMS é suportada (ams_slots.slot_index 0..3).
  if (unit !== 0) return null;
  return slotByte - 0x20;
}

// Slots com filamento segundo tray_exist_bits. Sem o campo na mensagem (relatório
// parcial) não há como saber -- undefined, e ninguém conclui "ficou vazio".
export function trayOccupancy(print: any): boolean[] | undefined {
  const bits = print?.ams?.tray_exist_bits;
  if (bits === undefined || bits === null || bits === "") return undefined;
  const mask = typeof bits === "number" ? bits : parseInt(String(bits).trim(), 16);
  if (Number.isNaN(mask)) return undefined;
  return [0, 1, 2, 3].map((i) => (mask & (1 << i)) !== 0);
}

export interface RunoutObservation {
  events: JobAmsEvents;
  // Slot alimentando a impressão ANTES desta mensagem e depois dela (null = nenhum/255).
  previousActiveSlot: number | null;
  activeSlot: number | null;
  usedSlots: number[];
  percent: number;
  previousOccupancy?: boolean[];
  occupancy?: boolean[];
  hmsAppeared: Array<{ attr: number; code: number; formatted: string }>;
  now?: number;
}

export type RunoutNews =
  | { kind: "switch"; from: number | null; to: number; percent: number }
  | { kind: "runout"; slot: number; percent: number; source: RunoutSource; hms?: string };

function addRunout(events: JobAmsEvents, slot: number, percent: number, at: string, source: RunoutSource, hms?: string): boolean {
  const existing = events.runouts.find((r) => r.slot === slot);
  if (existing) {
    if (!existing.sources.includes(source)) existing.sources.push(source);
    if (hms && !existing.hms) existing.hms = hms;
    return false;
  }
  events.runouts.push({ slot, percent, at, sources: [source], ...(hms ? { hms } : {}) });
  return true;
}

// Atualiza os eventos do job com uma mensagem da impressora e devolve o que é novo (para o log).
export function observeRunout(o: RunoutObservation): RunoutNews[] {
  const news: RunoutNews[] = [];
  const at = new Date(o.now ?? Date.now()).toISOString();

  if (o.activeSlot !== null) {
    const last = o.events.switches[o.events.switches.length - 1];
    if (!last || last.to !== o.activeSlot) {
      const from = last ? last.to : null;
      o.events.switches.push({ from, to: o.activeSlot, percent: o.percent, at });
      if (from !== null) news.push({ kind: "switch", from, to: o.activeSlot, percent: o.percent });
    }
  }

  for (const h of o.hmsAppeared) {
    const slot = parseRunoutHms(h.attr, h.code);
    if (slot === null) continue;
    if (addRunout(o.events, slot, o.percent, at, "hms", h.formatted)) {
      news.push({ kind: "runout", slot, percent: o.percent, source: "hms", hms: h.formatted });
    }
  }

  // Slot que alimentava a impressão ficou vazio. Tirar à mão um carretel que está
  // sendo puxado derruba a impressão, então aqui é filamento acabado. Slot vazio que
  // não estava alimentando (ex.: cor que já terminou) não conta.
  if (o.previousOccupancy && o.occupancy) {
    for (let slot = 0; slot < 4; slot++) {
      if (!o.previousOccupancy[slot] || o.occupancy[slot]) continue;
      const wasFeeding = slot === o.previousActiveSlot || slot === o.activeSlot;
      if (!wasFeeding || !o.usedSlots.includes(slot)) continue;
      if (addRunout(o.events, slot, o.percent, at, "tray_empty")) {
        news.push({ kind: "runout", slot, percent: o.percent, source: "tray_empty" });
      }
    }
  }

  return news;
}

// Slot reserva: o primeiro para onde a impressão foi a partir do slot que acabou,
// perto do momento em que acabou, e que o fatiador não tinha planejado (troca de cor
// planejada não é reserva).
const BACKUP_WINDOW_MS = 15 * 60 * 1000;

export function findBackupSlot(
  runout: RunoutEvent,
  switches: SlotSwitch[],
  isPlannedSlot: (slot: number) => boolean
): number | null {
  const t = Date.parse(runout.at);
  const candidates = switches.filter(
    (s) =>
      s.from === runout.slot &&
      s.to !== runout.slot &&
      !isPlannedSlot(s.to) &&
      Math.abs(Date.parse(s.at) - t) <= BACKUP_WINDOW_MS
  );
  candidates.sort((a, b) => Math.abs(Date.parse(a.at) - t) - Math.abs(Date.parse(b.at) - t));
  return candidates.length ? candidates[0].to : null;
}

export interface RunoutSplit {
  slot: number;
  backupSlot: number | null;
  fraction: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// Divide o consumo planejado do slot que acabou: até o percentual em que acabou fica
// com ele, o resto vai para o reserva (pela proporção do que foi impresso). Sem
// reserva identificado, o slot fica com tudo (como antes) e só é marcado esgotado.
// Muda perSlot no lugar; computeFinalGrams depois aplica o percentual executado.
export function applyRunoutSplit(
  perSlot: Map<number, SlotConsumption>,
  events: JobAmsEvents | undefined,
  percentExecuted: number
): RunoutSplit[] {
  const splits: RunoutSplit[] = [];
  if (!events?.runouts.length) return splits;

  const planned = new Set<number>();
  for (const [slot, c] of perSlot) {
    if (c.quality !== "unknown" && c.grams > 0) planned.add(slot);
  }

  for (const runout of events.runouts) {
    const own = perSlot.get(runout.slot);
    if (!own) continue;
    own.depleted = true;

    const backup = findBackupSlot(runout, events.switches, (s) => planned.has(s));
    if (backup === null || own.quality === "unknown" || own.grams <= 0 || percentExecuted <= 0) {
      splits.push({ slot: runout.slot, backupSlot: null, fraction: 1 });
      continue;
    }

    const fraction = Math.max(0, Math.min(1, runout.percent / percentExecuted));
    const total = own.grams;
    const discount = own.weightDiscount;
    own.grams = round2(total * fraction);
    own.weightDiscount = round2(discount * fraction);
    perSlot.set(backup, {
      grams: round2(total * (1 - fraction)),
      quality: own.quality,
      weightDiscount: round2(discount * (1 - fraction)),
      ...(own.ambiguous ? { ambiguous: true } : {}),
    });
    splits.push({ slot: runout.slot, backupSlot: backup, fraction });
  }

  return splits;
}
