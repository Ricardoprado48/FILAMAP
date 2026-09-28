import test from "node:test";
import assert from "node:assert/strict";
import { AuthApiError, AuthRetryableFetchError, SupabaseClient } from "@supabase/supabase-js";
import {
  authenticateAgentSession,
  isTransitoryAuthError,
  isTokenRevokedAuthError,
} from "./sessionManager";
import { AgentSecrets, SecretStore } from "./secretStore";
import { PairingError } from "./devicePairing";

class MemorySecretStore implements SecretStore {
  readonly kind = "memory";
  readonly persists = true;
  public secrets: AgentSecrets;

  constructor(initial: AgentSecrets = { supabaseRefreshToken: null, printerAccessCode: null }) {
    this.secrets = { ...initial };
  }

  async load(): Promise<AgentSecrets> {
    return { ...this.secrets };
  }

  async save(secrets: AgentSecrets): Promise<void> {
    this.secrets = { ...secrets };
  }

  async clear(): Promise<void> {
    this.secrets = { supabaseRefreshToken: null, printerAccessCode: null };
  }
}

test("isTransitoryAuthError detecta corretamente falhas de rede e DNS", () => {
  const fetchErr = new AuthRetryableFetchError("TypeError: fetch failed", 0);
  assert.equal(isTransitoryAuthError(fetchErr), true);

  const dnsErr = new Error("getaddrinfo ENOTFOUND xyz.supabase.co");
  assert.equal(isTransitoryAuthError(dnsErr), true);

  const timeoutErr = new Error("Connection timed out (ETIMEDOUT)");
  assert.equal(isTransitoryAuthError(timeoutErr), true);

  const server500 = { status: 502, message: "Bad Gateway" };
  assert.equal(isTransitoryAuthError(server500), true);

  const apiErr = new AuthApiError("Invalid Refresh Token", 400, "invalid_grant");
  assert.equal(isTransitoryAuthError(apiErr), false);
});

test("isTokenRevokedAuthError detecta token revogado ou inválido", () => {
  const apiErr = new AuthApiError("Invalid Refresh Token: Already Used", 400, "invalid_grant");
  assert.equal(isTokenRevokedAuthError(apiErr), true);

  const fetchErr = new AuthRetryableFetchError("TypeError: fetch failed", 0);
  assert.equal(isTokenRevokedAuthError(fetchErr), false);

  const unknownErr = new Error("Something strange");
  assert.equal(isTokenRevokedAuthError(unknownErr), false);
});

test("A: refresh válido -> autenticação automática", async () => {
  const secretStore = new MemorySecretStore({
    supabaseRefreshToken: "valid-initial-token",
    printerAccessCode: "ACCESS123",
  });

  let refreshCalled = false;
  const fakeSupabase = {
    auth: {
      refreshSession: async ({ refresh_token }: { refresh_token: string }) => {
        refreshCalled = true;
        assert.equal(refresh_token, "valid-initial-token");
        return {
          data: {
            session: {
              refresh_token: "new-rotated-token",
              user: { id: "user-abc" },
            },
          },
          error: null,
        };
      },
    },
  } as unknown as SupabaseClient;

  let promptLoginCalled = false;
  const result = await authenticateAgentSession({
    supabase: fakeSupabase,
    auth: { type: "refresh_token", refreshToken: "valid-initial-token" },
    agentEmail: "test@filamap.com",
    printerAccessCode: "ACCESS123",
    secretStore,
    promptLogin: async () => {
      promptLoginCalled = true;
      return { type: "password", password: "pwd" };
    },
  });

  assert.equal(refreshCalled, true);
  assert.equal(promptLoginCalled, false);
  assert.equal(result.userId, "user-abc");
  assert.equal(result.source, "refresh_token");

  // Novo token rotacionado foi salvo no cofre
  const saved = await secretStore.load();
  assert.equal(saved.supabaseRefreshToken, "new-rotated-token");
  assert.equal(saved.printerAccessCode, "ACCESS123");
});

