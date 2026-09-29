// O2: emissor REAL do Agent (dist compilado) contra o banco de TESTE. Recusa producao.
// Prova: envio real pela RPC, segredo ficticio nao chega ao banco, central fora do ar
// nao lanca nem trava, e a fila guardada e entregue depois.
const { createRequire } = require("module");
const req = createRequire("C:/FILAMAP-staging/desktop-agent/package.json");
const { createClient } = req("@supabase/supabase-js");
const { OpsEmitter } = req("./dist/observability/emitter.js");
const { createSanitizer } = req("./dist/observability/sanitize.js");
const crypto = require("crypto");

const K = JSON.parse(process.env.STAGING_CREDS);
if (K.url.includes("gqtlszffgvxsqcmefhyd")) throw new Error("Recusado: producao.");
let falhas = 0;
const ok = (c, m, x) => { console.log((c ? "OK   " : "FALHA") + " " + m + (c || x === undefined ? "" : " -> " + JSON.stringify(x))); if (!c) falhas++; };
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const FAKE_CODE = "87654321";
const FAKE_JWT = "eyJhbGciOiJIUzI1NiJ9.eyJmaWN0aWNpbyI6dHJ1ZX0.YXNzaW5hdHVyYS1maWN0aWNpYQ";

(async () => {
  const admin = createClient(K.url, K.service_role, opts);
  const A = createClient(K.url, K.anon, opts);
  const { error: le } = await A.auth.signInWithPassword({ email: K.email, password: K.password });
  if (le) throw le;
  const installationId = crypto.randomUUID();
  const sanitizer = createSanitizer();
  sanitizer.registerSecret(FAKE_CODE);
  const send = async (installation, events, signal) => {
    const { data, error } = await A.rpc("ingest_ops_events", { p_installation: installation, p_events: events }).abortSignal(signal);
    if (error) return { ok: false, reason: error.message };
    return { ok: data?.ok === true, reason: data?.reason };
  };
  const base = { enabled: true, filePath: null, installationId, kind: "agent", machineHint: "teste-o2", appVersion: "4.2.0-test", sanitizer, canSend: () => true, getStatus: () => ({ mqtt: "connected", session: "ok" }) };

  try {
    // 1. envio real
    const e1 = new OpsEmitter({ ...base, send });
    e1.emit("AGENT_STARTED", { metadata: { access_code: FAKE_CODE, note: `token ${FAKE_JWT}` } });
    e1.emit("MQTT_ERROR", { error: Object.assign(new Error(`ECONNRESET code=${FAKE_CODE} auth ${FAKE_JWT}`), { code: "ECONNRESET" }) });
    e1.emit("FINALIZE_COMPLETED", { job_id: crypto.randomUUID(), metadata: { items: [{ slot: 0, grams: 12.3 }] } });
    const next = await e1.flushOnce();
    ok(next === 60000 && e1.stats().queued === 0, "3 eventos enviados de verdade e removidos da fila", e1.stats());
    const { data: rows } = await admin.from("ops_events").select("*").eq("installation_id", installationId).order("seq");
    ok(rows.length === 3, "3 linhas gravadas no banco", rows?.length);
    const dump = JSON.stringify(rows);
    ok(!dump.includes(FAKE_CODE) && !dump.includes(FAKE_JWT), "Access Code e JWT ficticios NAO chegaram ao banco");
    ok(rows[1].error_code === "ECONNRESET" && rows[1].fingerprint?.length === 16, "erro com codigo e impressao digital", rows[1]);
    const { data: inst } = await admin.from("ops_installations").select("*").eq("installation_id", installationId).single();
    ok(inst.status.mqtt === "connected" && inst.app_version === "4.2.0-test", "status e versao da instalacao gravados", inst);

    // 2. central fora do ar (host invalido): nao lanca, nao trava, guarda
    const dead = createClient("https://nao-existe-filamap.invalid", K.anon, opts);
    const e2 = new OpsEmitter({ ...base, timeoutMs: 3000, send: async (i, ev, signal) => {
      const { data, error } = await dead.rpc("ingest_ops_events", { p_installation: i, p_events: ev }).abortSignal(signal);
      return error ? { ok: false, reason: error.message } : { ok: data?.ok === true };
    } });
    let threw = false;
    const t0 = Date.now();
    try { e2.emit("JOB_DETECTED"); e2.emit("JOB_FINISHED"); } catch { threw = true; }
    const emitMs = Date.now() - t0;
    const back = await e2.flushOnce();
    ok(!threw && emitMs < 50, `emit com central fora do ar nao lanca e e instantaneo (${emitMs} ms)`);
    ok(back === 60000 && e2.stats().queued === 2, "falha vira backoff e a fila e preservada", { back, s: e2.stats() });

    // 3. a mesma fila entregue quando a central volta
    const e3 = new OpsEmitter({ ...base, send });
    e3.emit("JOB_DETECTED");
    await e3.flushOnce();
    const { count } = await admin.from("ops_events").select("id", { count: "exact", head: true }).eq("installation_id", installationId);
    ok(count === 4, "envio seguinte chega normalmente", count);
  } finally {
    await admin.from("ops_installations").delete().eq("installation_id", installationId);
    await A.auth.signOut({ scope: "local" });
  }
  console.log(falhas === 0 ? "RESULTADO: TODOS OK" : `RESULTADO: ${falhas} FALHA(S)`);
  process.exitCode = falhas ? 1 : 0;
})().catch((e) => { console.error("ERRO:", e.message || e); process.exitCode = 1; });
