import https from "node:https";
import dns from "node:dns";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

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

// Escaneia EXCLUSIVAMENTE a pasta user do Bambu Studio (perfis criados por você)
async function syncCustomUserPresets() {
  console.log("🔍 Buscando seus filamentos personalizados no Bambu Studio...");
  const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  const userDir = path.join(appData, "BambuStudio", "user");

  if (!fs.existsSync(userDir)) {
    console.log("ℹ️ Pasta de usuário do Bambu Studio não encontrada.");
    return;
  }

  const customPresets: any[] = [];

  try {
    const userFolders = fs.readdirSync(userDir);

    for (const folder of userFolders) {
      const filDir = path.join(userDir, folder, "filament");
      if (!fs.existsSync(filDir)) continue;

      const files = fs.readdirSync(filDir).filter(f => f.endsWith(".json") || f.endsWith(".info"));

      for (const file of files) {
        try {
          const filePath = path.join(filDir, file);
          const raw = fs.readFileSync(filePath, "utf-8");
          const json = JSON.parse(raw);

          // Pega o nome do perfil salvo
          const name = json.name || path.basename(file, path.extname(file));
          
          // Detecta material
          const rawMat = (json.filament_type?.[0] || json.material || "").toUpperCase();
          let material = "PETG";
          if (rawMat.includes("PLA") || name.toUpperCase().includes("PLA")) material = "PLA";
          else if (rawMat.includes("PETG") || name.toUpperCase().includes("PETG")) material = "PETG";
          else if (rawMat.includes("ABS") || name.toUpperCase().includes("ABS")) material = "ABS";
          else if (rawMat.includes("TPU") || name.toUpperCase().includes("TPU")) material = "TPU";

          // Detecta marca comum brasileira ou o próprio nome
          let brand = "Personalizado";
          const lower = name.toLowerCase();
          if (lower.includes("voolt")) brand = "Voolt3D";
          else if (lower.includes("3d fila") || lower.includes("3dfila")) brand = "3D Fila";
          else if (lower.includes("esun")) brand = "Esun";
          else if (lower.includes("creality")) brand = "Creality";
          else if (lower.includes("gtmax")) brand = "GTMax3D";
          else if (lower.includes("printalot")) brand = "PrintaLot";
          else if (lower.includes("masterprint")) brand = "MasterPrint";

          const density = parseFloat(json.filament_density?.[0]) || (material === "PETG" ? 1.27 : 1.24);
          const minTemp = json.nozzle_temperature_range_low?.[0] || "";
          const maxTemp = json.nozzle_temperature_range_high?.[0] || "";
          const bedTemp = json.hot_plate_temp?.[0] || "";

          customPresets.push({
            name,
            material,
            brand,
            density,
            nozzle_temperature_range: minTemp && maxTemp ? `${minTemp}°C - ${maxTemp}°C` : null,
            bed_temperature: bedTemp ? `${bedTemp}°C` : null,
            source: "bambu_user_custom",
          });
        } catch (e) {}
      }
    }
  } catch (err: any) {
    console.error("Erro ao ler pasta user:", err.message);
  }

  console.log(`📦 Filamentos personalizados encontrados: ${customPresets.length}`);

  for (const preset of customPresets) {
    try {
      const existing = await supabaseRequest(`/filament_presets?select=id&name=eq.${encodeURIComponent(preset.name)}`);
      if (!existing || existing.length === 0) {
        await supabaseRequest("/filament_presets", "POST", preset);
        console.log(`  ⭐ Importado: ${preset.name} (${preset.brand} - ${preset.material})`);
      }
    } catch {}
  }
}

async function startAgent() {
  console.log("🧵 Iniciando Desktop Agent Filamap...");
  console.log("🌐 Conectando ao banco Supabase via HTTPS...");

  try {
    await syncCustomUserPresets();

    const printers = await supabaseRequest(`/printers?select=*&serial=eq.${PRINTER_SERIAL}`);
    let printer = printers?.[0];

    if (!printer) {
      console.log("ℹ️ Registrando Bambu Lab A1 no Supabase...");
      const inserted = await supabaseRequest("/printers", "POST", {
        serial: PRINTER_SERIAL,
        model: "A1",
        ip_address: PRINTER_IP,
        is_online: true,
      });
      printer = inserted?.[0];
      console.log("✅ Impressora cadastrada com sucesso!");
    } else {
      console.log("✅ Impressora localizada no Supabase!");
      await supabaseRequest(`/printers?id=eq.${printer.id}`, "PATCH", {
        ip_address: PRINTER_IP,
        is_online: true,
      });
    }

    for (let i = 0; i < 4; i++) {
      await supabaseRequest("/ams_slots?on_conflict=printer_id,slot_index", "POST", {
        printer_id: printer.id,
        slot_index: i,
      }).catch(() => {});
    }

    console.log(`🖨️ Conectando à Bambu Lab A1 em ${PRINTER_IP}:8883 (Serial: ${PRINTER_SERIAL})...`);

    const client = mqtt.connect(`mqtts://${PRINTER_IP}:8883`, {
      username: "bblp",
      password: PRINTER_ACCESS_CODE,
      rejectUnauthorized: false,
      reconnectPeriod: 5000,
    });

    let lastGcodeState = "IDLE";
    let activeSlotIndex = 0;

    client.on("connect", () => {
      console.log("✅ Conectado com sucesso ao broker MQTT da Bambu Lab A1!");
      updateStatus(printer.id, true);

      client.subscribe(`device/${PRINTER_SERIAL}/report`, (err) => {
        if (err) console.error("❌ Erro ao se inscrever no tópico:", err);
        else console.log(`📡 Escutando telemetria em: device/${PRINTER_SERIAL}/report`);
      });
    });

    client.on("error", (err) => {
      console.error("⚠️ Erro de conexão MQTT:", err.message);
    });

    client.on("close", () => {
      console.log("🔌 Conexão MQTT fechada.");
      updateStatus(printer.id, false);
    });

    client.on("message", async (topic, payload) => {
      try {
        const data = JSON.parse(payload.toString());
        const print = data.print;
        if (!print) return;

        if (print.ams?.ams?.[0]?.tray_tar !== undefined) {
          activeSlotIndex = Number(print.ams.ams[0].tray_tar) || 0;
        }

        const currentState = print.gcode_state || lastGcodeState;

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
    console.log(`🔄 Status sincronizado: ${isOnline ? "ONLINE 🟢" : "OFFLINE 🔴"}`);
  } catch (err: any) {
    console.error("Erro ao atualizar status:", err.message);
  }
}

startAgent();