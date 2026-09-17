import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import mqtt from "mqtt";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import dgram from "node:dgram";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const SUPABASE_URL = (process.env.SUPABASE_URL || "").trim().replace(/['"]/g, "").replace(/\/$/, "");
const SUPABASE_ANON_KEY = (process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim().replace(/['"]/g, "");
const AGENT_EMAIL = (process.env.AGENT_EMAIL || "").trim();
const AGENT_PASSWORD = (process.env.AGENT_PASSWORD || "").trim();
let PRINTER_IP = (process.env.PRINTER_IP || "").trim().replace(/['"]/g, "");
const PRINTER_SERIAL = (process.env.PRINTER_SERIAL || "").trim().replace(/['"]/g, "");
const PRINTER_ACCESS_CODE = (process.env.PRINTER_ACCESS_CODE || "").trim().replace(/['"]/g, "");

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !AGENT_EMAIL || !AGENT_PASSWORD || !PRINTER_SERIAL) {
  console.error("❌ Erro: Configure SUPABASE_URL, SUPABASE_ANON_KEY, AGENT_EMAIL, AGENT_PASSWORD e PRINTER_SERIAL no .env");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: true },
});

interface ActiveJobState {
  subtaskName: string;
  maxProgressPercent: number;
  lastProgressPercent: number;
  activeSlot: number;
  startTime: number;
}

const STATE_FILE = path.join(process.cwd(), "agent-state.json");

function loadJobState(): ActiveJobState | null {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
    }
  } catch (e) {}
  return null;
}

function saveJobState(state: ActiveJobState | null) {
  try {
    if (state === null) {
      if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
    } else {
      fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
    }
  } catch (e) {}
}

let currentJob: ActiveJobState | null = loadJobState();

// Função de Descoberta Automática de IP na Rede Local (UDP)
async function discoverPrinterIp(): Promise<string> {
  if (PRINTER_IP) {
    console.log(`🌐 Usando IP configurado no .env: ${PRINTER_IP}`);
    return PRINTER_IP;
  }

  console.log("🔍 Procurando impressora Bambu Lab automaticamente na rede local...");
  return new Promise((resolve) => {
    const socket = dgram.createSocket("udp4");
    let resolved = false;

    socket.on("error", (err) => {
      socket.close();
      if (!resolved) {
        resolved = true;
        resolve("");
      }
    });

    socket.bind(() => {
      try {
        socket.setBroadcast(true);
      } catch (e) {}
      
      const message = Buffer.from("BBLP");
      socket.send(message, 0, message.length, 2021, "255.255.255.255", (err) => {
        if (err && !resolved) {
          socket.close();
          resolved = true;
          resolve("");
        }
      });
    });

    socket.on("message", (msg, rinfo) => {
      const text = msg.toString();
      if ((text.includes("BBLP") || text.includes(PRINTER_SERIAL)) && !resolved) {
        resolved = true;
        socket.close();
        console.log(`✅ Impressora encontrada automaticamente no IP: ${rinfo.address}`);
        resolve(rinfo.address);
      }
    });

    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        try { socket.close(); } catch (e) {}
        console.warn("⚠️ Descoberta automática por UDP esgotou o tempo. Tentando reconectar...");
        resolve("");
      }
    }, 4000);
  });
}

async function startAgent() {
  console.log("🧵 Iniciando Desktop Agent Filamap (com descoberta de rede)...");

  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: AGENT_EMAIL,
    password: AGENT_PASSWORD,
  });

  if (authError || !authData.session) {
    console.error("❌ Falha no login do agente:", authError?.message || "sessão não iniciada");
    process.exit(1);
  }

  console.log(`🔐 Agente autenticado como ${authData.user?.email}`);

  // Descobre o IP se estiver em branco no .env
  if (!PRINTER_IP) {
    PRINTER_IP = await discoverPrinterIp();
  }

  if (!PRINTER_IP) {
    console.error("❌ Erro: Não foi possível localizar a impressora na rede local. Defina o PRINTER_IP manualmente no .env se necessário.");
    process.exit(1);
  }

  try {
    const { data: existingPrinters } = await supabase
      .from("printers")
      .select("*")
      .eq("serial", PRINTER_SERIAL);

    let printer = existingPrinters?.[0];

    if (!printer) {
      const { data: inserted, error: insertError } = await supabase
        .from("printers")
        .insert({ serial: PRINTER_SERIAL, model: "A1", ip_address: PRINTER_IP, is_online: true })
        .select()
        .single();
      if (insertError) throw insertError;
      printer = inserted;
    } else {
      await supabase
        .from("printers")
        .update({ ip_address: PRINTER_IP, is_online: true })
        .eq("id", printer.id);
    }

    // Heartbeat a cada 15s
    setInterval(async () => {
      try {
        await supabase
          .from("printers")
          .update({ is_online: true, updated_at: new Date().toISOString() })
          .eq("id", printer.id);
      } catch (e) {}
    }, 15000);

    console.log(`🖨️ Conectando à Bambu Lab A1 em ${PRINTER_IP}:8883...`);

    const client = mqtt.connect(`mqtts://${PRINTER_IP}:8883`, {
      username: "bblp",
      password: PRINTER_ACCESS_CODE,
      rejectUnauthorized: false,
      reconnectPeriod: 5000,
    });

    function requestStatusPush() {
      const payload = JSON.stringify({ pushing: { sequence_id: "0", command: "pushall" } });
      client.publish(`device/${PRINTER_SERIAL}/request`, payload);
    }

    let lastGcodeState = "IDLE";
    let activeSlotIndex = 0;
    let lastSyncTime = 0;

    client.on("connect", () => {
      console.log("✅ Conectado ao broker MQTT da Bambu Lab A1!");
      updateStatus(printer.id, true);

      client.subscribe(`device/${PRINTER_SERIAL}/report`, (err) => {
        if (err) console.error("❌ Erro ao se inscrever:", err);
        else {
          console.log("📡 Escutando telemetria em tempo real...");
          requestStatusPush();
        }
      });

      setInterval(() => {
        if (client.connected) requestStatusPush();
      }, 10000);
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
        const progress = Number(print.mc_percent) || 0;
        const taskName = print.subtask_name || "";

        if (currentState === "RUNNING") {
          if (!currentJob || currentJob.subtaskName !== taskName) {
            currentJob = {
              subtaskName: taskName || "Impressão A1",
              maxProgressPercent: progress,
              lastProgressPercent: progress,
              activeSlot: activeSlotIndex,
              startTime: Date.now(),
            };
            saveJobState(currentJob);
          } else {
            currentJob.lastProgressPercent = progress;
            if (progress > currentJob.maxProgressPercent) {
              currentJob.maxProgressPercent = progress;
              saveJobState(currentJob);
            }
          }
        }

        const now = Date.now();
        if (now - lastSyncTime > 2500 || (print.gcode_state && print.gcode_state !== lastGcodeState)) {
          lastSyncTime = now;

          const telemetryData: Record<string, unknown> = {
            is_online: true,
            gcode_state: currentState,
            active_slot_index: activeSlotIndex,
          };

          if (print.subtask_name !== undefined) telemetryData.current_task = print.subtask_name;
          if (print.mc_percent !== undefined) telemetryData.print_progress = progress;
          if (print.mc_remaining_time !== undefined) telemetryData.remaining_time_min = Number(print.mc_remaining_time) || 0;
          if (print.layer_num !== undefined) telemetryData.current_layer = Number(print.layer_num) || 0;
          if (print.total_layer_num !== undefined) telemetryData.total_layers = Number(print.total_layer_num) || 0;
          if (print.nozzle_temper !== undefined) telemetryData.nozzle_temp = Math.round(Number(print.nozzle_temper));
          if (print.nozzle_target_temper !== undefined) telemetryData.nozzle_target_temp = Math.round(Number(print.nozzle_target_temper));
          if (print.bed_temper !== undefined) telemetryData.bed_temp = Math.round(Number(print.bed_temper));
          if (print.bed_target_temper !== undefined) telemetryData.bed_target_temp = Math.round(Number(print.bed_target_temper));

          await supabase.from("printers").update(telemetryData).eq("id", printer.id);
        }

        if (currentState === "FINISH" && lastGcodeState !== "FINISH") {
          console.log("🎉 Impressão CONCLUÍDA!");
          await finalizeJob(printer.id, print, 100, "COMPLETED");
          currentJob = null;
          saveJobState(null);
        }

        if ((currentState === "FAILED" || currentState === "PAUSE_STOP" || currentState === "STOP") &&
            (lastGcodeState === "RUNNING" || lastGcodeState === "PAUSE")) {
          const finalPercent = currentJob ? currentJob.maxProgressPercent : progress;
          console.log(`⚠️ Impressão INTERROMPIDA/FALHA aos ${finalPercent}%!`);
          await finalizeJob(printer.id, print, finalPercent, currentState);
          currentJob = null;
          saveJobState(null);
        }

        lastGcodeState = currentState;
      } catch (err: any) {
        console.error("Erro no processamento:", err.message);
      }
    });
  } catch (err: any) {
    console.error("❌ Erro de inicialização:", err.message || err);
  }
}

