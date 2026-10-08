import test from "node:test";
import assert from "node:assert/strict";
import {
  PUSHALL_IDLE_MS,
  RECONNECT_DELAYS_MS,
  pruneDrops,
  reconnectDelayMs,
  shouldFetchSliceInfoNow,
  shouldRequestFullStatus,
} from "./printerLoadPolicy";

const MIN = 60_000;

test("pushall: impressora mandando relatórios -> nunca pede status completo", () => {
  const now = 10 * 60 * MIN;
  assert.equal(shouldRequestFullStatus({ now, lastReportAt: now - 1_000, lastPushallAt: 0 }), false);
  assert.equal(shouldRequestFullStatus({ now, lastReportAt: now - (PUSHALL_IDLE_MS - 1), lastPushallAt: 0 }), false);
});

test("pushall: 5 min sem relatório -> pede uma vez, e não repete antes de mais 5 min", () => {
  const now = 10 * 60 * MIN;
  assert.equal(shouldRequestFullStatus({ now, lastReportAt: now - PUSHALL_IDLE_MS, lastPushallAt: 0 }), true);
  assert.equal(shouldRequestFullStatus({ now, lastReportAt: now - 20 * MIN, lastPushallAt: now - MIN }), false);
  assert.equal(shouldRequestFullStatus({ now, lastReportAt: now - 20 * MIN, lastPushallAt: now - PUSHALL_IDLE_MS }), true);
});

test("pushall: no ritmo antigo (a cada 10s) a política recusaria quase todos", () => {
  // 1 hora de impressão com relatórios a cada 2s: 0 pedidos (antes eram 360).
  let lastPushallAt = 0;
  let sent = 0;
  for (let t = 0; t <= 60 * MIN; t += 10_000) {
    if (shouldRequestFullStatus({ now: t + 60 * MIN, lastReportAt: t + 60 * MIN - 2_000, lastPushallAt })) {
      sent++;
      lastPushallAt = t + 60 * MIN;
    }
  }
  assert.equal(sent, 0);
});

test("FTPS: não baixa durante o preparo (camada 0/1, 0-1%)", () => {
  const base = { gcodeState: "RUNNING", alreadyAttempted: false, hasSliceInfo: false };
  assert.equal(shouldFetchSliceInfoNow({ ...base, layerNum: 0, percent: 0 }), false);
  assert.equal(shouldFetchSliceInfoNow({ ...base, layerNum: 1, percent: 1 }), false);
  assert.equal(shouldFetchSliceInfoNow({ ...base, layerNum: undefined, percent: undefined }), false);
});

test("FTPS: baixa quando a impressão já está rodando de verdade", () => {
  const base = { gcodeState: "RUNNING", alreadyAttempted: false, hasSliceInfo: false };
  assert.equal(shouldFetchSliceInfoNow({ ...base, layerNum: 2, percent: 0 }), true);
  assert.equal(shouldFetchSliceInfoNow({ ...base, layerNum: undefined, percent: 2 }), true);
});

test("FTPS: uma única tentativa por job, e nada fora de RUNNING", () => {
  const ready = { layerNum: 10, percent: 30 };
  assert.equal(shouldFetchSliceInfoNow({ ...ready, gcodeState: "RUNNING", alreadyAttempted: true, hasSliceInfo: false }), false);
  assert.equal(shouldFetchSliceInfoNow({ ...ready, gcodeState: "RUNNING", alreadyAttempted: false, hasSliceInfo: true }), false);
  assert.equal(shouldFetchSliceInfoNow({ ...ready, gcodeState: "PAUSE", alreadyAttempted: false, hasSliceInfo: false }), false);
  assert.equal(shouldFetchSliceInfoNow({ ...ready, gcodeState: "PREPARE", alreadyAttempted: false, hasSliceInfo: false }), false);
});

test("reconexão: espera cresce com quedas na última hora", () => {
  const now = 100 * 60 * MIN;
  assert.equal(reconnectDelayMs([now], now), RECONNECT_DELAYS_MS[0]);
  assert.equal(reconnectDelayMs([now - 10 * MIN, now], now), RECONNECT_DELAYS_MS[1]);
  assert.equal(reconnectDelayMs([now - 30 * MIN, now - 10 * MIN, now], now), RECONNECT_DELAYS_MS[2]);
  const many = Array.from({ length: 20 }, (_, i) => now - i * MIN);
  assert.equal(reconnectDelayMs(many, now), RECONNECT_DELAYS_MS[RECONNECT_DELAYS_MS.length - 1]);
});

test("reconexão: quedas com mais de 1 hora não contam (espera volta ao mínimo)", () => {
  const now = 100 * 60 * MIN;
  assert.equal(reconnectDelayMs([now - 2 * 60 * MIN, now - 90 * MIN, now], now), RECONNECT_DELAYS_MS[0]);
  assert.equal(reconnectDelayMs([], now), RECONNECT_DELAYS_MS[0]);
  assert.deepEqual(pruneDrops([now - 2 * 60 * MIN, now - 5 * MIN], now), [now - 5 * MIN]);
});
