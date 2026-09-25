import test from "node:test";
import assert from "node:assert/strict";
import { JobStateMachine, ActiveJobState, extractGramsFromName, resolveRemote3mfPath } from "./jobStateMachine";

test("extractGramsFromName extrai gramas com padrão _Xg ou Xg", () => {
  assert.equal(extractGramsFromName("peca_suporte_45g.gcode"), 45);
  assert.equal(extractGramsFromName("vaso_12.5g.gcode.3mf"), 12.5);
  assert.equal(extractGramsFromName("sem_peso.gcode"), null);
});

test("resolveRemote3mfPath gera caminhos corretos e seguros", () => {
  assert.equal(resolveRemote3mfPath("", "suporte"), "/sdcard/suporte.gcode.3mf");
  assert.equal(resolveRemote3mfPath("teste.gcode", "qualquer"), "teste.3mf");
  assert.equal(resolveRemote3mfPath("/sdcard/cache/file.3mf", "qualquer"), "/sdcard/cache/file.3mf");
});

test("A: RUNNING + subtask_name válido cria exatamente 1 job", () => {
  const sm = new JobStateMachine();
  const actions = sm.processPrintPayload({
    gcode_state: "RUNNING",
    subtask_name: "peça_teste_30g",
    mc_percent: 0,
    ams: { ams: [{ tray_tar: 1 }] },
  });

  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, "create_job");
  if (actions[0].type === "create_job") {
    assert.equal(actions[0].job.subtaskName, "peça_teste_30g");
    assert.equal(actions[0].job.activeSlot, 1);
    assert.deepEqual(actions[0].job.usedSlots, [1]);
    assert.equal(actions[0].job.filamentGrams, 30);
    assert.ok(actions[0].job.jobId);
  }
});

test("B: RUNNING seguinte sem subtask_name (delta) mantém exatamente o mesmo jobId", () => {
  const sm = new JobStateMachine();
  const actions1 = sm.processPrintPayload({
    gcode_state: "RUNNING",
    subtask_name: "peça_teste_30g",
    mc_percent: 5,
  });
  const initialJobId = sm.getCurrentJob()?.jobId;
  assert.ok(initialJobId);

  // Delta sem subtask_name e sem gcode_state
  const actions2 = sm.processPrintPayload({
    mc_percent: 10,
    nozzle_temper: 220,
  });

  assert.equal(sm.getCurrentJob()?.jobId, initialJobId);
  assert.equal(sm.getCurrentJob()?.subtaskName, "peça_teste_30g");
  assert.equal(sm.getCurrentJob()?.maxProgressPercent, 10);
  // Não cria novo job! Apenas atualiza progresso
  assert.equal(actions2.length, 1);
  assert.equal(actions2[0].type, "update_job");
});

test("C: subtask_name reaparece em delta posterior e mantém exatamente o mesmo jobId", () => {
  const sm = new JobStateMachine();
  sm.processPrintPayload({
    gcode_state: "RUNNING",
    subtask_name: "peça_teste_30g",
    mc_percent: 10,
  });
  const initialJobId = sm.getCurrentJob()?.jobId;

  // Delta sem subtask_name
  sm.processPrintPayload({ mc_percent: 12 });

  // Delta onde subtask_name reaparece
  const actions = sm.processPrintPayload({
    gcode_state: "RUNNING",
    subtask_name: "peça_teste_30g",
    mc_percent: 15,
  });

  assert.equal(sm.getCurrentJob()?.jobId, initialJobId);
  assert.equal(sm.getCurrentJob()?.subtaskName, "peça_teste_30g");
  assert.equal(sm.getCurrentJob()?.maxProgressPercent, 15);
  // Não emite create_job
  assert.ok(!actions.some((a) => a.type === "create_job"));
});

test("D: mudança de temperatura/progresso/slot não cria novo job", () => {
  const sm = new JobStateMachine();
  sm.processPrintPayload({
    gcode_state: "RUNNING",
    subtask_name: "vaso",
    mc_percent: 1,
    ams: { ams: [{ tray_tar: 0 }] },
  });
  const jobId = sm.getCurrentJob()?.jobId;

  const actions = sm.processPrintPayload({
    nozzle_temper: 215,
    bed_temper: 60,
    mc_percent: 2,
  });

  assert.equal(sm.getCurrentJob()?.jobId, jobId);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, "update_job");
});

