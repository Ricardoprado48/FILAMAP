import test from "node:test";
import assert from "node:assert/strict";
import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";
import { SessionSupervisor } from "./sessionSupervisor";

const USER = "user-1";
const NOW = 1_800_000_000_000;

function session(refresh: string, userId = USER, expiresInS = 3600): any {
  return {
    access_token: `at-${refresh}`,
    refresh_token: refresh,
    expires_at: Math.floor(NOW / 1000) + expiresInS,
    user: { id: userId },
  };
}

// Fake mínimo de supabase.auth: só o que o supervisor usa.
function fakeAuth() {
  const state = {
    current: null as any,
    listener: null as null | ((event: string, s: any) => void),
    refreshCalls: [] as string[],
    signInCalls: 0,
    signOutCalls: [] as any[],
    refreshImpl: async (_rt: string): Promise<any> => ({ data: { session: null }, error: null }),
    signInImpl: async (_pw: string): Promise<any> => ({ data: { session: session("rt-pw") }, error: null }),
  };
  const auth: any = {
    onAuthStateChange(cb: any) {
      state.listener = cb;
      return { data: { subscription: { unsubscribe() { state.listener = null; } } } };
    },
    async getSession() {
      return { data: { session: state.current }, error: null };
    },
    async refreshSession({ refresh_token }: { refresh_token: string }) {
      state.refreshCalls.push(refresh_token);
      const r = await state.refreshImpl(refresh_token);
      if (r.data?.session) state.current = r.data.session;
      return r;
    },
    async signInWithPassword({ password }: { password: string }) {
      state.signInCalls++;
      const r = await state.signInImpl(password);
      if (r.data?.session) state.current = r.data.session;
      return r;
    },
    async signOut(opts: any) {
      state.signOutCalls.push(opts);
      state.current = null;
      return { error: null };
    },
  };
  return { auth, state };
}

function build(overrides: Partial<ConstructorParameters<typeof SessionSupervisor>[0]> = {}) {
  const { auth, state } = fakeAuth();
  const persisted: string[] = [];
  const sleeps: number[] = [];
  const prompts = { count: 0 };
  let clock = NOW;
  const sup = new SessionSupervisor({
    auth,
    expectedUserId: USER,
    initialSession: session("rt-0"),
    getAgentEmail: () => "a@b.c",
    persistRefreshToken: async (rt) => { persisted.push(rt); },
    askPassword: async () => { prompts.count++; return "secret"; },
    sleep: async (ms) => { sleeps.push(ms); clock += ms; },
    now: () => clock,
    logInfo: () => {},
    logWarn: () => {},
    ...overrides,
  });
  return { sup, auth, state, persisted, sleeps, prompts };
}

const tick = () => new Promise((r) => setTimeout(r, 5));

test("persiste cada refresh token rotacionado (restart após >1h não exige senha)", async () => {
  const { sup, state, persisted } = build();
  sup.start();
  state.listener!("TOKEN_REFRESHED", session("rt-1"));
  await tick();
  state.listener!("TOKEN_REFRESHED", session("rt-1")); // repetido: não regrava
  state.listener!("TOKEN_REFRESHED", session("rt-2"));
  await tick();
  assert.deepEqual(persisted, ["rt-1", "rt-2"]);
});

test("ignora sessão de outro usuário no evento de auth", async () => {
  const { sup, state, persisted } = build();
  sup.start();
  state.listener!("SIGNED_IN", session("rt-x", "intruso"));
  await tick();
  assert.deepEqual(persisted, []);
});

test("falha de rede no heartbeat com sessão válida NÃO dispara refresh nem senha", async () => {
  const { sup, state, prompts } = build();
  state.current = session("rt-0");
  sup.reportSessionLost("heartbeat: fetch failed");
  await sup.currentRecovery();
  assert.equal(state.refreshCalls.length, 0);
  assert.equal(prompts.count, 0);
  assert.equal(sup.isHealthy(), true);
});

test("SIGNED_OUT com refresh token ainda válido recupera sem pedir senha", async () => {
  const { sup, state, prompts, persisted } = build();
  state.refreshImpl = async () => ({ data: { session: session("rt-1") }, error: null });
  sup.start();
  state.listener!("SIGNED_OUT", null);
  await tick();
  await sup.currentRecovery();
  assert.deepEqual(state.refreshCalls, ["rt-0"]);
  assert.equal(prompts.count, 0);
  assert.deepEqual(persisted, ["rt-1"]);
  assert.equal(sup.isHealthy(), true);
});

