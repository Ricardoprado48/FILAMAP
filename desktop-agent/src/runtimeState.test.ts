import test from "node:test";
import assert from "node:assert/strict";
import { buildTelemetryUpdate, initialGcodeStateFor, isPrinterReportTopic, isValidPrintPayload } from "./runtimeState";
import { JobStateMachine, ActiveJobState } from "./jobStateMachine";

const SERIAL = "03919D570307088";
const NOW = "2026-09-28T01:00:00.000Z";

test("tópico /report da própria impressora é reconhecido; outros não", () => {
  assert.equal(isPrinterReportTopic(`device/${SERIAL}/report`, SERIAL), true);
  assert.equal(isPrinterReportTopic(`device/${SERIAL}/request`, SERIAL), false);
  assert.equal(isPrinterReportTopic(`device/OUTRA/report`, SERIAL), false);
});

test("/report válido produz last_online (UTC ISO) junto com a telemetria", () => {
  const u = buildTelemetryUpdate({
    print: { gcode_state: "IDLE", nozzle_temper: 25.4 },
    fromPrinterReport: true,
    currentState: "IDLE",
    activeSlotIndex: null,
    nowIso: NOW,
  });
  assert.equal(u.last_online, NOW);
  assert.equal(u.last_seen_at, NOW);
  assert.equal(u.nozzle_temp, 25);
  assert.match(String(u.last_online), /Z$/);
});

test("mensagem fora do tópico /report NÃO produz last_online", () => {
  const u = buildTelemetryUpdate({
    print: { gcode_state: "RUNNING" },
    fromPrinterReport: false,
    currentState: "RUNNING",
    activeSlotIndex: 1,
    nowIso: NOW,
  });
  assert.equal("last_online" in u, false);
});

test("payload print inválido NÃO produz last_online", () => {
  for (const bad of [[], "x", 1] as any[]) {
    assert.equal(isValidPrintPayload(bad), false);
    const u = buildTelemetryUpdate({ print: bad, fromPrinterReport: true, currentState: "IDLE", activeSlotIndex: null, nowIso: NOW });
    assert.equal("last_online" in u, false);
  }
});

test("telemetria preserva exatamente os campos que já eram gravados", () => {
  const u = buildTelemetryUpdate({
    print: {
      subtask_name: "Cubo",
      mc_percent: "42",
      mc_remaining_time: 10,
      layer_num: 3,
      total_layer_num: 9,
      nozzle_temper: 219.6,
      bed_temper: 64.5,
    },
    fromPrinterReport: true,
    currentState: "RUNNING",
    activeSlotIndex: 2,
    filamentSliceInfo: [{ trayId: 0 }],
    nowIso: NOW,
  });
  assert.deepEqual(u, {
    is_online: true,
    last_seen_at: NOW,
    last_online: NOW,
    gcode_state: "RUNNING",
    active_slot_index: 2,
    current_task: "Cubo",
    print_progress: 42,
    remaining_time_min: 10,
    current_layer: 3,
    total_layers: 9,
    nozzle_temp: 220,
    bed_temp: 65,
    filament_slice_info: [{ trayId: 0 }],
  });
});

// ---- Restart com job restaurado (R11) ----

const restored: ActiveJobState = {
  jobId: "job-1",
  subtaskName: "Peça",
  gcodeFile: "Peça.3mf",
  maxProgressPercent: 40,
  lastProgressPercent: 40,
  activeSlot: 1,
  usedSlots: [1],
  startTime: 1,
  totalCostTime: 0,
  filamentGrams: 0,
  filamentSliceInfo: [],
  amsMapping: [1],
};

function restart(job: ActiveJobState | null) {
  return new JobStateMachine({ initialJob: job ? { ...job, usedSlots: [...job.usedSlots] } : null, initialGcodeState: initialGcodeStateFor(job) });
}

test("sem job restaurado o estado inicial continua IDLE", () => {
  assert.equal(initialGcodeStateFor(null), "IDLE");
});

test("restart com job + impressora em FINISH finaliza COMPLETED", () => {
  const a = restart(restored).processPrintPayload({ gcode_state: "FINISH" } as any);
  assert.equal(a.length, 1);
  assert.equal(a[0].type, "finalize_job");
  assert.equal((a[0] as any).finishStatus, "COMPLETED");
  assert.equal((a[0] as any).job.jobId, "job-1");
});

test("restart com job + impressora em FAILED finaliza FAILED (antes ficava preso)", () => {
  const a = restart(restored).processPrintPayload({ gcode_state: "FAILED" } as any);
  assert.equal(a[0]?.type, "finalize_job");
  assert.equal((a[0] as any).finishStatus, "FAILED");
  assert.equal((a[0] as any).percentExecuted, 40);
});

test("restart com job + impressora já em IDLE finaliza STOP proporcional (antes ficava preso)", () => {
  const a = restart(restored).processPrintPayload({ gcode_state: "IDLE" } as any);
  assert.equal(a[0]?.type, "finalize_job");
  assert.equal((a[0] as any).finishStatus, "STOP");
});

test("restart com job + RUNNING do mesmo job continua sem finalizar nem recriar", () => {
  const sm = restart(restored);
  const a = sm.processPrintPayload({ gcode_state: "RUNNING", subtask_name: "Peça", mc_percent: 41 } as any);
  assert.equal(a.some((x) => x.type === "finalize_job" || x.type === "create_job"), false);
  assert.equal(sm.getCurrentJob()?.jobId, "job-1");
  assert.equal(sm.getCurrentJob()?.maxProgressPercent, 41);
});

test("restart com job fantasma (0%) + IDLE descarta sem finalizar", () => {
  const a = restart({ ...restored, maxProgressPercent: 0, lastProgressPercent: 0 }).processPrintPayload({ gcode_state: "IDLE" } as any);
  assert.equal(a[0]?.type, "discard_job");
});
