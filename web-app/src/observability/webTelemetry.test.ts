import { describe, it, expect, vi, beforeEach } from "vitest";

const rpc = vi.fn();
const getSession = vi.fn();
vi.mock("../lib/supabase", () => ({
  supabase: { rpc: (...a: any[]) => rpc(...a), auth: { getSession: () => getSession(), onAuthStateChange: vi.fn() } },
}));

import { webEmit, flushWebTelemetry, sanitizer, _resetWebTelemetryForTests, _webQueueForTests } from "./webTelemetry";

beforeEach(() => {
  _resetWebTelemetryForTests();
  rpc.mockReset();
  getSession.mockReset();
});

describe("webEmit / flush", () => {
  it("nunca lança, mesmo com erro estranho", () => {
    const evil = { toString() { throw new Error("x"); } };
    expect(() => webEmit("WEB_ERROR", { error: evil })).not.toThrow();
  });

  it("sem sessão não chama a RPC e mantém a fila", async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    webEmit("WEB_ERROR", { error: new Error("falhou") });
    expect(await flushWebTelemetry()).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
    expect(_webQueueForTests()).toHaveLength(1);
  });

  it("com sessão envia como instalação web e esvazia a fila; segredo registrado não sai", async () => {
    getSession.mockResolvedValue({ data: { session: { user: { id: "u" } } } });
    rpc.mockResolvedValue({ data: { ok: true }, error: null });
    sanitizer.registerSecret("tokenzinho-ficticio-123");
    webEmit("WEB_ERROR", { error: new Error("falha com tokenzinho-ficticio-123") });
    expect(await flushWebTelemetry()).toBe(true);
    const [fn, args] = rpc.mock.calls[0];
    expect(fn).toBe("ingest_ops_events");
    expect(args.p_installation.kind).toBe("web");
    expect(JSON.stringify(args)).not.toContain("tokenzinho-ficticio-123");
    expect(_webQueueForTests()).toHaveLength(0);
  });

  it("erro repetido em 60 s vira 1 evento com repeat_count", async () => {
    for (let i = 0; i < 5; i++) webEmit("WEB_ERROR", { error: new Error("render quebrou 7") });
    expect(_webQueueForTests()).toHaveLength(1);
  });

  it("RPC falhando mantém a fila", async () => {
    getSession.mockResolvedValue({ data: { session: { user: { id: "u" } } } });
    rpc.mockResolvedValue({ data: null, error: { message: "rede" } });
    webEmit("SUPPORT_REQUEST", { message: "ajuda" });
    expect(await flushWebTelemetry()).toBe(false);
    expect(_webQueueForTests()).toHaveLength(1);
  });
});
