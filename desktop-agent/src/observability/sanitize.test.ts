import test from "node:test";
import assert from "node:assert/strict";
import { createSanitizer, fingerprint, REDACTED } from "./sanitize";

// Todos os valores abaixo são FICTÍCIOS.
const FAKE_JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0ZSJ9.c2lnbmF0dXJhLWZpY3RpY2lh";
const FAKE_REFRESH = "k9x2mq7w1zpa";
const FAKE_ACCESS_CODE = "12345678";
const FAKE_PASSWORD = "Senha#Ficticia9";

test("JWT, Bearer, refresh token/Access Code/senha registrados nunca saem", () => {
  const s = createSanitizer();
  s.registerSecret(FAKE_REFRESH);
  s.registerSecret(FAKE_ACCESS_CODE);
  s.registerSecret(FAKE_PASSWORD);
  const out = s.text(`auth ${FAKE_JWT} Bearer abc.def refresh=${FAKE_REFRESH} code ${FAKE_ACCESS_CODE} pass ${FAKE_PASSWORD}`);
  for (const secret of [FAKE_JWT, "abc.def", FAKE_REFRESH, FAKE_ACCESS_CODE, FAKE_PASSWORD]) {
    assert.equal(out.includes(secret), false, `vazou: ${secret}`);
  }
  assert.ok(out.includes(REDACTED));
});

test("pares chave=valor sensíveis, blocos longos, chave privada, sb-auth-token", () => {
  const s = createSanitizer();
  const out = s.text('{"password":"x1y2z3","access_code":"998877"} apikey=zzz sb-abcd-auth-token -----BEGIN PRIVATE KEY-----AAAA-----END PRIVATE KEY----- ' + "A".repeat(40));
  for (const leak of ["x1y2z3", "998877", "zzz", "sb-abcd-auth-token", "AAAA", "A".repeat(40)]) {
    assert.equal(out.includes(leak), false, `vazou: ${leak}`);
  }
});

test("UUID de job continua legível; e-mail e pasta de usuário mascarados", () => {
  const s = createSanitizer();
  const out = s.text("job 0f8fad5b-d9cb-469f-a165-70867728950e de ricardo.teste@example.com em C:\\Users\\Note Ricardo\\AppData e /home/fulano/x");
  assert.ok(out.includes("0f8fad5b-d9cb-469f-a165-70867728950e"));
  assert.ok(out.includes("r***@example.com"));
  assert.equal(out.includes("Note Ricardo"), false);
  assert.equal(out.includes("fulano"), false);
});

test("IP da rede (v4 e v6) mascarado; versão, horário e UUID continuam legíveis", () => {
  const s = createSanitizer();
  const out = s.text(
    "Error: connect ETIMEDOUT 192.168.15.17:8883 fe80::1ff:fe23:4567:890a 2001:db8:85a3:0:0:8a2e:370:7334 " +
      "Agent 4.2.0 em 2026-09-29T10:57:41.855Z job 0f8fad5b-d9cb-469f-a165-70867728950e"
  );
  for (const leak of ["192.168.15.17", "fe80::1ff", "2001:db8"]) assert.equal(out.includes(leak), false, `vazou: ${leak}`);
  assert.ok(out.includes("<ip>:8883"));
  assert.ok(out.includes("Agent 4.2.0"));
  assert.ok(out.includes("10:57:41.855Z"));
  assert.ok(out.includes("0f8fad5b-d9cb-469f-a165-70867728950e"));
});

test("página HTML de erro (Cloudflare) vira só o título", () => {
  const s = createSanitizer();
  assert.equal(s.text("<html><head><title>502 Bad Gateway</title></head><body>cookie=abc</body></html>"), "[html] 502 Bad Gateway");
});

test("metadata: chaves sensíveis removidas, profundidade/arrays/tamanho limitados, circular ok", () => {
  const s = createSanitizer();
  const circ: any = { a: 1 };
  circ.self = circ;
  const m = s.metadata({ password: "p", refresh_token: "r", Authorization: "x", nested: { accessCode: "1" }, list: Array.from({ length: 50 }, (_, i) => i), circ, deep: { a: { b: { c: { d: { e: 1 } } } } } });
  assert.equal(m.password, REDACTED);
  assert.equal(m.refresh_token, REDACTED);
  assert.equal(m.Authorization, REDACTED);
  assert.equal((m.nested as any).accessCode, REDACTED);
  assert.equal((m.list as any[]).length, 20);
  assert.equal((m.circ as any).self, "[circular]");
  assert.equal((m.deep as any).a.b.c, "[depth]");
  const big = s.metadata({ blob: "x ".repeat(5000), a: "y ".repeat(200), b: "z ".repeat(200), c: "w ".repeat(200), d: "v ".repeat(200), e: "u ".repeat(200), f: "t ".repeat(200), g: "s ".repeat(200), h: "r ".repeat(200), i: "q ".repeat(200), j: "p ".repeat(200), k: "o ".repeat(200), l: "n ".repeat(200) });
  assert.equal(big.truncated, true);
});

test("status não redige chave 'session' mas limpa texto", () => {
  const s = createSanitizer();
  const st = s.status({ session: "lost", mqtt: "connected", note: FAKE_JWT, n: 3, obj: { x: 1 } as any });
  assert.equal(st.session, "lost");
  assert.equal(st.note, REDACTED);
  assert.equal(st.n, 3);
  assert.equal(st.obj, undefined);
});

test("nunca lança: objeto com toString que explode", () => {
  const s = createSanitizer();
  const evil = { toString() { throw new Error("boom"); } };
  assert.equal(s.text(evil), "[sanitize_failed]");
  const m = s.metadata({ get x() { throw new Error("boom"); } } as any);
  assert.ok(m.sanitize_failed === true || typeof m === "object");
});

test("fingerprint ignora números e IDs, distingue componente", () => {
  const a = fingerprint("finalize", "42703", "column spools_1.tray_info_idx does not exist (job 0f8fad5b-d9cb-469f-a165-70867728950e)");
  const b = fingerprint("finalize", "42703", "column spools_2.tray_info_idx does not exist (job 1f8fad5b-d9cb-469f-a165-70867728950f)");
  const c = fingerprint("mqtt", "42703", "column spools_1.tray_info_idx does not exist");
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(a.length, 16);
});

test("Agent e Web usam o MESMO arquivo de sanitização", () => {
  const fs = require("node:fs") as typeof import("node:fs");
  const path = require("node:path") as typeof import("node:path");
  const root = path.join(__dirname, "..", "..", "..");
  const agent = fs.readFileSync(path.join(root, "desktop-agent", "src", "observability", "sanitize.ts"), "utf-8").replace(/\r\n/g, "\n");
  const web = fs.readFileSync(path.join(root, "web-app", "src", "observability", "sanitize.ts"), "utf-8").replace(/\r\n/g, "\n");
  assert.equal(web, agent);
});
