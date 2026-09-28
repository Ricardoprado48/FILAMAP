import { describe, it, expect } from "vitest";
import { isPrinterOnline, isPrinterLivePrinting } from "./printer";
import type { Printer } from "../types";

describe("printer utils", () => {
  const createPrinter = (overrides: Partial<Printer> = {}): Printer => ({
    id: "printer-1",
    serial: "03919D570307088",
    model: "A1",
    ip_address: "192.168.15.4",
    is_online: true,
    last_seen_at: new Date().toISOString(),
    gcode_state: "IDLE",
    ...overrides,
  });

  describe("isPrinterOnline", () => {
    it("retorna false se impressora for nula ou indefinida", () => {
      expect(isPrinterOnline(null)).toBe(false);
      expect(isPrinterOnline(undefined)).toBe(false);
    });

    it("retorna false se last_seen_at não estiver definido", () => {
      const printer = createPrinter({ last_seen_at: null });
      expect(isPrinterOnline(printer)).toBe(false);
    });

    it("retorna true se Agent vivo (last_seen_at < 45s) E telemetria da impressora recente (last_online)", () => {
      const printer = createPrinter({
        last_seen_at: new Date(Date.now() - 5000).toISOString(),
        last_online: new Date(Date.now() - 5000).toISOString(),
      });
      expect(isPrinterOnline(printer)).toBe(true);
    });

    it("retorna false com só o heartbeat do Agent recente e sem telemetria da impressora", () => {
      const printer = createPrinter({ last_seen_at: new Date(Date.now() - 5000).toISOString(), last_online: null });
      expect(isPrinterOnline(printer)).toBe(false);
    });

    it("retorna false se last_seen_at for antigo (> 45s)", () => {
      const printer = createPrinter({ last_seen_at: new Date(Date.now() - 50000).toISOString() });
      expect(isPrinterOnline(printer)).toBe(false);
    });
  });

  describe("isPrinterLivePrinting", () => {
    it("H: RUNNING + Agent vivo + telemetria recente -> card ao vivo ativo (true)", () => {
      const printer = createPrinter({
        last_seen_at: new Date(Date.now() - 2000).toISOString(),
        last_online: new Date(Date.now() - 2000).toISOString(),
        gcode_state: "RUNNING",
      });
      expect(isPrinterLivePrinting(printer)).toBe(true);
    });

    it("PAUSE + Agent vivo + telemetria recente -> card ao vivo ativo (true)", () => {
      const printer = createPrinter({
        last_seen_at: new Date(Date.now() - 2000).toISOString(),
        last_online: new Date(Date.now() - 2000).toISOString(),
        gcode_state: "PAUSE",
      });
      expect(isPrinterLivePrinting(printer)).toBe(true);
    });

    it("I: RUNNING + last_seen_at expirado -> card ao vivo inativo (false)", () => {
      const printer = createPrinter({
        last_seen_at: new Date(Date.now() - 50000).toISOString(),
        gcode_state: "RUNNING",
      });
      expect(isPrinterLivePrinting(printer)).toBe(false);
    });

    it("J: OFFLINE + RUNNING stale (ex: dados de ontem) -> nunca mostrar impressão ao vivo", () => {
      const printer = createPrinter({
        last_seen_at: "2026-09-25T15:30:12.405Z",
        gcode_state: "RUNNING",
        print_progress: 13,
      });
      expect(isPrinterLivePrinting(printer)).toBe(false);
    });

    it("IDLE + last_seen_at válido -> card ao vivo inativo (false)", () => {
      const printer = createPrinter({
        last_seen_at: new Date(Date.now() - 1000).toISOString(),
        gcode_state: "IDLE",
      });
      expect(isPrinterLivePrinting(printer)).toBe(false);
    });

    it("FINISH + last_seen_at válido -> card ao vivo inativo (false)", () => {
      const printer = createPrinter({
        last_seen_at: new Date(Date.now() - 1000).toISOString(),
        gcode_state: "FINISH",
      });
      expect(isPrinterLivePrinting(printer)).toBe(false);
    });
  });
});
