// Regras puras de runtime do Agent, extraídas de index.ts para serem
// testáveis sem MQTT/Supabase reais.

export function isPrinterReportTopic(topic: string, serial: string): boolean {
  return topic === `device/${serial}/report`;
}

export function isValidPrintPayload(print: unknown): print is Record<string, any> {
  return typeof print === "object" && print !== null && !Array.isArray(print);
}

export interface TelemetryUpdateInput {
  print: Record<string, any>;
  // true só quando a mensagem veio do tópico /report desta impressora.
  fromPrinterReport: boolean;
  currentState: string;
  activeSlotIndex: number | null;
  filamentSliceInfo?: unknown[];
  nowIso: string;
}

// Monta o UPDATE de printers para uma mensagem de telemetria.
//
// Contrato de sinais (ver docs/06_DECISIONS.md, incidente 2026-09-27):
// - last_seen_at: o Agent está vivo (heartbeat também grava).
// - last_online: a IMPRESSORA falou via MQTT. Só é produzido aqui, e só
//   para um payload `print` válido recebido em device/{serial}/report --
//   nunca por heartbeat, conexão MQTT, FTPS ou resposta do Supabase.
export function buildTelemetryUpdate(input: TelemetryUpdateInput): Record<string, unknown> {
  const { print, currentState, activeSlotIndex, nowIso } = input;
  const data: Record<string, unknown> = {
    is_online: true,
    last_seen_at: nowIso,
    gcode_state: currentState,
    active_slot_index: activeSlotIndex,
  };
  if (input.fromPrinterReport && isValidPrintPayload(print)) {
    data.last_online = nowIso;
  }
  if (print.subtask_name !== undefined) data.current_task = print.subtask_name;
  if (print.mc_percent !== undefined) data.print_progress = Number(print.mc_percent) || 0;
  if (print.mc_remaining_time !== undefined) data.remaining_time_min = Number(print.mc_remaining_time) || 0;
  if (print.layer_num !== undefined) data.current_layer = Number(print.layer_num) || 0;
  if (print.total_layer_num !== undefined) data.total_layers = Number(print.total_layer_num) || 0;
  if (print.nozzle_temper !== undefined) data.nozzle_temp = Math.round(Number(print.nozzle_temper));
  if (print.bed_temper !== undefined) data.bed_temp = Math.round(Number(print.bed_temper));
  if (input.filamentSliceInfo && input.filamentSliceInfo.length > 0) {
    data.filament_slice_info = input.filamentSliceInfo;
  }
  return data;
}

// Estado gcode assumido ao restaurar um job de agent-state.json. Antes era
// sempre "IDLE", e aí um job que terminou em FAILED (ou já voltou para
// IDLE) com o Agent fora do ar nunca era finalizado: FAILED/STOP exigem
// vir de RUNNING/PAUSE e IDLE exige lastGcodeState RUNNING. Um job salvo
// só existe se a impressora estava imprimindo quando foi gravado.
export function initialGcodeStateFor(restoredJob: unknown): string {
  return restoredJob ? "RUNNING" : "IDLE";
}
