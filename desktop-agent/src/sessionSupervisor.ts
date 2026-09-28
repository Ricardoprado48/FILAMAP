import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { isTokenRevokedAuthError, isTransitoryAuthError } from "./config/sessionManager";

// Supervisor da sessão Supabase do Agent em execução.
//
// Por quê isso existe (incidente 2026-09-27, ver docs/09_CHANGELOG.md):
// autenticateAgentSession() só cuida do STARTUP. Depois disso o Agent
// dependia do auto-refresh do supabase-js sem observar o resultado. Quando
// a sessão foi revogada no servidor (signOut() com escopo global feito por
// outro cliente da mesma conta), o próximo refresh falhou, o supabase-js
// removeu a sessão e passou a mandar a anon key: RLS rejeitou inserts e o
// UPDATE do heartbeat passou a afetar 0 linhas SEM erro. Processo vivo,
// MQTT ok, Agent "offline" para sempre, sem nenhum log útil.
//
// Responsabilidades (e só estas -- nada de regra de negócio aqui):
// 1. Persistir no cofre cada refresh token rotacionado, para que um
//    restart do processo depois de >1h não exija senha de novo.
// 2. Receber sinais de sessão perdida (evento SIGNED_OUT do supabase-js
//    ou heartbeat sem efeito) e recuperar em single-flight:
//      refresh com o último token conhecido (backoff em erro transitório)
//      -> se revogado, pede a senha pelo diálogo já existente, com
//         cooldown entre pedidos e verificação do mesmo user_id.
// 3. Nunca derrubar o processo: todo erro vira log + nova tentativa.

type AuthClient = Pick<
  SupabaseClient["auth"],
  "onAuthStateChange" | "getSession" | "refreshSession" | "signInWithPassword" | "signOut"
>;

export interface SessionSupervisorOptions {
  auth: AuthClient;
  expectedUserId: string;
  initialSession: Session | null;
  getAgentEmail: () => string;
  persistRefreshToken: (refreshToken: string) => Promise<void>;
  askPassword: () => Promise<string>;
  retryDelayMs?: (attempt: number) => number;
  passwordPromptCooldownMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  logInfo?: (message: string) => void;
  logWarn?: (message: string) => void;
}

// Sessão com menos que isso de validade é tratada como já perdida.
const SESSION_MIN_VALIDITY_MS = 60_000;

export class SessionSupervisor {
  private readonly opts: Required<Omit<SessionSupervisorOptions, "initialSession">>;
  private lastKnownRefreshToken: string | null;
  private lastPersistedRefreshToken: string | null;
  private recovering: Promise<void> | null = null;
  private lastPasswordPromptAt = 0;
  private healthy = true;
  private unsubscribe: (() => void) | null = null;

  constructor(options: SessionSupervisorOptions) {
    this.opts = {
      retryDelayMs: (attempt) => Math.min(5000 * Math.pow(2, attempt), 60_000),
      passwordPromptCooldownMs: 15 * 60_000,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      now: () => Date.now(),
      logInfo: console.log,
      logWarn: console.warn,
      ...options,
    };
    this.lastKnownRefreshToken = options.initialSession?.refresh_token ?? null;
    // O startup (authenticateAgentSession) já persistiu este token.
    this.lastPersistedRefreshToken = this.lastKnownRefreshToken;
  }

