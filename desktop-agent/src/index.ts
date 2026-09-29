import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import mqtt from "mqtt";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { fetchAndParseSliceInfo, FilamentSliceInfo } from "./ftpsParser";
import { JobStateMachine, ActiveJobState, parseAmsMapping } from "./jobStateMachine";
import {
  computeConsumptionPerSlot,
  buildJobConsumptionItems,
  detectPhysicalIdentityMismatches,
  resolvePhysicalSpoolsForJob,
  groupBambuCandidatesBySlot,
  computeAmsSlotSelfHeals,
} from "./consumption";
import { decideRediscovery } from "./networkRediscovery";
import { discoverPrinterIp } from "./printerDiscovery";
import { printerModelFromSerial } from "./printerModel";
import type { JobConsumptionItem, SpoolPhysicalInfo, BambuSyncedSpoolRow, AmsSlotPhysicalCandidate } from "./consumption";
import { getConfigDir } from "./config/configStore";
import { resolveAgentRuntimeConfig, persistSessionSecrets } from "./config/onboarding";
import { mergeNonSecretConfig } from "./config/configStore";
import { pairAgentDevice, PairingError } from "./config/devicePairing";
import { authenticateAgentSession } from "./config/sessionManager";
import { createCliPrompts, closeCliPrompts } from "./config/onboardingCli";
import { createGuiPrompts, resetGuiPrompts, SetupCancelledError, wasSetupShownThisRun } from "./config/onboardingGui";
import { showDesktopNotice } from "./config/desktopNotice";
import { isAccessCodeRejected } from "./mqttAuth";
import { syncBambuStudioFilamentProfiles } from "./filamentProfileSync";
import { syncBambuCloudSpools } from "./bambuCloudSpoolSync";
import { syncAmsProjection, isMissingArchivedColumn } from "./amsProjection";
import { resolveSecretStore, SecretStore } from "./config/secretStore";
import { SessionSupervisor } from "./sessionSupervisor";
import { FinalizeOutbox } from "./finalizeOutbox";
import { buildTelemetryUpdate, initialGcodeStateFor, isPrinterReportTopic } from "./runtimeState";
import { loadNonSecretConfig } from "./config/configStore";
import { createSanitizer } from "./observability/sanitize";
import { OpsEmitter, EmitFields } from "./observability/emitter";
import type { EventType } from "./observability/eventCatalog";
import { loadOrCreateInstallationId, machineHint, markRunStart, markRunStopped } from "./observability/installationId";
import { AGENT_VERSION } from "./observability/version";

dotenv.config();

// agent.log não tinha horário em nenhuma linha -- impossível correlacionar
// com last_seen_at do banco numa investigação (incidente 2026-09-27).
for (const level of ["log", "warn", "error"] as const) {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]) => original(`[${new Date().toISOString()}]`, ...args);
}

// Rejeição não tratada em integração (MQTT/FTPS/Supabase/bridge) não pode
// derrubar o Agent inteiro: registra com stack e segue. Exceção síncrona
// não capturada continua encerrando o processo (estado pode estar
// corrompido) -- o Task Scheduler relança via run-agent.vbs.
process.on("unhandledRejection", (reason: any) => {
  // Janela de configuração fechada pela pessoa: não é falha. Encerra limpo (volta pelo atalho).
  if (reason instanceof SetupCancelledError) {
    console.log(`ℹ️ ${reason.message} Encerrando; o atalho "Filamap" abre a configuração de novo.`);
    process.exit(0);
  }
  console.error("❌ Promise rejeitada sem tratamento (Agent segue rodando):", reason?.stack || reason);
  opsEmit("UNHANDLED_REJECTION", { error: reason });
});

// Central de Observabilidade (docs/PACOTE_CONSTRUCAO_OBSERVABILIDADE_FILAMAP_V1.md).
// Só observa: nenhum evento decide estoque, identidade, peso ou finalize, e
// opsEmit() nunca lança nem espera rede. null até a sessão existir.
const opsSanitizer = createSanitizer();
let ops: OpsEmitter | null = null;
function opsEmit(type: EventType, fields?: EmitFields) {
  try {
    ops?.emit(type, fields);
  } catch {}
}
let setupSuccessShown = false;
const opsState = {
  mqtt: "unknown" as "unknown" | "connected" | "disconnected",
  mqttDownSince: 0,
  bambuSync: "unknown" as "unknown" | "ok" | "failing",
  profileSync: "unknown" as "unknown" | "ok" | "failing",
  lastBambuSyncAt: null as string | null,
  lastProfileSyncAt: null as string | null,
  lastInboxCount: -1,
  printerId: null as string | null,
  activeJob: false,
};

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
let lastMqttPrintPayload: any = null;

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
  opsSanitizer.registerSecret(PRINTER_ACCESS_CODE);
  opsSanitizer.registerSecret(SUPABASE_ANON_KEY);

  if (!supabase) {
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: true },
    });
  }

  return resolved.auth;
}

function getJobStateFilePath(): string {
  try {
    const configDir = getConfigDir();
    if (fs.existsSync(configDir)) {
      return path.join(configDir, "agent-state.json");
    }
  } catch {}
  return path.join(process.cwd(), "agent-state.json");
}

const STATE_FILE = getJobStateFilePath();

function loadJobState(): ActiveJobState | null {
  try {
    let candidatePath = STATE_FILE;
    if (!fs.existsSync(candidatePath)) {
      candidatePath = path.join(process.cwd(), "agent-state.json");
    }
    if (fs.existsSync(candidatePath)) {
      const content = fs.readFileSync(candidatePath, "utf-8");
      const parsed = JSON.parse(content);
      if (
        parsed &&
        typeof parsed.jobId === "string" &&
        parsed.jobId.trim() &&
        typeof parsed.subtaskName === "string" &&
        typeof parsed.startTime === "number"
      ) {
        return parsed as ActiveJobState;
      } else {
        console.warn("⚠️ agent-state.json inválido ou incompleto. Descartando resíduo obsoleto.");
        try { fs.unlinkSync(candidatePath); } catch {}
      }
    }
  } catch (e) {
    console.error("⚠️ Erro ao carregar agent-state.json:", e);
  }
  return null;
}