test("B: primeira tentativa falha por erro transitório e próxima funciona -> nenhuma tela de senha", async () => {
  const secretStore = new MemorySecretStore({
    supabaseRefreshToken: "token-temporarily-offline",
    printerAccessCode: "ACCESS123",
  });

  let calls = 0;
  const fakeSupabase = {
    auth: {
      refreshSession: async () => {
        calls++;
        if (calls === 1) {
          // Primeira falha transitória (ex.: Wi-Fi conectando)
          return {
            data: { session: null },
            error: new AuthRetryableFetchError("TypeError: fetch failed", 0),
          };
        }
        // Segunda tentativa sucede
        return {
          data: {
            session: {
              refresh_token: "token-after-reconnect",
              user: { id: "user-123" },
            },
          },
          error: null,
        };
      },
    },
  } as unknown as SupabaseClient;

  let promptLoginCalled = false;
  const result = await authenticateAgentSession({
    supabase: fakeSupabase,
    auth: { type: "refresh_token", refreshToken: "token-temporarily-offline" },
    agentEmail: "test@filamap.com",
    printerAccessCode: "ACCESS123",
    secretStore,
    sleep: async () => {}, // Instantâneo para teste
    promptLogin: async () => {
      promptLoginCalled = true;
      return { type: "password", password: "pwd" };
    },
  });

  assert.equal(calls, 2);
  assert.equal(promptLoginCalled, false); // Nenhuma tela de senha!
  assert.equal(result.userId, "user-123");

  const saved = await secretStore.load();
  assert.equal(saved.supabaseRefreshToken, "token-after-reconnect");
});

test("C: rede indisponível temporariamente -> token local preservado", async () => {
  const secretStore = new MemorySecretStore({
    supabaseRefreshToken: "token-must-be-preserved",
    printerAccessCode: "ACCESS123",
  });

  const fakeSupabase = {
    auth: {
      refreshSession: async () => {
        return {
          data: { session: null },
          error: new AuthRetryableFetchError("getaddrinfo ENOTFOUND", 0),
        };
      },
    },
  } as unknown as SupabaseClient;

  let promptLoginCalled = false;

  await assert.rejects(
    async () => {
      await authenticateAgentSession({
        supabase: fakeSupabase,
        auth: { type: "refresh_token", refreshToken: "token-must-be-preserved" },
        agentEmail: "test@filamap.com",
        printerAccessCode: "ACCESS123",
        secretStore,
        maxTransitoryRetries: 2,
        sleep: async () => {},
        promptLogin: async () => {
          promptLoginCalled = true;
          return { type: "password", password: "pwd" };
        },
      });
    },
    /Falha de rede ao conectar ao Supabase/
  );

  assert.equal(promptLoginCalled, false);

  // CRÍTICO: Token local NÃO FOI APAGADO!
  const saved = await secretStore.load();
  assert.equal(saved.supabaseRefreshToken, "token-must-be-preserved");
  assert.equal(saved.printerAccessCode, "ACCESS123");
});

