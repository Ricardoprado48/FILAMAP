import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/supabase", () => ({ supabase: { from: vi.fn() } }));

import { supabase } from "../lib/supabase";
import { createFakeSupabase, type FakeQueryCall } from "../testUtils/fakeSupabase";
import {
  updateSpoolWeight,
  linkSpoolNfc,
  findSpoolByNfcUid,
  unlinkSpoolNfc,
  updateSpoolLocation,
  createSpool,
} from "./spoolService";
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

describe("unlinkSpoolNfc", () => {
  it("zera nfc_uid e nfc_written_at sem tocar em peso ou localização", async () => {
    const calls: FakeQueryCall[] = [];
    const fake = createFakeSupabase((call) => {
      calls.push(call);
      return { data: [{ id: "spool-1", ...call.payload }], error: null };
    });
    vi.mocked(supabase.from).mockReset();
    vi.mocked(supabase.from).mockImplementation(fake.from as any);

    await unlinkSpoolNfc("spool-1");

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("update");
    expect(calls[0].filters).toEqual([{ col: "id", val: "spool-1" }]);
    expect(calls[0].payload).toEqual({ nfc_uid: null, nfc_written_at: null });
  });
});

describe("updateSpoolLocation", () => {
  it("atualiza a localização do carretel com sucesso quando a coluna existe", async () => {
    const calls: FakeQueryCall[] = [];
    const fake = createFakeSupabase((call) => {
      calls.push(call);
      return { data: [{ id: "spool-1", ...call.payload }], error: null };
    });
    vi.mocked(supabase.from).mockReset();
    vi.mocked(supabase.from).mockImplementation(fake.from as any);

    const res = await updateSpoolLocation("spool-1", "Prateleira A1");

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("update");
    expect(calls[0].filters).toEqual([{ col: "id", val: "spool-1" }]);
    expect(calls[0].payload).toEqual({ location: "Prateleira A1" });
    expect(res.data).toEqual([{ id: "spool-1", location: "Prateleira A1" }]);
  });

  it("retorna locationPendingMigration caso o banco retorne PGRST204", async () => {
    const fake = createFakeSupabase(() => ({
      data: null,
      error: { code: "PGRST204", message: "Could not find the 'location' column" },
    }));
    vi.mocked(supabase.from).mockReset();
    vi.mocked(supabase.from).mockImplementation(fake.from as any);

    const res = await updateSpoolLocation("spool-1", "Prateleira A1");
    expect((res as any).locationPendingMigration).toBe(true);
  });
});

describe("createSpool", () => {
  it("insere carretel no estoque com todos os campos informados", async () => {
    const calls: FakeQueryCall[] = [];
    const fake = createFakeSupabase((call) => {
      calls.push(call);
      return { data: { id: "spool-created", ...call.payload }, error: null };
    });
    vi.mocked(supabase.from).mockReset();
    vi.mocked(supabase.from).mockImplementation(fake.from as any);

    const payload = {
      filament_product_id: "prod-1",
      brand: "VIDA BUENAS",
      material: "PLA",
      color_name: "PLA BRANCO ULTRA SILK",
      color_hex: "#FFFFFF",
      current_weight: 1000,
      spool_tare_weight: 200,
      location: "Prateleira A1",
      filament_profile_id: "P6337f36",
    };

    const res = await createSpool(payload);

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("insert");
    expect(calls[0].payload.brand).toBe("VIDA BUENAS");
    expect(calls[0].payload.current_weight).toBe(1000);
    expect(calls[0].payload.spool_tare_weight).toBe(200);
    expect(calls[0].payload.location).toBe("Prateleira A1");
    expect(calls[0].payload.filament_profile_id).toBe("P6337f36");
    expect(calls[0].payload.filament_product_id).toBe("prod-1");
    expect(res.data.id).toBe("spool-created");
  });

  it("sem preço grava NULL (nunca o antigo padrão de R$ 85) e não inventa vínculo com a nuvem", async () => {
    const calls: FakeQueryCall[] = [];
    const fake = createFakeSupabase((call) => {
      calls.push(call);
      return { data: { id: "spool-x", ...call.payload }, error: null };
    });
    vi.mocked(supabase.from).mockReset();
    vi.mocked(supabase.from).mockImplementation(fake.from as any);

    await createSpool({
      filament_product_id: "prod-1",
      brand: null,
      material: "PLA",
      color_name: "+ PLA AZUL VELVET VOOLT",
      color_hex: null,
      current_weight: 742,
      spool_tare_weight: 190,
    });

    expect(calls[0].payload.price_paid).toBeNull();
    expect(calls[0].payload.initial_weight).toBe(742);
    expect("bambu_spool_id" in calls[0].payload).toBe(false);
  });

  it("grava bambu_spool_id só quando vem da caixa de entrada (ação explícita)", async () => {
    const calls: FakeQueryCall[] = [];
    const fake = createFakeSupabase((call) => {
      calls.push(call);
      return { data: { id: "spool-y", ...call.payload }, error: null };
    });
    vi.mocked(supabase.from).mockReset();
    vi.mocked(supabase.from).mockImplementation(fake.from as any);

    await createSpool({
      filament_product_id: "prod-1",
      brand: "Bambu Lab",
      material: "PLA",
      color_name: "PLA Lite Amarelo",
      color_hex: "#FFB549",
      current_weight: 1000,
      spool_tare_weight: 250,
      bambu_spool_id: "8594733",
    });

    expect(calls[0].payload.bambu_spool_id).toBe("8594733");
  });

  it("executa fallback sem location se a migration estiver pendente no banco remoto (PGRST204)", async () => {
    let callCount = 0;
    const calls: FakeQueryCall[] = [];
    const fake = createFakeSupabase((call) => {
      calls.push(call);
      callCount++;
      if (callCount === 1) {
        return { data: null, error: { code: "PGRST204", message: "Could not find 'location'" } };
      }
      return { data: { id: "spool-created-fallback", ...call.payload }, error: null };
    });
    vi.mocked(supabase.from).mockReset();
    vi.mocked(supabase.from).mockImplementation(fake.from as any);

    const res = await createSpool({
      filament_product_id: "prod-2",
      brand: "Voolt3D",
      material: "PLA",
      color_name: "Azul",
      color_hex: "#0000FF",
      current_weight: 1000,
      spool_tare_weight: 218,
      location: "Prateleira B2",
    });

    expect(callCount).toBe(2);
    expect(calls[0].payload.location).toBe("Prateleira B2");
    expect(calls[1].payload.location).toBeUndefined();
    expect((res as any).locationPendingMigration).toBe(true);
    expect(res.data.id).toBe("spool-created-fallback");
  });
});

