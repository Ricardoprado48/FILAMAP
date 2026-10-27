// Placa fatiada exportada pelo Bambu Studio (seta ao lado de Imprimir placa > Exportar arquivo fatiado da placa,
// .gcode.3mf). Metadata/slice_info.config traz, por placa: tempo previsto (prediction, em
// segundos), peso total e gramas por filamento (cor, material, perfil). O projeto salvo
// (.3mf comum) NÃO tem esses dados -- só o arquivo fatiado.

import { listZipEntries, readZipEntry } from "./zipReader";

export interface SlicedFilament {
  id: number;
  type: string;
  color: string;
  grams: number;
  trayInfoIdx?: string;
}

export interface SlicedPlate {
  index: number;
  seconds: number;
  weightG: number;
  filaments: SlicedFilament[];
  objects: string[];
  thumbnail?: string;
}

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:-]+)="([^"]*)"/g)) out[m[1]] = m[2];
  return out;
}

const num = (v: string | undefined) => {
  const n = parseFloat(v ?? "");
  return Number.isFinite(n) ? n : 0;
};

export function parseSliceInfo(xml: string): SlicedPlate[] {
  const plates: SlicedPlate[] = [];
  for (const m of xml.matchAll(/<plate>([\s\S]*?)<\/plate>/g)) {
    const body = m[1];
    const meta: Record<string, string> = {};
    for (const t of body.matchAll(/<metadata\b[^>]*\/?>/g)) {
      const a = attrs(t[0]);
      if (a.key) meta[a.key] = a.value ?? "";
    }
    const filaments: SlicedFilament[] = [];
    for (const t of body.matchAll(/<filament\b[^>]*\/?>/g)) {
      const a = attrs(t[0]);
      const grams = Math.round(num(a.used_g) * 100) / 100;
      if (grams <= 0) continue;
      filaments.push({
        id: Math.trunc(num(a.id)),
        type: a.type || "",
        color: (a.color || "").toUpperCase(),
        grams,
        ...(a.tray_info_idx ? { trayInfoIdx: a.tray_info_idx } : {}),
      });
    }
    const objects = Array.from(body.matchAll(/<object\b[^>]*\/?>/g))
      .map((t) => attrs(t[0]))
      .filter((a) => a.skipped !== "true" && a.name)
      .map((a) => a.name);
    const weightG = num(meta.weight) || filaments.reduce((s, f) => s + f.grams, 0);
    plates.push({
      index: Math.trunc(num(meta.index)) || plates.length + 1,
      seconds: Math.round(num(meta.prediction)),
      weightG: Math.round(weightG * 100) / 100,
      filaments,
      objects,
    });
  }
  return plates;
}

function toDataUrl(bytes: Uint8Array, mime: string): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(bin)}`;
}

export async function readSlicedPlateFile(buf: ArrayBuffer): Promise<SlicedPlate[]> {
  const entries = listZipEntries(buf);
  const info = entries.find((e) => e.name === "Metadata/slice_info.config");
  if (!info) throw new Error("Este arquivo não tem os dados do fatiamento. No Bambu Studio, fatie e use a seta ▾ ao lado de Imprimir placa › Exportar arquivo fatiado da placa (.gcode.3mf).");
  const plates = parseSliceInfo(new TextDecoder().decode(await readZipEntry(buf, info)));
  if (!plates.length || plates.every((p) => p.seconds === 0 && p.weightG === 0)) {
    throw new Error("O arquivo não tem placa fatiada. No Bambu Studio, fatie a placa antes de exportar (o projeto salvo .3mf não guarda tempo nem gramas).");
  }
  for (const p of plates) {
    const png = entries.find((e) => e.name === `Metadata/plate_${p.index}.png`);
    if (png) {
      try {
        p.thumbnail = toDataUrl(await readZipEntry(buf, png), "image/png");
      } catch {
        // sem miniatura: a placa continua valendo
      }
    }
  }
  return plates;
}
