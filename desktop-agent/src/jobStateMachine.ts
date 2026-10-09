import { randomUUID } from "node:crypto";
import type { FilamentSliceInfo } from "./ftpsParser";
import type { JobAmsEvents } from "./amsRunout";

export interface ActiveJobState {
  jobId: string;
  subtaskName: string;
  gcodeFile?: string;
  maxProgressPercent: number;
  lastProgressPercent: number;
  activeSlot: number;
  usedSlots: number[];
  startTime: number;
  totalCostTime: number;
  filamentGrams: number;
  filamentSliceInfo?: FilamentSliceInfo[];
  amsMapping?: number[];
  // Trocas de slot e carretel acabado durante o job (amsRunout.ts).
  amsEvents?: JobAmsEvents;
}

export type StateMachineAction =
  | {
      type: "create_job";
      job: ActiveJobState;
      remoteFilePath: string;
    }
  | {
      type: "update_job";
      job: ActiveJobState;
      reason: "progress" | "slot_added" | "name_discovered";
    }
  | {
      type: "finalize_job";
      job: ActiveJobState;
      percentExecuted: number;
      finishStatus: string;
    }
  | {
      type: "discard_job";
      job: ActiveJobState;
      reason: "idle_zero_progress" | "phantom_cleanup";
    };

export interface MqttPrintPayload {
  gcode_state?: string;
  subtask_name?: string;
  gcode_file?: string;
  mc_percent?: number | string;
  mc_total_cost_time?: number | string;
  calc_remaining_time?: number | string;
  ams_mapping?: Array<number | string> | string;
  tray_now?: number | string;
  tray_tar?: number | string;
  ams?: {
    tray_now?: number | string;
    tray_tar?: number | string;
    ams_mapping?: Array<number | string> | string;
    ams?: Array<{
      tray_now?: number | string;
      tray_tar?: number | string;
    }>;
  };
  [key: string]: unknown;
}

export function parseAmsMapping(raw: unknown): number[] | undefined {
  if (Array.isArray(raw)) {
    const parsed = raw.map(Number).filter((n) => !isNaN(n) && ((n >= 0 && n <= 15) || n === 255));
    if (parsed.length > 0) return parsed;
  } else if (typeof raw === "string" && raw.trim()) {
    try {
      const json = JSON.parse(raw);
      if (Array.isArray(json)) {
        const parsed = json.map(Number).filter((n) => !isNaN(n) && ((n >= 0 && n <= 15) || n === 255));
        if (parsed.length > 0) return parsed;
      }
    } catch {
      const parts = raw.split(",").map((s) => Number(s.trim())).filter((n) => !isNaN(n) && ((n >= 0 && n <= 15) || n === 255));
      if (parts.length > 0) return parts;
    }
  }
  return undefined;
}

export function extractGramsFromName(taskName: string): number | null {
  const match = taskName.match(/_(\d+(?:\.\d+)?)g/i) || taskName.match(/(\d+(?:\.\d+)?)g\b/i);
  if (match && match[1]) {
    return parseFloat(match[1]);
  }
  return null;
}

export function resolveRemote3mfPath(gcodeFile: string, taskName: string): string {
  let remoteFilePath = gcodeFile.trim();
  if (!remoteFilePath) {
    const safeName = taskName.trim() || "Impressao";
    return `/sdcard/${safeName}.gcode.3mf`;
  }

  if (!remoteFilePath.toLowerCase().endsWith(".3mf")) {
    remoteFilePath = remoteFilePath.replace(/\.gcode$/i, ".3mf").replace(/\.gcode\.3mf$/i, ".3mf");
    if (!remoteFilePath.toLowerCase().endsWith(".3mf")) {
      remoteFilePath += ".3mf";
    }
  }

  return remoteFilePath;
}

export interface JobStateMachineOptions {
  initialJob?: ActiveJobState | null;
  initialGcodeState?: string;
  initialSlotIndex?: number;
}

export class JobStateMachine {
  private currentJob: ActiveJobState | null;
  private lastGcodeState: string;
  private activeSlotIndex: number;
  private lastKnownSubtaskName: string;
  private lastKnownGcodeFile: string;
  private lastKnownAmsMapping?: number[];

