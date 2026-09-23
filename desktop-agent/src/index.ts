import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import mqtt from "mqtt";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { fetchAndParseSliceInfo, FilamentSliceInfo } from "./ftpsParser";
import { computeConsumptionPerSlot, buildJobConsumptionItems, detectPhysicalIdentityMismatches } from "./consumption";
import { decideRediscovery } from "./networkRediscovery";
import { discoverPrinterIp } from "./printerDiscovery";
import type { JobConsumptionItem, SpoolPhysicalInfo } from "./consumption";
import { resolveAgentRuntimeConfig, persistSessionSecrets } from "./config/onboarding";
import { createCliPrompts, closeCliPrompts } from "./config/onboardingCli";
import { createGuiPrompts, resetGuiPrompts } from "./config/onboardingGui";
import { syncBambuStudioFilamentProfiles } from "./filamentProfileSync";
import { syncBambuCloudSpools } from "./bambuCloudSpoolSync";
import { resolveSecretStore, SecretStore } from "./config/secretStore";

dotenv.config();

// Preenchidas por bootstrapRuntimeConfig() antes do resto do Agent rodar.
// Se as 5 variáveis de sempre estiverem no .env, o valor é exatamente o
// mesmo que já existia (nenhum onboarding roda). Caso contrário, vêm de
// config.json + SecretStore + assistente interativo -- ver
// src/config/onboarding.ts e docs/11_AGENT_ONBOARDING_V2.md.
let SUPABASE_URL = "";
let SUPABASE_ANON_KEY = "";
let AGENT_EMAIL = "";
let PRINTER_IP = "";
let PRINTER_SERIAL = "";
let PRINTER_ACCESS_CODE = "";
let supabase: SupabaseClient;
let activeSecretStore: SecretStore;

async function bootstrapRuntimeConfig() {
  activeSecretStore = resolveSecretStore();

  const useGui = process.platform === "win32";
  const prompts = useGui
    ? createGuiPrompts()
    : createCliPrompts();

  let resolved;
  try {
    resolved = await resolveAgentRuntimeConfig(activeSecretStore, prompts);
  } finally {
    if (useGui) {
      resetGuiPrompts();
    } else {
      closeCliPrompts();
    }
  }

  SUPABASE_URL = resolved.supabaseUrl;
  SUPABASE_ANON_KEY = resolved.supabaseAnonKey;
  AGENT_EMAIL = resolved.agentEmail;
  PRINTER_IP = resolved.printerIp;
  PRINTER_SERIAL = resolved.printerSerial;
  PRINTER_ACCESS_CODE = resolved.printerAccessCode;

  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: true },
  });

  return resolved.auth;
}

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

function extractGramsFromName(taskName: string): number | null {
  const match = taskName.match(/_(\d+(?:\.\d+)?)g/i) || taskName.match(/(\d+(?:\.\d+)?)g\b/i);
  if (match && match[1]) {
    return parseFloat(match[1]);
  }
  return null;
}

