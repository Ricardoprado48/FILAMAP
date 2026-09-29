// Sanitização de TUDO que sai da máquina para a Central de Observabilidade
// (PACOTE_CONSTRUCAO_OBSERVABILIDADE_FILAMAP_V1, seção 10).
//
// ARQUIVO IDÊNTICO em desktop-agent/src/observability/sanitize.ts e
// web-app/src/observability/sanitize.ts (sem dependência de Node nem de
// browser). Um teste compara os dois -- alterar um exige alterar o outro.
//
// Nunca lança: qualquer falha interna devolve um marcador, nunca o original.

export const REDACTED = "[REDACTED]";
export const LIMITS = { message: 500, stack: 1500, metaString: 300, metaBytes: 3500, depth: 4, array: 20 };

const SENSITIVE_KEY = /pass|secret|token|jwt|cookie|authorization|access.?code|api.?key|session|credential|private/i;

const PATTERNS: Array<[RegExp, string]> = [
  [/-----BEGIN [A-Z ]*KEY-----[\s\S]*?(-----END [A-Z ]*KEY-----|$)/g, REDACTED],
  [/eyJ[\w-]+\.[\w-]+\.[\w-]*/g, REDACTED],
  [/\bBearer\s+\S+/gi, `Bearer ${REDACTED}`],
  [/\bsb-[\w-]+-auth-token\b/g, REDACTED],
  [/(["']?(?:password|senha|access_code|refresh_token|access_token|apikey)["']?\s*[:=]\s*)(["']?)[^"'\s,}&]+/gi, `$1$2${REDACTED}`],
  // Blocos longos sem hífen (base64/hex de chave). UUID tem hífens a cada <=12 chars e passa.
  [/[A-Za-z0-9+/=_]{32,}/g, REDACTED],
  [/([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g, "$1***@$2"],
  [/([A-Za-z]:\\Users\\)[^\\/\s"']+/gi, "$1<user>"],
  [/(\/(?:home|Users)\/)[^/\s"']+/g, "$1<user>"],
];

export interface Sanitizer {
  registerSecret(value: string | null | undefined): void;
  text(value: unknown, max?: number): string;
  metadata(value: unknown): Record<string, unknown>;
  status(value: Record<string, unknown>): Record<string, unknown>;
}

export function createSanitizer(): Sanitizer {
  let secrets: string[] = [];

  function registerSecret(value: string | null | undefined): void {
    try {
      if (typeof value !== "string" || value.length < 4 || secrets.includes(value)) return;
      secrets = [...secrets, value].sort((a, b) => b.length - a.length).slice(0, 50);
    } catch {
      // registrar segredo nunca pode quebrar quem chamou
    }
  }

  function text(value: unknown, max = LIMITS.message): string {
    try {
      let s = value instanceof Error ? `${value.name}: ${value.message}` : typeof value === "string" ? value : String(value);
      for (const secret of secrets) s = s.split(secret).join(REDACTED);
      if (/<html[\s>]/i.test(s) || /<!doctype html/i.test(s)) {
        const title = /<title[^>]*>([^<]{0,120})<\/title>/i.exec(s)?.[1]?.trim();
        s = title ? `[html] ${title}` : "[html]";
      }
      for (const [re, rep] of PATTERNS) s = s.replace(re, rep);
      return s.length > max ? s.slice(0, max - 1) + "…" : s;
    } catch {
      return "[sanitize_failed]";
    }
  }

  function walk(value: unknown, depth: number, seen: WeakSet<object>): unknown {
    if (value === null || typeof value === "number" || typeof value === "boolean") return value;
    if (typeof value === "string") return text(value, LIMITS.metaString);
    if (typeof value === "bigint") return value.toString();
    if (typeof value !== "object") return undefined;
    if (seen.has(value as object)) return "[circular]";
    if (depth >= LIMITS.depth) return "[depth]";
    seen.add(value as object);
    if (value instanceof Error) return text(value, LIMITS.metaString);
    if (Array.isArray(value)) return value.slice(0, LIMITS.array).map((v) => walk(v, depth + 1, seen));
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 40)) {
      out[k] = SENSITIVE_KEY.test(k) ? REDACTED : walk(v, depth + 1, seen);
    }
    return out;
  }

  function metadata(value: unknown): Record<string, unknown> {
    try {
      if (value === undefined || value === null) return {};
      const cleaned = walk(value, 0, new WeakSet());
      const obj = cleaned && typeof cleaned === "object" && !Array.isArray(cleaned) ? (cleaned as Record<string, unknown>) : { value: cleaned };
      if (JSON.stringify(obj).length > LIMITS.metaBytes) {
        return { truncated: true, keys: Object.keys(obj).slice(0, 20) };
      }
      return obj;
    } catch {
      return { sanitize_failed: true };
    }
  }

  // Status da instalação: montado pelo próprio código com valores enumerados
  // (sem texto livre de terceiros) -- chaves NÃO são redigidas (ex.: "session"),
  // mas todo texto passa pelos padrões.
  function status(value: Record<string, unknown>): Record<string, unknown> {
    try {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value).slice(0, 30)) {
        out[k] = typeof v === "string" ? text(v, 120) : typeof v === "number" || typeof v === "boolean" || v === null ? v : undefined;
      }
      return out;
    } catch {
      return {};
    }
  }

  return { registerSecret, text, metadata, status };
}

// Stack: só frames, sem o texto de mensagem repetido; caminhos de usuário mascarados.
export function sanitizeStack(s: Sanitizer, stack: unknown): string | undefined {
  if (typeof stack !== "string" || !stack) return undefined;
  return s.text(stack, LIMITS.stack);
}

// Agrupamento de erros: mesma causa = mesma impressão digital, sem números/IDs.
export function fingerprint(component: string, errorCode: string | undefined, message: string, stack?: string): string {
  const normalized = message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>")
    .replace(/\d+/g, "N")
    .slice(0, 200);
  const frame = (stack || "").split("\n").find((l) => /^\s+at /.test(l))?.trim().replace(/:\d+:\d+\)?$/, "") || "";
  return fnv1a64(`${component}|${errorCode || ""}|${normalized}|${frame}`);
}

function fnv1a64(input: string): string {
  // FNV-1a 64 bits com duas metades de 32 (sem BigInt/crypto: roda igual no Node e no browser).
  let h1 = 0x811c9dc5, h2 = 0xcbf29ce4;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c + i), 0x01000193) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}
