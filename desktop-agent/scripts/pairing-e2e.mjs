// Teste ponta a ponta do pareamento de computador (credencial por
// dispositivo) contra um projeto Supabase de STAGING.
//
// Uso (PowerShell):
//   $env:SUPABASE_URL="https://<ref>.supabase.co"
//   $env:SUPABASE_ANON_KEY="..."; $env:SUPABASE_SERVICE_ROLE_KEY="..."
//   node desktop-agent/scripts/pairing-e2e.mjs
//
// Cria um usuário descartável, percorre o fluxo inteiro e apaga o usuário no
// fim (mesmo se algo falhar). Recusa rodar contra produção.

import { createClient } from "@supabase/supabase-js";
import assert from "node:assert/strict";

const PROD_REF = "gqtlszffgvxsqcmefhyd";
const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceKey) {
  console.error("Defina SUPABASE_URL, SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY (staging).");
  process.exit(2);
}
if (url.includes(PROD_REF)) {
  console.error("Recusado: este teste cria e apaga usuários e só roda em staging.");
  process.exit(2);
}

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, serviceKey, opts);
const email = `pairing-e2e-${Date.now()}@filamap.test`;
const password = `Pw-${crypto.randomUUID()}`;
let userId = null;
const results = [];

async function step(name, fn) {
  try {
    await fn();
    results.push(["ok", name]);
    console.log(`✅ ${name}`);
  } catch (e) {
    results.push(["FALHOU", name]);
    console.error(`❌ ${name}: ${e?.message || e}`);
    throw e;
  }
}

async function pair(code, deviceName) {
  const res = await fetch(`${url}/functions/v1/agent-pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: anonKey, Authorization: `Bearer ${anonKey}` },
    body: JSON.stringify({ code, device_name: deviceName, agent_version: "e2e" }),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

try {
  const web = createClient(url, anonKey, opts);
  let code;
  let device;
  const deviceClient = createClient(url, anonKey, opts);

  await step("usuário de teste criado", async () => {
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    assert.ifError(error);
    userId = data.user.id;
    const s = await web.auth.signInWithPassword({ email, password });
    assert.ifError(s.error);
  });

  await step("anon NÃO consegue gerar código", async () => {
    const anon = createClient(url, anonKey, opts);
    const { error } = await anon.rpc("create_agent_pairing_code");
    assert.ok(error, "anon gerou código");
  });

  await step("anon NÃO consegue consumir código direto no banco", async () => {
    const anon = createClient(url, anonKey, opts);
    const { error } = await anon.rpc("consume_agent_pairing_code", { p_code: "ABCDEFGHJK" });
    assert.ok(error, "anon chamou consume_agent_pairing_code");
  });

  await step("Web gera código XXXXX-XXXXX", async () => {
    const { data, error } = await web.rpc("create_agent_pairing_code");
    assert.ifError(error);
    code = data[0].code;
    assert.match(code, /^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
  });

  await step("código errado é recusado (400 invalid_code)", async () => {
    const r = await pair("ZZZZZ-ZZZZZ", "PC-ERRADO");
    assert.equal(r.status, 400);
    assert.equal(r.body?.error, "invalid_code");
  });

  await step("Agent troca código por sessão própria", async () => {
    const r = await pair(code.toLowerCase(), "PC-OFICINA");
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.user_id, userId);
    device = r.body;
    const { error } = await deviceClient.auth.setSession({ access_token: device.access_token, refresh_token: device.refresh_token });
    assert.ifError(error);
  });

  await step("mesmo código não serve duas vezes", async () => {
    const r = await pair(code, "PC-INTRUSO");
    assert.equal(r.status, 400);
  });

  await step("sessão do computador lê dados do dono (RLS inalterada)", async () => {
    const { error } = await deviceClient.from("printers").select("id").limit(1);
    assert.ifError(error);
  });

  await step("presença do computador registrada (touch_agent_device)", async () => {
    const { data, error } = await deviceClient.rpc("touch_agent_device", { p_agent_version: "e2e-2" });
    assert.ifError(error);
    assert.equal(data, true);
  });

  await step("Web lista o computador", async () => {
    const { data, error } = await web.from("agent_devices").select("id, device_name, agent_version").is("revoked_at", null);
    assert.ifError(error);
    assert.equal(data.length, 1);
    assert.equal(data[0].device_name, "PC-OFICINA");
    assert.equal(data[0].agent_version, "e2e-2");
  });

  await step("sessão da Web e do computador são independentes (refresh do computador funciona)", async () => {
    const { data, error } = await deviceClient.auth.refreshSession();
    assert.ifError(error);
    assert.ok(data.session);
  });

  await step("Web desconecta o computador", async () => {
    const { error } = await web.rpc("revoke_agent_device", { p_device_id: device.device_id });
    assert.ifError(error);
  });

  await step("computador desconectado NÃO consegue mais renovar a sessão", async () => {
    const { data, error } = await deviceClient.auth.refreshSession();
    assert.ok(error || !data.session, "refresh ainda funcionou depois de desconectar");
  });

  await step("sessão da Web continua funcionando depois de desconectar o computador", async () => {
    const { error } = await web.from("agent_devices").select("id").limit(1);
    assert.ifError(error);
    const r = await web.auth.refreshSession();
    assert.ifError(r.error);
  });

  await step("computador revogado some da lista ativa", async () => {
    const { data } = await web.from("agent_devices").select("id").is("revoked_at", null);
    assert.equal(data.length, 0);
  });
} catch {
  // já registrado em results
} finally {
  if (userId) await admin.auth.admin.deleteUser(userId).catch(() => {});
  const failed = results.filter(([s]) => s !== "ok").length;
  console.log(`\n${results.length - failed}/${results.length} etapas ok. Usuário de teste removido.`);
  process.exit(failed ? 1 : 0);
}
