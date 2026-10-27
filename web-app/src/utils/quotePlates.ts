// Orçamento por placas: cada placa fatiada entra com tempo e gramas por cor, e com
// quantas vezes ela vai ser impressa (4 bases por placa, 12 pedidas = 3 vezes).
// Total = soma de (placa × vezes): é o tempo de máquina e o material de cada cor que a
// calculadora usa. A arrumação das placas no Bambu Studio é livre.

import type { SlicedFilament } from "./slicedPlate";

export interface QuotePlate {
  id: string;
  name: string;
  seconds: number;
  filaments: SlicedFilament[];
  // Quantas vezes imprimir esta placa.
  prints: number;
  notes: string;
  // Só na tela (não vai para o banco).
  thumbnail?: string;
}

export interface QuoteFilamentLine {
  key: string;
  type: string;
  color: string;
  trayInfoIdx?: string;
  grams: number;
}

export interface QuoteSummary {
  prints: number;
  seconds: number;
  grams: number;
  filaments: QuoteFilamentLine[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function filamentKey(f: { type: string; color: string; trayInfoIdx?: string }): string {
  return `${f.trayInfoIdx || ""}|${(f.type || "").toUpperCase()}|${(f.color || "").toUpperCase()}`;
}

// Vezes vazias ou zeradas contam como 1 (a placa está na lista para ser impressa).
export function printsOf(p: { prints?: number }): number {
  return p.prints && p.prints > 0 ? p.prints : 1;
}

// Soma de todas as placas, cada uma × vezes: tempo total e gramas de cada cor.
export function summarizeQuote(plates: QuotePlate[]): QuoteSummary {
  let seconds = 0;
  let prints = 0;
  const byKey = new Map<string, QuoteFilamentLine>();
  for (const p of plates) {
    const times = printsOf(p);
    prints += times;
    seconds += p.seconds * times;
    for (const f of p.filaments) {
      const key = filamentKey(f);
      const line = byKey.get(key) ?? { key, type: f.type, color: f.color, ...(f.trayInfoIdx ? { trayInfoIdx: f.trayInfoIdx } : {}), grams: 0 };
      line.grams += f.grams * times;
      byKey.set(key, line);
    }
  }
  const filaments = Array.from(byKey.values())
    .map((l) => ({ ...l, grams: round2(l.grams) }))
    .sort((a, b) => b.grams - a.grams);
  return {
    prints,
    seconds: Math.round(seconds),
    grams: round2(filaments.reduce((s, l) => s + l.grams, 0)),
    filaments,
  };
}

// Placas do catálogo; as salvas antes de "vezes" (campo units) voltam com o mesmo número.
export function loadStoredPlates(stored: Array<Omit<QuotePlate, "prints" | "thumbnail"> & { prints?: number; units?: number }>): QuotePlate[] {
  return stored.map(({ units, prints, ...rest }) => ({ ...rest, prints: prints ?? units ?? 1 }));
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

// Sobra abaixo disso: o saldo pode estar errado pela balança -- pedir para repesar.
export const STOCK_TIGHT_G = 35;

export interface StockLine extends QuoteFilamentLine {
  haveG: number;
  spoolIds: string[];
  status: "ok" | "tight" | "buy";
  // Quanto falta (status "buy") ou quanto sobra (os outros).
  diffG: number;
}

// Tem material para o orçamento? Soma o saldo de todos os carretéis do estoque (não
// arquivados) com a mesma cor e o mesmo material da placa.
export function checkStock(lines: QuoteFilamentLine[], spools: MatchableSpool[]): StockLine[] {
  const active = spools.filter((s) => !s.archived_at);
  return lines.map((line) => {
    const material = (line.type || "").toUpperCase();
    const matches = active.filter(
      (s) => hex(s.color_hex) === hex(line.color) && (!material || (s.material || "").toUpperCase().includes(material))
    );
    const haveG = round2(matches.reduce((sum, s) => sum + Math.max(0, s.current_weight ?? 0), 0));
    const left = round2(haveG - line.grams);
    const status = left < 0 ? "buy" : left < STOCK_TIGHT_G ? "tight" : "ok";
    return { ...line, haveG, spoolIds: matches.map((s) => s.id), status, diffG: Math.abs(left) };
  });
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