test("D: token realmente inválido/revogado -> login é solicitado e token inválido é removido", async () => {
  const secretStore = new MemorySecretStore({
    supabaseRefreshToken: "revoked-token",
    printerAccessCode: "ACCESS123",
  });

  let passwordAuthCalled = false;
  const fakeSupabase = {
    auth: {
      refreshSession: async () => {
        return {
          data: { session: null },
          error: new AuthApiError("Invalid Refresh Token", 400, "invalid_grant"),
        };
      },
      signInWithPassword: async ({ email, password }: any) => {
        passwordAuthCalled = true;
        assert.equal(email, "test@filamap.com");
        assert.equal(password, "user-secret-password");
        return {
          data: {
            session: {
              refresh_token: "new-token-after-password",
              user: { id: "user-logged-in" },
            },
          },
          error: null,
        };
      },
    },
  } as unknown as SupabaseClient;

  let promptLoginCalled = false;
  const result = await authenticateAgentSession({
    supabase: fakeSupabase,
    auth: { type: "refresh_token", refreshToken: "revoked-token" },
    agentEmail: "test@filamap.com",
    printerAccessCode: "ACCESS123",
    secretStore,
    promptLogin: async () => {
      promptLoginCalled = true;
      // Ao ser chamado, confirma que o refresh token anterior foi zerado no store
      const midwayStore = await secretStore.load();
      assert.equal(midwayStore.supabaseRefreshToken, null);
      assert.equal(midwayStore.printerAccessCode, "ACCESS123");

      return { type: "password", password: "user-secret-password" };
    },
  });

  assert.equal(promptLoginCalled, true);
  assert.equal(passwordAuthCalled, true);
  assert.equal(result.userId, "user-logged-in");
  assert.equal(result.source, "password");

  const finalSaved = await secretStore.load();
  assert.equal(finalSaved.supabaseRefreshToken, "new-token-after-password");
  assert.equal(finalSaved.printerAccessCode, "ACCESS123");
});

test("E: login manual bem-sucedido -> novo refresh token é salvo via DPAPI/store", async () => {
  const secretStore = new MemorySecretStore({
    supabaseRefreshToken: null,
    printerAccessCode: "ACCESS123",
  });

  const fakeSupabase = {
    auth: {
      signInWithPassword: async () => ({
        data: {
          session: {
            refresh_token: "fresh-new-token",
            user: { id: "user-456" },
          },
        },
        error: null,
      }),
    },
  } as unknown as SupabaseClient;

  const result = await authenticateAgentSession({
    supabase: fakeSupabase,
    auth: { type: "password", password: "secure-password" },
    agentEmail: "test@filamap.com",
    printerAccessCode: "ACCESS123",
    secretStore,
  });

  assert.equal(result.userId, "user-456");
  const saved = await secretStore.load();
  assert.equal(saved.supabaseRefreshToken, "fresh-new-token");
});

test("F: Access Code permanece preservado em todos os fluxos", async () => {
  const secretStore = new MemorySecretStore({
    supabaseRefreshToken: "some-token",
    printerAccessCode: "CRITICAL_ACCESS_CODE",
  });

  const fakeSupabase = {
    auth: {
      refreshSession: async () => ({
        data: {
          session: {
            refresh_token: "rotated-token",
            user: { id: "user-1" },
          },
        },
        error: null,
      }),
    },
  } as unknown as SupabaseClient;

  await authenticateAgentSession({
    supabase: fakeSupabase,
    auth: { type: "refresh_token", refreshToken: "some-token" },
    agentEmail: "test@filamap.com",
    printerAccessCode: "CRITICAL_ACCESS_CODE",
    secretStore,
  });

  const saved = await secretStore.load();
  assert.equal(saved.printerAccessCode, "CRITICAL_ACCESS_CODE");
});

test("G: Senha nunca é gravada no secretStore", async () => {
  const secretStore = new MemorySecretStore();

  const fakeSupabase = {
    auth: {
      signInWithPassword: async () => ({
        data: {
          session: {
            refresh_token: "my-token",
            user: { id: "user-9" },
          },
        },
        error: null,
      }),
    },
  } as unknown as SupabaseClient;

  await authenticateAgentSession({
    supabase: fakeSupabase,
    auth: { type: "password", password: "ultra-secret-password" },
    agentEmail: "test@filamap.com",
    printerAccessCode: "ACCESS123",
    secretStore,
  });

  const saved = await secretStore.load();
  // SecretStore só contém supabaseRefreshToken e printerAccessCode
  assert.equal((saved as any).password, undefined);
  assert.equal(JSON.stringify(saved).includes("ultra-secret-password"), false);
});

