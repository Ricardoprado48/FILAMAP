// O1: Central de Observabilidade contra o banco de TESTE. Recusa producao.
// Usuarios: A (principal de teste), B (user2), anon. B vira admin temporariamente via service_role.
const { createRequire } = require("module");
const crypto = require("crypto");
const req = createRequire("C:/FILAMAP-staging/desktop-agent/package.json");
const { createClient } = req("@supabase/supabase-js");

const K = JSON.parse(process.env.STAGING_CREDS);
const U2 = JSON.parse(process.env.STAGING_USER2);
if (K.url.includes("gqtlszffgvxsqcmefhyd")) throw new Error("Recusado: producao.");
let falhas = 0;
const ok = (cond, msg, extra) => { console.log((cond ? "OK   " : "FALHA") + " " + msg + (cond || extra === undefined ? "" : " -> " + JSON.stringify(extra))); if (!cond) falhas++; };
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const uuid = () => crypto.randomUUID();
const boot = uuid();
let seq = 0;
const ev = (over = {}) => ({ client_event_id: uuid(), boot_id: boot, seq: ++seq, occurred_at: new Date().toISOString(), event_type: "AGENT_STARTED", severity: "INFO", component: "agent", message: "teste O1", metadata: {}, ...over });
const inst = (id, over = {}) => ({ installation_id: id, kind: "agent", machine_hint: "hintA", app_version: "4.2.0-test", status: { mqtt: "connected" }, ...over });