  constructor(options: JobStateMachineOptions = {}) {
    this.currentJob = options.initialJob ? { ...options.initialJob } : null;
    this.lastGcodeState = options.initialGcodeState ?? "IDLE";
    this.activeSlotIndex = options.initialSlotIndex !== undefined ? options.initialSlotIndex : -1;
    this.lastKnownSubtaskName = this.currentJob?.subtaskName ?? "";
    this.lastKnownGcodeFile = this.currentJob?.gcodeFile ?? "";
    if (this.currentJob?.amsMapping) {
      this.lastKnownAmsMapping = this.currentJob.amsMapping;
    }
  }

  public getCurrentJob(): ActiveJobState | null {
    return this.currentJob;
  }

  public getLastGcodeState(): string {
    return this.lastGcodeState;
  }

  public getActiveSlotIndex(): number | null {
    if (this.activeSlotIndex >= 0 && this.activeSlotIndex <= 15 && this.activeSlotIndex !== 255) {
      return this.activeSlotIndex;
    }
    return null;
  }

  /**
   * Processa uma mensagem de telemetria da impressora e retorna as ações resultantes.
   * Lida com deltas MQTT sem recriar jobs indevidamente.
   */
  public processPrintPayload(print: MqttPrintPayload): StateMachineAction[] {
    const actions: StateMachineAction[] = [];

    // 1. Atualiza slot ativo se presente no payload (prioriza tray_now sobre tray_tar)
    const rawSlot =
      print.ams?.tray_now !== undefined
        ? print.ams.tray_now
        : print.ams?.tray_tar !== undefined
        ? print.ams.tray_tar
        : print.ams?.ams?.[0]?.tray_now !== undefined
        ? print.ams.ams[0].tray_now
        : print.ams?.ams?.[0]?.tray_tar !== undefined
        ? print.ams.ams[0].tray_tar
        : print.tray_now !== undefined
        ? print.tray_now
        : print.tray_tar;

    if (rawSlot !== undefined) {
      const slotVal = Number(rawSlot);
      // Valor 255 é transição/retração -- nunca converte para 0 e nunca adiciona a usedSlots
      if (!isNaN(slotVal)) {
        if (slotVal >= 0 && slotVal <= 15 && slotVal !== 255) {
          this.activeSlotIndex = slotVal;
        } else if (slotVal === 255) {
          this.activeSlotIndex = -1;
        }
      }
    }

    // Extrai ams_mapping se presente no payload
    const rawMapping =
      print.ams_mapping ??
      print.ams?.ams_mapping ??
      (print as any).mapping ??
      (print as any).subtask_mapping;

    if (rawMapping !== undefined) {
      const parsedMapping = parseAmsMapping(rawMapping);
      if (parsedMapping && parsedMapping.length > 0) {
        this.lastKnownAmsMapping = parsedMapping;
        if (this.currentJob) {
          this.currentJob.amsMapping = parsedMapping;
        }
      }
    }

    // 2. Extrai campos da mensagem com tolerância a delta
    const rawGcodeState = typeof print.gcode_state === "string" && print.gcode_state.trim() ? print.gcode_state.trim() : undefined;
    const currentState = rawGcodeState || this.lastGcodeState;

    const rawSubtaskName = typeof print.subtask_name === "string" && print.subtask_name.trim() ? print.subtask_name.trim() : undefined;
    if (rawSubtaskName) {
      this.lastKnownSubtaskName = rawSubtaskName;
    }

    const rawGcodeFile = typeof print.gcode_file === "string" && print.gcode_file.trim() ? print.gcode_file.trim() : undefined;
    if (rawGcodeFile) {
      this.lastKnownGcodeFile = rawGcodeFile;
    }

    const progress = print.mc_percent !== undefined ? Number(print.mc_percent) : undefined;
    const validProgress = progress !== undefined && !isNaN(progress) ? Math.max(0, Math.min(100, progress)) : undefined;

    const totalCostTime = Number(print.mc_total_cost_time) || Number(print.calc_remaining_time) || 0;

    // 3. Gerenciamento do ciclo de vida quando RUNNING
    if (currentState === "RUNNING") {
      if (!this.currentJob) {
        // Novo job iniciando
        const effectiveName = this.lastKnownSubtaskName || "Impressão A1";
        const effectiveGcodeFile = this.lastKnownGcodeFile || "";
        const extractedGrams = extractGramsFromName(effectiveName);
        const remoteFilePath = resolveRemote3mfPath(effectiveGcodeFile, effectiveName);

        const validUsedSlots = this.activeSlotIndex >= 0 && this.activeSlotIndex !== 255 ? [this.activeSlotIndex] : [];
        const newJob: ActiveJobState = {
          jobId: randomUUID(),
          subtaskName: effectiveName,
          gcodeFile: effectiveGcodeFile,
          maxProgressPercent: validProgress ?? 0,
          lastProgressPercent: validProgress ?? 0,
          activeSlot: this.activeSlotIndex,
          usedSlots: validUsedSlots,
          startTime: Date.now(),
          totalCostTime,
          filamentGrams: extractedGrams || 0,
          filamentSliceInfo: [],
          amsEvents: { switches: [], runouts: [] },
          ...(this.lastKnownAmsMapping ? { amsMapping: this.lastKnownAmsMapping } : {}),
        };

        this.currentJob = newJob;
        actions.push({
          type: "create_job",
          job: newJob,
          remoteFilePath,
        });
      } else {
        // Job já existe. Verifica se há transição legítima de novo job ou apenas delta
        let isRealNewJob = false;

        // Uma mudança real de job durante RUNNING requer um novo subtaskName explícito diferente
        // acompanhado de reset de progresso (ex: usuário iniciou outra impressão)
        if (
          rawSubtaskName &&
          this.currentJob.subtaskName !== "Impressão A1" &&
          rawSubtaskName !== this.currentJob.subtaskName &&
          validProgress !== undefined &&
          validProgress < this.currentJob.maxProgressPercent &&
          validProgress <= 5
        ) {
          isRealNewJob = true;
        }

        if (isRealNewJob) {
          // Finaliza o job anterior interrompido antes de criar o novo
          actions.push({
            type: "finalize_job",
            job: this.currentJob,
            percentExecuted: this.currentJob.maxProgressPercent,
            finishStatus: "REPLACED",
          });

          const effectiveName = rawSubtaskName!;
          const effectiveGcodeFile = rawGcodeFile || "";
          const extractedGrams = extractGramsFromName(effectiveName);
          const remoteFilePath = resolveRemote3mfPath(effectiveGcodeFile, effectiveName);

          const validUsedSlots = this.activeSlotIndex >= 0 && this.activeSlotIndex !== 255 ? [this.activeSlotIndex] : [];
          const newJob: ActiveJobState = {
            jobId: randomUUID(),
            subtaskName: effectiveName,
            gcodeFile: effectiveGcodeFile,
            maxProgressPercent: validProgress ?? 0,
            lastProgressPercent: validProgress ?? 0,
            activeSlot: this.activeSlotIndex,
            usedSlots: validUsedSlots,
            startTime: Date.now(),
            totalCostTime,
            filamentGrams: extractedGrams || 0,
            filamentSliceInfo: [],
            amsEvents: { switches: [], runouts: [] },
            ...(this.lastKnownAmsMapping ? { amsMapping: this.lastKnownAmsMapping } : {}),
          };

          this.currentJob = newJob;
          actions.push({
            type: "create_job",
            job: newJob,
            remoteFilePath,
          });
        } else {
          // Continuação do mesmo job
          let updated = false;

          // Se o job atual usava o nome genérico de fallback e agora descobrimos o nome real:
          if (rawSubtaskName && this.currentJob.subtaskName === "Impressão A1" && rawSubtaskName !== "Impressão A1") {
            this.currentJob.subtaskName = rawSubtaskName;
            const extractedGrams = extractGramsFromName(rawSubtaskName);
            if (extractedGrams && !this.currentJob.filamentGrams) {
              this.currentJob.filamentGrams = extractedGrams;
            }
            actions.push({
              type: "update_job",
              job: this.currentJob,
              reason: "name_discovered",
            });
            updated = true;
          }

          // Atualização de progresso
          if (validProgress !== undefined) {
            this.currentJob.lastProgressPercent = validProgress;
            if (validProgress > this.currentJob.maxProgressPercent) {
              this.currentJob.maxProgressPercent = validProgress;
              if (!updated) {
                actions.push({
                  type: "update_job",
                  job: this.currentJob,
                  reason: "progress",
                });
                updated = true;
              }
            }
          }

          // Rastreamento de novos slots AMS (multicolor)
          if (this.activeSlotIndex >= 0 && this.activeSlotIndex !== 255) {
            if (!this.currentJob.usedSlots.includes(this.activeSlotIndex)) {
              this.currentJob.usedSlots.push(this.activeSlotIndex);
              this.currentJob.activeSlot = this.activeSlotIndex;
              if (!updated) {
                actions.push({
                  type: "update_job",
                  job: this.currentJob,
                  reason: "slot_added",
                });
                updated = true;
              }
            } else if (this.currentJob.activeSlot !== this.activeSlotIndex) {
              this.currentJob.activeSlot = this.activeSlotIndex;
            }
          }
        }
      }
    }

    // 4. Finalização normal em FINISH
    if (currentState === "FINISH" && this.lastGcodeState !== "FINISH" && this.currentJob) {
      actions.push({
        type: "finalize_job",
        job: this.currentJob,
        percentExecuted: 100,
        finishStatus: "COMPLETED",
      });
      this.currentJob = null;
      this.lastKnownAmsMapping = undefined;
    }

    // 5. Interrupção/Falha em FAILED / STOP / PAUSE_STOP
    if (
      (currentState === "FAILED" || currentState === "PAUSE_STOP" || currentState === "STOP") &&
      (this.lastGcodeState === "RUNNING" || this.lastGcodeState === "PAUSE") &&
      this.currentJob
    ) {
      actions.push({
        type: "finalize_job",
        job: this.currentJob,
        percentExecuted: this.currentJob.maxProgressPercent,
        finishStatus: currentState,
      });
      this.currentJob = null;
      this.lastKnownAmsMapping = undefined;
    }

    // 6. Transição para IDLE (ou impressora já parada em IDLE)
    if (currentState === "IDLE" && this.currentJob) {
      if (this.currentJob.maxProgressPercent === 0) {
        // Job fantasma que nunca imprimiu nada de verdade: descarta sem debitar estoque
        actions.push({
          type: "discard_job",
          job: this.currentJob,
          reason: "idle_zero_progress",
        });
        this.currentJob = null;
        this.lastKnownAmsMapping = undefined;
      } else if (this.lastGcodeState === "RUNNING" || this.lastGcodeState === "PAUSE") {
        // Interrompido e voltou para IDLE sem evento explícito de STOP
        actions.push({
          type: "finalize_job",
          job: this.currentJob,
          percentExecuted: this.currentJob.maxProgressPercent,
          finishStatus: "STOP",
        });
        this.currentJob = null;
        this.lastKnownAmsMapping = undefined;
      }
    }

    this.lastGcodeState = currentState;
    return actions;
  }

  /** Permite anexar o ams_mapping capturado via MQTT ao job ativo */
  public attachAmsMapping(mapping: number[]): void {
    if (this.currentJob?.amsMapping && this.currentJob.amsMapping.length > 0) {
      const isDifferent =
        this.currentJob.amsMapping.length !== mapping.length ||
        this.currentJob.amsMapping.some((val, idx) => val !== mapping[idx]);
      if (isDifferent) {
        console.warn(
          `⚠️ ams_mapping conflitante recebido durante o job ${this.currentJob.jobId}. Preservando mapping original: [${this.currentJob.amsMapping}] contra novo [${mapping}]`
        );
        return;
      }
    }
    this.lastKnownAmsMapping = mapping;
    if (this.currentJob) {
      this.currentJob.amsMapping = mapping;
    }
  }

  /** Permite anexar os dados do slice_info.config baixados via FTPS ao job ativo */
  public attachSliceInfo(sliceInfo: FilamentSliceInfo[]): void {
    if (this.currentJob) {
      this.currentJob.filamentSliceInfo = sliceInfo;
    }
  }
}
