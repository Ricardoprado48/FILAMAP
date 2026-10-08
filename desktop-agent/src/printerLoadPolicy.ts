// Modo leve: o quanto o Agent pesa sobre a impressora (incidente 2026-10-02 a 10-08).
//
// Com `pushall` a cada 10s e download FTPS no início de cada job, a A1 derrubava
// a conexão MQTT ~6x/dia e várias falhas de impressão coincidiram com a queda.
// Regras daqui:
// - pushall (status completo) só ao conectar e, depois, só se a impressora ficar
//   PUSHALL_IDLE_MS sem mandar nenhum relatório -- ela já envia as mudanças sozinha
//   e a máquina de estados aceita relatórios parciais;
// - o .3mf só é baixado com a impressão já rodando (fora do preparo/calibração);
// - reconexão depois de queda com espera crescente, para não insistir justamente
//   quando a impressora está sobrecarregada.

export const PUSHALL_IDLE_MS = 5 * 60_000;

export function shouldRequestFullStatus(s: { now: number; lastReportAt: number; lastPushallAt: number }): boolean {
  return s.now - s.lastReportAt >= PUSHALL_IDLE_MS && s.now - s.lastPushallAt >= PUSHALL_IDLE_MS;
}

// Camada mínima (ou percentual) para considerar que a impressão saiu do preparo
// (nivelamento, aquecimento, carga de filamento, calibração de fluxo).
export const SLICE_FETCH_MIN_LAYER = 2;
export const SLICE_FETCH_MIN_PERCENT = 2;

export function shouldFetchSliceInfoNow(s: {
  gcodeState: string;
  layerNum: number | undefined;
  percent: number | undefined;
  alreadyAttempted: boolean;
  hasSliceInfo: boolean;
}): boolean {
  if (s.alreadyAttempted || s.hasSliceInfo) return false;
  if (s.gcodeState !== "RUNNING") return false;
  return (s.layerNum ?? 0) >= SLICE_FETCH_MIN_LAYER || (s.percent ?? 0) >= SLICE_FETCH_MIN_PERCENT;
}

export const RECONNECT_DELAYS_MS = [10_000, 30_000, 60_000, 120_000, 300_000, 600_000];
export const RECONNECT_WINDOW_MS = 60 * 60_000;

// Espera antes de reconectar, pela quantidade de quedas na última hora
// (incluindo a atual). Quedas antigas saem da janela e a espera volta a 10s.
export function reconnectDelayMs(dropTimes: number[], now: number): number {
  const recent = dropTimes.filter((t) => now - t < RECONNECT_WINDOW_MS && t <= now).length;
  const idx = Math.min(Math.max(recent, 1), RECONNECT_DELAYS_MS.length) - 1;
  return RECONNECT_DELAYS_MS[idx];
}

export function pruneDrops(dropTimes: number[], now: number): number[] {
  return dropTimes.filter((t) => now - t < RECONNECT_WINDOW_MS);
}
