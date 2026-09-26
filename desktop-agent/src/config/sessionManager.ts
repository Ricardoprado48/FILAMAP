import {
  isAuthApiError,
  isAuthRetryableFetchError,
  SupabaseClient,
  Session,
} from "@supabase/supabase-js";
import { AuthStrategy, persistSessionSecrets } from "./onboarding";
import { SecretStore } from "./secretStore";

export interface AuthenticateSessionOptions {
  supabase: SupabaseClient;
  auth: AuthStrategy;
  agentEmail: string;
  getAgentEmail?: () => string;
  printerAccessCode: string;
  getPrinterAccessCode?: () => string;
  secretStore: SecretStore;
  promptLogin?: () => Promise<AuthStrategy>;
  maxTransitoryRetries?: number;
  retryDelayMs?: (attempt: number) => number;
  sleep?: (ms: number) => Promise<void>;
  logWarn?: (message: string) => void;
  logInfo?: (message: string) => void;
}

export interface AuthenticatedSessionResult {
  session: Session;
  userId: string;
  source: "refresh_token" | "password";
}

/**
 * Identifica se um erro retornado pelo Supabase Auth é transitório (rede/DNS/servidor temporário).
 * Em erros transitórios, o refresh token local NUNCA deve ser apagado.
 */
export function isTransitoryAuthError(error: unknown): boolean {
  if (!error) return false;

  if (isAuthRetryableFetchError(error)) {
    return true;
  }

  const err = error as Record<string, unknown>;
  const status = typeof err.status === "number" ? err.status : undefined;
  if (status === 0 || (status !== undefined && status >= 500)) {
    return true;
  }

  const message = String(err.message || "").toLowerCase();
  const name = String(err.name || "").toLowerCase();

  const transitoryPatterns = [
    "fetch failed",
    "enotfound",
    "etimedout",
    "econnrefused",
    "econnreset",
    "network",
    "timeout",
    "retryable",
    "abort",
    "eai_again",
  ];

  return transitoryPatterns.some((p) => message.includes(p) || name.includes(p));
}

/**
 * Identifica se o Supabase Auth respondeu explicitamente que o refresh token
 * é inválido, revogado ou expirado no servidor.
 */
export function isTokenRevokedAuthError(error: unknown): boolean {
  if (!error) return false;

  if (isTransitoryAuthError(error)) {
    return false;
  }

  if (isAuthApiError(error)) {
    const status = error.status;
    const code = String(error.code || "").toLowerCase();
    const msg = String(error.message || "").toLowerCase();

    if (status === 400 || status === 401 || status === 422) {
      if (
        code === "invalid_grant" ||
        code === "invalid_refresh_token" ||
        code === "refresh_token_not_found" ||
        msg.includes("invalid refresh token") ||
        msg.includes("already used") ||
        msg.includes("revoked") ||
        msg.includes("not found")
      ) {
        return true;
      }
    }
  }

  const err = error as Record<string, unknown>;
  const msg = String(err.message || "").toLowerCase();
  if (
    msg.includes("invalid refresh token") ||
    msg.includes("refresh_token_not_found") ||
    msg.includes("token is expired")
  ) {
    return true;
  }

  return false;
}

/**
 * Autentica o Desktop Agent garantindo:
 * 1. Sessões salvas reutilizam refresh token sem pedir senha.
 * 2. Erros transitórios de rede aplicam retry com backoff e NUNCA apagam o segredo.
 * 3. Apenas token comprovadamente revogado/expirado aciona o diálogo interativo de login.
 * 4. Senhas nunca são persistidas em disco; refresh token e Access Code são protegidos no cofre.
 */
export async function authenticateAgentSession(
  options: AuthenticateSessionOptions
): Promise<AuthenticatedSessionResult> {
  const {
    supabase,
    agentEmail,
    printerAccessCode,
    secretStore,
    maxTransitoryRetries = 4,
    retryDelayMs = (attempt) => Math.min(1000 * Math.pow(2, attempt), 10000),
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    logWarn = console.warn,
    logInfo = console.log,
  } = options;

  let currentAuth = options.auth;

  // 1. Caminho de autenticação por refresh_token
  if (currentAuth.type === "refresh_token") {
    let attempt = 0;
    while (true) {
      const result = await supabase.auth.refreshSession({
        refresh_token: currentAuth.refreshToken,
      });

      if (!result.error && result.data.session) {
        const session = result.data.session;
        // Salva o novo refresh token emitido pelo Supabase
        await persistSessionSecrets(
          secretStore,
          session.refresh_token ?? currentAuth.refreshToken,
          printerAccessCode
        );
        return {
          session,
          userId: session.user.id,
          source: "refresh_token",
        };
      }

      const error = result.error;

      // Se for falha transitória de rede (ex.: Wi-Fi ligando no boot)
      if (isTransitoryAuthError(error)) {
        if (attempt < maxTransitoryRetries) {
          const delay = retryDelayMs(attempt);
          logWarn(
            `⚠️ Falha de rede ao renovar sessão (tentativa ${attempt + 1}/${maxTransitoryRetries + 1}): ${
              error?.message || error
            }. Nova tentativa em ${delay / 1000}s...`
          );
          attempt++;
          await sleep(delay);
          continue;
        }

        // Excedeu retries transitórios: PRESERVA o token local e lança erro previsível
        logWarn(
          "⚠️ Rede indisponível após várias tentativas. O token de sessão local foi preservado com segurança."
        );
        throw new Error(
          `Falha de rede ao conectar ao Supabase: ${error?.message || "Serviço inacessível"}`
        );
      }

      // Se for comprovadamente revogado/expirado
      if (isTokenRevokedAuthError(error)) {
        logWarn("⚠️ Sessão salva expirou ou foi revogada no servidor. Solicitando novo login.");

        // Remove apenas o refresh token inválido, preservando o Access Code da impressora
        await persistSessionSecrets(secretStore, null, printerAccessCode);

        if (!options.promptLogin) {
          throw new Error("Sessão expirada e nenhum mecanismo de prompt disponível.");
        }

        // Abre diálogo de login
        currentAuth = await options.promptLogin();
        break;
      }

      // Erro desconhecido que não é categoricamente revogação: por cautela não apaga o token
      logWarn(
        `⚠️ Erro não conclusivo ao tentar renovar sessão: ${error?.message || error}. O token local foi preservado.`
      );
      throw error || new Error("Erro desconhecido durante autenticação");
    }
  }

  // 2. Caminho de autenticação por e-mail/senha
  if (currentAuth.type === "password") {
    const emailToUse = options.getAgentEmail ? options.getAgentEmail() : agentEmail;
    const accessCodeToUse = options.getPrinterAccessCode ? options.getPrinterAccessCode() : printerAccessCode;

    const result = await supabase.auth.signInWithPassword({
      email: emailToUse,
      password: currentAuth.password,
    });

    if (result.error || !result.data.session) {
      throw new Error(`Falha no login com senha: ${result.error?.message || "Sessão inválida"}`);
    }

    const session = result.data.session;
    // Persiste o novo refresh token obtido (senha é descartada da memória)
    await persistSessionSecrets(
      secretStore,
      session.refresh_token ?? null,
      accessCodeToUse
    );

    logInfo("✅ Autenticado com sucesso via e-mail e senha. Nova sessão persistida.");

    return {
      session,
      userId: session.user.id,
      source: "password",
    };
  }

  throw new Error("Estratégia de autenticação não suportada.");
}
