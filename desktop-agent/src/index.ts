import https from "node:https";
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import mqtt from "mqtt";
import dotenv from "dotenv";

dotenv.config();

const SUPABASE_URL = (process.env.SUPABASE_URL || "").trim().replace(/['"]/g, "").replace(/\/$/, "");
const SUPABASE_KEY = (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || "").trim().replace(/['"]/g, "");
const PRINTER_IP = (process.env.PRINTER_IP || "").trim().replace(/['"]/g, "");
const PRINTER_SERIAL = (process.env.PRINTER_SERIAL || "").trim().replace(/['"]/g, "");
const PRINTER_ACCESS_CODE = (process.env.PRINTER_ACCESS_CODE || "").trim().replace(/['"]/g, "");

if (!SUPABASE_URL || !SUPABASE_KEY || !PRINTER_IP || !PRINTER_SERIAL) {
  console.error("❌ Erro: Configure as variáveis no arquivo .env");
  process.exit(1);
}

function supabaseRequest(endpoint: string, method = "GET", data?: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const url = new URL(`${SUPABASE_URL}/rest/v1${endpoint}`);
    const options: https.RequestOptions = {
      hostname: url.hostname,
      port: 443,
      path: `${url.pathname}${url.search}`,
      method,
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        "Prefer": method === "POST" ? "return=representation" : "return=minimal",
      },
    };

    const req = https.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${body}`));
        } else {
          try {
            resolve(body ? JSON.parse(body) : null);
          } catch {
            resolve(body);
          }
        }
      });
    });

    req.on("error", (err) => reject(err));
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

async function startAgent() {
  console.log("🧵 Iniciando Desktop Agent Filamap com Telemetria Ativa...");

  try {
    const printers = await supabaseRequest(`/printers?select=*&serial=eq.${PRINTER_SERIAL}`);
    let printer = printers?.[0];

    if (!printer) {
      const inserted = await supabaseRequest("/printers", "POST", {
        serial: PRINTER_SERIAL,
        model: "A1",
        ip_address: PRINTER_IP,
        is_online: true,
      });
      printer = inserted?.[0];
    } else {
      await supabaseRequest(`/printers?id=eq.${printer.id}`, "PATCH", {
        ip_address: PRINTER_IP,
        is_online: true,
      });
    }

    console.log(`🖨️ Conectando à Bambu Lab A1 em ${PRINTER_IP}:8883...`);

    const client = mqtt.connect(`mqtts://${PRINTER_IP}:8883`, {
      username: "bblp",
      password: PRINTER_ACCESS_CODE,
      rejectUnauthorized: false,
      reconnectPeriod: 5000,
    });

    function requestStatusPush() {
      const payload = JSON.stringify({
        pushing: {
          sequence_id: "0",
          command: "pushall"
        }
      });
      client.publish(`device/${PRINTER_SERIAL}/request`, payload);
    }

    let lastGcodeState = "IDLE";
    let activeSlotIndex = 0;
    let lastSyncTime = 0;

    client.on("connect", () => {
      console.log("✅ Conectado ao broker MQTT da Bambu Lab A1!");
      updateStatus(printer.id, true);

      client.subscribe(`device/${PRINTER_SERIAL}/report`, (err) => {
        if (err) {
          console.error("❌ Erro ao se inscrever no tópico:", err);
        } else {
          console.log(`📡 Escutando telemetria em tempo real...`);
          requestStatusPush();
        }
      });

      // Solicita atualização forçada periodicamente
      setInterval(() => {
        if (client.connected) requestStatusPush();
      }, 10000);
    });

    client.on("error", (err) => {
      console.error("⚠️ Erro de conexão MQTT:", err.message);
    });

    client.on("close", () => {
      console.log("🔌 Conexão MQTT fechada.");
      updateStatus(printer.id, false);
    });

    client.on("message", async (_topic, payload) => {
      try {
        const raw = JSON.parse(payload.toString());
        const print = raw.print;
        if (!print) return;

        if (print.ams?.ams?.[0]?.tray_tar !== undefined) {
          activeSlotIndex = Number(print.ams.ams[0].tray_tar) || 0;
        }

        const currentState = print.gcode_state || lastGcodeState;
        const now = Date.now();

        // Salva dados se houver alteração ou a cada 2.5s
        if (now - lastSyncTime > 2500 || (print.gcode_state && print.gcode_state !== lastGcodeState)) {
          lastSyncTime = now;

          const telemetryData: any = {
            is_online: true,
            gcode_state: currentState,
            active_slot_index: activeSlotIndex,
          };

          if (print.subtask_name !== undefined) telemetryData.current_task = print.subtask_name;
          if (print.mc_percent !== undefined) telemetryData.print_progress = Number(print.mc_percent) || 0;
          if (print.mc_remaining_time !== undefined) telemetryData.remaining_time_min = Number(print.mc_remaining_time) || 0;
          if (print.layer_num !== undefined) telemetryData.current_layer = Number(print.layer_num) || 0;
          if (print.total_layer_num !== undefined) telemetryData.total_layers = Number(print.total_layer_num) || 0;
          
          if (print.nozzle_temper !== undefined) telemetryData.nozzle_temp = Math.round(Number(print.nozzle_temper));
          if (print.nozzle_target_temper !== undefined) telemetryData.nozzle_target_temp = Math.round(Number(print.nozzle_target_temper));
          if (print.bed_temper !== undefined) telemetryData.bed_temp = Math.round(Number(print.bed_temper));
          if (print.bed_target_temper !== undefined) telemetryData.bed_target_temp = Math.round(Number(print.bed_target_temper));

          await supabaseRequest(`/printers?id=eq.${printer.id}`, "PATCH", telemetryData);
          console.log(`📊 Telemetria enviada: Estado=${currentState} | Bico=${telemetryData.nozzle_temp || 0}°C | Progresso=${telemetryData.print_progress || 0}%`);
        }

        if (currentState === "FINISH" && lastGcodeState !== "FINISH") {
          console.log("🎉 Impressão FINALIZADA detectada!");
          await handlePrintFinish(printer.id, print, activeSlotIndex);
        }

        lastGcodeState = currentState;
      } catch (err: any) {
        console.error("Erro no processamento:", err.message);
      }
    });

  } catch (err: any) {
    console.error("❌ Erro na comunicação com Supabase:", err.message || err);
  }
}

async function handlePrintFinish(printerId: string, printData: any, slotIdx: number) {
  try {
    const subtaskName = printData.subtask_name || "Trabalho 3D";
    const durationMinutes = Math.round((printData.mc_cost_time || 0) / 60);
    const weightUsed = 25;

    const slots = await supabaseRequest(`/ams_slots?select=spool_id,spool:spools(*)&printer_id=eq.${printerId}&slot_index=eq.${slotIdx}`);
    const slotRecord = slots?.[0];
    const spoolId = slotRecord?.spool_id || null;
    const currentSpool = slotRecord?.spool;

    if (spoolId && currentSpool) {
      const newWeight = Math.max(0, (currentSpool.current_weight || 0) - weightUsed);
      await supabaseRequest(`/spools?id=eq.${spoolId}`, "PATCH", { current_weight: newWeight });
      console.log(`📉 Saldo atualizado: ${currentSpool.material} -> ${newWeight}g`);
    }

    await supabaseRequest("/print_logs", "POST", {
      printer_id: printerId,
      spool_id: spoolId,
      slot_index: slotIdx,
      subtask_name: subtaskName,
      filament_used_g: weightUsed,
      print_duration_minutes: durationMinutes,
      completed_at: new Date().toISOString(),
    });

    console.log("✅ Log registrado no Supabase!");
  } catch (e: any) {
    console.error("❌ Falha ao gravar término:", e.message);
  }
}

async function updateStatus(printerId: string, isOnline: boolean) {
  try {
    await supabaseRequest(`/printers?id=eq.${printerId}`, "PATCH", {
      is_online: isOnline,
    });
  } catch (err: any) {}
}

startAgent();