test("H: reinicialização simulada -> sessão restaurada automaticamente sem login", async () => {
  // 1. Simula primeiro boot com login por senha
  const secretStore = new MemorySecretStore();
  const fakeSupabase = {
    auth: {
      signInWithPassword: async () => ({
        data: {
          session: {
            refresh_token: "saved-session-token",
            user: { id: "user-persistent" },
          },
        },
        error: null,
      }),
      refreshSession: async ({ refresh_token }: any) => {
        assert.equal(refresh_token, "saved-session-token");
        return {
          data: {
            session: {
              refresh_token: "next-reboot-token",
              user: { id: "user-persistent" },
            },
          },
          error: null,
        };
      },
    },
  } as unknown as SupabaseClient;

  await authenticateAgentSession({
    supabase: fakeSupabase,
    auth: { type: "password", password: "password123" },
    agentEmail: "test@filamap.com",
    printerAccessCode: "BAMBU_ACCESS",
    secretStore,
  });

  // 2. Simula encerramento do processo e reinicialização automática do Windows
  const reloadedSecrets = await secretStore.load();
  assert.ok(reloadedSecrets.supabaseRefreshToken);

  let promptLoginCalledOnReboot = false;
  const rebootResult = await authenticateAgentSession({
    supabase: fakeSupabase,
    auth: { type: "refresh_token", refreshToken: reloadedSecrets.supabaseRefreshToken! },
    agentEmail: "test@filamap.com",
    printerAccessCode: reloadedSecrets.printerAccessCode!,
    secretStore,
    promptLogin: async () => {
      promptLoginCalledOnReboot = true;
      return { type: "password", password: "fail" };
    },
  });

  // Autenticação automática completada sem intervenção do usuário!
  assert.equal(promptLoginCalledOnReboot, false);
  assert.equal(rebootResult.userId, "user-persistent");
  assert.equal(rebootResult.source, "refresh_token");
});

test("I: token revogado -> promptLogin fornece nova senha -> cliente autentica e sessão é retornada", async () => {
  const secretStore = new MemorySecretStore({
    supabaseRefreshToken: "expired-token",
    printerAccessCode: "OLD_ACCESS",
  });

  let loggedInEmail = "";
  let loggedInPassword = "";
  let sessionStored: any = null;

  const fakeSupabase = {
    auth: {
      refreshSession: async () => {
        return {
          data: { session: null },
          error: new AuthApiError("Invalid Refresh Token", 400, "invalid_grant"),
        };
      },
      signInWithPassword: async ({ email, password }: any) => {
        loggedInEmail = email;
        loggedInPassword = password;
        const session = {
          access_token: "new-access-token",
          refresh_token: "brand-new-refresh-token",
          user: { id: "user-reauth-123" },
        };
        sessionStored = session;
        return {
          data: { session },
          error: null,
        };
      },
      setSession: async (session: any) => {
        sessionStored = session;
        return { data: { session }, error: null };
      },
    },
  } as unknown as SupabaseClient;

  let currentEmail = "old@filamap.com";
  let currentAccessCode = "OLD_ACCESS";

  const result = await authenticateAgentSession({
    supabase: fakeSupabase,
    auth: { type: "refresh_token", refreshToken: "expired-token" },
    agentEmail: currentEmail,
    getAgentEmail: () => currentEmail,
    printerAccessCode: currentAccessCode,
    getPrinterAccessCode: () => currentAccessCode,
    secretStore,
    promptLogin: async () => {
      currentEmail = "newuser@filamap.com";
      currentAccessCode = "NEW_ACCESS_CODE";
      return { type: "password", password: "fresh-password" };
    },
  });

  assert.equal(result.userId, "user-reauth-123");
  assert.equal(result.source, "password");
  assert.equal(loggedInEmail, "newuser@filamap.com");
  assert.equal(loggedInPassword, "fresh-password");
  assert.equal(result.session.access_token, "new-access-token");

  const secrets = await secretStore.load();
  assert.equal(secrets.supabaseRefreshToken, "brand-new-refresh-token");
  assert.equal(secrets.printerAccessCode, "NEW_ACCESS_CODE");
});


