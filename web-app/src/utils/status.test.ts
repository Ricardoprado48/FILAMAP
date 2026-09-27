import { describe, it, expect } from "vitest";
import type { Printer } from "../types";
import {
  getAgentStatus,
  getPrinterStatus,
  formatPrinterOperationalState,
  isPrinterLivePrinting,
} from "./status";

function createPrinter(overrides: Partial<Printer> = {}): Printer {
  return {
    id: "p1",
    serial: "03919D570307088",
    model: "A1",
    ip_address: "192.168.15.15",
    is_online: true,
    last_seen_at: new Date().toISOString(),
    last_online: new Date().toISOString(),
    gcode_state: "IDLE",
    ...overrides,
  };
}

describe("Status Hermético - Agent e Impressora (Fixtures A - L)", () => {
  const baseNow = 1758990000000; // Epoch fixo para testes determinísticos

  describe("STATUS AGENT", () => {
    it("Fixture A: heartbeat fresco (< 45s) -> Online", () => {
      const printer = createPrinter({
        last_seen_at: new Date(baseNow - 15000).toISOString(),
      });
      expect(getAgentStatus(printer, baseNow)).toBe("ONLINE");
    });

    it("Fixture B: heartbeat expirado (>= 45s) -> Offline", () => {
      const printer = createPrinter({
        last_seen_at: new Date(baseNow - 46000).toISOString(),
      });
      expect(getAgentStatus(printer, baseNow)).toBe("OFFLINE");
    });

    it("Fixture C: timestamp null -> Offline (estado seguro)", () => {
      const printer = createPrinter({ last_seen_at: null });
      expect(getAgentStatus(printer, baseNow)).toBe("OFFLINE");
    });

    it("Fixture D: timestamp inválido -> Offline (estado seguro)", () => {
      const printer = createPrinter({ last_seen_at: "data-invalida" });
      expect(getAgentStatus(printer, baseNow)).toBe("OFFLINE");
    });

    it("Fixture E: timezone UTC correto interpretado em epoch ms", () => {
      const utcString = "2026-09-27T18:00:00.000Z";
      const exactTime = new Date(utcString).getTime();
      const printer = createPrinter({ last_seen_at: utcString });

      // 10s após o timestamp UTC exato -> ONLINE
      expect(getAgentStatus(printer, exactTime + 10000)).toBe("ONLINE");
      // 50s após o timestamp UTC exato -> OFFLINE
      expect(getAgentStatus(printer, exactTime + 50000)).toBe("OFFLINE");
    });

    it("Fixture F: passagem do tempo sem novo fetch expira visualmente", () => {
      const printer = createPrinter({
        last_seen_at: new Date(baseNow).toISOString(),
      });
      // No momento inicial T0:
      expect(getAgentStatus(printer, baseNow)).toBe("ONLINE");
      // Após 20s:
      expect(getAgentStatus(printer, baseNow + 20000)).toBe("ONLINE");
      // Após 50s sem novo fetch:
      expect(getAgentStatus(printer, baseNow + 50000)).toBe("OFFLINE");
    });
  });

  describe("STATUS IMPRESSORA", () => {
    it("Fixture G: Agent Online + telemetry fresca (< 60s) -> Online", () => {
      const printer = createPrinter({
        last_seen_at: new Date(baseNow - 5000).toISOString(),
        last_online: new Date(baseNow - 10000).toISOString(),
        is_online: true,
      });
      expect(getPrinterStatus(printer, baseNow)).toBe("ONLINE");
    });

    it("Fixture H: Agent Online + telemetry expirada (>= 60s) -> Offline", () => {
      const printer = createPrinter({
        last_seen_at: new Date(baseNow - 5000).toISOString(),
        last_online: new Date(baseNow - 70000).toISOString(),
        is_online: true,
      });
      expect(getPrinterStatus(printer, baseNow)).toBe("OFFLINE");
    });

    it("Fixture H2: Agent Online + is_online false -> Offline", () => {
      const printer = createPrinter({
        last_seen_at: new Date(baseNow - 5000).toISOString(),
        is_online: false,
      });
      expect(getPrinterStatus(printer, baseNow)).toBe("OFFLINE");
    });

    it("Fixture I: Agent Offline + telemetry antiga -> Sem comunicação", () => {
      const printer = createPrinter({
        last_seen_at: new Date(baseNow - 60000).toISOString(),
        last_online: new Date(baseNow - 120000).toISOString(),
      });
      expect(getPrinterStatus(printer, baseNow)).toBe("SEM_COMUNICACAO");
    });

    it("Fixture J: Agent Offline + telemetry aparentemente fresca em cache -> Sem comunicação", () => {
      // O Agent crashou há 60s, mas a telemetria em cache tem timestamp de 2s atrás:
      // O frontend NUNCA pode confiar no estado da impressora sem observador vivo!
      const printer = createPrinter({
        last_seen_at: new Date(baseNow - 60000).toISOString(),
        last_online: new Date(baseNow - 2000).toISOString(),
      });
      expect(getPrinterStatus(printer, baseNow)).toBe("SEM_COMUNICACAO");
    });

    it("Fixture K: startup sem dados (undefined) -> estado neutro de verificação", () => {
      expect(getAgentStatus(undefined)).toBe("VERIFICANDO");
      expect(getPrinterStatus(undefined)).toBe("VERIFICANDO");
      expect(formatPrinterOperationalState(undefined)).toBe("Verificando...");
    });

    it("Fixture L: reconexão -> volta a Online deterministicamente", () => {
      const printerDesconectada = createPrinter({
        last_seen_at: new Date(baseNow - 5000).toISOString(),
        is_online: false,
      });
      expect(getPrinterStatus(printerDesconectada, baseNow)).toBe("OFFLINE");

      const printerReconectada = createPrinter({
        last_seen_at: new Date(baseNow - 1000).toISOString(),
        last_online: new Date(baseNow - 1000).toISOString(),
        is_online: true,
      });
      expect(getPrinterStatus(printerReconectada, baseNow)).toBe("ONLINE");
    });
  });

  describe("ESTADOS OPERACIONAIS HUMANOS", () => {
    it("Mapeia RUNNING para 'Imprimindo'", () => {
      const printer = createPrinter({ gcode_state: "RUNNING" });
      expect(formatPrinterOperationalState(printer)).toBe("Imprimindo");
      expect(isPrinterLivePrinting(printer)).toBe(true);
    });

    it("Mapeia PAUSE para 'Pausada'", () => {
      const printer = createPrinter({ gcode_state: "PAUSE" });
      expect(formatPrinterOperationalState(printer)).toBe("Pausada");
      expect(isPrinterLivePrinting(printer)).toBe(true);
    });

    it("Mapeia FINISH para 'Pronta para impressão'", () => {
      const printer = createPrinter({ gcode_state: "FINISH" });
      expect(formatPrinterOperationalState(printer)).toBe("Pronta para impressão");
      expect(isPrinterLivePrinting(printer)).toBe(false);
    });

    it("Mapeia IDLE para 'Pronta para impressão'", () => {
      const printer = createPrinter({ gcode_state: "IDLE" });
      expect(formatPrinterOperationalState(printer)).toBe("Pronta para impressão");
      expect(isPrinterLivePrinting(printer)).toBe(false);
    });

    it("Mapeia FAILED para 'Falha na impressão'", () => {
      const printer = createPrinter({ gcode_state: "FAILED" });
      expect(formatPrinterOperationalState(printer)).toBe("Falha na impressão");
      expect(isPrinterLivePrinting(printer)).toBe(false);
    });

    it("Mapeia STOP/CANCEL para 'Interrompida'", () => {
      const printer = createPrinter({ gcode_state: "STOP" });
      expect(formatPrinterOperationalState(printer)).toBe("Interrompida");
      expect(isPrinterLivePrinting(printer)).toBe(false);
    });

    it("Quando Agent Offline, exibe 'Aguardando Desktop Agent'", () => {
      const printer = createPrinter({
        last_seen_at: new Date(baseNow - 90000).toISOString(),
      });
      expect(formatPrinterOperationalState(printer, undefined, undefined, baseNow)).toBe("Aguardando Desktop Agent");
    });

    it("Quando Impressora Offline, exibe 'Desconectada'", () => {
      const printer = createPrinter({
        last_seen_at: new Date(baseNow - 5000).toISOString(),
        is_online: false,
      });
      expect(formatPrinterOperationalState(printer, undefined, undefined, baseNow)).toBe("Desconectada");
    });
  });
});
