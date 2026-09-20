import type { Printer } from "../types";
import { PRINTER_ONLINE_THRESHOLD_MS } from "../constants";

export function isPrinterOnline(
  printer?: Printer | null
): boolean {
  if (!printer?.last_seen_at) return false;

  return (
    Date.now() -
      new Date(printer.last_seen_at).getTime() <
    PRINTER_ONLINE_THRESHOLD_MS
  );
}
