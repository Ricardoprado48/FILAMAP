import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/supabase", () => ({ supabase: { from: vi.fn() } }));

import { supabase } from "../lib/supabase";
import { createFakeSupabase, type FakeQueryCall } from "../testUtils/fakeSupabase";
import { updateSpoolWeight, linkSpoolNfc, findSpoolByNfcUid } from "./spoolService";
import { buildWeighUpdate, buildNfcLinkUpdate } from "../utils/spoolStatus";

describe("updateSpoolWeight", () => {
  let calls: FakeQueryCall[];

  beforeEach(() => {
    calls = [];
    const fake = createFakeSupabase((call) => {
      calls.push(call);
      return { data: [{ id: call.filters[0]?.val, ...call.payload }], error: null };
    });
    vi.mocked(supabase.from).mockReset();
    vi.mocked(supabase.from).mockImplementation(fake.from as any);
  });

  it("atualiza apenas o carretel indicado (filtra por id) e preserva os campos Bambu", async () => {
    const payload = buildWeighUpdate({ grossWeight: "1200", tareWeight: "200" }, "2026-09-22T23:00:00.000Z");
    const { data, error } = await updateSpoolWeight("spool-1", payload);

    expect(error).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe("spools");
    expect(calls[0].method).toBe("update");
    expect(calls[0].filters).toEqual([{ col: "id", val: "spool-1" }]);

    const payloadKeys = Object.keys(calls[0].payload);
    expect(payloadKeys.some((k) => k.startsWith("bambu_"))).toBe(false);
    expect(payloadKeys).not.toContain("bambu_spool_id");
    expect(data).toEqual([{ id: "spool-1", ...payload }]);
  });
});

describe("linkSpoolNfc", () => {
  let calls: FakeQueryCall[];

  beforeEach(() => {
    calls = [];
    const fake = createFakeSupabase((call) => {
      calls.push(call);
      return { data: [{ id: call.filters[0]?.val, ...call.payload }], error: null };
    });
    vi.mocked(supabase.from).mockReset();
    vi.mocked(supabase.from).mockImplementation(fake.from as any);
  });

  it("só grava nfc_uid no carretel já existente indicado (nunca insere linha nova)", async () => {
    const payload = buildNfcLinkUpdate("TAG-1");
    await linkSpoolNfc("spool-1", payload);

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("update");
    expect(calls[0].filters).toEqual([{ col: "id", val: "spool-1" }]);
    expect(calls[0].payload).toEqual({ nfc_uid: "TAG-1" });
  });

  it("propaga o erro do banco (ex.: violação da UNIQUE(nfc_uid) por tag já vinculada a outro carretel)", async () => {
    const fake = createFakeSupabase(() => ({
      data: null,
      error: { message: "duplicate key value violates unique constraint", code: "23505" },
    }));
    vi.mocked(supabase.from).mockReset();
    vi.mocked(supabase.from).mockImplementation(fake.from as any);

    const { error } = await linkSpoolNfc("spool-1", buildNfcLinkUpdate("TAG-1"));
    expect(error?.code).toBe("23505");
  });
});

describe("findSpoolByNfcUid", () => {
  it("busca o carretel que já usa a tag para pré-checagem de duplicidade", async () => {
    const calls: FakeQueryCall[] = [];
    const fake = createFakeSupabase((call) => {
      calls.push(call);
      return { data: { id: "spool-existing", color_name: "Azul", brand: "Voolt3D" }, error: null };
    });
    vi.mocked(supabase.from).mockReset();
    vi.mocked(supabase.from).mockImplementation(fake.from as any);

    const { data } = await findSpoolByNfcUid("TAG-1");

    expect(calls[0].filters).toEqual([{ col: "nfc_uid", val: "TAG-1" }]);
    expect(data?.id).toBe("spool-existing");
  });
});
