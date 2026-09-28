import type { Printer } from "../types";
import { AGENT_ONLINE_THRESHOLD_MS, PRINTER_ONLINE_THRESHOLD_MS } from "../constants";

export type AgentStatus = "ONLINE" | "OFFLINE" | "VERIFICANDO";
export type PrinterStatus = "ONLINE" | "OFFLINE" | "SEM_COMUNICACAO" | "VERIFICANDO";

export function getAgentStatus(
  printer?: Printer | null,
  nowMs: number = Date.now()
): AgentStatus {
  if (printer === undefined) return "VERIFICANDO";
  if (!printer || !printer.last_seen_at) return "OFFLINE";

  const lastSeen = new Date(printer.last_seen_at).getTime();
  if (isNaN(lastSeen)) return "OFFLINE";

  const diff = nowMs - lastSeen;
  if (diff < 0) {
    // Tolerância para leve skew de relógio (< 5s no futuro ainda é recente)
    return diff > -5000 ? "ONLINE" : "ONLINE";
  }

  return diff < AGENT_ONLINE_THRESHOLD_MS ? "ONLINE" : "OFFLINE";
}

export function getPrinterStatus(
  printer?: Printer | null,
  nowMs: number = Date.now()
): PrinterStatus {
  if (printer === undefined) return "VERIFICANDO";

  const agentStatus = getAgentStatus(printer, nowMs);
  if (agentStatus === "VERIFICANDO") return "VERIFICANDO";

  // CASO A: Agent Offline -> Não há observador confiável para atestar se a impressora física está on/off.
  if (agentStatus === "OFFLINE") {
    return "SEM_COMUNICACAO";
  }

  // CASO B / C: Agent Online
  if (!printer) return "OFFLINE";

  // Se o Agent explicitamente reporta is_online: false (MQTT desconectado)
  if (printer.is_online === false) {
    return "OFFLINE";
  }

  // Se last_online estiver preenchido (timestamp dedicado da telemetria MQTT)
  if (printer.last_online) {
    const printerSeen = new Date(printer.last_online).getTime();
    if (isNaN(printerSeen)) return "OFFLINE";
    const diff = nowMs - printerSeen;
    return diff < PRINTER_ONLINE_THRESHOLD_MS ? "ONLINE" : "OFFLINE";
  }

  // Sem last_online não há evidência de que a impressora falou: Offline.
  // last_seen_at NÃO serve aqui -- o heartbeat do Agent também o grava, e
  // Agent vivo não prova impressora ligada.
  return "OFFLINE";
}

export function formatPrinterOperationalState(
  printer?: Printer | null,
  agentStatus?: AgentStatus,
  printerStatus?: PrinterStatus,
  nowMs: number = Date.now()
): string {
  const aStatus = agentStatus ?? getAgentStatus(printer, nowMs);
  const pStatus = printerStatus ?? getPrinterStatus(printer, nowMs);

  if (pStatus === "VERIFICANDO" || aStatus === "VERIFICANDO") {
    return "Verificando...";
  }

  if (pStatus === "SEM_COMUNICACAO") {
    return "Aguardando Desktop Agent";
  }

  if (pStatus === "OFFLINE") {
    return "Desconectada";
  }

  // Impressora Online -> tradução semântica dos gcode_states suportados
  const gcode = (printer?.gcode_state || "").trim().toUpperCase();

  switch (gcode) {
    case "RUNNING":
      return "Imprimindo";
    case "PAUSE":
    case "PAUSED":
      return "Pausada";
    case "PREPARE":
      return "Preparando impressão";
    case "FINISH":
    case "IDLE":
      return "Pronta para impressão";
    case "FAILED":
      return "Falha na impressão";
    case "STOP":
    case "CANCEL":
    case "CANCELED":
    case "CANCELLED":
      return "Interrompida";
    default:
      return gcode || "Pronta para impressão";
  }
}

export function isPrinterLivePrinting(
  printer?: Printer | null,
  nowMs: number = Date.now()
): boolean {
  const pStatus = getPrinterStatus(printer, nowMs);
  if (pStatus !== "ONLINE") return false;
  const gcode = (printer?.gcode_state || "").trim().toUpperCase();
  return gcode === "RUNNING" || gcode === "PAUSE" || gcode === "PAUSED";
}

export function getAgentBadgeProps(status: AgentStatus) {
  switch (status) {
    case "ONLINE":
      return {
        label: "Agent: Online",
        fullText: "AGENT ONLINE",
        bg: "rgba(16, 185, 129, 0.15)",
        color: "#34d399",
        border: "#059669",
        dotColor: "#10b981",
      };
    case "OFFLINE":
      return {
        label: "Agent: Offline",
        fullText: "AGENT OFFLINE",
        bg: "rgba(239, 68, 68, 0.15)",
        color: "#f87171",
        border: "#dc2626",
        dotColor: "#ef4444",
      };
    case "VERIFICANDO":
    default:
      return {
        label: "Agent: ...",
        fullText: "AGENT VERIFICANDO",
        bg: "rgba(148, 163, 184, 0.15)",
        color: "#94a3b8",
        border: "#475569",
        dotColor: "#94a3b8",
      };
  }
}

export function getPrinterBadgeProps(status: PrinterStatus) {
  switch (status) {
    case "ONLINE":
      return {
        label: "Impressora: Online",
        fullText: "IMPRESSORA ONLINE",
        bg: "rgba(16, 185, 129, 0.15)",
        color: "#34d399",
        border: "#059669",
        dotColor: "#10b981",
      };
    case "OFFLINE":
      return {
        label: "Impressora: Offline",
        fullText: "IMPRESSORA OFFLINE",
        bg: "rgba(239, 68, 68, 0.15)",
        color: "#f87171",
        border: "#dc2626",
        dotColor: "#ef4444",
      };
    case "SEM_COMUNICACAO":
      return {
        label: "Impressora: Sem comunicação",
        fullText: "SEM COMUNICAÇÃO",
        bg: "rgba(245, 158, 11, 0.15)",
        color: "#fbbf24",
        border: "#d97706",
        dotColor: "#f59e0b",
      };
    case "VERIFICANDO":
    default:
      return {
        label: "Impressora: ...",
        fullText: "IMPRESSORA VERIFICANDO",
        bg: "rgba(148, 163, 184, 0.15)",
        color: "#94a3b8",
        border: "#475569",
        dotColor: "#94a3b8",
      };
  }
}
