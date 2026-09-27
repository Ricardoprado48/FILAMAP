import type { Printer } from "../types";
import { getPrinterStatus, isPrinterLivePrinting as isLivePrinting } from "./status";

export function isPrinterOnline(
  printer?: Printer | null
): boolean {
  return getPrinterStatus(printer) === "ONLINE";
}

export function isPrinterLivePrinting(
  printer?: Printer | null
): boolean {
  return isLivePrinting(printer);
}