async function startAgent() {
  console.log("🧵 Iniciando Desktop Agent Filamap (com leitura de dados do fatiador)...");

  let auth = await bootstrapRuntimeConfig();

  let authData:
    | {
        session: {
          refresh_token: string;
          user: { id: string };
        } | null;
      }
    | undefined;
  let authError;

  for (let authAttempt = 0; authAttempt < 2; authAttempt++) {
    if (auth.type === "refresh_token") {
      const result = await supabase.auth.refreshSession({ refresh_token: auth.refreshToken });
      authData = result.data;
      authError = result.error;

      if (authError || !authData.session) {
        if (authAttempt === 0) {
          console.warn("⚠️ Sessão salva expirou ou foi revogada. Abrindo o login novamente.");

          // Remove somente o refresh token inválido e preserva o Access Code da Bambu.
  await persistSessionSecrets(activeSecretStore, null, PRINTER_ACCESS_CODE);

          // O segundo bootstrap abre novamente o login na mesma execução.
          auth = await bootstrapRuntimeConfig();
          continue;
        }
      }
    } else {
      const result = await supabase.auth.signInWithPassword({
        email: AGENT_EMAIL,
        password: auth.password,
      });
      authData = result.data;
      authError = result.error;
    }

    break;
  }

  const authenticatedSession = authData?.session;
  if (authError || !authenticatedSession) {
    console.error("❌ Falha no login do agente:", authError?.message || "sessão não iniciada");
    process.exit(1);
  }

  const authenticatedUserId = authenticatedSession.user.id;

  await persistSessionSecrets(
    activeSecretStore,
    authenticatedSession.refresh_token ?? null,
    PRINTER_ACCESS_CODE
  );

  // Sincroniza os presets pessoais do Bambu Studio mesmo quando
  // a impressora estiver desligada. filament_id é a identidade estável.
  let filamentSyncInProgress = false;

  async function syncFilamentProfiles() {
    if (filamentSyncInProgress) return;

    filamentSyncInProgress = true;

    try {
      const count = await syncBambuStudioFilamentProfiles(
        supabase,
        authenticatedUserId
      );

      console.log(
        `🧵 Perfis de filamento sincronizados do Bambu Studio: ${count}`
      );
    } catch (error: any) {
      console.warn(
        "⚠️ Falha ao sincronizar perfis do Bambu Studio:",
        error?.message || error
      );
    } finally {
      filamentSyncInProgress = false;
    }
  }

  await syncFilamentProfiles();

  setInterval(() => {
    void syncFilamentProfiles();
  }, 60000);

  // Cloud Spool Sync: liga os spools físicos da conta Bambu (bridge C++)
  // aos carretéis do Filamap. Roda em paralelo ao resto do Agent -- bridge
  // indisponível/crash/timeout só loga e segue, nunca mata o Agent (a
  // bridge já teve histórico de crash na saída, corrigido no commit
  // 5bf1220, e o Agent não pode depender dela pra continuar funcionando).
  let bambuCloudSyncInProgress = false;

  async function syncBambuCloud() {
    if (bambuCloudSyncInProgress) return;

    bambuCloudSyncInProgress = true;

    try {
      const result = await syncBambuCloudSpools(supabase, authenticatedUserId);

      console.log(
        `🧵 Cloud Spool Sync: ${result.spoolsInserted} novo(s), ${result.spoolsUpdated} atualizado(s), ` +
          `${result.profilesUpserted} perfil(is), ${result.skippedRecords} registro(s) ignorado(s) de ${result.totalRecords}.`
      );
    } catch (error: any) {
      console.warn(
        "⚠️ Falha ao sincronizar spools da conta Bambu:",
        error?.message || error
      );
    } finally {
      bambuCloudSyncInProgress = false;
    }
  }

  await syncBambuCloud();

  setInterval(() => {
    void syncBambuCloud();
  }, 300000);

  while (!PRINTER_IP) {
    PRINTER_IP = await discoverPrinterIp(PRINTER_SERIAL);

    if (!PRINTER_IP) {
      console.warn("⚠️ Impressora ainda não encontrada. Nova tentativa em 15 segundos...");
      await new Promise((resolve) => setTimeout(resolve, 15000));
    }
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
      const initialDecision = decideRediscovery({
        rediscoveryInProgress,
        clientConnected: client.connected,
        previousIp: PRINTER_IP,
        discoveredIp: "",
      });

      if (
        initialDecision.action === "skip_in_progress" ||
        initialDecision.action === "skip_connected"
      ) {
        return;
      }

      rediscoveryInProgress = true;
      const previousIp = PRINTER_IP;

      try {
        console.warn("🔍 Conexão MQTT perdida. Procurando a impressora novamente na rede...");

        while (!client.connected) {
          // Força nova descoberta em vez de reutilizar o IP conhecido.
          PRINTER_IP = "";

          const newIp = await discoverPrinterIp(PRINTER_SERIAL);

          const decision = decideRediscovery({
            rediscoveryInProgress: false,
            clientConnected: client.connected,
            previousIp,
            discoveredIp: newIp,
          });

          if (decision.action === "skip_connected") {
            PRINTER_IP = previousIp;
            return;
          }

          if (
            decision.action === "reconnect_same_ip" ||
            decision.action === "reconnect_new_ip"
          ) {
            PRINTER_IP = decision.targetIp;

            client.options.host = decision.targetIp;
            client.options.hostname = decision.targetIp;

            if (decision.action === "reconnect_same_ip") {
              console.log(`✅ Impressora reencontrada no mesmo IP: ${decision.targetIp}`);
            } else {
              console.log(
                `✅ Impressora reencontrada. IP atualizado: ${previousIp} -> ${decision.targetIp}`
              );
            }

            if (!client.reconnecting) {
              client.reconnect();
            }

            return;
          }

          PRINTER_IP = previousIp;
          console.warn("⚠️ Impressora ainda não encontrada. Nova tentativa em 15 segundos...");
          await new Promise((resolve) => setTimeout(resolve, 15000));
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

        if (currentState === "FINISH" && lastGcodeState !== "FINISH" && currentJob) {
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

    // Join com spools: além do spool_id vinculado por NFC (fonte da
    // verdade da associação slot -> spool físico), traz o snapshot mais
    // recente da localização reportada pela própria Bambu Cloud
    // (bambu_dev_id/bambu_slot_id/bambu_in_printer, ver bambuCloudSpoolSync.ts)
    // e weight_confirmed_at, usados abaixo só para cross-check/log -- nunca
    // para decidir o spool_id enviado à RPC.
    const { data: slotRows } = await supabase
      .from("ams_slots")
      .select("slot_index, spool_id, spool:spools(weight_confirmed_at, bambu_spool_id, bambu_dev_id, bambu_in_printer, bambu_slot_id)")
      .eq("printer_id", printerId)
      .in("slot_index", Array.from(perSlot.keys()));

    const spoolBySlot = new Map<number, string | null>();
    const weightConfirmedBySlot = new Map<number, boolean>();
    const physicalInfoBySlot = new Map<number, SpoolPhysicalInfo | null>();

    for (const r of (slotRows || []) as any[]) {
      spoolBySlot.set(r.slot_index, r.spool_id);
      const spool = Array.isArray(r.spool) ? r.spool[0] : r.spool;
      weightConfirmedBySlot.set(r.slot_index, Boolean(spool?.weight_confirmed_at));
      physicalInfoBySlot.set(
        r.slot_index,
        spool
          ? {
              bambuSpoolId: spool.bambu_spool_id ?? null,
              bambuDevId: spool.bambu_dev_id ?? null,
              bambuInPrinter: spool.bambu_in_printer ?? null,
              bambuSlotId: spool.bambu_slot_id ?? null,
            }
          : null
      );
    }

    const items = buildJobConsumptionItems(
      perSlot,
      spoolBySlot,
      percentExecuted
    );

    for (const item of items) {
      if (item.orphan_slot) {
        console.warn(
          `⚠️ Slot ${item.slot_index} usado no job mas sem spool_id em ams_slots -- log órfão, sem desconto (${item.grams}g não debitados de ninguém).`
        );
      } else if (item.grams > 0 && !weightConfirmedBySlot.get(item.slot_index)) {
        console.warn(
          `⚖️ Slot ${item.slot_index}: consumo de ${item.grams}g será registrado, mas o carretel ainda não tem peso confirmado -- current_weight NÃO será descontado até a pesagem no Estoque.`
        );
      }
    }

    const mismatches = detectPhysicalIdentityMismatches(items, physicalInfoBySlot, PRINTER_SERIAL);
    for (const mismatch of mismatches) {
      console.warn(
        `🔀 Slot ${mismatch.slotIndex}: possível troca de carretel não atualizada via NFC -- ${mismatch.reason}.`
      );
    }

    // Chamada única e atômica: idempotência, checagem de dono, desconto de
    // cada spool (só quando o spool já tem peso confirmado -- ver migration
    // 20260923120000_finalize_print_job_weight_gate.sql) e inserção de
    // todas as linhas de log -- tudo ou nada.
    const { data: logRows, error } = await supabase.rpc("finalize_print_job", {
      p_job_id: jobId,
      p_printer_id: printerId,
      p_subtask_name: subtaskName,
      p_print_duration_minutes: durationMinutes,
      p_status: finishStatus,
      p_items: items,
    });

    if (error) throw error;

    const totalDeducted = items.reduce(
      (acc, it) => acc + (it.spool_id && weightConfirmedBySlot.get(it.slot_index) ? it.grams : 0),
      0
    );
    console.log(`📝 Job ${jobId} finalizado (${finishStatus}) -- ${logRows?.length ?? items.length} linha(s) de log, ${totalDeducted}g debitados no total.`);
  } catch (e: any) {
    console.error("❌ Falha ao finalizar trabalho:", e.message);
  }
}

async function updateStatus(printerId: string, isOnline: boolean) {
  await supabase.from("printers").update({ is_online: isOnline }).eq("id", printerId);
}

startAgent();







