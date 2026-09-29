import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { OpsEmitter, OpsEmitterOptions, OpsEvent } from "./emitter";
import { createSanitizer } from "./sanitize";

function tmp() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ops-")), "telemetry-outbox.json");
}

function make(over: Partial<OpsEmitterOptions> = {}) {
  let t = Date.parse("2026-10-01T12:00:00Z");
  const sent: OpsEvent[][] = [];
  const e = new OpsEmitter({
    enabled: true,
    filePath: null,
    installationId: "0f8fad5b-d9cb-469f-a165-70867728950e",
    kind: "agent",
    machineHint: "abc",
    appVersion: "4.2.0",
    sanitizer: createSanitizer(),
    send: async (_i, ev) => {
      sent.push(ev);
      return { ok: true };
    },
    canSend: () => true,
    getStatus: () => ({ mqtt: "connected" }),
    now: () => t,
    ...over,
  });
  return { e, sent, advance: (ms: number) => (t += ms) };
}

test("emit nunca lança: sanitizer, status, send e disco quebrados", async () => {
  const broken = { registerSecret() {}, text() { throw new Error("x"); }, metadata() { throw new Error("x"); }, status() { throw new Error("x"); } } as any;
  const { e } = make({ sanitizer: broken, getStatus: () => { throw new Error("x"); }, send: async () => { throw new Error("rede"); }, filePath: "Z:\\nao\\existe\\x.json" });
  assert.doesNotThrow(() => e.emit("AGENT_STARTED", { error: new Error("boom"), metadata: { a: 1 } }));
  const next = await e.flushOnce();
  assert.ok(next >= 60_000);
});

test("desligado (telemetry:false) não faz nada", async () => {
  const { e, sent } = make({ enabled: false });
  e.emit("AGENT_STARTED");
  await e.flushOnce();
  assert.equal(sent.length, 0);
  assert.equal(e.stats().queued, 0);
});

test("sem sessão não chama o envio; eventos ficam na fila", async () => {
  let calls = 0;
  const { e } = make({ canSend: () => false, send: async () => { calls++; return { ok: true }; } });
  e.emit("JOB_DETECTED", { job_id: "j" });
  await e.flushOnce();
  assert.equal(calls, 0);
  assert.equal(e.stats().queued, 1);
});

test("falha de envio: backoff crescente, fila preservada, sem lançar", async () => {
  const { e } = make({ send: async () => ({ ok: false, reason: "no_session" }) });
  e.emit("JOB_DETECTED");
  assert.equal(await e.flushOnce(), 60_000);
  assert.equal(await e.flushOnce(), 120_000);
  assert.equal(await e.flushOnce(), 300_000);
  assert.equal(e.stats().queued, 1);
});

test("timeout do envio vira falha (não trava o ciclo)", async () => {
  const { e } = make({ timeoutMs: 20, send: () => new Promise(() => {}) });
  e.emit("JOB_DETECTED");
  const next = await e.flushOnce();
  assert.equal(next, 60_000);
  assert.equal(e.stats().queued, 1);
});

test("single-flight: dois flush simultâneos = 1 envio", async () => {
  let calls = 0;
  const { e } = make({ send: async () => { calls++; await new Promise((r) => setTimeout(r, 10)); return { ok: true }; } });
  e.emit("JOB_DETECTED");
  await Promise.all([e.flushOnce(), e.flushOnce()]);
  assert.equal(calls, 1);
});

test("sucesso remove o lote; lote máximo de 50", async () => {
  const { e, sent } = make();
  for (let i = 0; i < 60; i++) e.emit("JOB_DETECTED");
  assert.equal(await e.flushOnce(), 5_000);
  assert.equal(sent[0].length, 50);
  await e.flushOnce();
  assert.equal(e.stats().queued, 0);
});

test("erro em loop: janela de 60 s soma repetições; teto de 20/dia por impressão digital", async () => {
  const { e, sent, advance } = make({ dailyCap: 1000 });
  for (let i = 0; i < 10; i++) e.emit("AGENT_ERROR", { error: new Error("Erro no processamento 42") });
  advance(61_000);
  e.emit("AGENT_ERROR", { error: new Error("Erro no processamento 43") });
  await e.flushOnce();
  assert.equal(sent[0].length, 2);
  assert.equal(sent[0][1].repeat_count, 10);
  for (let i = 0; i < 40; i++) {
    advance(61_000);
    e.emit("AGENT_ERROR", { error: new Error(`Erro no processamento ${100 + i}`) });
  }
  assert.equal(e.stats().queued, 18);
  e.emit("JOB_DETECTED");
  assert.equal(e.stats().queued, 19, "erro em loop não impede evento de impressão");
});

test("cota diária local e virada do dia", () => {
  const { e, advance } = make({ dailyCap: 3 });
  for (let i = 0; i < 5; i++) e.emit("JOB_DETECTED");
  assert.equal(e.stats().queued, 3);
  assert.equal(e.stats().droppedLocal, 2);
  advance(24 * 3600_000);
  e.emit("JOB_DETECTED");
  assert.equal(e.stats().queued, 4);
});

test("anel: cheio descarta primeiro o INFO mais antigo", () => {
  const { e } = make({ maxQueue: 3, dailyCap: 100 });
  e.emit("SESSION_LOST");
  e.emit("JOB_DETECTED");
  e.emit("JOB_FAILED");
  e.emit("MQTT_DISCONNECTED");
  assert.equal(e.stats().queued, 3);
  assert.equal(e.stats().droppedLocal, 1);
});

test("persistência: fila sobrevive a restart; arquivo corrompido não impede o start", async () => {
  const file = tmp();
  const a = make({ filePath: file, canSend: () => false });
  a.e.emit("JOB_DETECTED", { job_id: "0f8fad5b-d9cb-469f-a165-70867728950e" });
  await a.e.shutdown(10);
  const b = make({ filePath: file });
  assert.equal(b.e.stats().queued, 1);
  fs.writeFileSync(file, "{lixo");
  const c = make({ filePath: file });
  assert.equal(c.e.stats().queued, 0);
});

test("status vai junto; seq e boot_id ordenam; segredo em mensagem sai limpo", async () => {
  const s = createSanitizer();
  s.registerSecret("12345678");
  let inst: any;
  const { e, sent } = make({ sanitizer: s, send: async (i, ev) => { inst = i; sent.push(ev); return { ok: true }; } });
  e.emit("MQTT_ERROR", { message: "falha com code 12345678" });
  e.emit("MQTT_CONNECTED");
  await e.flushOnce();
  assert.equal(inst.status.mqtt, "connected");
  assert.equal(sent[0][0].message?.includes("12345678"), false);
  assert.equal(sent[0][0].seq + 1, sent[0][1].seq);
  assert.equal(sent[0][0].boot_id, e.bootId);
});

test("metadata + stack nunca passam do limite do banco (4 KB)", () => {
  const { e } = make();
  const err = new Error("x");
  err.stack = "Error: x\n" + "    at f (C:\\a\\b.js:1:1)\n".repeat(400);
  e.emit("AGENT_ERROR", { error: err, metadata: { a: "b ".repeat(140), c: "d ".repeat(140), f: "g ".repeat(140), h: "i ".repeat(140) } });
  const q = (e as any).queue as OpsEvent[];
  assert.ok(JSON.stringify(q[0].metadata).length < 4000);
});

test("changed(): só a transição conta", () => {
  const { e } = make();
  assert.equal(e.changed("mqtt", "up"), true);
  assert.equal(e.changed("mqtt", "up"), false);
  assert.equal(e.changed("mqtt", "down"), true);
});
