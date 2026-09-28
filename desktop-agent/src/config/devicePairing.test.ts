import test from "node:test";
import assert from "node:assert/strict";
import { normalizePairingCode, pairAgentDevice, PairingError } from "./devicePairing";

function fakeFetch(status: number, body: unknown, calls: any[] = []): typeof fetch {
  return (async (url: any, init: any) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
}

const OK_BODY = { device_id: "d1", user_id: "u1", email: "u@x.com", access_token: "at", refresh_token: "rt" };

test("normalizePairingCode aceita minúsculas, hífen e espaços; rejeita tamanho e caracteres ambíguos", () => {
  assert.equal(normalizePairingCode("abcde-fghjk"), "ABCDEFGHJK");
  assert.equal(normalizePairingCode(" ABCDE FGHJK "), "ABCDEFGHJK");
  assert.equal(normalizePairingCode("ABCDE-FGHJ"), null);
  assert.equal(normalizePairingCode("ABCDE-FGH0K"), null); // 0 não existe no alfabeto
  assert.equal(normalizePairingCode(""), null);
});

test("pairAgentDevice chama a Edge Function com código normalizado e nome do computador", async () => {
  const calls: any[] = [];
  const r = await pairAgentDevice({
    supabaseUrl: "https://x.supabase.co/",
    supabaseAnonKey: "anon",
    code: "abcde-fghjk",
    deviceName: "PC-OFICINA",
    agentVersion: "1.2.3",
    fetchImpl: fakeFetch(200, OK_BODY, calls),
  });
  assert.equal(r.refreshToken, "rt");
  assert.equal(r.userId, "u1");
  assert.equal(calls[0].url, "https://x.supabase.co/functions/v1/agent-pair");
  assert.deepEqual(JSON.parse(calls[0].init.body), { code: "ABCDEFGHJK", device_name: "PC-OFICINA", agent_version: "1.2.3" });
  assert.equal(calls[0].init.headers.apikey, "anon");
});

test("código com formato errado não chega a chamar o servidor", async () => {
  const calls: any[] = [];
  await assert.rejects(
    () => pairAgentDevice({ supabaseUrl: "https://x", supabaseAnonKey: "a", code: "123", fetchImpl: fakeFetch(200, OK_BODY, calls) }),
    (e: any) => e instanceof PairingError && e.kind === "invalid_format"
  );
  assert.equal(calls.length, 0);
});

test("classifica respostas: 400 invalid_code, 5xx rede, corpo inesperado servidor, fetch lançando rede", async () => {
  const base = { supabaseUrl: "https://x", supabaseAnonKey: "a", code: "ABCDE-FGHJK" };
  const kind = async (fetchImpl: typeof fetch) => {
    try {
      await pairAgentDevice({ ...base, fetchImpl });
      return "ok";
    } catch (e: any) {
      return e.kind;
    }
  };
  assert.equal(await kind(fakeFetch(400, { error: "invalid_code" })), "invalid_code");
  assert.equal(await kind(fakeFetch(503, { error: "x" })), "network");
  assert.equal(await kind(fakeFetch(200, { user_id: "u1" })), "server");
  assert.equal(await kind((async () => { throw new TypeError("fetch failed"); }) as any), "network");
});