test("E: sequência de pacotes delta que reproduzia o bug: zero phantom jobs", () => {
  const sm = new JobStateMachine();

  // 1. Início de job com nome real
  sm.processPrintPayload({
    gcode_state: "RUNNING",
    subtask_name: "0.2mm layer, 2 walls, 8% infill",
    mc_percent: 0,
  });
  const originalJobId = sm.getCurrentJob()?.jobId;
  assert.ok(originalJobId);

  // 2. Delta periódico da Bambu SEM subtask_name e SEM gcode_file (o que antes virava "")
  const actionsDelta1 = sm.processPrintPayload({
    nozzle_temper: 220,
    layer_num: 1,
  });
  assert.equal(sm.getCurrentJob()?.jobId, originalJobId);
  assert.equal(sm.getCurrentJob()?.subtaskName, "0.2mm layer, 2 walls, 8% infill");
  assert.ok(!actionsDelta1.some((a) => a.type === "create_job"));

  // 3. Status pushall com subtask_name novamente
  const actionsDelta2 = sm.processPrintPayload({
    gcode_state: "RUNNING",
    subtask_name: "0.2mm layer, 2 walls, 8% infill",
    gcode_file: "0.2mm layer, 2 walls, 8% infill.gcode",
    mc_percent: 1,
  });
  assert.equal(sm.getCurrentJob()?.jobId, originalJobId);
  assert.ok(!actionsDelta2.some((a) => a.type === "create_job"));

  // 4. Outro delta sem subtask_name
  const actionsDelta3 = sm.processPrintPayload({
    mc_percent: 2,
    layer_num: 2,
  });
  assert.equal(sm.getCurrentJob()?.jobId, originalJobId);
  assert.ok(!actionsDelta3.some((a) => a.type === "create_job"));

  // Zero phantom jobs criados!
  assert.equal(sm.getCurrentJob()?.jobId, originalJobId);
});

test("F: FINISH finaliza exatamente uma vez", () => {
  const sm = new JobStateMachine();
  sm.processPrintPayload({
    gcode_state: "RUNNING",
    subtask_name: "teste_finish",
    mc_percent: 99,
  });
  const initialJob = sm.getCurrentJob();
  assert.ok(initialJob);

  // Transição para FINISH
  const actions1 = sm.processPrintPayload({
    gcode_state: "FINISH",
    mc_percent: 100,
  });

  assert.equal(actions1.length, 1);
  assert.equal(actions1[0].type, "finalize_job");
  if (actions1[0].type === "finalize_job") {
    assert.equal(actions1[0].job.jobId, initialJob.jobId);
    assert.equal(actions1[0].percentExecuted, 100);
    assert.equal(actions1[0].finishStatus, "COMPLETED");
  }
  assert.equal(sm.getCurrentJob(), null);

  // Mensagem repetida de FINISH (pushall repetido) NÃO finaliza de novo
  const actions2 = sm.processPrintPayload({
    gcode_state: "FINISH",
  });
  assert.equal(actions2.length, 0);
});

test("G: STOP / FAILED finaliza exatamente uma vez com o progresso máximo", () => {
  const sm = new JobStateMachine();
  sm.processPrintPayload({
    gcode_state: "RUNNING",
    subtask_name: "teste_stop",
    mc_percent: 45,
  });
  const initialJob = sm.getCurrentJob();
  assert.ok(initialJob);

  const actions = sm.processPrintPayload({
    gcode_state: "STOP",
    mc_percent: 40, // simulando reporte residual
  });

  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, "finalize_job");
  if (actions[0].type === "finalize_job") {
    assert.equal(actions[0].job.jobId, initialJob.jobId);
    assert.equal(actions[0].percentExecuted, 45); // usa maxProgressPercent
    assert.equal(actions[0].finishStatus, "STOP");
  }
  assert.equal(sm.getCurrentJob(), null);
});

