import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import mqtt from "mqtt";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import dgram from "node:dgram";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { fetchAndParseSliceInfo, FilamentSliceInfo } from "./ftpsParser";
import { computeConsumptionPerSlot } from "./consumption";
import type { JobConsumptionItem } from "./consumption";

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
  jobId: string; // chave de idempotência (não há task_id/job_id confirmado no payload MQTT real -- ver relatório, investigação (a))
  subtaskName: string;
  maxProgressPercent: number;
  lastProgressPercent: number;
  activeSlot: number; // último slot ativo reportado (mantido por compat/log)
  usedSlots: number[]; // TODOS os slots vistos como ativos durante RUNNING, não só o inicial
  startTime: number;
  totalCostTime: number; // Segundos estimados pelo fatiador
  filamentGrams: number;  // Gramas calculadas pelo fatiador (se informadas)
  filamentSliceInfo?: FilamentSliceInfo[]; // Adicionado para armazenar informações do slice_info.config
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

async function discoverPrinterIp(): Promise<string> {
  if (PRINTER_IP) return PRINTER_IP;

  console.log("🔍 Procurando impressora Bambu Lab automaticamente na rede local...");

  return new Promise((resolve) => {
    const ports = [2021, 1990];
    const sockets: dgram.Socket[] = [];
    let resolved = false;

    function cleanup() {
      for (const socket of sockets) {
        try {
          socket.close();
        } catch (_) {}
      }
    }

    function finish(ip: string) {
      if (resolved) return;

      resolved = true;
      cleanup();

      if (ip) {
        console.log(`✅ Impressora encontrada automaticamente no IP: ${ip}`);
      }

      resolve(ip);
    }

    function handleMessage(msg: Buffer, rinfo: dgram.RemoteInfo) {
      const text = msg.toString("utf8");

      const isBambu =
        text.includes("urn:bambulab-com:device:3dprinter") ||
        text.toLowerCase().includes("devmodel.bambu.com") ||
        text.includes(PRINTER_SERIAL);

      if (!isBambu) return;

      const usnMatch = text.match(/^USN:\s*(.+)$/im);
      const announcedSerial = usnMatch?.[1]?.trim() ?? "";

      if (
        announcedSerial &&
        PRINTER_SERIAL &&
        announcedSerial !== PRINTER_SERIAL &&
        !announcedSerial.includes(PRINTER_SERIAL)
      ) {
        return;
      }

      let detectedIp = rinfo.address;

      const locationMatch = text.match(/^LOCATION:\s*(.+)$/im);

      if (locationMatch?.[1]) {
        const location = locationMatch[1].trim();
        const ipMatch = location.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);

        if (ipMatch?.[0]) {
          detectedIp = ipMatch[0];
        }
      }

      finish(detectedIp);
    }

    for (const port of ports) {
      try {
        const socket = dgram.createSocket({
          type: "udp4",
          reuseAddr: true,
        });

        sockets.push(socket);

        socket.on("error", (error) => {
          console.warn(
            `⚠️ Falha ao escutar descoberta Bambu na porta ${port}: ${error.message}`
          );
        });

        socket.on("message", handleMessage);

        socket.bind(port, "0.0.0.0", () => {
          try {
            socket.addMembership("239.255.255.250");
          } catch (_) {}
        });
      } catch (_) {}
    }

    setTimeout(() => {
      finish("");
    }, 12000);
  });
}
function extractGramsFromName(taskName: string): number | null {
  const match = taskName.match(/_(\d+(?:\.\d+)?)g/i) || taskName.match(/(\d+(?:\.\d+)?)g\b/i);
  if (match && match[1]) {
    return parseFloat(match[1]);
  }
  return null;
}

