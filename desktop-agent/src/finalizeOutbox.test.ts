import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FinalizeOutbox, PendingFinalization } from "./finalizeOutbox";

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "outbox-"));
  return path.join(dir, "agent-pending-finalize.json");
}

function item(jobId = "job-1"): Omit<PendingFinalization, "enqueuedAt" | "attempts"> {
  return {
    jobId,
    printerId: "printer-1",
    job: { jobId, subtaskName: "x", gcodeFile: "", maxProgressPercent: 100, lastProgressPercent: 100, activeSlot: 0, usedSlots: [0], startTime: 1, totalCostTime: 0, filamentGrams: 0, filamentSliceInfo: [] },
    percentExecuted: 100,
    finishStatus: "COMPLETED",
    printSnapshot: { subtask_name: "x", mc_cost_time: 600 },
    mqttTrays: [{ id: "0", tray_type: "PLA" }],
  };
}

const quiet = { logInfo: () => {}, logWarn: () => {} };

test("falha no RPC (rede/Supabase fora) mantém o job na fila, em disco", async () => {
  const file = tmpFile();
  const ob = new FinalizeOutbox({ filePath: file, canExecute: () => true, execute: async () => { throw new Error("fetch failed"); }, ...quiet });
  assert.equal(ob.enqueue(item()), true);
  await ob.flush();
  assert.equal(ob.size(), 1);
  const disk = JSON.parse(fs.readFileSync(file, "utf-8"));
  assert.equal(disk[0].attempts, 1);
  assert.equal(disk[0].lastError, "fetch failed");
});

test("sem sessão (canExecute=false) o RPC nem é chamado e o job fica na fila", async () => {
  let calls = 0;
  const ob = new FinalizeOutbox({ filePath: tmpFile(), canExecute: () => false, execute: async () => { calls++; }, ...quiet });
  ob.enqueue(item());
  await ob.flush();
  assert.equal(calls, 0);
  assert.equal(ob.size(), 1);
});

test("sucesso remove da fila e apaga o arquivo", async () => {
  const file = tmpFile();
  const ob = new FinalizeOutbox({ filePath: file, canExecute: () => true, execute: async () => {}, ...quiet });
  ob.enqueue(item());
  await ob.flush();
  assert.equal(ob.size(), 0);
  assert.equal(fs.existsSync(file), false);
});

test("fila sobrevive a restart do processo e é reenviada depois", async () => {
  const file = tmpFile();
  const a = new FinalizeOutbox({ filePath: file, canExecute: () => false, execute: async () => {}, ...quiet });
  a.enqueue(item("job-A"));
  const seen: PendingFinalization[] = [];
  const b = new FinalizeOutbox({ filePath: file, canExecute: () => true, execute: async (p) => { seen.push(p); }, ...quiet });
  assert.equal(b.size(), 1);
  await b.flush();
  assert.equal(seen[0].jobId, "job-A");
  assert.deepEqual(seen[0].mqttTrays, [{ id: "0", tray_type: "PLA" }]);
  assert.equal(seen[0].printSnapshot.mc_cost_time, 600);
});

test("mesmo job enfileirado 2x (ex.: restart reprocessou FINISH) vira 1 envio", async () => {
  let calls = 0;
  const ob = new FinalizeOutbox({ filePath: tmpFile(), canExecute: () => true, execute: async () => { calls++; }, ...quiet });
  ob.enqueue(item());
  ob.enqueue({ ...item(), percentExecuted: 12 });
  assert.equal(ob.size(), 1);
  assert.equal(ob.pending()[0].percentExecuted, 100);
  await ob.flush();
  assert.equal(calls, 1);
});

test("flush concorrente não envia o mesmo job duas vezes", async () => {
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const ob = new FinalizeOutbox({ filePath: tmpFile(), canExecute: () => true, execute: async () => { calls++; await gate; }, ...quiet });
  ob.enqueue(item());
  const p1 = ob.flush();
  const p2 = ob.flush();
  assert.equal(p1, p2);
  release();
  await p1;
  assert.equal(calls, 1);
});

test("um job falhando não impede os outros de serem enviados", async () => {
  const done: string[] = [];
  const ob = new FinalizeOutbox({
    filePath: tmpFile(),
    canExecute: () => true,
    execute: async (p) => { if (p.jobId === "ruim") throw new Error("x"); done.push(p.jobId); },
    ...quiet,
  });
  ob.enqueue(item("ruim"));
  ob.enqueue(item("bom"));
  await ob.flush();
  assert.deepEqual(done, ["bom"]);
  assert.deepEqual(ob.pending().map((p) => p.jobId), ["ruim"]);
});

test("arquivo corrompido é preservado em quarentena e não derruba o Agent", () => {
  const file = tmpFile();
  fs.writeFileSync(file, "{ nao eh json");
  const ob = new FinalizeOutbox({ filePath: file, canExecute: () => true, execute: async () => {}, ...quiet });
  assert.equal(ob.size(), 0);
  const kept = fs.readdirSync(path.dirname(file)).filter((f) => f.includes("corrompido"));
  assert.equal(kept.length, 1);
});
