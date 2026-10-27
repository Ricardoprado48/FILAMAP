// Orçamento por placas: cada placa fatiada entra com tempo e gramas por cor, e com
// quantas unidades do produto ela atende (4 copos numa placa = 4; placa só com as
// tampas de 6 produtos = 6). Por unidade do produto: soma de (placa ÷ unidades).
// A arrumação das placas no Bambu Studio é livre -- só importa o que cada uma rende.

import type { SlicedFilament } from "./slicedPlate";

export interface QuotePlate {
  id: string;
  name: string;
  seconds: number;
  filaments: SlicedFilament[];
  units: number;
  notes: string;
  // Só na tela (não vai para o banco).
  thumbnail?: string;
}

export interface QuoteFilamentLine {
  key: string;
  type: string;
  color: string;
  trayInfoIdx?: string;
  gramsPerUnit: number;
}

export interface QuoteSummary {
  secondsPerUnit: number;
  gramsPerUnit: number;
  filaments: QuoteFilamentLine[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function filamentKey(f: { type: string; color: string; trayInfoIdx?: string }): string {
  return `${f.trayInfoIdx || ""}|${(f.type || "").toUpperCase()}|${(f.color || "").toUpperCase()}`;
}

export function summarizeQuote(plates: QuotePlate[]): QuoteSummary {
  let seconds = 0;
  const byKey = new Map<string, QuoteFilamentLine>();
  for (const p of plates) {
    const units = p.units > 0 ? p.units : 1;
    seconds += p.seconds / units;
    for (const f of p.filaments) {
      const key = filamentKey(f);
      const line = byKey.get(key) ?? { key, type: f.type, color: f.color, ...(f.trayInfoIdx ? { trayInfoIdx: f.trayInfoIdx } : {}), gramsPerUnit: 0 };
      line.gramsPerUnit += f.grams / units;
      byKey.set(key, line);
    }
  }
  const filaments = Array.from(byKey.values())
    .map((l) => ({ ...l, gramsPerUnit: round2(l.gramsPerUnit) }))
    .sort((a, b) => b.gramsPerUnit - a.gramsPerUnit);
  return {
    secondsPerUnit: Math.round(seconds),
    gramsPerUnit: round2(filaments.reduce((s, l) => s + l.gramsPerUnit, 0)),
    filaments,
  };
}

// Quantas vezes imprimir a placa para chegar na encomenda: 12 peças, 2 por placa = 6.
// Sempre arredonda para cima (5 peças, 2 por placa = 3 impressões, sobra 1).
export function printsFor(units: number, qty: number): number {
  const u = units > 0 ? units : 1;
  const q = qty > 0 ? qty : 1;
  return Math.ceil(q / u - 1e-9);
}

export interface OrderFilamentLine {
  key: string;
  type: string;
  color: string;
  trayInfoIdx?: string;
  grams: number;
}

export interface OrderSummary {
  qty: number;
  seconds: number;
  grams: number;
  filaments: OrderFilamentLine[];
  plates: { id: string; prints: number; pieces: number }[];
}

// Encomenda inteira: cada placa impressa printsFor(unidades, qty) vezes. É o que vai
// para a impressora -- tempo total e gramas de cada cor.
export function summarizeOrder(plates: QuotePlate[], qty: number): OrderSummary {
  const q = qty > 0 ? qty : 1;
  let seconds = 0;
  const byKey = new Map<string, OrderFilamentLine>();
  const perPlate = plates.map((p) => {
    const units = p.units > 0 ? p.units : 1;
    const prints = printsFor(units, q);
    seconds += p.seconds * prints;
    for (const f of p.filaments) {
      const key = filamentKey(f);
      const line = byKey.get(key) ?? { key, type: f.type, color: f.color, ...(f.trayInfoIdx ? { trayInfoIdx: f.trayInfoIdx } : {}), grams: 0 };
      line.grams += f.grams * prints;
      byKey.set(key, line);
    }
    return { id: p.id, prints, pieces: Math.round(prints * units * 100) / 100 };
  });
  const filaments = Array.from(byKey.values())
    .map((l) => ({ ...l, grams: round2(l.grams) }))
    .sort((a, b) => b.grams - a.grams);
  return {
    qty: q,
    seconds: Math.round(seconds),
    grams: round2(filaments.reduce((s, l) => s + l.grams, 0)),
    filaments,
    plates: perPlate,
  };
}

export interface MatchableSpool {
  id: string;
  material?: string | null;
  color_hex?: string | null;
  price_paid?: number | null;
  current_weight?: number | null;
  filament_product_id?: string | null;
  archived_at?: string | null;
}

export interface MatchableProfile {
  source_key: string;
  filament_product_id?: string | null;
}

const hex = (c: string | null | undefined) => (c || "").replace("#", "").slice(0, 6).toUpperCase();

// Carretel do estoque para uma cor do fatiamento, para usar o preço dele.
// 1) perfil do Bambu Studio (tray_info_idx) -> produto -> carretel desse produto;
// 2) mesmo material e mesma cor. Entre vários, prefere quem tem preço e saldo.
export function matchSpoolForFilament(
  line: { type: string; color: string; trayInfoIdx?: string },
  spools: MatchableSpool[],
  profiles: MatchableProfile[]
): string {
  const active = spools.filter((s) => !s.archived_at);
  const rank = (list: MatchableSpool[]) =>
    list
      .slice()
      .sort(
        (a, b) =>
          Number(Boolean(b.price_paid)) - Number(Boolean(a.price_paid)) ||
          Number((b.current_weight ?? 0) > 0) - Number((a.current_weight ?? 0) > 0)
      )[0]?.id ?? "";

  if (line.trayInfoIdx) {
    const products = new Set(
      profiles.filter((p) => p.source_key === line.trayInfoIdx && p.filament_product_id).map((p) => p.filament_product_id)
    );
    const byProduct = active.filter((s) => s.filament_product_id && products.has(s.filament_product_id));
    if (byProduct.length) return rank(byProduct);
  }
  const material = (line.type || "").toUpperCase();
  const byColor = active.filter(
    (s) => hex(s.color_hex) === hex(line.color) && (!material || (s.material || "").toUpperCase().includes(material))
  );
  return rank(byColor);
}

export function hoursFromSeconds(seconds: number): string {
  return (Math.round((seconds / 3600) * 100) / 100).toString();
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}h${String(m).padStart(2, "0")}` : `${m} min`;
}

// O que vai para o banco (sem miniatura).
export function storablePlates(plates: QuotePlate[]): Omit<QuotePlate, "thumbnail">[] {
  return plates.map(({ thumbnail: _thumb, ...rest }) => rest);
}
