import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { EVENT_CATALOG, EventType, Severity } from "./eventCatalog";
import { Sanitizer, fingerprint as makeFingerprint } from "./sanitize";

// Emissor de eventos da Central de Observabilidade (PACOTE seção 13).
//
// REGRAS FIXAS (documento-base seção 18):
// - emit() é síncrono, O(1) e NUNCA lança: o fluxo crítico (MQTT, job,
//   finalize, estoque) não espera nem depende da central.
// - envio em lote por timer próprio, single-flight, com timeout e backoff;
//   falha de envio nunca chama o supervisor de sessão nem altera estado.
// - fila local limitada (anel), cota diária e teto por impressão digital:
//   um erro em loop não consegue gastar a cota dos eventos de impressão.

export interface OpsEvent {
  client_event_id: string;
  boot_id: string;
  seq: number;
  occurred_at: string;
  event_type: EventType;
  severity: Severity;
  component: string;
  printer_id?: string | null;
  job_id?: string | null;
  spool_id?: string | null;
  error_code?: string;
  fingerprint?: string;
  message?: string;
  repeat_count: number;
  metadata: Record<string, unknown>;
}

export interface OpsInstallation {
  installation_id: string;
  kind: "agent" | "web";
  machine_hint: string;
  app_version: string;
  printer_id?: string | null;
  status: Record<string, unknown>;
}

export type OpsSend = (installation: OpsInstallation, events: OpsEvent[], signal: AbortSignal) => Promise<{ ok: boolean; reason?: string }>;

export interface EmitFields {
  message?: string;
  error?: unknown;
  error_code?: string;
  component?: string;
  severity?: Severity;
  printer_id?: string | null;
  job_id?: string | null;
  spool_id?: string | null;
  metadata?: Record<string, unknown>;
}

export interface OpsEmitterOptions {
  enabled: boolean;
  filePath: string | null;
  installationId: string;
  kind: "agent" | "web";
  machineHint: string;
  appVersion: string;
  sanitizer: Sanitizer;
  send: OpsSend;
  canSend: () => boolean;
  getStatus: () => Record<string, unknown>;
  getPrinterId?: () => string | null;
  now?: () => number;
  logWarn?: (message: string) => void;
  maxQueue?: number;
  dailyCap?: number;
  perFingerprintDailyCap?: number;
  batchSize?: number;
  flushMs?: number;
  timeoutMs?: number;
  windowMs?: number;
  statusEveryMs?: number;
  persistDebounceMs?: number;
}

const BACKOFF_MS = [60_000, 120_000, 300_000, 900_000, 1_800_000];
const STACK_MAX = 1500;

export class OpsEmitter {
  readonly bootId = randomUUID();
  private readonly o: Required<Omit<OpsEmitterOptions, "getPrinterId" | "filePath">> & Pick<OpsEmitterOptions, "getPrinterId" | "filePath">;
  private queue: OpsEvent[] = [];
  private seq = 0;
  private droppedLocal = 0;
  private dayKey = "";
  private dayCount = 0;
  private fpDay = new Map<string, number>();
  private windows = new Map<string, { until: number; suppressed: number }>();
  private lastValues = new Map<string, string>();
  private inFlight: Promise<number> | null = null;
  private failures = 0;
  private lastStatusAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(options: OpsEmitterOptions) {
    this.o = {
      now: () => Date.now(),
      logWarn: () => {},
      maxQueue: 500,
      dailyCap: 250,
      perFingerprintDailyCap: 20,
      batchSize: 50,
      flushMs: 60_000,
      timeoutMs: 10_000,
      windowMs: 60_000,
      statusEveryMs: 300_000,
      persistDebounceMs: 10_000,
      ...options,
    };
    if (this.o.enabled) this.load();
  }

