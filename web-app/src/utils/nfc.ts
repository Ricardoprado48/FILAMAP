import type { Spool } from "../types";

export function generateAutoTagId(mat: string, col: string): string {
  const cleanCol = col.trim().toUpperCase().replace(/[^A-Z0-9]/g, "-").replace(/-+/g, "-");
  const rnd = Math.floor(1000 + Math.random() * 9000);
  return `FILA-${mat.toUpperCase()}-${cleanCol || "COR"}-${rnd}`;
}

// "written": nfc_written_at confirma escrita física real via NDEFReader.write()
// (handleWriteTag). "pending": tem nfc_uid mas nunca teve gravação física
// confirmada (ex.: veio de importação em lote via seed_spools.ts). "none":
// sem nfc_uid nenhum.
export function getNfcStatus(spool: Spool): "written" | "pending" | "none" {
  if (spool.nfc_written_at) return "written";
  if (spool.nfc_uid) return "pending";
  return "none";
}
