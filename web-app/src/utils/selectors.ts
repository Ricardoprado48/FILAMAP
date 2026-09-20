import type { Printer, PrintLog, Spool } from "../types";

export function getPendingWeighingLogs(
  printLogs: PrintLog[]
): PrintLog[] {
  return printLogs.filter(
    (log) => log.needs_weighing
  );
}

export function getWriterSpool(
  inventory: Spool[],
  writerSpoolId: string
): Spool | null {
  return (
    inventory.find(
      (spool) => spool.id === writerSpoolId
    ) || null
  );
}

export function getActivePrinter(
  printers: Printer[]
): Printer | null {
  return printers[0] || null;
}