test("Supabase/internet fora: backoff crescente, token preservado, recupera quando volta", async () => {
  const { sup, state, sleeps, prompts } = build();
  let calls = 0;
  state.refreshImpl = async () => {
    calls++;
    if (calls <= 3) return { data: { session: null }, error: new AuthRetryableFetchError("fetch failed", 0) };
    return { data: { session: session("rt-1") }, error: null };
  };
  sup.reportSessionLost("teste");
  assert.equal(sup.isHealthy(), true); // ainda não avaliou
  await sup.currentRecovery();
  assert.deepEqual(state.refreshCalls, ["rt-0", "rt-0", "rt-0", "rt-0"]);
  assert.deepEqual(sleeps, [5000, 10000, 20000]);
  assert.equal(prompts.count, 0);
  assert.equal(sup.isHealthy(), true);
});

test("sessão revogada (cenário do incidente): pede senha, faz login e persiste", async () => {
  const { sup, state, prompts, persisted } = build();
  state.refreshImpl = async () => ({
    data: { session: null },
    error: new AuthApiError("Invalid Refresh Token: Refresh Token Not Found", 400, "refresh_token_not_found"),
  });
  sup.reportSessionLost("SIGNED_OUT");
  await sup.currentRecovery();
  assert.equal(prompts.count, 1);
  assert.equal(state.signInCalls, 1);
  assert.deepEqual(persisted, ["rt-pw"]);
  assert.equal(sup.isHealthy(), true);
});

test("usuário cancela o diálogo: respeita cooldown e pergunta de novo, sem derrubar nada", async () => {
  let asked = 0;
  const { sup, state, sleeps } = build({
    askPassword: async () => {
      asked++;
      if (asked === 1) throw new Error("Login do Filamap foi cancelado.");
      return "secret";
    },
    passwordPromptCooldownMs: 900_000,
  });
  state.refreshImpl = async () => ({ data: { session: null }, error: new AuthApiError("revoked", 400, "invalid_grant") });
  sup.reportSessionLost("teste");
  await sup.currentRecovery();
  assert.equal(asked, 2);
  assert.deepEqual(sleeps, [900_000]);
  assert.equal(sup.isHealthy(), true);
});

test("login com outra conta é rejeitado e descartado localmente", async () => {
  let n = 0;
  const { sup, state, persisted } = build({ passwordPromptCooldownMs: 1 });
  state.refreshImpl = async () => ({ data: { session: null }, error: new AuthApiError("revoked", 400, "invalid_grant") });
  state.signInImpl = async () => {
    n++;
    return { data: { session: n === 1 ? session("rt-other", "outra-conta") : session("rt-ok") }, error: null };
  };
  sup.reportSessionLost("teste");
  await sup.currentRecovery();
  assert.deepEqual(state.signOutCalls, [{ scope: "local" }]);
  assert.deepEqual(persisted, ["rt-ok"]);
});

test("sinais repetidos durante a recuperação não criam recuperação paralela", async () => {
  const { sup, state } = build();
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  state.refreshImpl = async () => {
    await gate;
    return { data: { session: session("rt-1") }, error: null };
  };
  sup.reportSessionLost("a");
  const first = sup.currentRecovery();
  await tick();
  sup.reportSessionLost("b");
  sup.reportSessionLost("c");
  assert.equal(sup.currentRecovery(), first);
  release();
  await first;
  assert.equal(state.refreshCalls.length, 1);
});

test("exceção inesperada dentro da recuperação não escapa (processo não cai)", async () => {
  const { sup, state } = build();
  let calls = 0;
  state.refreshImpl = async () => {
    calls++;
    if (calls === 1) throw new Error("boom");
    return { data: { session: session("rt-1") }, error: null };
  };
  sup.reportSessionLost("teste");
  await sup.currentRecovery();
  assert.equal(sup.isHealthy(), true);
});

test("falha ao persistir no cofre não interrompe a sessão", async () => {
  const { sup, state } = build({ persistRefreshToken: async () => { throw new Error("DPAPI indisponível"); } });
  sup.start();
  state.listener!("TOKEN_REFRESHED", session("rt-1"));
  await tick();
  assert.equal(sup.isHealthy(), true);
});
