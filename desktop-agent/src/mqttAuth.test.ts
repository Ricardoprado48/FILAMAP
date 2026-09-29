import test from "node:test";
import assert from "node:assert/strict";
import { isAccessCodeRejected } from "./mqttAuth";
import { buildNoticeScript } from "./config/desktopNotice";

test("Access Code recusado pela impressora", () => {
  assert.equal(isAccessCodeRejected({ code: 5, message: "Connection refused: Not authorized" }), true);
  assert.equal(isAccessCodeRejected({ code: 4, message: "Connection refused: Bad username or password" }), true);
  assert.equal(isAccessCodeRejected(new Error("Connection refused: Not authorized")), true);
});

test("queda de rede ou impressora desligada NÃO é Access Code errado", () => {
  assert.equal(isAccessCodeRejected({ code: "ECONNRESET", message: "read ECONNRESET" }), false);
  assert.equal(isAccessCodeRejected({ code: "ETIMEDOUT", message: "connect ETIMEDOUT 192.168.15.17:8883" }), false);
  assert.equal(isAccessCodeRejected(null), false);
  assert.equal(isAccessCodeRejected("texto"), false);
});

test("aviso na tela: aspas simples escapadas, uma linha por item", () => {
  const s = buildNoticeScript("Filamap", ["Pronto!", "Impressora d'Oeste"], "info");
  assert.ok(s.includes("'Impressora d''Oeste'"));
  assert.ok(s.includes("@('Pronto!','Impressora d''Oeste') -join [Environment]::NewLine"));
  assert.ok(s.includes("'Information'"));
});