  start(): void {
    const { data } = this.opts.auth.onAuthStateChange((event, session) => {
      // O callback do supabase-js roda com o lock de auth adquirido: nada
      // de await de chamadas de auth aqui dentro -- só agenda o trabalho.
      if ((event === "TOKEN_REFRESHED" || event === "SIGNED_IN") && session) {
        setTimeout(() => void this.handleNewSession(session), 0);
      } else if (event === "SIGNED_OUT") {
        setTimeout(() => this.reportSessionLost("supabase-js removeu a sessão (SIGNED_OUT)"), 0);
      }
    });
    this.unsubscribe = () => data.subscription.unsubscribe();
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  isHealthy(): boolean {
    return this.healthy;
  }

  // Promise da recuperação em andamento (ou null). Usado por testes e por
  // quem quiser esperar a recuperação terminar.
  currentRecovery(): Promise<void> | null {
    return this.recovering;
  }

  reportSessionLost(reason: string): void {
    if (this.recovering) return;
    this.recovering = this.recover(reason).finally(() => {
      this.recovering = null;
    });
  }

  private async handleNewSession(session: Session): Promise<void> {
    if (session.user?.id !== this.opts.expectedUserId) return;
    this.lastKnownRefreshToken = session.refresh_token;
    if (session.refresh_token && session.refresh_token !== this.lastPersistedRefreshToken) {
      try {
        await this.opts.persistRefreshToken(session.refresh_token);
        this.lastPersistedRefreshToken = session.refresh_token;
      } catch (e: any) {
        this.opts.logWarn(`⚠️ Não foi possível persistir o refresh token renovado: ${e?.message || e}`);
      }
    }
  }

  private async hasUsableSession(): Promise<boolean> {
    try {
      const { data } = await this.opts.auth.getSession();
      const session = data?.session;
      if (!session || session.user?.id !== this.opts.expectedUserId) return false;
      const expiresAtMs = (session.expires_at ?? 0) * 1000;
      return expiresAtMs - this.opts.now() > SESSION_MIN_VALIDITY_MS;
    } catch {
      return false;
    }
  }

  private async recover(reason: string): Promise<void> {
    // Falha de rede no heartbeat não é problema de sessão: se a sessão em
    // memória continua válida, não há nada a recuperar aqui.
    if (await this.hasUsableSession()) return;

    this.healthy = false;
    this.opts.logWarn(`🔐 Sessão Supabase perdida (${reason}). Iniciando recuperação automática...`);

    let attempt = 0;
    while (true) {
      try {
        if (await this.hasUsableSession()) break;

        if (this.lastKnownRefreshToken) {
          const { data, error } = await this.opts.auth.refreshSession({
            refresh_token: this.lastKnownRefreshToken,
          });
          if (!error && data.session) {
            if (data.session.user?.id === this.opts.expectedUserId) {
              await this.handleNewSession(data.session);
              break;
            }
            this.opts.logWarn("⚠️ Refresh devolveu sessão de outro usuário -- descartando.");
            await this.opts.auth.signOut({ scope: "local" });
            this.lastKnownRefreshToken = null;
          } else if (isTransitoryAuthError(error)) {
            const delay = this.opts.retryDelayMs(attempt++);
            this.opts.logWarn(
              `⚠️ Falha de rede ao renovar sessão: ${error?.message || error}. Nova tentativa em ${Math.round(delay / 1000)}s.`
            );
            await this.opts.sleep(delay);
            continue;
          } else {
            // Revogado ou erro não conclusivo: o token não serve mais para
            // este processo. Só a senha recupera.
            this.opts.logWarn(
              `⚠️ Refresh token rejeitado pelo servidor (${error?.message || "sem detalhe"}${
                isTokenRevokedAuthError(error) ? ", revogado" : ""
              }). Novo login necessário.`
            );
            this.lastKnownRefreshToken = null;
          }
        }

        const wait = this.lastPasswordPromptAt
          ? this.lastPasswordPromptAt + this.opts.passwordPromptCooldownMs - this.opts.now()
          : 0;
        if (wait > 0) await this.opts.sleep(wait);

        this.lastPasswordPromptAt = this.opts.now();
        let password: string;
        try {
          password = await this.opts.askPassword();
        } catch (e: any) {
          this.opts.logWarn(
            `⚠️ Login não informado (${e?.message || e}). Novo pedido em ${Math.round(
              this.opts.passwordPromptCooldownMs / 60_000
            )} min; heartbeat e telemetria seguem suspensos até lá.`
          );
          continue;
        }

        const { data, error } = await this.opts.auth.signInWithPassword({
          email: this.opts.getAgentEmail(),
          password,
        });
        if (error || !data.session) {
          if (isTransitoryAuthError(error)) {
            // Senha pode estar certa: não impõe o cooldown do diálogo.
            this.lastPasswordPromptAt = 0;
            const delay = this.opts.retryDelayMs(attempt++);
            this.opts.logWarn(`⚠️ Falha de rede no login: ${error?.message}. Nova tentativa em ${Math.round(delay / 1000)}s.`);
            await this.opts.sleep(delay);
          } else {
            this.opts.logWarn(`⚠️ Falha no login: ${error?.message || "sessão inválida"}.`);
          }
          continue;
        }
        if (data.session.user?.id !== this.opts.expectedUserId) {
          this.opts.logWarn(
            "⚠️ Login feito com outra conta Filamap -- o Agent continua vinculado à conta original. Sessão descartada."
          );
          await this.opts.auth.signOut({ scope: "local" });
          continue;
        }
        await this.handleNewSession(data.session);
        break;
      } catch (e: any) {
        const delay = this.opts.retryDelayMs(attempt++);
        this.opts.logWarn(`⚠️ Erro inesperado na recuperação de sessão: ${e?.message || e}. Nova tentativa em ${Math.round(delay / 1000)}s.`);
        await this.opts.sleep(delay);
      }
    }

    this.healthy = true;
    this.opts.logInfo("✅ Sessão Supabase recuperada. Heartbeat e telemetria retomados.");
  }
}