function saveJobState(state: ActiveJobState | null) {
  try {
    if (state === null) {
      if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
      const cwdFile = path.join(process.cwd(), "agent-state.json");
      if (fs.existsSync(cwdFile)) fs.unlinkSync(cwdFile);
    } else {
      const dir = path.dirname(STATE_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const tmpFile = path.join(dir, `agent-state.${randomUUID()}.tmp`);
      fs.writeFileSync(tmpFile, JSON.stringify(state, null, 2), "utf-8");
      fs.renameSync(tmpFile, STATE_FILE);
    }
  } catch (e) {
    console.error("⚠️ Erro ao salvar agent-state.json de forma atômica:", e);
  }
}


function pairWithServer(code: string) {
  return pairAgentDevice({
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY,
    code,
    agentVersion: AGENT_VERSION,
  });
}

async function startAgent() {
  console.log("🧵 Iniciando Desktop Agent Filamap (com leitura de dados do fatiador)...");

  let auth;
  try {
    auth = await bootstrapRuntimeConfig();
  } catch (error: any) {
    if (error instanceof SetupCancelledError) {
      console.log(`ℹ️ ${error.message} Encerrando; o atalho "Filamap" abre a configuração de novo.`);
      process.exit(0);
    }
    throw error;
  }

  let authResult;
  try {
    authResult = await authenticateAgentSession({
      supabase,
      auth,
      agentEmail: AGENT_EMAIL,
      getAgentEmail: () => AGENT_EMAIL,
      printerAccessCode: PRINTER_ACCESS_CODE,
      getPrinterAccessCode: () => PRINTER_ACCESS_CODE,
      secretStore: activeSecretStore,
      promptLogin: async (reason?: string) => {
        if (reason) {
          await showDesktopNotice("Filamap Agent", [
            "O código de pareamento não foi aceito.",
            reason,
            "",
            "Gere um código novo no site do Filamap (Computadores > Conectar computador) e digite na próxima janela.",
          ], "warning");
        }
        return bootstrapRuntimeConfig();
      },
      pairDevice: (code) => pairWithServer(code),
    });
  } catch (error: any) {
    if (error instanceof SetupCancelledError) {
      console.log(`ℹ️ ${error.message} Encerrando; o atalho "Filamap" abre a configuração de novo.`);
      process.exit(0);
    }
    console.error("❌ Falha na autenticação do agente:", error?.message || error);
    process.exit(1);
  }

  opsSanitizer.registerSecret(authResult?.session?.access_token);
  opsSanitizer.registerSecret(authResult?.session?.refresh_token);
  if (authResult?.session?.access_token && authResult?.session?.refresh_token) {
    await supabase.auth.setSession({
      access_token: authResult.session.access_token,
      refresh_token: authResult.session.refresh_token,
    });
  }

  const authenticatedUserId = authResult.userId;

  // No pareamento o usuário não digita e-mail: guarda o que o servidor
  // devolveu (só para logs/diagnóstico; nada de senha).
  if (authResult.email && authResult.email !== AGENT_EMAIL) {
    AGENT_EMAIL = authResult.email;
    try {
      mergeNonSecretConfig({ agentEmail: AGENT_EMAIL });
    } catch {}
  }

  const sessionSupervisor = new SessionSupervisor({
    auth: supabase.auth,
    expectedUserId: authenticatedUserId,
    initialSession: authResult.session ?? null,
    persistRefreshToken: (refreshToken) => {
      opsSanitizer.registerSecret(refreshToken);
      return persistSessionSecrets(activeSecretStore, refreshToken, PRINTER_ACCESS_CODE);
    },
    // Computador desconectado na Web (ou sessão perdida de vez): pede um
    // novo código de pareamento. Nunca pede a senha da conta.
    reauthenticate: async () => {
      let code: string;
      if (process.platform === "win32") {
        resetGuiPrompts();
        code = await createGuiPrompts().askPairingCode();
      } else {
        try {
          code = await createCliPrompts().askPairingCode();
        } finally {
          closeCliPrompts();
        }
      }
      try {
        const paired = await pairWithServer(code);
        const { data, error } = await supabase.auth.setSession({
          access_token: paired.accessToken,
          refresh_token: paired.refreshToken,
        });
        return { session: data.session, error };
      } catch (e: any) {
        if (e instanceof PairingError && e.kind === "network") {
          return { session: null, error: { name: "NetworkError", message: e.message } };
        }
        return { session: null, error: e };
      }
    },
    onRecovered: () => {
      opsEmit("SESSION_RECOVERED");
      void finalizeOutbox.flush();
    },
    onLost: (reason) => opsEmit("SESSION_LOST", { message: reason }),
  });
  sessionSupervisor.start();

  // Jobs terminados ficam aqui até o RPC confirmar (ver finalizeOutbox.ts).
  // Só envia com sessão do próprio usuário: sem ela o supabase-js usaria a
  // anon key e as leituras do finalize voltariam vazias.
  const finalizeOutbox = new FinalizeOutbox({
    filePath: path.join(path.dirname(STATE_FILE), "agent-pending-finalize.json"),
    canExecute: async () => {
      if (!sessionSupervisor.isHealthy()) return false;
      const { data } = await supabase.auth.getSession();
      return data.session?.user?.id === authenticatedUserId;
    },
    execute: (p) =>
      finalizeJob(p.printerId, p.printSnapshot, p.percentExecuted, p.finishStatus, p.job, p.mqttTrays),
    onRetry: (p) =>
      opsEmit("FINALIZE_RETRY", { message: p.lastError, job_id: p.jobId, printer_id: p.printerId, metadata: { job: p.jobId, attempts: p.attempts, enqueued_at: p.enqueuedAt } }),
  });

  startObservability(sessionSupervisor, finalizeOutbox);
  if (finalizeOutbox.size() > 0) {
    console.log(`📮 ${finalizeOutbox.size()} finalização(ões) pendente(s) de execução anterior -- reenviando.`);
  }
  void finalizeOutbox.flush();
  setInterval(() => void finalizeOutbox.flush(), 60000);

  // Presença deste computador em "Computadores conectados" (Web). Sessões
  // antigas por senha não têm dispositivo: a RPC devolve false e nada muda.
  let deviceTouchWarned = false;
  async function touchAgentDevice() {
    if (!sessionSupervisor.isHealthy()) return;
    const { error } = await supabase.rpc("touch_agent_device", { p_agent_version: AGENT_VERSION });
    if (error && !deviceTouchWarned) {
      deviceTouchWarned = true;
      console.warn("⚠️ Não foi possível registrar presença do computador:", error.message);
    }
  }
  void touchAgentDevice();
  setInterval(() => void touchAgentDevice(), 60000);

  // Sincroniza os presets pessoais do Bambu Studio mesmo quando
  // a impressora estiver desligada. filament_id é a identidade estável.
  let filamentSyncInProgress = false;
  let lastProfileCount = -1;

  async function syncFilamentProfiles() {
    if (filamentSyncInProgress) return;

    filamentSyncInProgress = true;

    try {
      const count = await syncBambuStudioFilamentProfiles(
        supabase,
        authenticatedUserId
      );

      // Só loga quando muda (antes: ~1.000 linhas/dia repetindo o mesmo número).
      if (count !== lastProfileCount) {
        console.log(
          `🧵 Perfis de filamento sincronizados do Bambu Studio: ${count}`
        );
        lastProfileCount = count;
      }
      opsState.lastProfileSyncAt = new Date().toISOString();
      if (opsState.profileSync === "failing") opsEmit("PROFILE_SYNC_RECOVERED");
      opsState.profileSync = "ok";
    } catch (error: any) {
      console.warn(
        "⚠️ Falha ao sincronizar perfis do Bambu Studio:",
        error?.message || error
      );
      if (opsState.profileSync !== "failing") opsEmit("PROFILE_SYNC_FAILED", { error });
      opsState.profileSync = "failing";
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
  let activePrinterRecord: any = null;
  lastMqttPrintPayload = null;
  let lastAmsFingerprint = "";
  let bambuCloudSyncInProgress = false;

  async function syncBambuCloud() {
    if (bambuCloudSyncInProgress) return;

    bambuCloudSyncInProgress = true;

    try {
      const result = await syncBambuCloudSpools(supabase, authenticatedUserId);

      console.log(
        `🧵 Cloud Spool Sync: ${result.spoolsUpdated} atualizado(s), ${result.inboxQueued} na caixa de entrada, ` +
          `${result.profilesUpserted} perfil(is), ${result.skippedRecords} registro(s) ignorado(s) de ${result.totalRecords}.`
      );
      opsState.lastBambuSyncAt = new Date().toISOString();
      if (opsState.bambuSync === "failing") opsEmit("BAMBU_SYNC_RECOVERED");
      opsState.bambuSync = "ok";
      if (result.inboxQueued !== opsState.lastInboxCount) {
        if (result.inboxQueued > 0) opsEmit("INBOX_ITEM_CREATED", { metadata: { inbox_queued: result.inboxQueued } });
        opsState.lastInboxCount = result.inboxQueued;
      }

      if (lastMqttPrintPayload && activePrinterRecord) {
        try {
          const proj = await syncAmsProjection(
            supabase,
            activePrinterRecord.id,
            PRINTER_SERIAL,
            lastMqttPrintPayload
          );
          if (proj.slotsUpdated > 0 || proj.spoolsUpdated > 0) {
            console.log(
              `🔧 Projeção AMS pós-Cloud Sync: ${proj.slotsUpdated} slot(s) e ${proj.spoolsUpdated} carretel(is) reconciliados.`
            );
          }
        } catch (projErr: any) {
          console.warn("⚠️ Falha na projeção AMS pós-Cloud Sync:", projErr?.message || projErr);
          opsEmit("AGENT_ERROR", { component: "ams_projection", error: projErr });
        }
      }
    } catch (error: any) {
      console.warn(
        "⚠️ Falha ao sincronizar spools da conta Bambu:",
        error?.message || error
      );
      if (opsState.bambuSync !== "failing") opsEmit("BAMBU_SYNC_FAILED", { error });
      opsState.bambuSync = "failing";
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
      if (ops?.changed("printer", "offline")) opsEmit("PRINTER_OFFLINE", { message: "impressora não encontrada na rede no início" });
      await new Promise((resolve) => setTimeout(resolve, 15000));
    }
  }
  if (ops?.changed("printer", "online")) opsEmit("PRINTER_ONLINE");

  try {
    const { data: existingPrinters } = await supabase
      .from("printers")
      .select("*")
      .eq("serial", PRINTER_SERIAL);

    let printer = existingPrinters?.[0];
    const detectedModel = printerModelFromSerial(PRINTER_SERIAL);

    if (!printer) {
      const { data: inserted, error: insertError } = await supabase
        .from("printers")
        .insert({
          user_id: authenticatedUserId,
          serial: PRINTER_SERIAL,
          model: detectedModel ?? "Bambu Lab",
          ip_address: PRINTER_IP,
          is_online: true,
        })
        .select()
        .single();
      if (insertError) throw insertError;
      printer = inserted;
    } else {
      const patch: Record<string, unknown> = { ip_address: PRINTER_IP, is_online: true };
      if (detectedModel && printer.model !== detectedModel) patch.model = detectedModel;
      await supabase.from("printers").update(patch).eq("id", printer.id);
    }

    activePrinterRecord = printer;
    opsState.printerId = printer.id;

    // Heartbeat a cada 15s — grava last_seen_at independente do estado da
    // conexão MQTT com a impressora, é o sinal de "o processo do Agent
    // ainda está rodando" que o frontend usa pra decidir online/offline.
    // O resultado é conferido: sem sessão o supabase-js cai na anon key e o
    // UPDATE afeta 0 linhas sem erro nenhum -- foi exatamente assim que o
    // Agent ficou "offline" com o processo vivo no incidente 2026-09-27.
    const updateFailures: Record<string, number> = {};
    // UPDATE em printers conferido (usado por heartbeat e telemetria).
    async function updatePrinterConfirmed(label: string, fields: Record<string, unknown>) {
      let failure: string | null = null;
      try {
        const { data, error } = await supabase.from("printers").update(fields).eq("id", printer.id).select("id");
        if (error) failure = error.message;
        else if (!data || data.length === 0) failure = "UPDATE sem efeito (0 linhas -- sessão ausente/RLS)";
      } catch (e: any) {
        failure = e?.message || String(e);
      }

      const previous = updateFailures[label] ?? 0;
      if (failure) {
        updateFailures[label] = previous + 1;
        // 1ª falha e depois a cada 20, para não inundar o log.
        if (previous === 0 || (previous + 1) % 20 === 0) {
          console.warn(`💔 ${label} falhou (${previous + 1}x seguidas): ${failure}`);
        }
        if (previous === 0) opsEmit("TELEMETRY_DEGRADED", { message: failure, metadata: { channel: label } });
        sessionSupervisor.reportSessionLost(`${label}: ${failure}`);
      } else if (previous > 0) {
        console.log(`💚 ${label} restabelecido após ${previous} falha(s).`);
        opsEmit("TELEMETRY_RESTORED", { metadata: { channel: label, failures: previous } });
        updateFailures[label] = 0;
      }
    }

    setInterval(() => {
      const nowIso = new Date().toISOString();
      void updatePrinterConfirmed("Heartbeat", { is_online: true, updated_at: nowIso, last_seen_at: nowIso });
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
      opsEmit("AGENT_STOPPED");
      try {
        await ops?.shutdown(3000);
        if (ops) markRunStopped(getConfigDir(), ops.bootId);
      } catch {}
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

    const restoredJob = loadJobState();
    const jobStateMachine = new JobStateMachine({
      initialJob: restoredJob,
      initialGcodeState: initialGcodeStateFor(restoredJob),
    });
    let lastGcodeState = initialGcodeStateFor(restoredJob);
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

            if (ops?.changed("printer", "online")) opsEmit("PRINTER_ONLINE", { metadata: { ip_changed: decision.action === "reconnect_new_ip" } });
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
          if (ops?.changed("printer", "offline")) opsEmit("PRINTER_OFFLINE");
          await new Promise((resolve) => setTimeout(resolve, 15000));
        }
      } catch (error: any) {
        PRINTER_IP = previousIp;
        console.error(
          "❌ Falha durante a redescoberta da impressora:",
          error?.message ?? error
        );
        opsEmit("AGENT_ERROR", { component: "discovery", error });
      } finally {
        rediscoveryInProgress = false;
      }
    }
    client.on("connect", () => {
      console.log(`✅ Conectado ao broker MQTT da Bambu Lab ${printerModelFromSerial(PRINTER_SERIAL) ?? ""} em ${PRINTER_IP}!`.replace("  ", " "));
      // Primeira configuração (ou novo Access Code/código): confirma para a pessoa que deu certo.
      if (wasSetupShownThisRun() && !setupSuccessShown) {
        setupSuccessShown = true;
        void showDesktopNotice("Filamap Agent", [
          `Pronto! Este computador está conectado ao Filamap e à impressora ${printerModelFromSerial(PRINTER_SERIAL) ?? "Bambu Lab"}.`,
          "",
          "O Filamap Agent continua funcionando escondido e liga sozinho com o Windows.",
          "Pode fechar este aviso e voltar ao site do Filamap.",
        ]);
      }
      updateStatus(printer.id, true);
      if (ops?.changed("mqtt", "connected")) opsEmit("MQTT_CONNECTED");
      opsState.mqtt = "connected";

      client.subscribe(`device/${PRINTER_SERIAL}/report`, () => requestStatusPush());

      if (!statusPushInterval) {
        statusPushInterval = setInterval(() => {
          if (client.connected) requestStatusPush();
        }, 10000);
      }
    });

    // mqtt.js emite 'error' em keepalive timeout e em erros de stream
    // (ECONNRESET/EHOSTUNREACH -- impressora desligada no meio da conexão).
    // Sem listener, o EventEmitter lança e derruba o processo inteiro. A
    // recuperação em si continua sendo feita pelo handler de 'close'.
    client.on("error", (err: any) => {
      console.warn(`⚠️ Erro na conexão MQTT: ${err?.code || ""} ${err?.message || err}`.trim());
      opsEmit("MQTT_ERROR", { error: err });
      if (isAccessCodeRejected(err)) void handleAccessCodeRejected();
    });

    // A impressora recusou o Access Code (digitado errado, ou trocado na impressora).
    // Sem impressão em andamento: apaga o Access Code salvo, avisa e encerra limpo;
    // o atalho "Filamap" abre a janela pedindo só o Access Code. Com impressão em
    // andamento: não mexe em nada (só registra) para não arriscar o desconto.
    let accessCodeHandling = false;
    async function handleAccessCodeRejected() {
      if (accessCodeHandling) return;
      accessCodeHandling = true;
      if (loadJobState()) {
        console.warn("⚠️ Access Code recusado pela impressora durante uma impressão; nada foi alterado.");
        accessCodeHandling = false;
        return;
      }
      console.warn("⚠️ A impressora recusou o Access Code. Pedindo de novo.");
      try {
        const current = await activeSecretStore.load();
        await activeSecretStore.save({ ...current, printerAccessCode: null });
      } catch (e: any) {
        console.error("❌ Não foi possível limpar o Access Code salvo:", e?.message || e);
      }
      await showDesktopNotice("Filamap Agent", [
        "A impressora não aceitou o Access Code.",
        "",
        "Confira o código na tela da impressora (configurações de rede, WLAN/LAN) e abra o atalho \"Filamap\" na Área de Trabalho para digitar de novo.",
      ], "warning");
      process.exit(0);
    }

    client.on("close", () => {
      console.log("🔌 Conexão MQTT fechada.");
      updateStatus(printer.id, false);
      if (ops?.changed("mqtt", "disconnected")) opsEmit("MQTT_DISCONNECTED");
      if (opsState.mqtt !== "disconnected") opsState.mqttDownSince = Date.now();
      opsState.mqtt = "disconnected";

      void rediscoverPrinter();
    });

    client.on("message", async (topic, payload) => {
      try {
        const raw = JSON.parse(payload.toString());

        // Captura ams_mapping enviado via comando (request ou report)
        const possibleMapping =
          raw.print?.ams_mapping ??
          raw.ams_mapping ??
          raw.request?.print?.ams_mapping ??
          raw.request?.ams_mapping;

        if (possibleMapping !== undefined) {
          const mapping = parseAmsMapping(possibleMapping);
          if (mapping && mapping.length > 0) {
            console.log(`🗺️ ams_mapping detectado via MQTT: [${mapping.join(", ")}]`);
            jobStateMachine.attachAmsMapping(mapping);
            const curJob = jobStateMachine.getCurrentJob();
            if (curJob) {
              saveJobState(curJob);
            }
          }
        }

        const print = raw.print;
        if (!print) return;

        if (print.ams) {
          lastMqttPrintPayload = print;
          const amsFingerprint = JSON.stringify({
            exist: print.ams.tray_exist_bits,
            tray: print.ams.ams?.[0]?.tray?.map((t: any) => ({
              id: t.id,
              type: t.tray_type,
              col: t.tray_color,
            })),
          });
          if (amsFingerprint !== lastAmsFingerprint) {
            lastAmsFingerprint = amsFingerprint;
            try {
              const proj = await syncAmsProjection(
                supabase,
                printer.id,
                PRINTER_SERIAL,
                print
              );
              if (proj.slotsUpdated > 0 || proj.spoolsUpdated > 0) {
                console.log(
                  `🔧 Projeção AMS atualizada via MQTT: ${proj.slotsUpdated} slot(s) e ${proj.spoolsUpdated} carretel(is) reconciliados com o hardware.`
                );
              }
            } catch (projErr: any) {
              console.warn("⚠️ Falha na projeção AMS via MQTT:", projErr?.message || projErr);
              opsEmit("AGENT_ERROR", { component: "ams_projection", error: projErr });
            }
          }
        }

        const actions = jobStateMachine.processPrintPayload(print);

        for (const action of actions) {
          if (action.type === "create_job") {
            saveJobState(action.job);
            console.log(`🧵 Novo trabalho de impressão detectado: "${action.job.subtaskName}" (JobId: ${action.job.jobId})`);
            opsState.activeJob = true;
            // JOB_DETECTED sai depois da leitura do fatiador (FTPS), para levar os gramas reais.
            let detectedGrams = action.job.filamentGrams;
            if (action.job.filamentGrams > 0) {
              console.log(`🎯 Peso detectado automaticamente do fatiador/arquivo: ${action.job.filamentGrams}g`);
            }

            // Busca metadados via FTPS exatamente 1 vez por job
            try {
              console.log(`📡 Solicitando arquivo de fatiador via FTPS no caminho: ${action.remoteFilePath}`);
              const sliceInfo = await fetchAndParseSliceInfo(PRINTER_IP, PRINTER_ACCESS_CODE, action.remoteFilePath);
              if (sliceInfo.length > 0) {
                console.log("ℹ️ Informações de slice_info.config carregadas com sucesso!");
                jobStateMachine.attachSliceInfo(sliceInfo);
                saveJobState(jobStateMachine.getCurrentJob());
                detectedGrams = Math.round(sliceInfo.reduce((sum, f) => sum + (f.totalGrams || 0), 0) * 100) / 100;
              }
            } catch (e: any) {
              console.error("❌ Erro ao carregar slice_info.config:", e.message);
              opsEmit("FTPS_FAILED", { error: e, job_id: action.job.jobId, metadata: { job: action.job.jobId } });
            }
            opsEmit("JOB_DETECTED", { job_id: action.job.jobId, metadata: { job: action.job.jobId, subtask: action.job.subtaskName, grams: detectedGrams } });
          } else if (action.type === "update_job") {
            saveJobState(action.job);
            if (action.reason === "slot_added") {
              console.log(
                `🎨 Troca de slot detectada durante o job -- slot ${action.job.activeSlot} adicionado (usados até agora: ${action.job.usedSlots.join(", ")})`
              );
            }
          } else if (action.type === "finalize_job") {
            if (action.finishStatus === "COMPLETED") {
              console.log("🎉 Impressão CONCLUÍDA!");
            } else {
              console.log(`⚠️ Impressão INTERROMPIDA/FALHA aos ${action.percentExecuted}%!`);
            }
            opsState.activeJob = false;
            opsEmit(action.finishStatus === "COMPLETED" ? "JOB_FINISHED" : "JOB_FAILED", {
              job_id: action.job.jobId,
              metadata: { job: action.job.jobId, status: action.finishStatus, percent: action.percentExecuted, slots: action.job.usedSlots },
            });
            // O job só sai de agent-state.json depois de gravado na fila;
            // a fila só o solta quando o RPC confirmar.
            const queued = finalizeOutbox.enqueue({
              jobId: action.job.jobId,
              printerId: printer.id,
              job: action.job,
              percentExecuted: action.percentExecuted,
              finishStatus: action.finishStatus,
              printSnapshot: { subtask_name: print.subtask_name, mc_cost_time: print.mc_cost_time },
              mqttTrays: currentMqttTrays(),
            });
            if (queued) {
              saveJobState(null);
              opsEmit("FINALIZE_QUEUED", { job_id: action.job.jobId, metadata: { job: action.job.jobId } });
            } else {
              console.error(`❌ Job ${action.job.jobId} não pôde ir para a fila -- mantido em agent-state.json.`);
              opsEmit("FINALIZE_FAILED", { job_id: action.job.jobId, message: "job não pôde ir para a fila persistente", metadata: { job: action.job.jobId } });
            }
            await finalizeOutbox.flush();
          } else if (action.type === "discard_job") {
            console.log("🧹 Descartando estado de job órfão/fantasma (impressora em IDLE com progresso 0%).");
            opsState.activeJob = false;
            saveJobState(null);
          }
        }

        const currentJob = jobStateMachine.getCurrentJob();
        const currentState = jobStateMachine.getLastGcodeState();
        const activeSlotIndex = jobStateMachine.getActiveSlotIndex();

        const now = Date.now();
        if (now - lastSyncTime > 2500 || (print.gcode_state && print.gcode_state !== lastGcodeState)) {
          lastSyncTime = now;
          const telemetryData = buildTelemetryUpdate({
            print,
            fromPrinterReport: isPrinterReportTopic(topic, PRINTER_SERIAL),
            currentState,
            activeSlotIndex,
            filamentSliceInfo: currentJob?.filamentSliceInfo,
            nowIso: new Date().toISOString(),
          });
          await updatePrinterConfirmed("Telemetria", telemetryData);
        }

        lastGcodeState = currentState;
      } catch (err: any) {
        console.error("Erro no processamento:", err.message);
        opsEmit("AGENT_ERROR", { component: "mqtt_handler", error: err });
      }
    });
  } catch (err: any) {
    console.error("❌ Erro de inicialização:", err.message || err);
    opsEmit("AGENT_ERROR", { component: "startup", error: err });
  }
}



async function finalizeJob(
  printerId: string,
  printData: any,
  percentExecuted: number,
  finishStatus: string,
  jobToFinalize: ActiveJobState | null,
  mqttTraysSnapshot?: any[]
) {
  try {
    const jobId = jobToFinalize?.jobId || randomUUID();
    const subtaskName = printData.subtask_name || (jobToFinalize ? jobToFinalize.subtaskName : "Trabalho 3D");
    const durationMinutes = Math.round((printData.mc_cost_time || 0) / 60);
    // Job que começou e terminou inteiro com o Agent desligado nunca tem
    // currentJob capturado -- cai no slot 0 como já acontecia antes desta
    // mudança (limitação conhecida, não nova: sem captura, não há como
    // saber que outros slots foram usados nem pegar slice_info.config).
    const usedSlots = jobToFinalize?.usedSlots?.length ? jobToFinalize.usedSlots : [jobToFinalize?.activeSlot ?? 0];

    // Prepara candidatos de slots AMS para resolução física de filamento
    // Erros nestas leituras precisam abortar: seguir com resultado vazio
    // gravaria o job como órfão (sem desconto) e a idempotência por job_id
    // impediria corrigir depois. Abortando, o job volta para a fila.
    const { data: allAmsSlots, error: allAmsSlotsError } = await supabase
      .from("ams_slots")
      .select("slot_index, spool_id, spool:spools(material, color_hex, tray_info_idx)")
      .eq("printer_id", printerId);
    if (allAmsSlotsError) throw allAmsSlotsError;

    const availableSlots: AmsSlotPhysicalCandidate[] = [];
    for (const r of (allAmsSlots || []) as any[]) {
      if (r.spool_id) {
        const spool = Array.isArray(r.spool) ? r.spool[0] : r.spool;
        availableSlots.push({
          slotIndex: r.slot_index,
          material: spool?.material ?? null,
          colorHex: spool?.color_hex ?? null,
          trayInfoIdx: spool?.tray_info_idx ?? null,
        });
      }
    }

    // Snapshot do instante do fim quando vem da fila (envio pode ser tardio).
    const mqttTrays = mqttTraysSnapshot ?? currentMqttTrays();
    for (let idx = 0; idx < mqttTrays.length; idx++) {
      const t = mqttTrays[idx];
      const sIdx = Number(t.id ?? idx);
      if (!availableSlots.some((s) => s.slotIndex === sIdx) && (t.tray_color || t.tray_type)) {
        availableSlots.push({
          slotIndex: sIdx,
          material: t.tray_type ?? null,
          colorHex: t.tray_color ?? null,
          trayInfoIdx: t.tray_info_idx ?? null,
        });
      }
    }

    const perSlot = computeConsumptionPerSlot(
      usedSlots,
      jobToFinalize?.filamentSliceInfo,
      jobToFinalize?.filamentGrams || 0,
      durationMinutes,
      jobToFinalize?.amsMapping,
      availableSlots
    );

    const usedSlotIndexes = Array.from(perSlot.keys());

    // Prioridade 2 (fallback): vínculo por toque de NFC. Join com spools só
    // para cross-check/log do que já está vinculado a cada slot -- weight_confirmed_at
    // e os campos bambu_* aqui são sobre o spool HOJE preso em ams_slots, não
    // necessariamente o que será usado (ver resolvePhysicalSpoolsForJob).
    const { data: slotRows, error: slotRowsError } = await supabase
      .from("ams_slots")
      .select("slot_index, spool_id, spool:spools(weight_confirmed_at, bambu_spool_id, bambu_dev_id, bambu_in_printer, bambu_slot_id)")
      .eq("printer_id", printerId)
      .in("slot_index", usedSlotIndexes);
    if (slotRowsError) throw slotRowsError;

    const amsSlotBySlot = new Map<number, string | null>();
    const physicalInfoBySlot = new Map<number, SpoolPhysicalInfo | null>();
    const spoolInfoById = new Map<string, { weightConfirmed: boolean }>();

    for (const r of (slotRows || []) as any[]) {
      amsSlotBySlot.set(r.slot_index, r.spool_id);
      const spool = Array.isArray(r.spool) ? r.spool[0] : r.spool;
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
      if (r.spool_id && spool) {
        spoolInfoById.set(r.spool_id, { weightConfirmed: Boolean(spool.weight_confirmed_at) });
      }
    }

    // Prioridade 1: spools do usuário que a própria Bambu Cloud reporta
    // fisicamente nesta impressora/slot agora (ver bambuCloudSpoolSync.ts).
    // Não depende de NFC ter sido tocado -- é a fonte preferencial (regra 2
    // do escopo desta fase). RLS já isola por user_id; o filtro por
    // bambu_dev_id aqui isola por impressora, repetido em JS dentro de
    // groupBambuCandidatesBySlot como segunda camada.
    // Arquivados (decisão D4) não são candidatos; banco sem archived_at -> consulta anterior.
    //    Colunas por extenso (sem template) para o R-CONTRATO validar as duas consultas.
    const onlyThisPrinterSlots = (q: any) =>
      q.eq("bambu_dev_id", PRINTER_SERIAL).eq("bambu_in_printer", true).in("bambu_slot_id", usedSlotIndexes.map(String));
    let { data: bambuCandidateRows, error: bambuCandidateError } = await onlyThisPrinterSlots(
      supabase.from("spools").select("id, bambu_dev_id, bambu_slot_id, bambu_in_printer, weight_confirmed_at, archived_at")
    );
    if (bambuCandidateError && isMissingArchivedColumn(bambuCandidateError)) {
      ({ data: bambuCandidateRows, error: bambuCandidateError } = await onlyThisPrinterSlots(
        supabase.from("spools").select("id, bambu_dev_id, bambu_slot_id, bambu_in_printer, weight_confirmed_at")
      ));
    } else if (!bambuCandidateError) {
      bambuCandidateRows = ((bambuCandidateRows || []) as any[]).filter((r) => !r.archived_at);
    }
    if (bambuCandidateError) throw bambuCandidateError;

    const bambuRows: BambuSyncedSpoolRow[] = ((bambuCandidateRows || []) as any[]).map((r) => {
      spoolInfoById.set(r.id, { weightConfirmed: Boolean(r.weight_confirmed_at) });
      return {
        id: r.id,
        bambuDevId: r.bambu_dev_id ?? null,
        bambuSlotId: r.bambu_slot_id ?? null,
        bambuInPrinter: r.bambu_in_printer ?? null,
      };
    });

    const bambuCandidatesBySlot = groupBambuCandidatesBySlot(bambuRows, PRINTER_SERIAL);

    const resolutions = resolvePhysicalSpoolsForJob(usedSlotIndexes, amsSlotBySlot, bambuCandidatesBySlot);

    const spoolBySlot = new Map<number, string | null>();
    const weightConfirmedBySlot = new Map<number, boolean>();
    for (const [slotIndex, resolution] of resolutions) {
      spoolBySlot.set(slotIndex, resolution.spoolId);
      weightConfirmedBySlot.set(
        slotIndex,
        resolution.spoolId ? Boolean(spoolInfoById.get(resolution.spoolId)?.weightConfirmed) : false
      );

      if (resolution.conflict) {
        console.warn(
          `🔀 Slot ${slotIndex}: Bambu Cloud identifica o carretel ${resolution.spoolId} fisicamente aqui, mas o vínculo NFC anterior apontava para ${resolution.amsSlotSpoolId} -- usando a identidade da Bambu Cloud (evidência inequívoca de localização) e corrigindo ams_slots.`
        );
      }
    }

    const items = buildJobConsumptionItems(
      perSlot,
      spoolBySlot,
      percentExecuted
    );

    for (const item of items) {
      if (item.orphan_slot) {
        console.warn(
          `⚠️ Slot ${item.slot_index} usado no job mas sem spool identificado (nem Bambu Cloud nem ams_slots) -- log órfão, sem desconto (${item.grams}g não debitados de ninguém).`
        );
      } else if (item.grams > 0 && !weightConfirmedBySlot.get(item.slot_index)) {
        console.warn(
          `⚖️ Slot ${item.slot_index}: consumo de ${item.grams}g será registrado, mas o carretel ainda não tem peso confirmado -- current_weight NÃO será descontado até a pesagem no Estoque.`
        );
      }
    }

    // Cross-check só faz sentido para os slots resolvidos por fallback
    // (ams_slots): para os resolvidos direto pela Bambu Cloud, o próprio
    // spool_id do item já É a localização mais recente -- comparar contra
    // physicalInfoBySlot (que descreve o spool ANTERIOR vinculado por NFC)
    // produziria uma divergência sobre o spool errado.
    const fallbackItems = items.filter((it) => resolutions.get(it.slot_index)?.source === "ams_slots");
    const mismatches = detectPhysicalIdentityMismatches(fallbackItems, physicalInfoBySlot, PRINTER_SERIAL);
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

    // ams_slots como projeção da localização física: só corrige depois que
    // o consumo já foi gravado com sucesso, e só quando a Bambu Cloud deu
    // evidência inequívoca de um spool diferente do que estava vinculado
    // (ver computeAmsSlotSelfHeals). Mesmo upsert idempotente já usado pelo
    // fluxo de NFC na Web (handleAssignSlot).
    const heals = computeAmsSlotSelfHeals(resolutions);
    for (const heal of heals) {
      const { error: healError } = await supabase.from("ams_slots").upsert(
        {
          printer_id: printerId,
          slot_index: heal.slotIndex,
          spool_id: heal.spoolId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "printer_id,slot_index" }
      );
      if (healError) {
        console.error(`❌ Falha ao atualizar ams_slots para o slot ${heal.slotIndex}:`, healError.message);
        opsEmit("AGENT_ERROR", { component: "ams_slots", error: healError, printer_id: printerId });
      } else {
        console.log(`🔧 Slot ${heal.slotIndex}: ams_slots atualizado automaticamente para o carretel ${heal.spoolId} identificado pela Bambu Cloud.`);
      }
    }

    const totalDeducted = items.reduce(
      (acc, it) => acc + (it.spool_id && weightConfirmedBySlot.get(it.slot_index) ? it.grams : 0),
      0
    );
    console.log(`📝 Job ${jobId} finalizado (${finishStatus}) -- ${logRows?.length ?? items.length} linha(s) de log, ${totalDeducted}g debitados no total.`);
    opsEmit("FINALIZE_COMPLETED", {
      job_id: jobId,
      printer_id: printerId,
      metadata: {
        job: jobId,
        status: finishStatus,
        deducted_g: totalDeducted,
        items: items.map((it) => ({
          slot: it.slot_index,
          spool_id: it.spool_id,
          grams: it.grams,
          orphan: Boolean(it.orphan_slot),
          source: resolutions.get(it.slot_index)?.source ?? null,
          weight_confirmed: Boolean(weightConfirmedBySlot.get(it.slot_index)),
        })),
      },
    });
    for (const it of items) {
      if (it.orphan_slot) {
        opsEmit("SPOOL_AMBIGUOUS", { job_id: jobId, printer_id: printerId, metadata: { job: jobId, slot: it.slot_index, grams: it.grams } });
      }
    }
  } catch (e: any) {
    // Propaga: quem decide reenviar é a FinalizeOutbox (antes o erro era
    // engolido e o job apagado em seguida -- consumo perdido).
    console.error("❌ Falha ao finalizar trabalho:", e?.message || e);
    throw e;
  }
}

// Liga a Central depois que a sessão existe. Qualquer falha aqui só desliga
// a observabilidade -- o Agent segue igual.
function startObservability(sessionSupervisor: SessionSupervisor, finalizeOutbox: FinalizeOutbox) {
  try {
    const dir = getConfigDir();
    const enabled = loadNonSecretConfig()?.telemetry !== false;
    const { id: installationId, created } = loadOrCreateInstallationId(dir);
    ops = new OpsEmitter({
      enabled,
      filePath: path.join(dir, "telemetry-outbox.json"),
      installationId,
      kind: "agent",
      machineHint: machineHint(),
      appVersion: AGENT_VERSION,
      sanitizer: opsSanitizer,
      canSend: () => sessionSupervisor.isHealthy(),
      getPrinterId: () => opsState.printerId,
      getStatus: () => {
        const pending = finalizeOutbox.pending();
        const oldest = pending.reduce((min, p) => Math.min(min, Date.parse(p.enqueuedAt) || Date.now()), Date.now());
        return {
          mqtt: opsState.mqtt,
          mqtt_down_min: opsState.mqtt === "disconnected" ? Math.round((Date.now() - opsState.mqttDownSince) / 60000) : 0,
          session: sessionSupervisor.isHealthy() ? "ok" : "lost",
          bambu_sync: opsState.bambuSync,
          profile_sync: opsState.profileSync,
          last_bambu_sync_at: opsState.lastBambuSyncAt,
          last_profile_sync_at: opsState.lastProfileSyncAt,
          pending_finalize: pending.length,
          pending_finalize_oldest_min: pending.length ? Math.round((Date.now() - oldest) / 60000) : 0,
          active_job: opsState.activeJob,
        };
      },
      send: async (installation, events, signal) => {
        const { data, error } = await supabase
          .rpc("ingest_ops_events", { p_installation: installation, p_events: events })
          .abortSignal(signal);
        if (error) return { ok: false, reason: error.message };
        return { ok: (data as any)?.ok === true, reason: (data as any)?.reason };
      },
      logWarn: (m) => console.warn(m),
    });
    const run = markRunStart(dir, ops.bootId);
    if (run.uncleanPrevious) {
      opsEmit("AGENT_CRASH_RECOVERED", { metadata: { previous_started_at: run.previousStartedAt } });
    }
    opsEmit("AGENT_STARTED", { metadata: { new_installation: created, platform: process.platform, node: process.version } });
    ops.start();
    if (!enabled) console.log("📡 Central de observabilidade desligada (config.json telemetry=false).");
  } catch (e: any) {
    ops = null;
    console.warn("⚠️ Central de observabilidade não iniciada (Agent segue normalmente):", e?.message || e);
  }
}

function currentMqttTrays(): any[] {
  return lastMqttPrintPayload?.ams?.ams?.[0]?.tray || lastMqttPrintPayload?.ams?.tray || [];
}

async function updateStatus(printerId: string, isOnline: boolean) {
  await supabase.from("printers").update({ is_online: isOnline }).eq("id", printerId);
}

startAgent();