async function startAgent() {
  console.log("🧵 Iniciando Desktop Agent Filamap (com leitura de dados do fatiador)...");

  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: AGENT_EMAIL,
    password: AGENT_PASSWORD,
  });

  if (authError || !authData.session) {
    console.error("❌ Falha no login do agente:", authError?.message || "sessão não iniciada");
    process.exit(1);
  }

  if (!PRINTER_IP) {
    PRINTER_IP = await discoverPrinterIp();
  }

  if (!PRINTER_IP) {
    console.error("❌ Erro: Não foi possível localizar a impressora na rede local.");
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
      await supabase.from("printers").update({ ip_address: PRINTER_IP, is_online: true }).eq("id", printer.id);
    }

    // Heartbeat a cada 15s — grava last_seen_at independente do estado da
    // conexão MQTT com a impressora, é o sinal de "o processo do Agent
    // ainda está rodando" que o frontend usa pra decidir online/offline.
    setInterval(async () => {
      try {
        const nowIso = new Date().toISOString();
        await supabase.from("printers").update({ is_online: true, updated_at: nowIso, last_seen_at: nowIso }).eq("id", printer.id);
      } catch (e) {}
    }, 15000);

    // Gravação de is_online:false num encerramento limpo (Ctrl+C, `kill`).
    // É só um caminho rápido — a proteção real contra o Agent morrer sem
    // aviso (queda de energia, crash, hibernação) é o frontend calcular
    // online pela recência de last_seen_at, não por depender de alguém
    // conseguir gravar `false` na saída.
    let shuttingDown = false;
    async function gracefulShutdown() {
      if (shuttingDown) return;
      shuttingDown = true;
      try {
        await supabase.from("printers").update({ is_online: false }).eq("id", printer.id);
      } catch (e) {}
      process.exit(0);
    }
    process.on("SIGINT", gracefulShutdown);
    process.on("SIGTERM", gracefulShutdown);

    const client = mqtt.connect(`mqtts://${PRINTER_IP}:8883`, {
      username: "bblp",
      password: PRINTER_ACCESS_CODE,
      rejectUnauthorized: false,
      reconnectPeriod: 0,
    });

    function requestStatusPush() {
      const payload = JSON.stringify({ pushing: { sequence_id: "0", command: "pushall" } });
      client.publish(`device/${PRINTER_SERIAL}/request`, payload);
    }

    let lastGcodeState = "IDLE";
    let activeSlotIndex = 0;
    let lastSyncTime = 0;

    let rediscoveryInProgress = false;
    let statusPushInterval: NodeJS.Timeout | null = null;

    async function rediscoverPrinter() {
      if (rediscoveryInProgress || client.connected) return;

      rediscoveryInProgress = true;
      const previousIp = PRINTER_IP;

      try {
        console.warn("🔍 Conexão MQTT perdida. Procurando a impressora novamente na rede...");

        while (!client.connected) {
          // Força nova descoberta em vez de reutilizar o IP conhecido.
          PRINTER_IP = "";

          const newIp = await discoverPrinterIp();

          // A conexão pode ter voltado enquanto a descoberta estava em andamento.
          if (client.connected) {
            PRINTER_IP = previousIp;
            return;
          }

          if (newIp) {
            PRINTER_IP = newIp;

            client.options.host = newIp;
            client.options.hostname = newIp;

            if (newIp === previousIp) {
              console.log(`✅ Impressora reencontrada no mesmo IP: ${newIp}`);
            } else {
              console.log(`✅ Impressora reencontrada. IP atualizado: ${previousIp} -> ${newIp}`);
            }

            if (!client.reconnecting) {
              client.reconnect();
            }

            return;
          }

          PRINTER_IP = previousIp;
          console.warn("⚠️ Impressora ainda não encontrada. Nova tentativa em 15 segundos...");
          await new Promise(resolve => setTimeout(resolve, 15000));
        }
      } catch (error: any) {
        PRINTER_IP = previousIp;
        console.error(
          "❌ Falha durante a redescoberta da impressora:",
          error?.message ?? error
        );
      } finally {
        rediscoveryInProgress = false;
      }
    }

    client.on("connect", () => {
      console.log(`✅ Conectado ao broker MQTT da Bambu Lab A1 em ${PRINTER_IP}!`);
      updateStatus(printer.id, true);

      client.subscribe(`device/${PRINTER_SERIAL}/report`, () => requestStatusPush());

      if (!statusPushInterval) {
        statusPushInterval = setInterval(() => {
          if (client.connected) requestStatusPush();
        }, 10000);
      }
    });

    client.on("close", () => {
      console.log("🔌 Conexão MQTT fechada.");
      updateStatus(printer.id, false);

      void rediscoverPrinter();
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
        const totalCostTime = Number(print.mc_total_cost_time) || Number(print.calc_remaining_time) || 0;

        // No Bambu Lab MQTT, o arquivo .gcode ou .3mf sendo impresso é enviado em print.gcode_file
        const gcodeFile = print.gcode_file || "";

        if (currentState === "RUNNING") {
          if (!currentJob || currentJob.subtaskName !== taskName) {
            // Tenta extrair gramas do nome do arquivo do fatiador (se o usuário nomear ex: "suporte_azeite_45g.gcode")
            const extractedGrams = extractGramsFromName(taskName);

            let filamentSliceInfo: FilamentSliceInfo[] = [];
            try {
              // Identifica dinamicamente o caminho do arquivo remoto .3mf na impressora.
              // Se gcodeFile estiver presente e terminar em .3mf ou .gcode, usamos ele.
              // Do contrário, fazemos o fallback inteligente utilizando o taskName.
              let remoteFilePath = gcodeFile;
              if (!remoteFilePath) {
                remoteFilePath = `/sdcard/${taskName}.gcode.3mf`;
              } else if (!remoteFilePath.toLowerCase().endsWith(".3mf")) {
                // Se o arquivo reportado for .gcode, frequentemente existe o correspondente .3mf na mesma pasta ou similar.
                // Mas geralmente nas impressoras modernas a pasta cache guarda o .3mf temporário do job atual
                remoteFilePath = remoteFilePath.replace(/\.gcode$/i, ".3mf").replace(/\.gcode\.3mf$/i, ".3mf");
                if (!remoteFilePath.toLowerCase().endsWith(".3mf")) {
                  remoteFilePath += ".3mf";
                }
              }

              console.log(`📡 Solicitando arquivo de fatiador via FTPS no caminho: ${remoteFilePath}`);
              filamentSliceInfo = await fetchAndParseSliceInfo(PRINTER_IP, PRINTER_ACCESS_CODE, remoteFilePath);
              if (filamentSliceInfo.length > 0) {
                console.log("ℹ️ Informações de slice_info.config carregadas com sucesso!");
              }
            } catch (e: any) {
              console.error("❌ Erro ao carregar slice_info.config:", e.message);
            }
            
            currentJob = {
              jobId: randomUUID(),
              subtaskName: taskName || "Impressão A1",
              maxProgressPercent: progress,
              lastProgressPercent: progress,
              activeSlot: activeSlotIndex,
              usedSlots: [activeSlotIndex],
              startTime: Date.now(),
              totalCostTime: totalCostTime,
              filamentGrams: extractedGrams || 0,
              filamentSliceInfo: filamentSliceInfo,
            };
            saveJobState(currentJob);
            if (extractedGrams) {
              console.log(`🎯 Peso detectado automaticamente do fatiador/arquivo: ${extractedGrams}g`);
            }
          } else {
            currentJob.lastProgressPercent = progress;
            let stateChanged = false;
            if (progress > currentJob.maxProgressPercent) {
              currentJob.maxProgressPercent = progress;
              stateChanged = true;
            }
            // Rastreia troca de slot ativo pela AMS durante o job -- é o
            // que permite descontar TODOS os carretéis usados num job
            // multicolor, não só o slot capturado no início.
            if (activeSlotIndex !== currentJob.activeSlot) {
              currentJob.activeSlot = activeSlotIndex;
              stateChanged = true;
            }
            if (!currentJob.usedSlots.includes(activeSlotIndex)) {
              currentJob.usedSlots.push(activeSlotIndex);
              console.log(`🎨 Troca de slot detectada durante o job -- slot ${activeSlotIndex} adicionado (usados até agora: ${currentJob.usedSlots.join(", ")})`);
              stateChanged = true;
            }
            if (stateChanged) {
              saveJobState(currentJob);
            }
          }
        }

        const now = Date.now();
        if (now - lastSyncTime > 2500 || (print.gcode_state && print.gcode_state !== lastGcodeState)) {
          lastSyncTime = now;
          const telemetryData: Record<string, unknown> = {
            is_online: true,
            last_seen_at: new Date().toISOString(),
            gcode_state: currentState,
            active_slot_index: activeSlotIndex,
          };
          if (print.subtask_name !== undefined) telemetryData.current_task = print.subtask_name;
          if (print.mc_percent !== undefined) telemetryData.print_progress = progress;
          if (print.mc_remaining_time !== undefined) telemetryData.remaining_time_min = Number(print.mc_remaining_time) || 0;
          if (print.layer_num !== undefined) telemetryData.current_layer = Number(print.layer_num) || 0;
          if (print.total_layer_num !== undefined) telemetryData.total_layers = Number(print.total_layer_num) || 0;
          if (print.nozzle_temper !== undefined) telemetryData.nozzle_temp = Math.round(Number(print.nozzle_temper));
          if (print.bed_temper !== undefined) telemetryData.bed_temp = Math.round(Number(print.bed_temper));

          if (currentJob?.filamentSliceInfo) {
            telemetryData.filament_slice_info = currentJob.filamentSliceInfo;
          }

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
    const jobId = currentJob?.jobId || randomUUID();
    const subtaskName = printData.subtask_name || (currentJob ? currentJob.subtaskName : "Trabalho 3D");
    const durationMinutes = Math.round((printData.mc_cost_time || 0) / 60);
    // Job que começou e terminou inteiro com o Agent desligado nunca tem
    // currentJob capturado -- cai no slot 0 como já acontecia antes desta
    // mudança (limitação conhecida, não nova: sem captura, não há como
    // saber que outros slots foram usados nem pegar slice_info.config).
    const usedSlots = currentJob?.usedSlots?.length ? currentJob.usedSlots : [currentJob?.activeSlot ?? 0];

    const perSlot = computeConsumptionPerSlot(
      usedSlots,
      currentJob?.filamentSliceInfo,
      currentJob?.filamentGrams || 0,
      durationMinutes
    );

    const { data: slotRows } = await supabase
      .from("ams_slots")
      .select("slot_index, spool_id")
      .eq("printer_id", printerId)
      .in("slot_index", Array.from(perSlot.keys()));
    const spoolBySlot = new Map<number, string | null>((slotRows || []).map((r: any) => [r.slot_index, r.spool_id]));

    const items: JobConsumptionItem[] = [];
    for (const [slotIdx, { grams, quality, weightDiscount }] of perSlot) {
      let finalGrams = grams;
      if (quality !== "unknown") {
        // Escala tanto o valor base quanto o desconto de purga/flush por
        // percentExecuted -- em FAILED/PAUSE_STOP/STOP (percentExecuted < 100),
        // um job que falhou cedo não deve ter nem o consumo nem o desconto de
        // purga aplicados em cheio, os dois avançam proporcionalmente juntos.
        const scaledGrams = Math.round(grams * (percentExecuted / 100) * 10) / 10;
        const scaledDiscount = weightDiscount > 0 ? Math.round(weightDiscount * (percentExecuted / 100) * 10) / 10 : 0;
        finalGrams = Math.max(0, Math.round((scaledGrams - scaledDiscount) * 10) / 10);
      }

      const spoolId = spoolBySlot.get(slotIdx) ?? null;
      items.push({
        spool_id: spoolId,
        slot_index: slotIdx,
        grams: finalGrams,
        consumption_quality: quality,
        orphan_slot: !spoolId,
      });

      if (!spoolId) {
        console.warn(`⚠️ Slot ${slotIdx} usado no job mas sem spool_id em ams_slots -- log órfão, sem desconto (${finalGrams}g não debitados de ninguém).`);
      }
    }

    // Chamada única e atômica: idempotência, checagem de dono, desconto de
    // cada spool e inserção de todas as linhas de log -- tudo ou nada.
    // Substitui o UPDATE direto + insert separado que existia antes.
    const { data: logRows, error } = await supabase.rpc("finalize_print_job", {
      p_job_id: jobId,
      p_printer_id: printerId,
      p_subtask_name: subtaskName,
      p_print_duration_minutes: durationMinutes,
      p_status: finishStatus,
      p_items: items,
    });

    if (error) throw error;

    const totalDeducted = items.reduce((acc, it) => acc + (it.spool_id ? it.grams : 0), 0);
    console.log(`📝 Job ${jobId} finalizado (${finishStatus}) -- ${logRows?.length ?? items.length} linha(s) de log, ${totalDeducted}g debitados no total.`);
  } catch (e: any) {
    console.error("❌ Falha ao finalizar trabalho:", e.message);
  }
}

async function updateStatus(printerId: string, isOnline: boolean) {
  await supabase.from("printers").update({ is_online: isOnline }).eq("id", printerId);
}

startAgent();




