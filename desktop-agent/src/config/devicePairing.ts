import os from "node:os";

// Pareamento do computador com a conta Filamap (credencial por dispositivo).
//
// O usuário gera um código na Web ("Conectar computador") e digita aqui. A
// Edge Function agent-pair troca o código por uma sessão Supabase própria
// deste computador -- a senha da conta nunca passa pelo Agent. Desconectar o
// computador na Web apaga só esta sessão.

export const PAIRING_CODE_LENGTH = 10;
// Mesmo alfabeto de create_agent_pairing_code (sem 0/O/1/I/L).
const PAIRING_ALPHABET = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]+$/;

export type PairingErrorKind = "invalid_format" | "invalid_code" | "network" | "server";

export class PairingError extends Error {
  constructor(readonly kind: PairingErrorKind, message: string) {
    super(message);
    this.name = "PairingError";
  }
}

export interface PairingResult {
  deviceId: string;
  userId: string;
  email: string;
  accessToken: string;
  refreshToken: string;
}

// "abcde-fghjk", "ABCDE FGHJK" -> "ABCDEFGHJK". Devolve null se não tem cara
// de código (evita gastar uma chamada ao servidor com erro de digitação).
export function normalizePairingCode(input: string): string | null {
  const cleaned = (input || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (cleaned.length !== PAIRING_CODE_LENGTH || !PAIRING_ALPHABET.test(cleaned)) return null;
  return cleaned;
}

export function defaultDeviceName(): string {
  return (os.hostname() || "Computador").slice(0, 80);
}

export interface PairAgentDeviceOptions {
  supabaseUrl: string;
  supabaseAnonKey: string;
  code: string;
  deviceName?: string;
  agentVersion?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export async function pairAgentDevice(options: PairAgentDeviceOptions): Promise<PairingResult> {
  const code = normalizePairingCode(options.code);
  if (!code) {
    throw new PairingError(
      "invalid_format",
      `Código inválido. Use o código de ${PAIRING_CODE_LENGTH} caracteres gerado em "Conectar computador" na Web.`
    );
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(`${options.supabaseUrl.replace(/\/$/, "")}/functions/v1/agent-pair`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: options.supabaseAnonKey,
        Authorization: `Bearer ${options.supabaseAnonKey}`,
      },
      body: JSON.stringify({
        code,
        device_name: options.deviceName || defaultDeviceName(),
        agent_version: options.agentVersion ?? null,
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
    });
  } catch (e: any) {
    throw new PairingError("network", `Sem conexão com o servidor Filamap: ${e?.message || e}`);
  }

  let body: any = null;
  try {
    body = await response.json();
  } catch {}

  if (response.status === 400 && body?.error === "invalid_code") {
    throw new PairingError("invalid_code", "Código inválido, expirado ou já usado. Gere um novo código na Web.");
  }
  if (response.status >= 500 || response.status === 0) {
    throw new PairingError("network", `Servidor Filamap indisponível (HTTP ${response.status}). Tente novamente.`);
  }
  if (
    !response.ok ||
    typeof body?.access_token !== "string" ||
    typeof body?.refresh_token !== "string" ||
    typeof body?.user_id !== "string"
  ) {
    throw new PairingError("server", `Resposta inesperada do servidor (HTTP ${response.status}).`);
  }

  return {
    deviceId: String(body.device_id ?? ""),
    userId: body.user_id,
    email: String(body.email ?? ""),
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
  };
}
