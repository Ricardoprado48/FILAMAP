import type { Spool } from "../types";

export type NfcStatus =
  | "written"
  | "pending"
  | "none";

export function generateAutoTagId(
  material: string,
  color: string
): string {
  const cleanColor = color
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "-")
    .replace(/-+/g, "-");

  const randomSuffix =
    Math.floor(1000 + Math.random() * 9000);

  return `FILA-${material.toUpperCase()}-${cleanColor || "COR"}-${randomSuffix}`;
}

export function getNfcStatus(
  spool: Spool
): NfcStatus {
  if (spool.nfc_written_at) {
    return "written";
  }

  if (spool.nfc_uid) {
    return "pending";
  }

  return "none";
}