  // Registra um evento. Nunca lança, nunca espera rede.
  emit(type: EventType, fields: EmitFields = {}): void {
    try {
      if (!this.o.enabled || this.stopped) return;
      const def = EVENT_CATALOG[type];
      if (!def) return;
      const s = this.o.sanitizer;
      const now = this.o.now();
      const component = fields.component ? s.text(fields.component, 40) : def.component;
      const severity = fields.severity ?? def.severity;
      const errorCode = fields.error_code ?? errorCodeOf(fields.error);
      const message = s.text(fields.message ?? (fields.error !== undefined ? fields.error : ""), 500);
      const rawStack = fields.error instanceof Error ? fields.error.stack : undefined;
      const fp = fields.error !== undefined || def.dedup === "window" ? makeFingerprint(component, errorCode, message, rawStack) : undefined;

      this.rollDay(now);
      let repeat = 1;
      if (fp) {
        if (def.dedup === "window") {
          const w = this.windows.get(fp);
          if (w && now < w.until) {
            w.suppressed++;
            return;
          }
          repeat = 1 + (w?.suppressed ?? 0);
          this.windows.set(fp, { until: now + this.o.windowMs, suppressed: 0 });
          if (this.windows.size > 200) this.windows.clear();
        }
        const used = this.fpDay.get(fp) ?? 0;
        if (used >= this.o.perFingerprintDailyCap) {
          this.droppedLocal++;
          return;
        }
        this.fpDay.set(fp, used + 1);
      }
      if (this.dayCount >= this.o.dailyCap) {
        this.droppedLocal++;
        return;
      }
      this.dayCount++;

      const metadata = s.metadata(fields.metadata ?? {});
      // O banco recusa metadata > 4 KB: o stack só entra no espaço que sobra.
      const room = 3700 - JSON.stringify(metadata).length;
      if (rawStack && room > 200) metadata.stack = s.text(rawStack, Math.min(STACK_MAX, room - 50));

      this.queue.push({
        client_event_id: randomUUID(),
        boot_id: this.bootId,
        seq: ++this.seq,
        occurred_at: new Date(now).toISOString(),
        event_type: type,
        severity,
        component,
        printer_id: fields.printer_id ?? this.o.getPrinterId?.() ?? null,
        job_id: fields.job_id ?? null,
        spool_id: fields.spool_id ?? null,
        error_code: errorCode ? s.text(errorCode, 80) : undefined,
        fingerprint: fp,
        message: message || undefined,
        repeat_count: repeat,
        metadata,
      });
      this.trim();
      this.markDirty();
    } catch {
      // observabilidade nunca derruba quem chamou
    }
  }

  // true quando o valor da chave mudou (1ª observação conta como mudança).
  changed(key: string, value: string): boolean {
    try {
      if (this.lastValues.get(key) === value) return false;
      this.lastValues.set(key, value);
      return true;
    } catch {
      return false;
    }
  }

  start(): void {
    if (!this.o.enabled || this.stopped) return;
    this.schedule(5_000);
  }

  // Encerramento: tenta um último envio com teto de tempo e grava o resto em disco.
  async shutdown(maxMs = 3_000): Promise<void> {
    try {
      if (!this.o.enabled) return;
      this.stopped = true;
      if (this.timer) clearTimeout(this.timer);
      await Promise.race([this.flushOnce().catch(() => 0), new Promise((r) => setTimeout(r, maxMs))]);
      this.persistNow();
    } catch {
      // idem
    }
  }

  stats(): { queued: number; droppedLocal: number; failures: number } {
    return { queued: this.queue.length, droppedLocal: this.droppedLocal, failures: this.failures };
  }

