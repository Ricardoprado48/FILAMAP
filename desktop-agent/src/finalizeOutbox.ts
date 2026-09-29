import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ActiveJobState } from "./jobStateMachine";

// Fila persistente de finalizações de job.
//
// Por quê (incidente 2026-09-27): finalizeJob() engolia qualquer erro e o
// chamador apagava agent-state.json logo em seguida. Sem sessão Supabase
// (ou sem rede) no instante do FINISH, o consumo do job era perdido para
// sempre. Agora o job passa para esta fila ANTES de sair de
// agent-state.json, e só sai da fila quando o RPC finalize_print_job
// responde sem erro. O RPC é idempotente por job_id, então reenviar é
// seguro: um reenvio de job já gravado devolve as linhas existentes.

export interface PendingFinalization {
  jobId: string;
  printerId: string;
  job: ActiveJobState;
  percentExecuted: number;
  finishStatus: string;
  // Recorte do payload MQTT no instante do fim (finalizeJob só usa estes).
  printSnapshot: { subtask_name?: string; mc_cost_time?: number };
  // Bandejas AMS vistas via MQTT no instante do fim -- usadas como
  // candidatos de resolução física mesmo se o envio acontecer muito depois.
  mqttTrays: any[];
  enqueuedAt: string;
  attempts: number;
  lastError?: string;
}

export interface FinalizeOutboxOptions {
  filePath: string;
  execute: (pending: PendingFinalization) => Promise<void>;
  // false = nem tenta (sem sessão confiável). O item continua na fila.
  canExecute: () => boolean | Promise<boolean>;
  logInfo?: (message: string) => void;
  logWarn?: (message: string) => void;
  // Observabilidade: chamado junto com o aviso de reenvio (tentativa 1 e a cada 10).
  onRetry?: (pending: PendingFinalization) => void;
}

export class FinalizeOutbox {
  private items: PendingFinalization[] = [];
  private flushing: Promise<void> | null = null;
  private readonly opts: Required<FinalizeOutboxOptions>;

  constructor(options: FinalizeOutboxOptions) {
    this.opts = { logInfo: console.log, logWarn: console.warn, onRetry: () => {}, ...options };
    this.items = this.load();
  }

  size(): number {
    return this.items.length;
  }

  pending(): readonly PendingFinalization[] {
    return this.items;
  }

  // true só se o item ficou gravado em disco -- o chamador só pode apagar
  // agent-state.json depois disso.
  enqueue(item: Omit<PendingFinalization, "enqueuedAt" | "attempts">): boolean {
    const existing = this.items.find((p) => p.jobId === item.jobId);
    if (existing) {
      // Mesmo job de novo (ex.: restart reprocessou o FINISH): mantém o
      // primeiro registro, que é o do instante real do fim.
      return this.persist();
    }
    this.items.push({ ...item, enqueuedAt: new Date().toISOString(), attempts: 0 });
    return this.persist();
  }

  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = this.runFlush().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private async runFlush(): Promise<void> {
    for (const item of [...this.items]) {
      if (!(await this.opts.canExecute())) return;
      try {
        await this.opts.execute(item);
        this.items = this.items.filter((p) => p.jobId !== item.jobId);
        this.persist();
        if (item.attempts > 0) {
          this.opts.logInfo(`📬 Finalização pendente do job ${item.jobId} enviada após ${item.attempts} tentativa(s).`);
        }
      } catch (e: any) {
        item.attempts++;
        item.lastError = e?.message || String(e);
        this.persist();
        if (item.attempts === 1 || item.attempts % 10 === 0) {
          this.opts.logWarn(
            `📮 Finalização do job ${item.jobId} guardada para reenvio (tentativa ${item.attempts}): ${item.lastError}`
          );
          try {
            this.opts.onRetry(item);
          } catch {}
        }
      }
    }
  }

  private load(): PendingFinalization[] {
    const file = this.opts.filePath;
    if (!fs.existsSync(file)) return [];
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
      if (Array.isArray(parsed)) {
        return parsed.filter((p) => p && typeof p.jobId === "string" && p.job && typeof p.printerId === "string");
      }
      throw new Error("formato inesperado");
    } catch (e: any) {
      // Nunca apaga: preserva o arquivo ilegível para recuperação manual.
      const quarantine = `${file}.corrompido-${Date.now()}`;
      try {
        fs.renameSync(file, quarantine);
      } catch {}
      this.opts.logWarn(`⚠️ Fila de finalização ilegível (${e?.message || e}); preservada em ${quarantine}.`);
      return [];
    }
  }

  private persist(): boolean {
    try {
      const file = this.opts.filePath;
      const dir = path.dirname(file);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      if (this.items.length === 0) {
        if (fs.existsSync(file)) fs.unlinkSync(file);
        return true;
      }
      const tmp = path.join(dir, `agent-pending-finalize.${randomUUID()}.tmp`);
      fs.writeFileSync(tmp, JSON.stringify(this.items, null, 2), "utf-8");
      fs.renameSync(tmp, file);
      return true;
    } catch (e: any) {
      this.opts.logWarn(`⚠️ Falha ao gravar fila de finalização: ${e?.message || e}`);
      return false;
    }
  }
}
