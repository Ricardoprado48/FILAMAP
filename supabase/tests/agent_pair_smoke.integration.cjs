// Pareamento do Agent (agent-pair) contra o banco de TESTE: codigo -> sessao propria -> desconectar.
const { createRequire } = require("module");
const req = createRequire("C:/FILAMAP-staging/desktop-agent/package.json");
const { createClient } = req("@supabase/supabase-js");
const K = JSON.parse(process.env.STAGING_CREDS);
if (K.url.includes("gqtlszffgvxsqcmefhyd")) throw new Error("Recusado: producao.");
let falhas = 0;
const ok = (c, m, x) => { console.log((c ? "OK   " : "FALHA") + " " + m + (c || x === undefined ? "" : " -> " + JSON.stringify(x))); if (!c) falhas++; };
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
(async () => {
  const A = createClient(K.url, K.anon, opts);
  const la = await A.auth.signInWithPassword({ email: K.email, password: K.password });
  if (la.error) throw la.error;
  const pc = await A.rpc("create_agent_pairing_code");
  ok(!pc.error, "codigo de pareamento gerado", pc.error);
  const r = await fetch(`${K.url}/functions/v1/agent-pair`, { method: "POST", headers: { apikey: K.anon, "Content-Type": "application/json" }, body: JSON.stringify({ code: pc.data[0].code, device_name: "smoke-" + Date.now(), agent_version: "smoke" }) });
  const j = await r.json();
  ok(r.status === 200 && !!j.refresh_token && !!j.access_token, "agent-pair devolve sessao propria (cadastro publico desligado)", { status: r.status, error: j.error });
  const d = await A.from("agent_devices").select("id,device_name").like("device_name", "smoke-%");
  ok(!d.error && d.data.length >= 1, "computador aparece em agent_devices", d.error);
  for (const dev of d.data || []) { const rv = await A.rpc("revoke_agent_device", { p_device_id: dev.id }); ok(!rv.error, "desconectar computador de teste", rv.error); }
  await A.auth.signOut({ scope: "local" });
  console.log(falhas === 0 ? "\nPAREAMENTO_OK" : `\n${falhas} FALHA(S)`);
  process.exit(falhas === 0 ? 0 : 1);
})();
