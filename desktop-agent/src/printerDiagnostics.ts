// Diário da impressora: o que a A1 já manda em todo relatório e o Agent jogava fora.
//
// - print_error: por que a impressão parou (0x0300400C = cancelada pela pessoa);
// - hms: alertas que aparecem na tela (AMS, bico, filamento, sensores);
// - stg_cur: etapa atual (nivelando, carregando filamento, imprimindo...).
//
// Só registra o dado bruto (regra do projeto: Agent coleta, quem interpreta é a
// Web). Os rótulos de etapa servem apenas para o agent.log ficar legível.

export const PRINT_ERROR_CANCELLED = 0x0300400c;

export interface HmsEntry {
  attr: number;
  code: number;
}

export interface StageMark {
  at: string;
  stage: number;
}

export type DiagnosticChange =
  | { kind: "hms_appeared"; code: string; attr: number; rawCode: number }
  | { kind: "hms_cleared"; code: string }
  | { kind: "print_error"; code: string; value: number; cancelledByUser: boolean }
  | { kind: "print_error_cleared"; code: string };

export interface DiagnosticSnapshot {
  print_error: string | null;
  cancelled_by_user: boolean;
  hms_active: string[];
  stage: number | null;
  stage_label: string | null;
  layer: number | null;
  stages: StageMark[];
}

const STAGE_LABELS: Record<number, string> = {
  0: "imprimindo",
  1: "nivelando a mesa",
  2: "aquecendo a mesa",
  4: "trocando filamento",
  6: "pausada: filamento acabou",
  7: "aquecendo o bico",
  8: "calibrando extrusão",
  13: "levando o cabeçote para a origem",
  14: "limpando o bico",
  16: "pausada pela pessoa",
  22: "descarregando filamento",
  24: "carregando filamento",
  255: "ociosa",
  [-1]: "ociosa",
};

export function stageLabel(stage: number | null | undefined): string | null {
  if (stage === null || stage === undefined || Number.isNaN(stage)) return null;
  return STAGE_LABELS[stage] ?? `etapa ${stage}`;
}

const hex4 = (n: number) => (n & 0xffff).toString(16).toUpperCase().padStart(4, "0");

// Mesmo formato do app Bambu Handy / wiki: 0700_2000_0002_0001.
export function formatHmsCode(attr: number, code: number): string {
  return `${hex4(attr >>> 16)}_${hex4(attr)}_${hex4(code >>> 16)}_${hex4(code)}`;
}

// 50348044 -> "0300_400C".
export function formatPrintError(value: number): string {
  return `${hex4(value >>> 16)}_${hex4(value)}`;
}

function toInt(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
}

const MAX_STAGES = 12;

export class PrinterDiagnostics {
  private printError = 0;
  private hms = new Map<string, HmsEntry>();
  private stage: number | null = null;
  private layer: number | null = null;
  private stages: StageMark[] = [];

  // Relatório parcial: só o que veio na mensagem muda. `hms`, quando vem, é a
  // lista completa dos alertas ativos.
  observe(print: Record<string, unknown>, now: number = Date.now()): DiagnosticChange[] {
    const changes: DiagnosticChange[] = [];

    if (Array.isArray(print.hms)) {
      const next = new Map<string, HmsEntry>();
      for (const h of print.hms as any[]) {
        const attr = toInt(h?.attr);
        const code = toInt(h?.code);
        if (attr === undefined || code === undefined) continue;
        next.set(formatHmsCode(attr, code), { attr, code });
      }
      for (const [code, entry] of next) {
        if (!this.hms.has(code)) changes.push({ kind: "hms_appeared", code, attr: entry.attr, rawCode: entry.code });
      }
      for (const code of this.hms.keys()) {
        if (!next.has(code)) changes.push({ kind: "hms_cleared", code });
      }
      this.hms = next;
    }

    const err = toInt(print.print_error);
    if (err !== undefined && err !== this.printError) {
      if (err !== 0) {
        changes.push({ kind: "print_error", code: formatPrintError(err), value: err, cancelledByUser: err === PRINT_ERROR_CANCELLED });
      } else {
        changes.push({ kind: "print_error_cleared", code: formatPrintError(this.printError) });
      }
      this.printError = err;
    }

    const stage = toInt(print.stg_cur);
    if (stage !== undefined && stage !== this.stage) {
      this.stage = stage;
      this.stages.push({ at: new Date(now).toISOString(), stage });
      if (this.stages.length > MAX_STAGES) this.stages.splice(0, this.stages.length - MAX_STAGES);
    }

    const layer = toInt(print.layer_num);
    if (layer !== undefined) this.layer = layer;

    return changes;
  }

  // Novo job: o histórico de etapas passa a ser o dele, e a camada da impressão
  // anterior não vale mais (senão o FTPS "camada >= 2" dispararia no preparo).
  startJob(now: number = Date.now()): void {
    this.stages = this.stage !== null ? [{ at: new Date(now).toISOString(), stage: this.stage }] : [];
    this.layer = null;
  }

  snapshot(): DiagnosticSnapshot {
    return {
      print_error: this.printError ? formatPrintError(this.printError) : null,
      cancelled_by_user: this.printError === PRINT_ERROR_CANCELLED,
      hms_active: Array.from(this.hms.keys()),
      stage: this.stage,
      stage_label: stageLabel(this.stage),
      layer: this.layer,
      stages: this.stages.slice(),
    };
  }

  // Frase curta para o agent.log quando uma impressão termina sem sucesso.
  failureReason(): string {
    const s = this.snapshot();
    if (s.cancelled_by_user) return "cancelada pela pessoa (na impressora, no app ou no Bambu Studio)";
    const parts: string[] = [];
    if (s.print_error) parts.push(`erro da impressora ${s.print_error}`);
    if (s.hms_active.length) parts.push(`alertas HMS ativos: ${s.hms_active.join(", ")}`);
    if (s.stage_label) parts.push(`etapa: ${s.stage_label}`);
    return parts.length ? parts.join("; ") : "sem código de erro informado pela impressora";
  }
}