test("H: Agent reinicia com job persistido válido e continua o mesmo job", () => {
  const persistedJob: ActiveJobState = {
    jobId: "job-persistido-123",
    subtaskName: "peca_em_andamento",
    maxProgressPercent: 50,
    lastProgressPercent: 50,
    activeSlot: 2,
    usedSlots: [2],
    startTime: Date.now() - 3600000,
    totalCostTime: 7200,
    filamentGrams: 50,
  };

  const sm = new JobStateMachine({
    initialJob: persistedJob,
    initialGcodeState: "RUNNING",
    initialSlotIndex: 2,
  });

  assert.equal(sm.getCurrentJob()?.jobId, "job-persistido-123");

  // Recebe delta da impressora que ainda está em RUNNING
  const actions = sm.processPrintPayload({
    mc_percent: 55,
  });

  assert.equal(sm.getCurrentJob()?.jobId, "job-persistido-123");
  assert.equal(sm.getCurrentJob()?.maxProgressPercent, 55);
  assert.ok(!actions.some((a) => a.type === "create_job"));
});

test("I: Impressora parada (IDLE) não cria ActiveJobState falso e descarta órfão com 0%", () => {
  // Caso 1: impressora enviando IDLE do início
  const sm1 = new JobStateMachine();
  const actions1 = sm1.processPrintPayload({
    gcode_state: "IDLE",
    subtask_name: "",
    mc_percent: 0,
  });
  assert.equal(actions1.length, 0);
  assert.equal(sm1.getCurrentJob(), null);

  // Caso 2: Agent iniciou com job órfão persistido de 0% de progresso mas a máquina está IDLE
  const orphanJob: ActiveJobState = {
    jobId: "phantom-0-percent",
    subtaskName: "0.2mm layer, 2 walls, 8% infill",
    maxProgressPercent: 0,
    lastProgressPercent: 0,
    activeSlot: 0,
    usedSlots: [0],
    startTime: Date.now(),
    totalCostTime: 0,
    filamentGrams: 0,
  };

  const sm2 = new JobStateMachine({
    initialJob: orphanJob,
    initialGcodeState: "IDLE",
  });

  const actions2 = sm2.processPrintPayload({
    gcode_state: "IDLE",
  });

  assert.equal(actions2.length, 1);
  assert.equal(actions2[0].type, "discard_job");
  assert.equal(sm2.getCurrentJob(), null);
});

test("J: Multicolor acumula usedSlots conforme AMS troca de slot", () => {
  const sm = new JobStateMachine();
  sm.processPrintPayload({
    gcode_state: "RUNNING",
    subtask_name: "multicolor_4cores",
    mc_percent: 5,
    ams: { ams: [{ tray_tar: 0 }] },
  });

  assert.deepEqual(sm.getCurrentJob()?.usedSlots, [0]);

  // Troca para slot 2
  sm.processPrintPayload({
    mc_percent: 15,
    ams: { ams: [{ tray_tar: 2 }] },
  });
  assert.deepEqual(sm.getCurrentJob()?.usedSlots, [0, 2]);

  // Troca para slot 1
  sm.processPrintPayload({
    mc_percent: 30,
    ams: { ams: [{ tray_tar: 1 }] },
  });
  assert.deepEqual(sm.getCurrentJob()?.usedSlots, [0, 2, 1]);

  // Volta para slot 0 (não duplica no usedSlots)
  sm.processPrintPayload({
    mc_percent: 45,
    ams: { ams: [{ tray_tar: 0 }] },
  });
  assert.deepEqual(sm.getCurrentJob()?.usedSlots, [0, 2, 1]);
});

test("K: Idempotência: mesmo jobId e finalização produzem chave única", () => {
  const sm = new JobStateMachine();
  sm.processPrintPayload({
    gcode_state: "RUNNING",
    subtask_name: "teste_idempotencia",
    mc_percent: 10,
  });

  const jobId = sm.getCurrentJob()?.jobId;
  assert.ok(jobId);

  // Vários pacotes delta com informações variadas
  for (let p = 11; p <= 100; p += 10) {
    sm.processPrintPayload({
      mc_percent: p,
      subtask_name: p % 20 === 0 ? "teste_idempotencia" : undefined,
    });
    assert.equal(sm.getCurrentJob()?.jobId, jobId);
  }

  const actions = sm.processPrintPayload({
    gcode_state: "FINISH",
  });

  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, "finalize_job");
  if (actions[0].type === "finalize_job") {
    assert.equal(actions[0].job.jobId, jobId);
  }
});
