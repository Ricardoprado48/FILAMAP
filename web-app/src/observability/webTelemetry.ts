import { supabase } from "../lib/supabase";
import { createSanitizer, fingerprint } from "./sanitize";

// Telemetria do app Web para a Central de Observabilidade: só WEB_ERROR e
// SUPPORT_REQUEST. Mesmas regras do Agent: nunca lança, nunca bloqueia a
// tela, sem sessão não envia, fila pequena em memória.

declare const __APP_VERSION__: string | undefined;
export const WEB_VERSION = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";

type WebEventType = "WEB_ERROR" | "SUPPORT_REQUEST";

interface WebEvent {
  client_event_id: string;
  boot_id: string;
  seq: number;
  occurred_at: string;
  event_type: WebEventType;
  severity: "INFO" | "ERROR";
  component: string;
  error_code?: string;
  fingerprint?: string;
  message?: string;
  repeat_count: number;
  metadata: Record<string, unknown>;
}

const MAX_QUEUE = 50;
const MAX_PER_SESSION = 100;
const WINDOW_MS = 60_000;

export const sanitizer = createSanitizer();
const bootId = uuid();
let seq = 0;
let emitted = 0;
let queue: WebEvent[] = [];
const windows = new Map<string, { until: number; suppressed: number }>();
let flushing: Promise<boolean> | null = null;
let started = false;

function uuid(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch {}
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
    (Number(c) ^ (Math.floor(Math.random() * 16) >> (Number(c) / 4))).toString(16)
  );
}

export function webInstallationId(): string {
  try {
    const key = "filamap_web_install_id";
    const found = localStorage.getItem(key);
    if (found && /^[0-9a-f-]{36}$/i.test(found)) return found;
    const id = uuid();
    localStorage.setItem(key, id);
    return id;
  } catch {
    return bootId; // sem armazenamento: vale só nesta aba
  }
}

export function webEmit(
  type: WebEventType,
  fields: { error?: unknown; message?: string; component?: string; metadata?: Record<string, unknown> } = {}
): void {
  try {
    const now = Date.now();
    const component = fields.component ? sanitizer.text(fields.component, 40) : "web";
    const message = sanitizer.text(fields.message ?? (fields.error !== undefined ? fields.error : ""), 500);
    const stack = fields.error instanceof Error ? fields.error.stack : undefined;
    const code = (fields.error as any)?.code;
    let repeat = 1;
    let fp: string | undefined;
    if (type === "WEB_ERROR") {
      fp = fingerprint(component, code ? String(code) : undefined, message, stack);
      const w = windows.get(fp);
      if (w && now < w.until) {
        w.suppressed++;
        return;
      }
      repeat = 1 + (w?.suppressed ?? 0);
      windows.set(fp, { until: now + WINDOW_MS, suppressed: 0 });
    }
    if (emitted >= MAX_PER_SESSION) return;
    emitted++;
    const metadata = sanitizer.metadata(fields.metadata ?? {});
    const room = 3700 - JSON.stringify(metadata).length;
    if (stack && room > 200) metadata.stack = sanitizer.text(stack, Math.min(1500, room - 50));
    queue.push({
      client_event_id: uuid(),
      boot_id: bootId,
      seq: ++seq,
      occurred_at: new Date(now).toISOString(),
      event_type: type,
      severity: type === "WEB_ERROR" ? "ERROR" : "INFO",
      component,
      error_code: code ? sanitizer.text(String(code), 80) : undefined,
      fingerprint: fp,
      message: message || undefined,
      repeat_count: repeat,
      metadata,
    });
    if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
  } catch {
    // observabilidade nunca derruba a tela
  }
}

// true = enviado (ou nada a enviar). Sem sessão, mantém a fila.
export function flushWebTelemetry(): Promise<boolean> {
  if (flushing) return flushing;
  flushing = doFlush().finally(() => {
    flushing = null;
  });
  return flushing;
}

async function doFlush(): Promise<boolean> {
  try {
    if (queue.length === 0) return true;
    const { data } = await supabase.auth.getSession();
    if (!data.session) return false;
    const batch = queue.slice(0, 50);
    const { data: res, error } = await supabase.rpc("ingest_ops_events", {
      p_installation: {
        installation_id: webInstallationId(),
        kind: "web",
        app_version: WEB_VERSION,
        status: sanitizer.status({ online: typeof navigator !== "undefined" ? navigator.onLine : null, standalone: isStandalone() }),
      },
      p_events: batch,
    });
    if (error || (res as any)?.ok !== true) return false;
    const sent = new Set(batch.map((e) => e.client_event_id));
    queue = queue.filter((e) => !sent.has(e.client_event_id));
    return true;
  } catch {
    return false;
  }
}

function isStandalone(): boolean {
  try {
    return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as any).standalone === true;
  } catch {
    return false;
  }
}

export function startWebTelemetry(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  try {
    window.addEventListener("error", (e) => webEmit("WEB_ERROR", { error: e.error ?? e.message, component: "window.onerror" }));
    window.addEventListener("unhandledrejection", (e) => webEmit("WEB_ERROR", { error: e.reason, component: "unhandledrejection" }));
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") void flushWebTelemetry();
    });
    window.setInterval(() => void flushWebTelemetry(), 60_000);
    supabase.auth.onAuthStateChange((_event, session) => {
      sanitizer.registerSecret(session?.access_token);
      sanitizer.registerSecret(session?.refresh_token);
    });
  } catch {
    // idem
  }
}

// Para testes.
export function _resetWebTelemetryForTests(): void {
  queue = [];
  seq = 0;
  emitted = 0;
  windows.clear();
}
export function _webQueueForTests(): readonly WebEvent[] {
  return queue;
}
