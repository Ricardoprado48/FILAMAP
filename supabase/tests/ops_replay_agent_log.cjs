// Replay do agent.log REAL (dia 2026-09-28) como uma instalacao "replay" no banco de TESTE,
// para demonstrar a Central reconstruindo o incidente tray_info_idx (16:22-17:44Z).
// Recusa producao. Passa o texto pela MESMA sanitizacao do Agent. Torna o usuario de teste admin.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { createRequire } = require("module");
const req = createRequire("C:/FILAMAP-staging/desktop-agent/package.json");
const { createClient } = req("@supabase/supabase-js");
const { createSanitizer, fingerprint } = req("./dist/observability/sanitize.js");

const K = JSON.parse(process.env.STAGING_CREDS);
if (K.url.includes("gqtlszffgvxsqcmefhyd")) throw new Error("Recusado: producao.");
const DAY = "2026-09-28";
const INSTALL = "00000000-0000-4000-8000-00000000a28a";
const s = createSanitizer();

const rules = [
  [/Iniciando Desktop Agent/, "AGENT_STARTED", "INFO", "agent"],
  [/Conectado ao broker MQTT/, "MQTT_CONNECTED", "INFO", "mqtt"],
  [/Conexão MQTT fechada/, "MQTT_DISCONNECTED", "WARNING", "mqtt"],
  [/Erro na conexão MQTT: (.*)/, "MQTT_ERROR", "WARNING", "mqtt"],
  [/(Heartbeat|Telemetria) falhou \(1x seguidas\): (.*)/, "TELEMETRY_DEGRADED", "WARNING", "supabase"],
  [/(Heartbeat|Telemetria) restabelecido/, "TELEMETRY_RESTORED", "INFO", "supabase"],
  [/Novo trabalho de impressão detectado: "(.*)" \(JobId: ([0-9a-f-]{36})\)/, "JOB_DETECTED", "INFO", "job"],
  [/Impressão CONCLUÍDA/, "JOB_FINISHED", "INFO", "job"],
  [/Impressão INTERROMPIDA\/FALHA aos (\d+)%/, "JOB_FAILED", "WARNING", "job"],
  [/Finalização do job ([0-9a-f-]{36}) guardada para reenvio \(tentativa (\d+)\): (.*)/, "FINALIZE_RETRY", "WARNING", "finalize"],
  [/Falha ao finalizar trabalho: (.*)/, "AGENT_ERROR", "ERROR", "finalize"],
  [/Finalização pendente do job ([0-9a-f-]{36}) enviada após (\d+)/, "FINALIZE_COMPLETED", "INFO", "finalize"],
  [/Job ([0-9a-f-]{36}) finalizado \((\w+)\) -- .*?([\d.]+)g debitados/, "FINALIZE_COMPLETED", "INFO", "finalize"],
  [/Impressora ainda não encontrada/, "PRINTER_OFFLINE", "WARNING", "printer"],
  [/Impressora (reencontrada|encontrada automaticamente)/, "PRINTER_ONLINE", "INFO", "printer"],
];

(async () => {
  const admin = createClient(K.url, K.service_role, { auth: { persistSession: false } });
  const { data: u } = await admin.auth.admin.listUsers();
  const user = u.users.find((x) => x.email === K.email);
  if (!user) throw new Error("usuario de teste nao encontrado");

  const lines = fs.readFileSync(path.join(process.env.APPDATA, "Filamap", "agent.log"), "utf-8").split(/\r?\n/);
  const boot = crypto.randomUUID();
  const events = [];
  let seq = 0;
  const lastState = new Map();
  for (const line of lines) {
    const m = /^\[(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\]\s*(.*)$/.exec(line);
    if (!m || !m[1].startsWith(DAY)) continue;
    for (const [re, type, severity, component] of rules) {
      const r = re.exec(m[2]);
      if (!r) continue;
      if (["PRINTER_OFFLINE", "PRINTER_ONLINE"].includes(type)) {
        if (lastState.get("printer") === type) break;
        lastState.set("printer", type);
      }
      const message = s.text(type === "AGENT_ERROR" ? r[1] : type === "FINALIZE_RETRY" ? r[3] : type === "MQTT_ERROR" ? r[1] : type === "TELEMETRY_DEGRADED" ? r[2] : "", 500);
      const job = /[0-9a-f]{8}-[0-9a-f-]{27}/.exec(m[2])?.[0] ?? null;
      const metadata = { replay: true };
      if (type === "JOB_DETECTED") metadata.subtask = s.text(r[1], 120);
      if (type === "JOB_FAILED") metadata.percent = Number(r[1]);
      if (type === "FINALIZE_RETRY") metadata.attempts = Number(r[2]);
      if (type === "FINALIZE_COMPLETED" && r[3]) metadata.deducted_g = Number(r[3]);
      if (job) metadata.job = job;
      events.push({
        user_id: user.id, installation_id: INSTALL, client_event_id: crypto.randomUUID(), boot_id: boot, seq: ++seq,
        occurred_at: m[1], received_at: m[1], app_version: "replay-log-28-09", event_type: type, severity, component,
        job_id: job, message: message || null,
        fingerprint: severity !== "INFO" ? fingerprint(component, undefined, message) : null,
        repeat_count: 1, metadata,
      });
      break;
    }
  }

  await admin.from("ops_installations").delete().eq("installation_id", INSTALL);
  const { error: ie } = await admin.from("ops_installations").insert({
    installation_id: INSTALL, user_id: user.id, kind: "agent", machine_hint: "replay", app_version: "replay-log-28-09",
    first_seen_at: `${DAY}T00:00:00Z`, last_seen_at: new Date().toISOString(),
    status: { mqtt: "connected", session: "ok", bambu_sync: "ok", profile_sync: "ok", pending_finalize: 0, replay: true },
  });
  if (ie) throw ie;
  for (let i = 0; i < events.length; i += 200) {
    const { error } = await admin.from("ops_events").insert(events.slice(i, i + 200));
    if (error) throw error;
  }
  await admin.from("ops_admins").upsert({ user_id: user.id });
  const byType = events.reduce((a, e) => ((a[e.event_type] = (a[e.event_type] || 0) + 1), a), {});
  console.log(`replay: ${events.length} eventos de ${DAY}`, JSON.stringify(byType));
  console.log("usuario de teste agora e admin no banco de TESTE");
})().catch((e) => { console.error("ERRO:", e.message || e); process.exitCode = 1; });
