import test from "node:test";
import assert from "node:assert/strict";
import { PRINT_ERROR_CANCELLED, PrinterDiagnostics, formatHmsCode, formatPrintError, stageLabel } from "./printerDiagnostics";

test("formata códigos como o Bambu Handy", () => {
  assert.equal(formatPrintError(PRINT_ERROR_CANCELLED), "0300_400C");
  assert.equal(formatPrintError(50348044), "0300_400C");
  assert.equal(formatHmsCode(0x07002000, 0x00020001), "0700_2000_0002_0001");
  assert.equal(formatHmsCode(0x0c0003ff, 0x0001000a), "0C00_03FF_0001_000A");
});

test("HMS: aparece uma vez, some uma vez, e relatório sem 'hms' não mexe na lista", () => {
  const d = new PrinterDiagnostics();
  const a = { attr: 0x07002000, code: 0x00020001 };
  assert.deepEqual(
    d.observe({ hms: [a] }).map((c) => c.kind),
    ["hms_appeared"]
  );
  assert.deepEqual(d.observe({ hms: [a] }), []);
  assert.deepEqual(d.observe({ mc_percent: 40 }), []);
  assert.deepEqual(d.snapshot().hms_active, ["0700_2000_0002_0001"]);
  const cleared = d.observe({ hms: [] });
  assert.deepEqual(cleared, [{ kind: "hms_cleared", code: "0700_2000_0002_0001" }]);
  assert.deepEqual(d.snapshot().hms_active, []);
});

test("HMS: entrada malformada é ignorada sem derrubar nada", () => {
  const d = new PrinterDiagnostics();
  assert.deepEqual(d.observe({ hms: [{ attr: "x" }, null, { attr: 1, code: 2 }] }).length, 1);
});

test("print_error: cancelamento pela pessoa é reconhecido", () => {
  const d = new PrinterDiagnostics();
  const [c] = d.observe({ print_error: 50348044 });
  assert.equal(c.kind, "print_error");
  assert.equal((c as any).cancelledByUser, true);
  assert.equal(d.snapshot().cancelled_by_user, true);
  assert.match(d.failureReason(), /cancelada pela pessoa/);
});

test("print_error: erro real aparece no motivo, junto com HMS e etapa", () => {
  const d = new PrinterDiagnostics();
  d.observe({ stg_cur: 24, hms: [{ attr: 0x07002000, code: 0x00020001 }] });
  const [c] = d.observe({ print_error: 0x07008011 });
  assert.equal((c as any).cancelledByUser, false);
  const reason = d.failureReason();
  assert.match(reason, /0700_8011/);
  assert.match(reason, /0700_2000_0002_0001/);
  assert.match(reason, /carregando filamento/);
});

test("print_error: zerar gera 'cleared' e o mesmo valor repetido não gera nada", () => {
  const d = new PrinterDiagnostics();
  d.observe({ print_error: 0x07008011 });
  assert.deepEqual(d.observe({ print_error: 0x07008011 }), []);
  assert.deepEqual(d.observe({ print_error: "0" }), [{ kind: "print_error_cleared", code: "0700_8011" }]);
  assert.equal(d.snapshot().print_error, null);
  assert.equal(d.failureReason(), "sem código de erro informado pela impressora");
});

test("etapas: guarda a sequência do job, sem repetir e com teto", () => {
  const d = new PrinterDiagnostics();
  d.observe({ stg_cur: 2 }, 1_000);
  d.startJob();
  d.observe({ stg_cur: 2 }, 2_000);
  d.observe({ stg_cur: 1 }, 3_000);
  d.observe({ stg_cur: 0, layer_num: 3 }, 4_000);
  const s = d.snapshot();
  assert.deepEqual(s.stages.map((m) => m.stage), [2, 1, 0]);
  assert.equal(s.layer, 3);
  assert.equal(s.stage_label, "imprimindo");
  for (let i = 0; i < 30; i++) d.observe({ stg_cur: i % 2 ? 4 : 0 });
  assert.equal(d.snapshot().stages.length, 12);
});

test("novo job zera a camada da impressão anterior (FTPS não dispara no preparo)", () => {
  const d = new PrinterDiagnostics();
  d.observe({ layer_num: 180, stg_cur: 0 });
  d.startJob();
  assert.equal(d.snapshot().layer, null);
  d.observe({ layer_num: 0, stg_cur: 1 });
  assert.equal(d.snapshot().layer, 0);
});

test("rótulo de etapa desconhecida não inventa nome", () => {
  assert.equal(stageLabel(99), "etapa 99");
  assert.equal(stageLabel(null), null);
});