(async () => {
  const admin = createClient(K.url, K.service_role, opts);
  const anon = createClient(K.url, K.anon, opts);
  const A = createClient(K.url, K.anon, opts);
  const B = createClient(K.url, K.anon, opts);
  const la = await A.auth.signInWithPassword({ email: K.email, password: K.password });
  const lb = await B.auth.signInWithPassword({ email: U2.email, password: U2.password });
  if (la.error || lb.error) throw la.error || lb.error;
  const idA = uuid(), idB = uuid(), idQ = uuid();

  try {
    // 1. A grava via RPC
    let r = await A.rpc("ingest_ops_events", { p_installation: inst(idA), p_events: [ev(), ev({ event_type: "MQTT_CONNECTED", component: "mqtt" })] });
    ok(!r.error && r.data.ok && r.data.accepted === 2, "A grava 2 eventos pela RPC", r);

    // 2-3. A nao le (nem os proprios) e nao ve health
    r = await A.from("ops_events").select("id");
    ok(!r.error && r.data.length === 0, "A nao le ops_events (nem os proprios)", r);
    r = await A.from("ops_installations").select("installation_id");
    ok(!r.error && r.data.length === 0, "A nao le ops_installations", r);
    r = await A.rpc("ops_health");
    ok(r.error && r.error.code === "42501", "A (nao admin) recebe 42501 em ops_health", r);
    r = await A.rpc("ops_purge_expired");
    ok(r.error && r.error.code === "42501", "A (nao admin) recebe 42501 em ops_purge_expired", r);

    // 4-5. anon
    r = await anon.rpc("ingest_ops_events", { p_installation: inst(uuid()), p_events: [ev()] });
    ok(!!r.error, "anon nao executa ingest_ops_events", r);
    r = await anon.from("ops_events").select("id");
    ok(!!r.error || r.data.length === 0, "anon nao le ops_events", r);
    r = await anon.rpc("ops_health");
    ok(!!r.error, "anon nao executa ops_health", r);
    r = await anon.rpc("keepalive");
    ok(!r.error && typeof r.data === "string", "anon executa keepalive (sinal diario)", r);

    // 6. insert/update/delete direto
    r = await A.from("ops_events").insert({ user_id: la.data.user.id, installation_id: idA, client_event_id: uuid(), boot_id: boot, seq: 1, occurred_at: new Date().toISOString(), event_type: "AGENT_STARTED", severity: "INFO", component: "x" });
    ok(!!r.error, "INSERT direto em ops_events negado", r);
    r = await A.from("ops_installations").update({ app_version: "hack" }).eq("installation_id", idA).select();
    ok(!!r.error || r.data.length === 0, "UPDATE direto em ops_installations negado", r);
    r = await A.from("ops_admins").insert({ user_id: la.data.user.id });
    ok(!!r.error, "A nao se torna admin sozinho", r);

    // 7. sequestro de installation_id
    r = await B.rpc("ingest_ops_events", { p_installation: inst(idA), p_events: [ev()] });
    ok(!r.error && r.data.ok === false && r.data.reason === "installation_owned_by_other_user", "B nao grava na instalacao de A", r);

    // 8. duplicado
    const dup = ev({ event_type: "JOB_DETECTED", component: "job" });
    await A.rpc("ingest_ops_events", { p_installation: inst(idA), p_events: [dup] });
    r = await A.rpc("ingest_ops_events", { p_installation: inst(idA), p_events: [dup] });
    ok(!r.error && r.data.duplicated === 1 && r.data.accepted === 0, "evento repetido vira 1 linha so", r);

    // 9. lote > 50
    r = await A.rpc("ingest_ops_events", { p_installation: inst(idA), p_events: Array.from({ length: 51 }, () => ev()) });
    ok(!r.error && r.data.accepted === 50 && r.data.dropped === 1, "51o evento do lote e descartado", r);

    // 10-11. invalidos nao derrubam o lote
    r = await A.rpc("ingest_ops_events", { p_installation: inst(idA), p_events: [
      ev({ metadata: { big: "x".repeat(6000) } }),
      ev({ event_type: "INVENTADO" }),
      ev({ severity: "DEBUG" }),
      ev({ client_event_id: "nao-uuid" }),
      ev(),
    ] });
    ok(!r.error && r.data.rejected === 4 && r.data.accepted === 1, "metadata > 4KB, tipo fora do catalogo, severidade e id invalidos: rejeitados sem derrubar o lote", r);

    // 12. cota diaria 300 (instalacao nova)
    let aceitos = 0;
    for (let i = 0; i < 6; i++) {
      r = await A.rpc("ingest_ops_events", { p_installation: inst(idQ), p_events: Array.from({ length: 50 }, () => ev()) });
      aceitos += r.data?.accepted ?? 0;
    }
    r = await A.rpc("ingest_ops_events", { p_installation: inst(idQ), p_events: [ev(), ev()] });
    ok(aceitos === 300 && r.data.accepted === 0 && r.data.dropped === 2, "cota de 300 eventos/dia por instalacao", { aceitos, r: r.data });

    // 13. impressora de outro usuario nao e aceita; a propria e
    const { data: prA } = await A.from("printers").select("id").limit(1);
    await A.rpc("ingest_ops_events", { p_installation: inst(idA, { printer_id: uuid() }), p_events: [] });
    let row = (await admin.from("ops_installations").select("printer_id").eq("installation_id", idA).single()).data;
    ok(row.printer_id === null, "printer_id que nao e do usuario e ignorado", row);
    if (prA && prA[0]) {
      await A.rpc("ingest_ops_events", { p_installation: inst(idA, { printer_id: prA[0].id }), p_events: [] });
      row = (await admin.from("ops_installations").select("printer_id").eq("installation_id", idA).single()).data;
      ok(row.printer_id === prA[0].id, "printer_id do proprio usuario e aceito", row);
    }

    // 14. clone: mesmo ID, outra maquina
    await A.rpc("ingest_ops_events", { p_installation: inst(idA, { machine_hint: "hintOUTRO" }), p_events: [] });

    // 15. purga > 30 dias
    const velho = ev();
    await A.rpc("ingest_ops_events", { p_installation: inst(idA), p_events: [velho] });
    await admin.from("ops_events").update({ received_at: new Date(Date.now() - 40 * 86400000).toISOString() }).eq("client_event_id", velho.client_event_id);
    await A.rpc("ingest_ops_events", { p_installation: inst(idA), p_events: [] });
    r = await admin.from("ops_events").select("id").eq("client_event_id", velho.client_event_id);
    ok(r.data.length === 0, "evento com mais de 30 dias e purgado", r);

    // 16. admin (B) le A
    await admin.from("ops_admins").insert({ user_id: lb.data.user.id });
    r = await B.from("ops_events").select("id").eq("installation_id", idA);
    ok(!r.error && r.data.length > 50, "admin le eventos de outro usuario", { n: r.data?.length, e: r.error });
    r = await B.rpc("ops_health");
    const h = (r.data || []).find((x) => x.installation_id === idA);
    ok(!r.error && h && h.user_email === K.email && h.possible_clone === true && h.health_status, "ops_health do admin: e-mail, alerta de clone e status", { e: r.error, h });
    r = await B.from("ops_admins").select("user_id");
    ok(!r.error && r.data.length === 1 && r.data[0].user_id === lb.data.user.id, "admin ve so o proprio registro em ops_admins", r);
    r = await B.rpc("ingest_ops_events", { p_installation: inst(idB, { kind: "web" }), p_events: [ev({ event_type: "WEB_ERROR", severity: "ERROR", component: "web" })] });
    ok(!r.error && r.data.accepted === 1, "Web grava WEB_ERROR", r);
    r = await B.rpc("ops_health");
    const hb = (r.data || []).find((x) => x.installation_id === idB);
    ok(hb && hb.health_status === "DEGRADED" && Number(hb.error_count_24h) === 1, "erro nas 24h deixa a instalacao DEGRADED", hb);

    // 17. sem sessao
    r = await A.rpc("ingest_ops_events", { p_installation: { installation_id: "x", kind: "agent" }, p_events: [] });
    ok(!r.error && r.data.reason === "bad_installation", "installation_id invalido recusado", r);
  } finally {
    await admin.from("ops_admins").delete().eq("user_id", lb.data.user.id);
    await admin.from("ops_installations").delete().in("installation_id", [idA, idB, idQ]);
    const sobra = await admin.from("ops_events").select("id", { count: "exact", head: true }).in("installation_id", [idA, idB, idQ]);
    console.log("limpeza: eventos restantes =", sobra.count);
    await A.auth.signOut({ scope: "local" });
    await B.auth.signOut({ scope: "local" });
  }
  console.log(falhas === 0 ? "RESULTADO: TODOS OK" : `RESULTADO: ${falhas} FALHA(S)`);
  process.exitCode = falhas ? 1 : 0;
})().catch((e) => { console.error("ERRO:", e.message || e); process.exitCode = 1; });
