import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadOrCreateInstallationId, machineHint, markRunStart, markRunStopped } from "./installationId";
import { AGENT_VERSION } from "./version";

test("installation_id: cria, mantém após restart, recria se corrompido (sem lançar)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "inst-"));
  const a = loadOrCreateInstallationId(dir);
  assert.equal(a.created, true);
  const b = loadOrCreateInstallationId(dir);
  assert.deepEqual(b, { id: a.id, created: false });
  fs.writeFileSync(path.join(dir, "installation.json"), "{corrompido");
  const c = loadOrCreateInstallationId(dir);
  assert.equal(c.created, true);
  assert.notEqual(c.id, a.id);
});

test("installation_id: pasta sem permissão/inexistente não lança", () => {
  assert.doesNotThrow(() => loadOrCreateInstallationId(path.join("Z:\\", "nao", "existe")));
});

test("machine_hint: estável, curto e sem o nome da máquina", () => {
  assert.equal(machineHint("NOTE-RICARDO"), machineHint("note-ricardo"));
  assert.equal(machineHint("PC1").length, 12);
  assert.equal(machineHint("NOTE-RICARDO").includes("RICARDO"), false);
  assert.notEqual(machineHint("PC1"), machineHint("PC2"));
});

test("versão do Agent = versão do instalador", () => {
  const iss = fs.readFileSync(path.join(__dirname, "..", "..", "installer", "FilamapAgentSetup.iss"), "utf-8");
  const m = /#define MyAppVersion "([^"]+)"/.exec(iss);
  assert.equal(m?.[1], AGENT_VERSION);
});

test("marca de execução: saída limpa x não limpa", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "run-"));
  assert.equal(markRunStart(dir, "b1").uncleanPrevious, false);
  assert.equal(markRunStart(dir, "b2").uncleanPrevious, true);
  markRunStopped(dir, "b2");
  assert.equal(markRunStart(dir, "b3").uncleanPrevious, false);
});
