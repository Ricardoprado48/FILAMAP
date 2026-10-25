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