async function finalizeJob(printerId: string, printData: any, percentExecuted: number, finishStatus: string) {
  try {
    const subtaskName = printData.subtask_name || (currentJob ? currentJob.subtaskName : "Trabalho 3D");
    const durationMinutes = Math.round((printData.mc_cost_time || 0) / 60);
    const slotIdx = currentJob ? currentJob.activeSlot : 0;

    const { data: slotRows } = await supabase
      .from("ams_slots")
      .select("spool_id, spool:spools(*)")
      .eq("printer_id", printerId)
      .eq("slot_index", slotIdx);

    const slotRecord = slotRows?.[0];
    const spoolId = slotRecord?.spool_id ?? null;
    const currentSpool = (slotRecord as any)?.spool;

    const estimatedUsedG = Math.max(1, Math.round((35 * (percentExecuted / 100)) * 10) / 10);

    if (spoolId && currentSpool) {
      const prevWeight = currentSpool.current_weight || 0;
      const nextWeight = Math.max(0, Math.round((prevWeight - estimatedUsedG) * 10) / 10);
      
      await supabase.from("spools").update({ current_weight: nextWeight }).eq("id", spoolId);
      console.log(`📉 Estoque abatido automaticamente: ${currentSpool.color_name} (-${estimatedUsedG}g)`);
    }

    await supabase.from("print_logs").insert({
      printer_id: printerId,
      spool_id: spoolId,
      slot_index: slotIdx,
      subtask_name: subtaskName,
      filament_used_g: estimatedUsedG,
      print_duration_minutes: durationMinutes,
      status: finishStatus,
      needs_weighing: false,
      completed_at: new Date().toISOString(),
    });

    console.log(`📝 Log gravado e estoque atualizado com sucesso (${finishStatus})`);
  } catch (e: any) {
    console.error("❌ Falha ao finalizar trabalho:", e.message);
  }
}

async function updateStatus(printerId: string, isOnline: boolean) {
  await supabase.from("printers").update({ is_online: isOnline }).eq("id", printerId);
}

startAgent();