  // Exposto para testes: um ciclo de envio. Devolve o atraso até o próximo.
  flushOnce(): Promise<number> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.doFlush().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async doFlush(): Promise<number> {
    if (!this.o.enabled) return this.o.flushMs;
    const now = this.o.now();
    try {
      if (!this.o.canSend()) return this.o.flushMs;
    } catch {
      return this.o.flushMs;
    }
    const statusDue = now - this.lastStatusAt >= this.o.statusEveryMs;
    if (this.queue.length === 0 && !statusDue) return this.o.flushMs;

    const batch = this.queue.slice(0, this.o.batchSize);
    let status: Record<string, unknown> = {};
    try {
      status = this.o.sanitizer.status({ ...this.o.getStatus(), queue_size: this.queue.length, dropped_local: this.droppedLocal });
    } catch {
      status = { queue_size: this.queue.length };
    }
    const installation: OpsInstallation = {
      installation_id: this.o.installationId,
      kind: this.o.kind,
      machine_hint: this.o.machineHint,
      app_version: this.o.appVersion,
      printer_id: safe(() => this.o.getPrinterId?.() ?? null, null),
      status,
    };

    const ctrl = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | null = null;
    try {
      const res = await Promise.race([
        this.o.send(installation, batch, ctrl.signal),
        new Promise<{ ok: boolean; reason?: string }>((resolve) => {
          timeout = setTimeout(() => {
            ctrl.abort();
            resolve({ ok: false, reason: "timeout" });
          }, this.o.timeoutMs);
        }),
      ]);
      if (res && res.ok) {
        // Aceitos, duplicados, descartados pela cota ou rejeitados: nenhum volta
        // (reenviar daria o mesmo resultado).
        const sent = new Set(batch.map((e) => e.client_event_id));
        this.queue = this.queue.filter((e) => !sent.has(e.client_event_id));
        this.lastStatusAt = now;
        if (this.failures > 0) safe(() => this.o.logWarn(`📡 Central de observabilidade: envio restabelecido após ${this.failures} falha(s).`), undefined);
        this.failures = 0;
        this.markDirty();
        return this.queue.length > 0 ? 5_000 : this.o.flushMs;
      }
      return this.fail(res?.reason || "resposta sem ok");
    } catch (e: any) {
      return this.fail(e?.message || String(e));
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private fail(reason: string): number {
    this.failures++;
    if (this.failures === 1) {
      safe(() => this.o.logWarn(`📡 Central de observabilidade indisponível (${this.o.sanitizer.text(reason, 120)}); eventos guardados localmente.`), undefined);
    }
    return BACKOFF_MS[Math.min(this.failures - 1, BACKOFF_MS.length - 1)];
  }

  private schedule(ms: number): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.flushOnce()
        .catch(() => this.o.flushMs)
        .then((next) => this.schedule(next));
    }, ms);
    (this.timer as any).unref?.();
  }

  private rollDay(now: number): void {
    const key = new Date(now).toISOString().slice(0, 10);
    if (key !== this.dayKey) {
      this.dayKey = key;
      this.dayCount = 0;
      this.fpDay.clear();
    }
  }

  // Anel: cheio -> sai o INFO mais antigo; sem INFO, o mais antigo de todos.
  private trim(): void {
    while (this.queue.length > this.o.maxQueue) {
      const idx = this.queue.findIndex((e) => e.severity === "INFO");
      this.queue.splice(idx >= 0 ? idx : 0, 1);
      this.droppedLocal++;
    }
  }

  private markDirty(): void {
    if (!this.o.filePath || this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.persistNow();
    }, this.o.persistDebounceMs);
    (this.persistTimer as any).unref?.();
  }

  private persistNow(): void {
    try {
      const file = this.o.filePath;
      if (!file) return;
      const dir = path.dirname(file);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const tmp = path.join(dir, `telemetry-outbox.${randomUUID()}.tmp`);
      fs.writeFileSync(tmp, JSON.stringify({ events: this.queue, dropped_local: this.droppedLocal }), "utf-8");
      fs.renameSync(tmp, file);
    } catch {
      // disco cheio/sem permissão: segue só em memória
    }
  }

  private load(): void {
    try {
      const file = this.o.filePath;
      if (!file || !fs.existsSync(file)) return;
      const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
      const events = Array.isArray(parsed?.events) ? parsed.events : [];
      this.queue = events
        .filter((e: any) => e && typeof e.client_event_id === "string" && typeof e.event_type === "string" && e.event_type in EVENT_CATALOG)
        .slice(-this.o.maxQueue);
      this.droppedLocal = Number(parsed?.dropped_local) || 0;
    } catch {
      // arquivo ilegível: descarta (é só telemetria) e recomeça
      this.queue = [];
    }
  }
}

function errorCodeOf(error: unknown): string | undefined {
  const e = error as any;
  const code = e?.code ?? e?.errno ?? e?.status;
  return code === undefined || code === null ? undefined : String(code);
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}