test("P1: código de pareamento válido -> sessão própria do computador, refresh salvo, e-mail vindo do servidor", async () => {
  const secretStore = new MemorySecretStore({ supabaseRefreshToken: null, printerAccessCode: "ACCESS123" });
  const setSessionCalls: any[] = [];
  const fakeSupabase = {
    auth: {
      setSession: async (tokens: any) => {
        setSessionCalls.push(tokens);
        return { data: { session: { refresh_token: tokens.refresh_token, user: { id: "user-789", email: "u@x.com" } } }, error: null };
      },
      signInWithPassword: async () => { throw new Error("não deve usar senha"); },
    },
  } as unknown as SupabaseClient;

  const result = await authenticateAgentSession({
    supabase: fakeSupabase,
    auth: { type: "pairing_code", code: "ABCDE-FGHJK" },
    agentEmail: "",
    printerAccessCode: "ACCESS123",
    secretStore,
    pairDevice: async (code) => {
      assert.equal(code, "ABCDE-FGHJK");
      return { deviceId: "d1", userId: "user-789", email: "u@x.com", accessToken: "at", refreshToken: "rt-device" };
    },
    logInfo: () => {},
  });

  assert.equal(result.source, "pairing");
  assert.equal(result.userId, "user-789");
  assert.equal(result.email, "u@x.com");
  assert.deepEqual(setSessionCalls, [{ access_token: "at", refresh_token: "rt-device" }]);
  const saved = await secretStore.load();
  assert.equal(saved.supabaseRefreshToken, "rt-device");
  assert.equal(saved.printerAccessCode, "ACCESS123");
});

test("P2: código errado pergunta de novo; código certo na segunda tentativa entra", async () => {

  const secretStore = new MemorySecretStore({ supabaseRefreshToken: null, printerAccessCode: "ACCESS123" });
  const fakeSupabase = {
    auth: {
      setSession: async (tokens: any) => ({ data: { session: { refresh_token: tokens.refresh_token, user: { id: "u1" } } }, error: null }),
    },
  } as unknown as SupabaseClient;
  const codes: string[] = [];
  let prompts = 0;

  const result = await authenticateAgentSession({
    supabase: fakeSupabase,
    auth: { type: "pairing_code", code: "ERRAD-OOOOO" },
    agentEmail: "",
    printerAccessCode: "ACCESS123",
    secretStore,
    pairDevice: async (code) => {
      codes.push(code);
      if (code !== "CERTO-22222") throw new PairingError("invalid_code", "Código inválido");
      return { deviceId: "d1", userId: "u1", email: "", accessToken: "at", refreshToken: "rt-ok" };
    },
    promptLogin: async () => { prompts++; return { type: "pairing_code", code: "CERTO-22222" }; },
    logInfo: () => {},
    logWarn: () => {},
  });

  assert.equal(result.userId, "u1");
  assert.equal(prompts, 1);
  assert.deepEqual(codes, ["ERRAD-OOOOO", "CERTO-22222"]);
});

test("P3: falha de rede no pareamento NÃO reabre o diálogo (propaga para o chamador)", async () => {

  let prompts = 0;
  await assert.rejects(
    () =>
      authenticateAgentSession({
        supabase: { auth: {} } as unknown as SupabaseClient,
        auth: { type: "pairing_code", code: "ABCDE-FGHJK" },
        agentEmail: "",
        printerAccessCode: "",
        secretStore: new MemorySecretStore(),
        pairDevice: async () => { throw new PairingError("network", "Sem conexão"); },
        promptLogin: async () => { prompts++; return { type: "pairing_code", code: "X" }; },
      }),
    /Sem conexão/
  );
  assert.equal(prompts, 0);
});
